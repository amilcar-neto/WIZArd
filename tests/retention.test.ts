import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingDelivery, afterConfirmedDmDelivery, eligibleForDeletion } from '../src/storage/retention.ts';
const ready = '2026-10-01T12:00:00.000Z';
const delivered = '2026-10-03T15:00:00.000Z';
test('sem DM confirmada não vence, mesmo após um ano', () => {
  assert.equal(eligibleForDeletion(pendingDelivery(ready), new Date('2027-10-01')), false);
});
test('prazo é uma semana completa a partir da entrega, não da geração', () => {
  const s = afterConfirmedDmDelivery(pendingDelivery(ready), delivered, ['123']);
  assert.equal(s.deleteAfter, '2026-10-10T15:00:00.000Z');
  assert.equal(eligibleForDeletion(s, new Date('2026-10-10T14:59:59.999Z')), false);
  assert.equal(eligibleForDeletion(s, new Date('2026-10-10T15:00:00.000Z')), true);
});
test('falha ou entrega parcial não confirma entrega', () => {
  assert.throws(() => afterConfirmedDmDelivery(pendingDelivery(ready), delivered, []));
});
test('manter-transcricao conserva o arquivo mesmo após o prazo', () => {
  const s = afterConfirmedDmDelivery(pendingDelivery(ready, true), delivered, ['123']);
  assert.equal(eligibleForDeletion(s, new Date('2027-10-01')), false);
});
test('recibo inconsistente ou prazo encurtado nunca autoriza exclusão', () => {
  const s = afterConfirmedDmDelivery(pendingDelivery(ready), delivered, ['123']);
  assert.equal(eligibleForDeletion({ ...s, deleteAfter: delivered }, new Date('2027-10-01')), false);
  assert.equal(eligibleForDeletion({ ...s, deliveredAt: null }, new Date('2027-10-01')), false);
});