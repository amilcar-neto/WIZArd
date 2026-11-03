import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarize } from '../src/summaries/summarize.ts';
import { ProviderError, type GenerateOptions } from '../src/summaries/providers.ts';
import { validateClassification } from '../src/sessions/campaign.ts';
async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'entrada.txt'), output = join(dir, 'resumo.md'), formatter = join(dir, 'formato.md');
  await writeFile(input, 'Wolfgang abriu a porta da Caduceus. Cecília acompanhou.'); await writeFile(formatter, 'Resuma em Markdown.');
  const classifier = async ({ transcript }: { transcript: string }) => validateClassification({ category: 'campaign', campaignId: 'serpente-duas-cabecas', confidence: 0.99, reason: 'Cena fictícia de teste.', evidence: ['Wolfgang abriu a porta da Caduceus.', 'Cecília acompanhou.'] }, transcript);
  return { input, output, formatter, classifier };
}
const success = async () => ({ text: '# Resumo\nA porta foi aberta.', provider: 'codex' as const });
test('preserva formato integral, salva resumo e retoma sem gerar de novo', async t => {
  const o = await fixture(t); let calls = 0;
  const generator = async (request: GenerateOptions) => { calls++; assert.equal(request.formatter, await readFile(o.formatter, 'utf8')); assert.match(request.transcript, /porta/); return success(); };
  await summarize({ ...o, generator });
  assert.match(await readFile(o.output, 'utf8'), /porta/); await access(o.input);
  const receipt = JSON.parse(await readFile(o.output + '.state.json', 'utf8'));
  assert.equal(receipt.retention.deliveredAt, null); assert.equal(receipt.retention.deleteAfter, null); assert.equal(receipt.retention.days, 7);
  assert.equal((await summarize({ ...o, generator })).resumed, true); assert.equal(calls, 1); await access(o.input);
});
test('falha do provedor preserva entrada e não publica resumo', async t => {
  const o = await fixture(t);
  await assert.rejects(summarize({ ...o, generator: async () => { throw new ProviderError('codex', 'incomplete'); } }), /incomplete/);
  await access(o.input); await assert.rejects(access(o.output));
});
test('retomada detecta entrada alterada e nunca a remove', async t => {
  const o = await fixture(t); await summarize({ ...o, keepInput: true, generator: success });
  await writeFile(o.input, 'Outra sessão.'); await assert.rejects(summarize({ ...o, generator: success }), /mudou/);
  assert.equal(await readFile(o.input, 'utf8'), 'Outra sessão.');
});
test('saída existente nunca é sobrescrita', async t => {
  const o = await fixture(t); await writeFile(o.output, 'Original');
  await assert.rejects(summarize({ ...o, generator: success }), /já existe/);
  assert.equal(await readFile(o.output, 'utf8'), 'Original'); await access(o.input);
});
test('resposta vazia preserva entrada', async t => {
  const o = await fixture(t); await assert.rejects(summarize({ ...o, generator: async () => ({ text: ' ', provider: 'claude' }) }), /vazio/); await access(o.input);
});
test('mudar de provedor exige outra saída', async t => {
  const o = await fixture(t); await summarize({ ...o, keepInput: true, generator: success, selection: 'codex' });
  await assert.rejects(summarize({ ...o, selection: 'claude', generator: success }), /configuração/); await access(o.input);
});
