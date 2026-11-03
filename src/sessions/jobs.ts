import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { saveJson, withState } from '../storage/json-state.ts';
import { SessionLibrary, managedFile, type Session } from './library.ts';
import { runProcess, type Selection } from '../summaries/providers.ts';
import { summarize } from '../summaries/summarize.ts';
import { queueCollection } from '../collection/queue.ts';
import { t, setting, enabled } from '../config/texts.ts';
import { campaignContext } from './campaign-glossary.ts';

export type Job = { sessionId: string; action: 'transcribe' | 'summarize'; status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'blocked'; requestedAt: string; finishedAt?: string; notified?: boolean };
type Workers = { run?: typeof runProcess; summarize?: typeof summarize; busy?: () => Promise<boolean>; pollMs?: number };

// O servidor está ocupado quando o StreamAmigos tem sala aberta (config/ajustes.txt).
// Se a consulta falhar, não bloqueia: melhor transcrever do que ficar esperando para sempre.
export async function streamBusy(): Promise<boolean> {
  if (!enabled('esperar_streamamigos', true)) return false;
  try {
    const response = await fetch(setting('streamamigos_endereco', 'http://127.0.0.1:3100/api/info'), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    return Number((await response.json() as { abertas?: unknown }).abertas) > 0;
  } catch { return false; }
}

export class SessionJobs {
  private running = false;
  private dir: string;
  private library: SessionLibrary; private notify: (job: Job, session?: Session) => Promise<void>;
  private workers: Workers;
  constructor(library: SessionLibrary, notify: (job: Job, session?: Session) => Promise<void>, workers: Workers = {}) {
    this.library = library; this.notify = notify; this.dir = join(library.root, 'tarefas'); this.workers = workers;
  }
  // Por padrão nunca espera; o bot liga a espera do StreamAmigos.
  waiting() { return (this.workers.busy ?? (async () => false))(); }
  private path(id: string, action: string) {
    if (!/^[a-f0-9]{32}$/.test(id) || !['transcribe', 'summarize'].includes(action)) throw new Error('Tarefa inválida.');
    return join(this.dir, `${id}-${action}.json`);
  }
  async enqueue(id: string, action: Job['action']) {
    const session = await this.library.get(id);
    if (!session) throw new Error(t('erro.sessao_nao_encontrada'));
    if (session.status === 'recording') throw new Error(t('erro.sessao_gravando'));
    const available = await this.library.available(session);
    if (action === 'transcribe' && available.transcript) throw new Error(t('erro.ja_transcrita'));
    if (action === 'transcribe' && !available.audio.length) throw new Error(t('erro.sem_audio'));
    if (action === 'summarize' && available.summary) throw new Error(t('erro.ja_resumida'));
    if (action === 'summarize' && !available.transcript) throw new Error(t('erro.transcreva_antes'));
    if (action === 'summarize' && session.classification?.accepted === false) throw new Error(t('erro.nao_e_mesa'));
    await mkdir(this.dir, { recursive: true });
    const path = this.path(id, action);
    // Inicialização exclusiva; withState serializa cliques concorrentes no mesmo pedido.
    const { open } = await import('node:fs/promises');
    try { const handle = await open(path, 'wx', 0o600); await handle.writeFile('{}'); await handle.close(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return withState(path, async (job, save) => {
      if (job.status === 'queued' || job.status === 'running') return { queued: false };
      Object.assign(job, { sessionId: id, action, status: 'queued', requestedAt: new Date().toISOString(), notified: false });
      delete job.finishedAt; await save(); return { queued: true };
    });
  }
  // Resposta do dono à pergunta "é Serpente?". Sim: libera e já pede o resumo. Não: só registra.
  async confirmCampaign(id: string, isCampaign: boolean) {
    const session = await this.library.get(id);
    if (!session) throw new Error(t('erro.sessao_nao_encontrada'));
    session.classification = { category: session.classification?.category ?? 'uncertain', confidence: session.classification?.confidence ?? 0, accepted: isCampaign, ownerDecision: isCampaign ? 'yes' : 'no' };
    await this.library.save(session);
    if (!isCampaign || (await this.library.available(session)).summary) return undefined;
    return this.enqueue(id, 'summarize');
  }
  async recover() {
    await mkdir(this.dir, { recursive: true });
    for (const path of await this.paths()) {
      const job = JSON.parse(await readFile(path, 'utf8')) as Job;
      if (job.status === 'running') { job.status = 'interrupted'; job.notified = false; await saveJson(path, job); }
    }
  }
  // Glossário e vocabulário gerados da coleção a cada pedido (dados/auto/), para acompanhar a campanha.
  private async context() {
    const history = process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md';
    const context = await campaignContext(resolve(history), resolve('config/vocabulario.txt'));
    const dir = join(this.library.root, 'auto'); await mkdir(dir, { recursive: true });
    const vocabulary = join(dir, 'vocabulario.txt'), glossary = join(dir, 'glossario.md');
    await writeFile(vocabulary, context.whisper.map(term => term + '\n').join(''));
    if (context.glossary) await writeFile(glossary, context.glossary);
    return { vocabulary, glossary: context.glossary ? glossary : undefined, references: context.names };
  }
  private async paths() { return (await readdir(this.dir)).filter(n => /^[a-f0-9]{32}-(transcribe|summarize)\.json$/.test(n)).sort().map(n => join(this.dir, n)); }
  // Transcrição com prioridade baixa (Linux) e pausada enquanto o servidor estiver ocupado.
  private async transcribe(input: unknown, transcript: string) {
    const python = process.env.WIZARD_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const args = [resolve('scripts/transcribe.py'), '--output', transcript, '--model', process.env.WIZARD_WHISPER_MODEL ?? 'small', '--language', 'pt', '--threads', process.env.WIZARD_TRANSCRIBE_THREADS ?? '2', '--vocab', (await this.context()).vocabulary];
    const [file, argv] = process.platform === 'linux' ? ['nice', ['-n', '19', python, ...args]] : [python, args];
    let pid: number | undefined, paused = false, checking = false;
    const canPause = process.platform !== 'win32';
    const watch = setInterval(async () => {
      if (!pid || checking || !canPause) return;
      checking = true;
      try {
        const busy = await this.waiting();
        if (busy !== paused) { process.kill(pid, busy ? 'SIGSTOP' : 'SIGCONT'); paused = busy; }
      } catch {} finally { checking = false; }
    }, this.workers.pollMs ?? 15000);
    try {
      return await (this.workers.run ?? runProcess)(file, argv, JSON.stringify(input) + '\n', process.cwd(), Number(process.env.WIZARD_TRANSCRIBE_TIMEOUT_MS ?? 21600000), { onSpawn: p => { pid = p; }, isPaused: () => paused });
    } finally {
      clearInterval(watch);
      if (paused && pid) try { process.kill(pid, 'SIGCONT'); } catch {}
    }
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await Promise.all((await this.paths()).map(async path => ({ path, job: JSON.parse(await readFile(path, 'utf8')) as Job })));
      for (const { path, job } of jobs) {
        if (job.status === 'queued') continue;
        if (!job.notified && ['done', 'failed', 'interrupted', 'blocked'].includes(job.status)) {
          await this.notify(job, await this.library.get(job.sessionId)); job.notified = true; await saveJson(path, job);
        }
      }
      const next = jobs.filter(j => j.job.status === 'queued').sort((a, b) => a.job.requestedAt.localeCompare(b.job.requestedAt))[0];
      if (!next || await this.waiting()) return;
      const { path, job } = next;
      job.status = 'running'; await saveJson(path, job);
      let session: Session | undefined;
      try {
        session = await this.library.get(job.sessionId);
        if (!session || session.status === 'recording') throw new Error('Sessão indisponível.');
        const files = await this.library.available(session);
        if (job.action === 'transcribe') {
          const transcript = join(this.library.sessions, session.id, 'transcricao.txt');
          if (!await managedFile(this.library.root, transcript)) {
            // Com faixas por pessoa, a transcrição sai com nomes; sem elas, usa o áudio misturado.
            const input = files.speakers.length ? { tracks: files.speakers.map(s => ({ name: s.name, path: s.file, offset: s.offset })) } : files.audio;
            const result = await this.transcribe(input, transcript);
            if (result.code !== 0) throw new Error('Transcrição falhou.');
          }
          session.transcript = transcript; await this.library.save(session);
          await this.library.armAudioRetention(session, Number(process.env.WIZARD_AUDIO_RETENTION_DAYS ?? 14));
        } else {
          if (!files.transcript) throw new Error('Transcrição indisponível.');
          const output = join(this.library.summaries, session.id + '.md'), context = await this.context();
          await (this.workers.summarize ?? summarize)({ input: files.transcript, output, formatter: process.env.FORMATADOR_PATH ?? 'Arquivo Formato Resumo de Sessão.md',
            selection: (process.env.WIZARD_PROVIDER ?? 'auto') as Selection, timeoutMs: Number(process.env.WIZARD_TIMEOUT_MS ?? 900000),
            ownerConfirmed: session.classification?.ownerDecision === 'yes', glossary: context.glossary, references: context.references });
          await queueCollection({ summary: output, history: process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md' });
          session.summary = output; await this.library.save(session);
        }
        job.status = 'done';
      } catch (e) {
        job.status = (e as NodeJS.ErrnoException).code === 'WIZARD_CAMPAIGN_MISMATCH' ? 'blocked' : 'failed';
        if (job.status === 'blocked' && session) {
          const result = JSON.parse(await readFile(join(this.library.summaries, session.id + '.md.classification.json'), 'utf8'));
          session.classification = { category: result.category, accepted: false, confidence: result.confidence }; await this.library.save(session);
        }
      }
      job.finishedAt = new Date().toISOString(); await saveJson(path, job);
      await this.notify(job, session); job.notified = true; await saveJson(path, job);
    } finally { this.running = false; }
  }
}
