import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export async function saveJson(path: string, data: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(data, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
export async function withState<T>(path: string, action: (state: any, save: () => Promise<void>) => Promise<T>) {
  let lock;
  try { lock = await open(path + '.lock', 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Operação em andamento; tente novamente em alguns segundos.'); throw e; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await lock.sync();
    const state = JSON.parse(await readFile(path, 'utf8'));
    return await action(state, () => saveJson(path, state));
  } finally { await lock.close(); await unlink(path + '.lock'); }
}