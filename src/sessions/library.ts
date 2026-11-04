import { readdir, readFile, realpath, lstat, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { saveJson } from '../storage/json-state.ts';
import { queueFiles } from '../storage/queue-files.ts';
import { t, setting } from '../config/texts.ts';
import { localDate, localTime } from '../config/time.ts';

export type Session = {
  id: string; title: string; startedAt: string; endedAt?: string; status: 'recording' | 'ready' | 'interrupted';
  guildId?: string; channelId?: string; summary?: string; transcript?: string; audio: string[];
  audioExpiresAt?: string; audioHashes?: Record<string, string>; audioDeletedAt?: string;
  // ownerDecision: resposta do dono quando a IA não reconheceu a mesa ('yes' libera o resumo).
  classification?: { category: string; accepted: boolean; confidence: number; ownerDecision?: 'yes' | 'no' };
  // Uma faixa por pessoa; offset = segundos desde o início da gravação. Usada para pôr nomes na transcrição.
  speakers?: Speaker[];
  // Transcrição sem resumo expira dias_guarda depois de pronta (o hash impede apagar arquivo trocado).
  transcriptReadyAt?: string; transcriptHash?: string; transcriptExpiresAt?: string; transcriptDeletedAt?: string;
  // Pós-sessão automático: depois da transcrição, pedir o resumo sozinho.
  autoSummarize?: boolean;
};
export type Speaker = { userId: string; name: string; file: string; offset: number; complete: boolean };
// Tudo o que é áudio da sessão: partes misturadas (para baixar) e faixas por pessoa.
const audioPaths = (s: Session) => [...s.audio, ...(s.speakers ?? []).map(t => t.file)];
const DAY = 86400000;
// Prazo único de guarda do áudio e da transcrição sem resumo (config/ajustes.txt, padrão 7 dias).
export function retentionDays() {
  const days = Number(setting('dias_guarda', '7'));
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('config/ajustes.txt: dias_guarda deve ser um número inteiro de 1 a 365.');
  return days;
}
const sha256 = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
export const fileId = (path: string) => createHash('sha256').update(resolve(path)).digest('hex').slice(0, 32);
export async function managedFile(root: string, path?: string): Promise<string | undefined> {
  if (!path) return;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return;
    const base = await realpath(root), actual = await realpath(path), rel = relative(base, actual);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) return;
    return actual;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
export class SessionLibrary {
  root: string; summaries: string; sessions: string;
  constructor(root = 'dados', summaries = 'dados/resumos') {
    this.root = resolve(root); this.summaries = resolve(summaries); this.sessions = join(this.root, 'sessoes');
  }
  path(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Sessão inválida.');
    return join(this.sessions, id, 'session.json');
  }
  async create(guildId: string, channelId: string) {
    const id = randomUUID().replaceAll('-', ''), startedAt = new Date().toISOString();
    const session: Session = { id, title: t('sessao.nome', { data: localDate(startedAt), hora: localTime(startedAt) }), startedAt, status: 'recording', guildId, channelId, audio: [] };
    await mkdir(join(this.sessions, id), { recursive: true }); await this.save(session); return session;
  }
  async save(session: Session) { await saveJson(this.path(session.id), session); }
  async list(): Promise<Session[]> {
    const found: Session[] = [];
    let dirs;
    try { dirs = await readdir(this.sessions, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; dirs = []; }
    for (const dir of dirs) {
      if (!dir.isDirectory() || dir.isSymbolicLink() || !/^[a-f0-9]{32}$/.test(dir.name)) continue;
      const session = JSON.parse(await readFile(this.path(dir.name), 'utf8')) as Session;
      if (session.id !== dir.name) throw new Error('Catálogo de sessões inconsistente.');
      found.push(session);
    }
    // Importa os resumos já existentes sem mover arquivos nem alterar seus recibos.
    for (const path of await queueFiles(this.summaries)) {
      const queue = JSON.parse(await readFile(path, 'utf8'));
      if (found.some(s => s.summary && resolve(s.summary) === resolve(queue.summary))) continue;
      let receipt: any = {};
      try { receipt = JSON.parse(await readFile(queue.summary + '.state.json', 'utf8')); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      found.push({ id: fileId(queue.summary), title: basename(queue.summary, '.md'), startedAt: queue.requestedAt,
        status: 'ready', summary: queue.summary, transcript: receipt.input, audio: [] });
    }
    return found.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  }
  async get(id: string) { return (await this.list()).find(s => s.id === id); }
  async available(session: Session) {
    const audio: string[] = [];
    for (const path of session.audio) { const safe = await managedFile(this.root, path); if (safe) audio.push(safe); }
    // Faixas por pessoa só valem se todas estiverem completas; senão a transcrição usa o áudio misturado.
    const speakers: Speaker[] = [];
    for (const s of session.speakers ?? []) { const file = s.complete ? await managedFile(this.root, s.file) : undefined; if (file) speakers.push({ ...s, file }); }
    const named = speakers.length > 0 && speakers.length === (session.speakers ?? []).length;
    return { summary: await managedFile(this.root, session.summary), transcript: await managedFile(this.root, session.transcript), audio, speakers: named ? speakers : [] };
  }
  async recover() {
    for (const session of await this.list()) {
      if (session.status !== 'recording') continue;
      session.status = 'interrupted'; session.endedAt = new Date().toISOString();
      session.audio = await this.audioFiles(session.id); await this.save(session);
    }
  }
  async audioFiles(id: string) {
    const dir = join(this.sessions, id);
    return (await readdir(dir)).filter(n => /^audio-\d+\.ogg$/.test(n)).sort().map(n => join(dir, n));
  }
  // Pedido na fila ou rodando impede apagar os arquivos da sessão.
  async pendingJob(id: string, action: 'transcribe' | 'summarize') {
    try { return ['queued', 'running'].includes(JSON.parse(await readFile(join(this.root, 'tarefas', `${id}-${action}.json`), 'utf8')).status); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
  }
  // Grava só os campos da retenção sobre a versão mais recente do arquivo, para não desfazer
  // o que a fila de tarefas salvou ao mesmo tempo (transcrição, resumo, classificação).
  private async patch(session: Session, fields: Partial<Session>) {
    Object.assign(session, fields);
    let fresh: Session;
    try { fresh = JSON.parse(await readFile(this.path(session.id), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; fresh = session; }
    await this.save(Object.assign(fresh, fields));
  }
  // O prazo conta a partir de "from" e nunca é encurtado: transcrever depois da gravação adia a exclusão.
  async armAudioRetention(session: Session, days: number, from = Date.now()) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('Retenção de áudio deve ser de 1 a 365 dias.');
    const hashes = { ...session.audioHashes };
    for (const file of audioPaths(session)) {
      if (hashes[file] || !await managedFile(this.root, file)) continue;
      hashes[file] = await sha256(file);
    }
    const deadline = from + days * DAY, current = Date.parse(session.audioExpiresAt ?? '');
    await this.patch(session, { audioHashes: hashes, audioExpiresAt: current >= deadline ? session.audioExpiresAt : new Date(deadline).toISOString() });
  }
  async armTranscriptRetention(session: Session, days: number, from = Date.now()) {
    const transcript = await managedFile(this.root, session.transcript);
    if (!transcript) return;
    await this.patch(session, { transcriptReadyAt: new Date(from).toISOString(), transcriptHash: await sha256(transcript), transcriptExpiresAt: new Date(from + days * DAY).toISOString() });
  }
  // Áudio (transcrito ou não) expira no prazo. Gravações antigas sem prazo ganham pelo menos 1 dia de carência.
  async cleanupAudio(now = Date.now(), days = retentionDays()) {
    for (const session of await this.list()) {
      if (session.status === 'recording' || session.audioDeletedAt || !audioPaths(session).length) continue;
      if (!session.audioExpiresAt) {
        const ended = Date.parse(session.endedAt ?? '');
        if (!Number.isFinite(ended)) continue;
        await this.armAudioRetention(session, days, Math.max(ended, now - days * DAY + DAY)); continue;
      }
      if (!(Date.parse(session.audioExpiresAt) <= now) || await this.pendingJob(session.id, 'transcribe')) continue;
      for (const path of audioPaths(session)) {
        const safe = await managedFile(this.root, path);
        if (safe && session.audioHashes?.[path] && await sha256(safe) === session.audioHashes[path]) await unlink(safe);
      }
      if (!(await this.available(session)).audio.length) await this.patch(session, { audioDeletedAt: new Date(now).toISOString() });
    }
  }
  // Transcrição sem resumo (conversa, teste, não é a mesa) expira no prazo. Com resumo vale o recibo do resumo.
  // Só transcrições feitas pelo bot, dentro da pasta da própria sessão.
  async cleanupTranscripts(now = Date.now(), days = retentionDays()) {
    for (const listed of await this.list()) {
      if (listed.status === 'recording' || listed.transcriptDeletedAt || !/^[a-f0-9]{32}$/.test(listed.id)) continue;
      let session: Session;
      try { session = JSON.parse(await readFile(this.path(listed.id), 'utf8')); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
      const transcript = await managedFile(join(this.sessions, session.id), session.transcript);
      if (!transcript || await managedFile(this.root, session.summary) || await this.pendingJob(session.id, 'summarize')) continue;
      if (!session.transcriptExpiresAt || !session.transcriptHash) {
        const ready = Date.parse(session.transcriptReadyAt ?? '') || (await lstat(transcript)).mtimeMs;
        await this.armTranscriptRetention(session, days, Math.max(ready, now - days * DAY + DAY)); continue;
      }
      if (!(Date.parse(session.transcriptExpiresAt) <= now) || await sha256(transcript) !== session.transcriptHash) continue;
      // Confere de novo logo antes de apagar: um resumo pode ter sido pedido enquanto o hash era calculado.
      if (await this.pendingJob(session.id, 'summarize') || (JSON.parse(await readFile(this.path(session.id), 'utf8')) as Session).summary) continue;
      await unlink(transcript);
      await this.patch(session, { transcriptDeletedAt: new Date(now).toISOString() });
    }
  }
}
