import { readFile, mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
type Options = { summary: string; history: string; sessionId?: string; replace?: typeof rename };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function syncedWrite(path: string, data: Buffer) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}
export async function appendHistory(o: Options) {
  const summary = resolve(o.summary), history = resolve(o.history);
  if (summary.toLowerCase() === history.toLowerCase()) throw new Error('O resumo e o histórico precisam ser arquivos diferentes.');
  if (extname(history).toLowerCase() !== '.md') throw new Error('O histórico deve ser um arquivo .md.');
  const summaryBytes = await readFile(summary), text = summaryBytes.toString('utf8');
  if (!text.trim()) throw new Error('O resumo está vazio. Histórico preservado.');
  if (text.includes('<!-- WIZArd:')) throw new Error('O resumo contém marcadores de histórico. Use o resumo individual.');
  const number = text.match(/^#\s+Sess[aã]o\s+(\d+)\b/im)?.[1];
  const sessionId = o.sessionId ?? (number ? 'sessao-' + Number(number) : 'texto-' + digest(summaryBytes));
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Identificador de sessão inválido.');
  const hash = digest(summaryBytes);
  await mkdir(dirname(history), { recursive: true });
  const lock = history + '.lock';
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Histórico ocupado. Se uma execução anterior foi interrompida, confira se terminou antes de remover o arquivo .lock.'); throw e; }
  let temporary: string | undefined;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await handle.sync();
    let previous = Buffer.alloc(0);
    try {
      const stat = await lstat(history);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('O histórico deve ser um arquivo regular sem link simbólico.');
      previous = await readFile(history);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const old = previous.toString('utf8');
    const markers = [...old.matchAll(/<!-- WIZArd:session=([a-zA-Z0-9_-]+);sha256=([a-f0-9]{64}) -->/g)];
    const sameId = markers.find(m => m[1] === sessionId);
    if (sameId && sameId[2] !== hash) throw new Error('Esta sessão já está no histórico com outro conteúdo. Nenhuma alteração foi feita.');
    if (sameId || markers.some(m => m[2] === hash) || old.includes(text.trim())) return { history, added: false, sessionId, backup: null };
    if (number && new RegExp('^#\\s+Sess[aã]o\\s+0*' + Number(number) + '\\b', 'im').test(old)) throw new Error('Esta sessão já existe no histórico sem marcador. Confira o texto antes de importar novamente.');
    const prefix = previous.length ? (old.endsWith('\n\n') ? '' : old.endsWith('\n') ? '\n' : '\n\n') : '# Histórico de sessões\n\n';
    const marker = '<!-- WIZArd:session=' + sessionId + ';sha256=' + hash + ' -->\n';
    const next = Buffer.concat([previous, Buffer.from(prefix + marker), summaryBytes, Buffer.from(text.endsWith('\n') ? '\n' : '\n\n')]);
    const backupDir = history + '.backups';
    await mkdir(backupDir, { recursive: true });
    const backup = join(backupDir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.bak');
    // Também registra o estado inicial vazio quando ainda não existe histórico.
    await syncedWrite(backup, previous);
    temporary = join(dirname(history), '.' + basename(history) + '.' + randomUUID() + '.tmp');
    await syncedWrite(temporary, next);
    // Detecta alterações feitas por outro programa durante a preparação.
    let current = Buffer.alloc(0);
    try { current = await readFile(history); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (!current.equals(previous)) throw new Error('O histórico mudou durante a operação. Backup salvo; tente novamente.');
    await (o.replace ?? rename)(temporary, history);
    temporary = undefined;
    return { history, added: true, sessionId, backup };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await handle.close();
    await unlink(lock);
  }
}