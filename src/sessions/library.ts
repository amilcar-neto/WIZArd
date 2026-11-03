import { readdir, readFile, realpath, lstat, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { saveJson } from '../storage/json-state.ts';
import { queueFiles } from '../storage/queue-files.ts';
import { t } from '../config/texts.ts';
import { localDate, localTime } from '../config/time.ts';

export type Session = {
  id: string; title: string; startedAt: string; endedAt?: string; status: 'recording' | 'ready' | 'interrupted';
  guildId?: string; channelId?: string; summary?: string; transcript?: string; audio: string[];
  audioExpiresAt?: string; audioHashes?: Record<string, string>; audioDeletedAt?: string;
  // ownerDecision: resposta do dono quando a IA não reconheceu a mesa ('yes' libera o resumo).
  classification?: { category: string; accepted: boolean; confidence: number; ownerDecision?: 'yes' | 'no' };
  // Uma faixa por pessoa; offset = segundos desde o início da gravação. Usada para pôr nomes na transcrição.
  speakers?: Speaker[];
};
export type Speaker = { userId: string; name: string; file: string; offset: number; complete: boolean };
// Tudo o que é áudio da sessão: partes misturadas (para baixar) e faixas por pessoa.
const audioPaths = (s: Session) => [...s.audio, ...(s.speakers ?? []).map(t => t.file)];
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
  async armAudioRetention(session: Session, days: number) {
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('Retenção de áudio deve ser de 1 a 365 dias.');
    if (session.audioExpiresAt) return;
    session.audioHashes = {};
    for (const file of audioPaths(session)) {
      if (!await managedFile(this.root, file)) continue;
      session.audioHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
    session.audioExpiresAt = new Date(Date.now() + days * 86400000).toISOString(); await this.save(session);
  }
  async cleanupAudio(now = Date.now()) {
    for (const session of await this.list()) {
      if (session.status === 'recording' || session.audioDeletedAt || !session.audioExpiresAt || !Number.isFinite(Date.parse(session.audioExpiresAt)) || Date.parse(session.audioExpiresAt) > now) continue;
      // Áudio sem transcrição preservada não é apagado automaticamente.
      const transcript = await managedFile(this.root, session.transcript);
      if (!transcript && !await managedFile(this.root, session.summary)) continue;
      for (const path of audioPaths(session)) {
        const safe = await managedFile(this.root, path);
        if (!safe) continue;
        const actual = createHash('sha256').update(await readFile(safe)).digest('hex');
        if (actual === session.audioHashes?.[path]) await unlink(safe);
      }
      if (!(await this.available(session)).audio.length) { session.audioDeletedAt = new Date(now).toISOString(); await this.save(session); }
    }
  }
}
