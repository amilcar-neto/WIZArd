import { readFile, lstat, realpath, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { eligibleForDeletion } from './retention.ts';
import { withState } from './json-state.ts';
export async function cleanupTranscript(receiptPath: string, managedRoot: string, now = new Date()) {
  return withState(receiptPath, async (state, save) => {
    if (state.transcriptDeletedAt || !state.retention || !eligibleForDeletion(state.retention, now)) return false;
    if (extname(state.input).toLowerCase() !== '.txt') return false;
    let stat;
    try { stat = await lstat(state.input); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const root = await realpath(resolve(managedRoot)), input = await realpath(state.input);
    const rel = relative(root, input);
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) return false;
    const summary = receiptPath.slice(0, -'.state.json'.length);
    const outputHash = createHash('sha256').update(await readFile(summary, 'utf8')).digest('hex');
    const inputHash = createHash('sha256').update(await readFile(input, 'utf8')).digest('hex');
    if (outputHash !== state.outputHash || inputHash !== state.inputHash) return false;
    await unlink(input);
    state.transcriptDeletedAt = now.toISOString(); await save();
    return true;
  });
}