export const RETENTION_DAYS = 7;
const WEEK_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
export type Retention = { days: 7; summaryReadyAt: string; deliveredAt: string | null; deleteAfter: string | null; discordMessageIds: string[]; keepForever: boolean };
export function pendingDelivery(summaryReadyAt: string, keepForever = false): Retention {
  if (!Number.isFinite(Date.parse(summaryReadyAt))) throw new Error('Data do resumo inválida.');
  return { days: 7, summaryReadyAt, deliveredAt: null, deleteAfter: null, discordMessageIds: [], keepForever };
}
// O módulo Discord chamará isto somente após todas as partes e o anexo serem enviados com sucesso.
// A confirmação é da API do Discord; não exige que o usuário tenha lido a DM.
export function afterConfirmedDmDelivery(state: Retention, deliveredAt: string, messageIds: string[]): Retention {
  const at = Date.parse(deliveredAt), ready = Date.parse(state.summaryReadyAt);
  if (!Number.isFinite(at) || !Number.isFinite(ready) || at < ready || !messageIds.length || messageIds.some(id => !/^\d+$/.test(id))) throw new Error('Confirmação de entrega inválida.');
  // Reenviar ou retomar nunca encurta um prazo existente.
  const deadline = Math.max(at + WEEK_MS, Date.parse(state.deleteAfter ?? '') || 0);
  return { ...state, deliveredAt, discordMessageIds: [...messageIds], deleteAfter: new Date(deadline).toISOString() };
}
export function eligibleForDeletion(state: Retention, now = new Date()): boolean {
  const ready = Date.parse(state.summaryReadyAt), delivered = Date.parse(state.deliveredAt ?? ''), deadline = Date.parse(state.deleteAfter ?? '');
  return state.days === 7 && !state.keepForever && state.discordMessageIds.length > 0
    && state.discordMessageIds.every(id => /^\d+$/.test(id))
    && Number.isFinite(ready) && Number.isFinite(delivered) && Number.isFinite(deadline)
    && delivered >= ready && deadline >= delivered + WEEK_MS && now.getTime() >= deadline;
}