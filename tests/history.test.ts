import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory } from '../src/collection/history.ts';
async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const summary = join(dir, 'resumo.md'), history = join(dir, 'historico.md');
  await writeFile(summary, '# Sessão 11: Teste\n\nA porta foi aberta.\n');
  return { summary, history };
}
test('acrescenta ao final e backup preserva bytes antigos, inclusive CRLF', async t => {
  const o = await fixture(t), before = Buffer.from('# Sessão 10: Anterior\r\n\r\nTexto antigo.\r\n');
  await writeFile(o.history, before);
  const result = await appendHistory(o);
  assert.equal(result.added, true); assert.deepEqual(await readFile(result.backup!), before);
  const after = await readFile(o.history);
  assert.deepEqual(after.subarray(0, before.length), before);
  assert.match(after.toString(), /Sessão 11/);
});
test('cria histórico e snapshot inicial vazio', async t => {
  const o = await fixture(t), r = await appendHistory(o);
  assert.equal((await readFile(r.backup!)).length, 0); assert.match(await readFile(o.history, 'utf8'), /A porta/);
});
test('retomada não duplica nem cria backup desnecessário', async t => {
  const o = await fixture(t); await appendHistory(o);
  const before = await readFile(o.history), backups = await readdir(o.history + '.backups');
  assert.equal((await appendHistory(o)).added, false);
  assert.deepEqual(await readFile(o.history), before); assert.deepEqual(await readdir(o.history + '.backups'), backups);
});
test('mesma sessão com texto diferente preserva histórico', async t => {
  const o = await fixture(t); await appendHistory(o); const before = await readFile(o.history);
  await writeFile(o.summary, '# Sessão 11: Outro resumo\nOutro texto.');
  await assert.rejects(appendHistory(o), /outro conteúdo/); assert.deepEqual(await readFile(o.history), before);
});
test('falha na substituição preserva histórico, backup e resumo para retomada', async t => {
  const o = await fixture(t); await writeFile(o.history, 'Histórico existente.');
  await assert.rejects(appendHistory({ ...o, replace: async () => { throw new Error('falha simulada'); } }), /falha simulada/);
  assert.equal(await readFile(o.history, 'utf8'), 'Histórico existente.');
  const files = await readdir(o.history + '.backups');
  assert.equal(await readFile(join(o.history + '.backups', files[0]), 'utf8'), 'Histórico existente.');
  await access(o.summary); await assert.rejects(access(o.history + '.lock'));
  assert.equal((await appendHistory(o)).added, true);
});
test('bloqueio impede duas escritas e não remove bloqueio de outra execução', async t => {
  const o = await fixture(t); await writeFile(o.history + '.lock', 'outra execução');
  await assert.rejects(appendHistory(o), /ocupado/); await access(o.history + '.lock'); await assert.rejects(access(o.history));
});
test('histórico antigo sem marcador não recebe a mesma sessão outra vez', async t => {
  const o = await fixture(t); await writeFile(o.history, '# Sessão 11: Versão antiga\nTexto.');
  await assert.rejects(appendHistory(o), /sem marcador/);
});