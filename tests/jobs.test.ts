import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionLibrary } from '../src/sessions/library.ts';
import { SessionJobs } from '../src/sessions/jobs.ts';
import { t } from '../src/config/texts.ts';
const same = (key: string) => (e: any) => String(e?.message ?? e).includes(t(key));

// Coleção fictícia: os testes nunca leem a coleção real.
const fakeHistory = join(tmpdir(), 'wizard-colecao-ficticia-' + process.pid + '.md');
await writeFile(fakeHistory, ['# Sessão 1: Teste', '## Personagens e NPCs introduzidos', '- *Zorvak* — vilão fictício.', ''].join('\n'));
process.env.WIZARD_HISTORY_PATH = fakeHistory;
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'wizard-jobs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const library = new SessionLibrary(root, join(root, 'resumos')), notifications: any[] = [];
  const jobs = new SessionJobs(library, async job => { notifications.push({ ...job }); });
  await jobs.recover(); const session = await library.create('1', '2'); session.status = 'ready';
  session.audio = [join(library.sessions, session.id, 'audio-0000.ogg')]; await writeFile(session.audio[0], 'fictício'); await library.save(session);
  return { root, library, jobs, session, notifications };
}
test('pedidos repetidos não duplicam tarefa e fila sobrevive à reinicialização', async t => {
  const { jobs, library, session } = await fixture(t);
  assert.equal((await jobs.enqueue(session.id, 'transcribe')).queued, true);
  assert.equal((await jobs.enqueue(session.id, 'transcribe')).queued, false);
  const next = new SessionJobs(library, async () => {}); await next.recover();
  assert.equal((await next.enqueue(session.id, 'transcribe')).queued, false);
});
test('tarefa em execução vira interrompida; não repete geração automaticamente', async t => {
  const { root, library, jobs, session, notifications } = await fixture(t); await jobs.enqueue(session.id, 'transcribe');
  const path = join(root, 'tarefas', (await readdir(join(root, 'tarefas')))[0]);
  const job = JSON.parse(await readFile(path, 'utf8')); job.status = 'running'; await writeFile(path, JSON.stringify(job));
  await jobs.recover(); await jobs.tick();
  assert.equal(JSON.parse(await readFile(path, 'utf8')).status, 'interrupted'); assert.equal(notifications[0].status, 'interrupted');
  assert.equal((await jobs.enqueue(session.id, 'transcribe')).queued, true);
});
test('não resume sem transcrição e não transcreve sessão ainda em gravação', async t => {
  const { jobs, library, session } = await fixture(t);
  await assert.rejects(jobs.enqueue(session.id, 'summarize'), /Transcreva/);
  session.status = 'recording'; await library.save(session); await assert.rejects(jobs.enqueue(session.id, 'transcribe'), same('erro.sessao_gravando'));
});
test('conclusão da transcrição atualiza catálogo, notifica e arma retenção sem chamar IA', async t => {
  const { library, session } = await fixture(t), notifications: any[] = []; let calls = 0;
  const jobs = new SessionJobs(library, async job => { notifications.push({ ...job }); }, { run: async (_file, args) => {
    calls++; await writeFile(args[args.indexOf('--output') + 1], 'Transcrição fictícia do teste.');
    return { code: 0, stdout: '', stderr: '' };
  } });
  await jobs.enqueue(session.id, 'transcribe'); await jobs.tick(); await jobs.tick();
  const updated = await library.get(session.id); assert.ok(updated?.transcript); assert.ok(updated?.audioExpiresAt);
  assert.equal(calls, 1); assert.equal(notifications.length, 1); assert.equal(notifications[0].status, 'done');
  assert.equal(await readFile(updated!.transcript!, 'utf8'), 'Transcrição fictícia do teste.');
});
test('reconhecimento negativo bloqueia resumo sem enfileirar coleção nem apagar transcrição', async t => {
  const { library, session } = await fixture(t), notifications: any[] = [];
  session.transcript = join(library.sessions, session.id, 'transcricao.txt'); await writeFile(session.transcript, 'Uma conversa normal.'); await library.save(session);
  const jobs = new SessionJobs(library, async job => { notifications.push({ ...job }); }, { summarize: async options => {
    await mkdir(library.summaries, { recursive: true });
    await writeFile(options.output + '.classification.json', JSON.stringify({ category: 'conversation', confidence: 0.99, accepted: false }));
    throw Object.assign(new Error('Não é a campanha.'), { code: 'WIZARD_CAMPAIGN_MISMATCH' });
  } });
  await jobs.enqueue(session.id, 'summarize'); await jobs.tick();
  assert.equal(notifications[0].status, 'blocked'); assert.equal((await library.get(session.id))?.classification?.accepted, false);
  await assert.rejects(access(join(library.summaries, session.id + '.md.collection.json'))); await access(session.transcript);
  await assert.rejects(jobs.enqueue(session.id, 'summarize'), same('erro.nao_e_mesa'));
});
test('faixas completas por pessoa vão para o transcritor com nome e horário de entrada', async t => {
  const { library, session } = await fixture(t); let sent: any;
  const a = join(library.sessions, session.id, 'falante-1.ogg'), b = join(library.sessions, session.id, 'falante-2.ogg');
  await writeFile(a, 'fictício'); await writeFile(b, 'fictício');
  session.speakers = [{ userId: '1', name: 'Ana', file: a, offset: 0, complete: true }, { userId: '2', name: 'Bruno', file: b, offset: 4.5, complete: true }];
  await library.save(session);
  const jobs = new SessionJobs(library, async () => {}, { run: async (_file, args, input) => {
    sent = { args, input: JSON.parse(input) }; await writeFile(args[args.indexOf('--output') + 1], '[00:00:01] Ana: oi');
    return { code: 0, stdout: '', stderr: '' };
  } });
  await jobs.enqueue(session.id, 'transcribe'); await jobs.tick();
  assert.deepEqual(sent.input.tracks.map((x: any) => [x.name, x.offset]), [['Ana', 0], ['Bruno', 4.5]]);
  assert.ok(sent.args.includes('--vocab'));
  const updated = await library.get(session.id);
  assert.ok(updated!.audioHashes![a] && updated!.audioHashes![b], 'faixas entram na retenção do áudio');
});
test('faixa incompleta faz a transcrição usar o áudio misturado, sem nomes', async t => {
  const { library, session } = await fixture(t); let sent: any;
  const a = join(library.sessions, session.id, 'falante-1.ogg'); await writeFile(a, 'fictício');
  session.speakers = [{ userId: '1', name: 'Ana', file: a, offset: 0, complete: true }, { userId: '2', name: 'Bruno', file: join(library.sessions, session.id, 'falante-2.ogg'), offset: 1, complete: false }];
  await library.save(session);
  const jobs = new SessionJobs(library, async () => {}, { run: async (_file, args, input) => {
    sent = JSON.parse(input); await writeFile(args[args.indexOf('--output') + 1], 'texto');
    return { code: 0, stdout: '', stderr: '' };
  } });
  await jobs.enqueue(session.id, 'transcribe'); await jobs.tick();
  assert.deepEqual(sent, session.audio);
});
test('mesa não reconhecida: dono confirma "é Serpente" e o resumo sai; "não é" bloqueia', async t => {
  const { library, session } = await fixture(t); const calls: any[] = [];
  session.transcript = join(library.sessions, session.id, 'transcricao.txt'); await writeFile(session.transcript, 'Sessão fictícia.'); await library.save(session);
  const jobs = new SessionJobs(library, async () => {}, { summarize: async options => {
    calls.push(options.ownerConfirmed);
    await mkdir(library.summaries, { recursive: true });
    if (!options.ownerConfirmed) {
      await writeFile(options.output + '.classification.json', JSON.stringify({ category: 'uncertain', confidence: 0.5, accepted: false }));
      throw Object.assign(new Error('dúvida'), { code: 'WIZARD_CAMPAIGN_MISMATCH' });
    }
    await writeFile(options.output, '# Resumo fictício\n'); await writeFile(options.output + '.state.json', '{}');
    return { output: options.output, resumed: false, provider: 'codex' };
  } });
  await jobs.enqueue(session.id, 'summarize'); await jobs.tick();
  assert.equal((await library.get(session.id))?.classification?.accepted, false);
  assert.equal((await jobs.confirmCampaign(session.id, true))?.queued, true);
  await jobs.tick();
  assert.deepEqual(calls, [false, true]);
  const done = await library.get(session.id);
  assert.equal(done?.classification?.ownerDecision, 'yes'); assert.ok(done?.summary);
  const other = (await fixture(t));
  other.session.transcript = join(other.library.sessions, other.session.id, 'transcricao.txt'); await writeFile(other.session.transcript, 'x'); await other.library.save(other.session);
  assert.equal(await other.jobs.confirmCampaign(other.session.id, false), undefined);
  await assert.rejects(other.jobs.enqueue(other.session.id, 'summarize'), same('erro.nao_e_mesa'));
});
test('pedido espera o StreamAmigos ficar sem salas para começar', async t => {
  const { library, session, root } = await fixture(t); let busy = true, calls = 0;
  const jobs = new SessionJobs(library, async () => {}, { busy: async () => busy, run: async (_f, args) => {
    calls++; await writeFile(args[args.indexOf('--output') + 1], 'texto'); return { code: 0, stdout: '', stderr: '' };
  } });
  await jobs.enqueue(session.id, 'transcribe'); await jobs.tick();
  assert.equal(calls, 0); assert.equal(await jobs.waiting(), true);
  const job = JSON.parse(await readFile(join(root, 'tarefas', (await readdir(join(root, 'tarefas')))[0]), 'utf8'));
  assert.equal(job.status, 'queued');
  busy = false; await jobs.tick(); assert.equal(calls, 1);
});
test('transcrição pausa quando abre sala e continua quando fecha', { skip: process.platform === 'win32' && 'pausa usa sinais do Linux' }, async t => {
  const { spawn } = await import('node:child_process');
  const { library, session } = await fixture(t); let busy = false; const seen: boolean[] = [];
  const jobs = new SessionJobs(library, async () => {}, { pollMs: 20, busy: async () => busy, run: async (_f, args, _i, _c, _ms, control) => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']); control!.onSpawn!(child.pid!);
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    busy = true; await wait(150); seen.push(control!.isPaused!());
    busy = false; await wait(150); seen.push(control!.isPaused!());
    child.kill('SIGKILL'); await writeFile(args[args.indexOf('--output') + 1], 'texto');
    return { code: 0, stdout: '', stderr: '' };
  } });
  await jobs.enqueue(session.id, 'transcribe'); await jobs.tick();
  assert.deepEqual(seen, [true, false]);
});
test('resumo recebe glossário e referências gerados da coleção', async t => {
  const { library, session } = await fixture(t); let got: any;
  session.transcript = join(library.sessions, session.id, 'transcricao.txt'); await writeFile(session.transcript, 'Sessão fictícia.'); await library.save(session);
  const jobs = new SessionJobs(library, async () => {}, { summarize: async options => {
    got = { glossary: await readFile(options.glossary!, 'utf8'), references: options.references };
    await mkdir(library.summaries, { recursive: true }); await writeFile(options.output, '# Resumo fictício\n'); await writeFile(options.output + '.state.json', '{}');
    return { output: options.output, resumed: false, provider: 'codex' };
  } });
  await jobs.enqueue(session.id, 'summarize'); await jobs.tick();
  assert.match(got.glossary, /Zorvak/); assert.deepEqual(got.references, ['Zorvak']);
});
