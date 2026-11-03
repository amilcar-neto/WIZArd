import { readFile, access } from 'node:fs/promises';
import { t } from '../config/texts.ts';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { withState } from '../storage/json-state.ts';
import { appendHistory } from '../collection/history.ts';
import { afterConfirmedDmDelivery } from '../storage/retention.ts';
export type Outgoing = { content: string; attachment?: { name: string; data: Buffer }; buttons?: { id: string; action: 'add' | 'skip'; label: string }[] };
export type Transport = { send: (ownerId: string, payload: Outgoing, nonce: string) => Promise<{ id: string; channelId: string }> };
export const collectionId = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 32);
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export function splitMessage(text: string): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > 2000) {
    let cut = rest.lastIndexOf('\n', 2000);
    if (cut < 1000) cut = 2000; else cut++;
    if (cut > 2000) cut = 2000;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    result.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest) result.push(rest);
  return result;
}
const nonceFor = (id: string, part: string) => BigInt('0x' + createHash('sha256').update(id + ':' + part).digest('hex').slice(0, 16)).toString();
async function checkedSummary(state: any) {
  const data = await readFile(state.summary);
  if (hash(data) !== state.summaryHash) throw new Error('O resumo mudou após preparar a entrega. Revise a pendência antes de reenviar.');
  return data;
}
async function markDelivered(state: any) {
  const receipt = state.summary + '.state.json';
  try { await access(receipt); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  await withState(receipt, async (record, save) => {
    if (record.outputHash !== state.summaryHash || !record.retention) throw new Error('O recibo não corresponde ao resumo entregue.');
    if (!record.retention.deliveredAt) {
      record.retention = afterConfirmedDmDelivery(record.retention, state.delivery.completedAt, state.delivery.parts.map((p: any) => p.id));
      await save();
    }
  });
}
export async function deliverSummary(path: string, ownerId: string, transport: Transport) {
  if (!/^\d+$/.test(ownerId)) throw new Error('DISCORD_OWNER_ID inválido.');
  return withState(path, async (state, save) => {
    if (state.status !== 'pending') return { delivered: false, reason: 'decided' };
    const data = await checkedSummary(state);
    if (state.delivery?.ownerId && state.delivery.ownerId !== ownerId) throw new Error('A entrega pertence a outro destinatário.');
    state.delivery ??= { format: 'attachment', ownerId, parts: [], completedAt: null, decisionMessageId: null, channelId: null };
    const id = state.collectionId ?? collectionId(path);
    state.collectionId = id;
    const buttons: Outgoing['buttons'] = [{ id, action: 'add', label: t('botao.adicionar_colecao') }, { id, action: 'skip', label: t('botao.nao_adicionar') }];
    const attachment = { name: basename(state.summary), data };
    // Preserve the payload indexes and nonces of deliveries started by older versions.
    const payloads: Outgoing[] = state.delivery.format === 'attachment'
      ? [{ content: t('entrega.resumo'), attachment, buttons }]
      : [
        ...splitMessage(data.toString('utf8')).map(content => ({ content })),
        { content: t('entrega.resumo_sem_botoes'), attachment },
        { content: t('entrega.pergunta'), buttons }
      ];
    if (!state.delivery.completedAt) {
      for (let index = state.delivery.parts.length; index < payloads.length; index++) {
        const message = await transport.send(ownerId, payloads[index], nonceFor(id, String(index)));
        state.delivery.parts.push({ id: message.id, channelId: message.channelId });
        state.delivery.channelId = message.channelId;
        if (index === payloads.length - 1) state.delivery.decisionMessageId = message.id;
        await save();
      }
      state.delivery.completedAt = new Date().toISOString();
      await save();
    }
    await markDelivered(state);
    return { delivered: true, reason: 'complete' };
  });
}
export async function decideCollection(o: { path: string; ownerId: string; actorId: string; messageId: string; channelId: string; action: 'add' | 'skip' }) {
  return withState(o.path, async (state, save) => {
    if (o.actorId !== o.ownerId || state.delivery?.ownerId !== o.ownerId || state.delivery?.decisionMessageId !== o.messageId || state.delivery?.channelId !== o.channelId || !state.delivery?.completedAt) throw new Error('Esta decisão não corresponde à entrega ou ao destinatário autorizado.');
    if (state.status !== 'pending') return { status: state.status, changed: false, history: state.history };
    await checkedSummary(state);
    if (o.action !== 'add' && o.action !== 'skip') throw new Error('Decisão inválida.');
    if (o.action === 'add') {
      const result = await appendHistory({ summary: state.summary, history: state.history });
      state.historyBackup = result.backup;
      state.status = 'added';
    } else state.status = 'skipped';
    state.decidedAt = new Date().toISOString(); state.discordUserId = o.actorId; state.discordMessageId = o.messageId;
    await save();
    return { status: state.status, changed: true, history: state.history };
  });
}
export async function deliverCollection(path: string, ownerId: string, transport: Transport) {
  return withState(path, async (state, save) => {
    if (state.status !== 'added' || state.historyDeliveredAt) return;
    if (state.discordUserId !== ownerId) throw new Error('Destinatário não autorizado para a coleção.');
    const data = await readFile(state.history);
    await transport.send(ownerId, { content: t('entrega.colecao_atualizada'), attachment: { name: basename(state.history), data } }, nonceFor(collectionId(path), 'collection'));
    state.historyDeliveredAt = new Date().toISOString(); await save();
  });
}
