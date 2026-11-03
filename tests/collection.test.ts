import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { queueCollection } from '../src/collection/queue.ts';
async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-collection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const summary = join(dir, 'resumo.md'), history = join(dir, 'colecao.md');
  await writeFile(summary, '# Sessão 1\nUma porta abriu.');
  return { summary, history };
}
test('gerar pendência não cria nem altera a coleção', async t => {
  const o = await fixture(t); const r = await queueCollection(o);
  assert.equal(r.state.status, 'pending'); assert.equal(r.state.decidedAt, null);
  await assert.rejects(access(o.history));
  await writeFile(o.history, 'Coleção original'); await queueCollection(o);
  assert.equal(await readFile(o.history, 'utf8'), 'Coleção original');
});
test('retomada conserva pendência e não presume aprovação', async t => {
  const o = await fixture(t), first = await queueCollection(o), next = await queueCollection(o);
  assert.equal(next.created, false); assert.deepEqual(first.state, next.state);
});
test('trocar o resumo após preparar decisão exige revisão', async t => {
  const o = await fixture(t); await queueCollection(o); await writeFile(o.summary, 'Outro conteúdo');
  await assert.rejects(queueCollection(o), /outro conteúdo/); await assert.rejects(access(o.history));
});