import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { queueCollection } from '../src/collection/queue.ts';
import { deliverSummary, decideCollection, deliverCollection, splitMessage, type Transport, type Outgoing } from '../src/discord/delivery.ts';
import { pendingDelivery, afterConfirmedDmDelivery } from '../src/storage/retention.ts';
import { cleanupTranscript } from '../src/storage/cleanup.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function fixture(t: any, long = false) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-dm-')), dataRoot = join(dir, 'dados');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dataRoot);
  const summary = join(dataRoot, 'resumo.md'), history = join(dataRoot, 'colecao.md'), input = join(dataRoot, 'transcricao.txt');
  const text = '# Sessão 99: Exemplo fictício\n' + (long ? 'Uma porta foi aberta.\n'.repeat(300) : 'Uma porta foi aberta.');
  await writeFile(summary, text); await writeFile(input, 'Transcrição fictícia.');
  const receipt = summary + '.state.json';
  await writeFile(receipt, JSON.stringify({ input, inputHash: hash('Transcrição fictícia.'), outputHash: hash(text), retention: pendingDelivery('2020-01-01T00:00:00.000Z') }));
  const queue = await queueCollection({ summary, history });
  const sent: Outgoing[] = [];
  const transport: Transport = { send: async (_owner, payload) => { sent.push(payload); return { id: String(100 + sent.length), channelId: '456' }; } };
  return { dir, dataRoot, summary, history, input, receipt, path: queue.path, sent, transport };
}
async function decision(o: Awaited<ReturnType<typeof fixture>>, action: 'add' | 'skip', actorId = '123') {
  const state = JSON.parse(await readFile(o.path, 'utf8'));
  return decideCollection({ path: o.path, ownerId: '123', actorId, messageId: state.delivery.decisionMessageId, channelId: '456', action });
}
test('mensagens respeitam 2000 caracteres, conservam texto e não cortam emoji', () => {
  const text = 'a'.repeat(1999) + '🧙' + 'texto\n'.repeat(1000), parts = splitMessage(text);
  assert.equal(parts.join(''), text); assert.ok(parts.every(p => p.length <= 2000));
  assert.ok(parts.every(p => !/[\uD800-\uDBFF]$/.test(p)));
});
test('entrega completa inicia retenção, mas não inclui na coleção', async t => {
  const o = await fixture(t, true); await deliverSummary(o.path, '123', o.transport);
  assert.equal(o.sent.length, 1);
  assert.equal(o.sent[0].attachment?.data.toString(), await readFile(o.summary, 'utf8'));
  assert.ok(o.sent[0].buttons); assert.ok(o.sent[0].content.length < 2000);
  await assert.rejects(access(o.history)); await access(o.input);
  const receipt = JSON.parse(await readFile(o.receipt, 'utf8'));
  assert.ok(receipt.retention.deliveredAt); assert.equal(Date.parse(receipt.retention.deleteAfter) - Date.parse(receipt.retention.deliveredAt), 7 * 86400000);
  const count = o.sent.length; await deliverSummary(o.path, '123', o.transport); assert.equal(o.sent.length, count);
});
test('falha parcial não inicia prazo e retoma sem repetir partes registradas', async t => {
  const o = await fixture(t, true); let calls = 0;
  const legacy = JSON.parse(await readFile(o.path, 'utf8'));
  legacy.delivery = { ownerId: '123', parts: [], completedAt: null, decisionMessageId: null, channelId: null };
  await writeFile(o.path, JSON.stringify(legacy));
  await assert.rejects(deliverSummary(o.path, '123', { send: async (id, p, nonce) => { if (++calls === 2) throw new Error('DM bloqueada'); return o.transport.send(id, p, nonce); } }), /DM bloqueada/);
  assert.equal(JSON.parse(await readFile(o.receipt, 'utf8')).retention.deliveredAt, null);
  assert.equal(JSON.parse(await readFile(o.path, 'utf8')).delivery.parts.length, 1);
  await deliverSummary(o.path, '123', o.transport);
  assert.equal(o.sent.filter(p => p.buttons).length, 1); await access(o.input);
});
test('somente confirmar adiciona, com backup; clique repetido não duplica', async t => {
  const o = await fixture(t); await writeFile(o.history, '# Sessão 98: Anterior\nTexto anterior.\n');
  await deliverSummary(o.path, '123', o.transport); const r = await decision(o, 'add'); assert.equal(r.status, 'added');
  const state = JSON.parse(await readFile(o.path, 'utf8'));
  assert.equal(await readFile(state.historyBackup, 'utf8'), '# Sessão 98: Anterior\nTexto anterior.\n');
  assert.equal((await decision(o, 'add')).changed, false);
  assert.equal((await readFile(o.history, 'utf8')).match(/# Sessão 99/g)?.length, 1);
  await deliverCollection(o.path, '123', o.transport);
  assert.equal(o.sent.at(-1)?.attachment?.data.toString(), await readFile(o.history, 'utf8'));
});
test('não adicionar conserva resumo individual e mantém coleção intacta', async t => {
  const o = await fixture(t); await deliverSummary(o.path, '123', o.transport);
  assert.equal((await decision(o, 'skip')).status, 'skipped');
  await assert.rejects(access(o.history)); await access(o.summary); await access(o.input);
});
test('outra pessoa ou outra mensagem não pode confirmar', async t => {
  const o = await fixture(t); await deliverSummary(o.path, '123', o.transport);
  await assert.rejects(decision(o, 'add', '999'), /autorizado/);
  await assert.rejects(decideCollection({ path: o.path, ownerId: '123', actorId: '123', messageId: '999', channelId: '456', action: 'add' }), /autorizado/);
  await assert.rejects(access(o.history));
});
test('resumo alterado após enfileirar não é enviado', async t => {
  const o = await fixture(t); await writeFile(o.summary, 'Texto diferente');
  await assert.rejects(deliverSummary(o.path, '123', o.transport), /mudou/); assert.equal(o.sent.length, 0);
});
test('limpeza apaga só TXT elegível e conserva resumo e coleção', async t => {
  const o = await fixture(t); const record = JSON.parse(await readFile(o.receipt, 'utf8'));
  record.retention = afterConfirmedDmDelivery(record.retention, '2020-01-02T00:00:00.000Z', ['123']);
  await writeFile(o.receipt, JSON.stringify(record));
  assert.equal(await cleanupTranscript(o.receipt, o.dataRoot, new Date('2020-01-08')), false); await access(o.input);
  assert.equal(await cleanupTranscript(o.receipt, o.dataRoot, new Date('2020-01-10')), true);
  await assert.rejects(access(o.input)); await access(o.summary);
});
test('limpeza não apaga TXT modificado ou fora de dados', async t => {
  const o = await fixture(t); const record = JSON.parse(await readFile(o.receipt, 'utf8'));
  record.retention = afterConfirmedDmDelivery(record.retention, '2020-01-02T00:00:00.000Z', ['123']);
  await writeFile(o.receipt, JSON.stringify(record)); await writeFile(o.input, 'Outra transcrição');
  assert.equal(await cleanupTranscript(o.receipt, o.dataRoot, new Date('2020-01-10')), false); await access(o.input);
  const outside = join(o.dir, 'original.txt'); await writeFile(outside, 'Transcrição fictícia.');
  record.input = outside; await writeFile(o.receipt, JSON.stringify(record));
  assert.equal(await cleanupTranscript(o.receipt, o.dataRoot, new Date('2020-01-10')), false); await access(outside);
});