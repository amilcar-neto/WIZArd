import { readFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export async function queueCollection(o: { summary: string; history: string }) {
  const summary = resolve(o.summary), history = resolve(o.history);
  if (summary.toLowerCase() === history.toLowerCase()) throw new Error('Resumo e coleção precisam ter caminhos diferentes.');
  const bytes = await readFile(summary);
  if (!bytes.toString('utf8').trim()) throw new Error('Resumo vazio não pode ser enviado para aprovação.');
  const summaryHash = createHash('sha256').update(bytes).digest('hex');
  const path = summary + '.collection.json';
  const state = { version: 1, status: 'pending', summary, summaryHash, history, requestedAt: new Date().toISOString(), decidedAt: null, discordUserId: null, discordMessageId: null };
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const existing = JSON.parse(await readFile(path, 'utf8'));
    if (existing.summary !== summary || existing.summaryHash !== summaryHash || existing.history !== history) throw new Error('A pendência existente corresponde a outro conteúdo ou coleção. Revise antes de reenviar.');
    return { path, state: existing, created: false };
  }
  try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n'); await handle.sync(); }
  catch (e) { await handle.close(); await unlink(path).catch(() => {}); throw e; }
  await handle.close();
  // Nunca escreve no histórico: a decisão será processada pelo módulo Discord.
  return { path, state, created: true };
}