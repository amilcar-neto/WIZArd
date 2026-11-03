import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function queueFiles(root: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await queueFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.collection.json')) result.push(path);
  }
  return result;
}