import { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectionId, deliverSummary, decideCollection, deliverCollection, type Transport } from './delivery.ts';
import { cleanupTranscript } from '../storage/cleanup.ts';
import { eligibleForDeletion } from '../storage/retention.ts';
import { queueFiles } from '../storage/queue-files.ts';
import { SessionLibrary } from '../sessions/library.ts';
import { SessionJobs, streamBusy } from '../sessions/jobs.ts';
import { PrivateMenu, confirmRow } from './private-menu.ts';
import { t } from '../config/texts.ts';
import { VoiceRecorder } from './voice-recorder.ts';
import { GuildControls } from './guild-controls.ts';
const token = process.env.DISCORD_BOT_TOKEN ?? '', ownerId = process.env.DISCORD_OWNER_ID ?? '';
if (!token || !/^\d+$/.test(ownerId)) {
  console.error('Configure DISCORD_BOT_TOKEN e DISCORD_OWNER_ID no .env local. Veja docs/DISCORD.md.'); process.exit(1);
}
for (const [key, min, max] of [
  ['WIZARD_AUDIO_RETENTION_DAYS', 1, 365], ['WIZARD_MAX_RECORDING_HOURS', 1, 12],
  ['WIZARD_TRANSCRIBE_THREADS', 1, 64], ['WIZARD_TRANSCRIBE_TIMEOUT_MS', 1000, 86400000],
  ['WIZARD_TIMEOUT_MS', 1000, 86400000]
] as const) {
  const value = process.env[key];
  if (value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)) {
    console.error('Configuração inválida: ' + key + '. Use inteiro entre ' + min + ' e ' + max + '.'); process.exit(1);
  }
}
const root = resolve(process.env.WIZARD_SUMMARY_DIR ?? 'dados/resumos');
const managedRoot = resolve('dados');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel] });
const library = new SessionLibrary(managedRoot, root);
const jobs = new SessionJobs(library, async (job, session) => {
  const user = await client.users.fetch(ownerId), titulo = session?.title ?? '';
  const key = job.status === 'done' ? (job.action === 'transcribe' ? 'fila.transcricao_pronta' : 'fila.resumo_pronto')
    : job.status === 'blocked' ? 'fila.confirmar_mesa' : job.status === 'interrupted' ? 'fila.interrompida' : 'fila.falhou';
  // Quando a IA não reconhece a mesa, pergunta ao dono em vez de decidir sozinha.
  const components = job.status === 'blocked' && session ? [confirmRow(session.id)] : [];
  await user.send({ content: t(key, { titulo }).trim(), components, allowedMentions: { parse: [] } });
}, { busy: streamBusy });
const menu = new PrivateMenu(client, ownerId, library, jobs);
const recorder = new VoiceRecorder(library, async session => {
  const user = await client.users.fetch(ownerId);
  await user.send({ content: t(session.status === 'interrupted' ? 'gravacao.interrompida' : 'gravacao.encerrada', { titulo: session.title }), allowedMentions: { parse: [] } });
});
const guildControls = new GuildControls(client, ownerId, managedRoot, recorder);
const transport: Transport = {
  async send(id, payload, nonce) {
    const user = await client.users.fetch(id);
    const options: any = { content: payload.content, allowedMentions: { parse: [] }, nonce, enforceNonce: true };
    if (payload.attachment) options.files = [new AttachmentBuilder(payload.attachment.data, { name: payload.attachment.name })];
    if (payload.buttons) options.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(...payload.buttons.map(b => new ButtonBuilder().setCustomId('wizard:' + b.action + ':' + b.id).setLabel(b.label).setStyle(b.action === 'add' ? ButtonStyle.Success : ButtonStyle.Secondary)))];
    const sent = await user.send(options);
    return { id: sent.id, channelId: sent.channelId };
  }
};
async function logFailure(event: string, error: any) {
  console.error('Falha em ' + event + '. Dados locais preservados. Código: ' + (typeof error?.code === 'number' ? error.code : 'local'));
  try { await mkdir('dados', { recursive: true }); await appendFile('dados/falhas.jsonl', JSON.stringify({ at: new Date().toISOString(), event, code: typeof error?.code === 'number' ? error.code : null }) + '\n'); } catch {}
}
let running = false;
let initialized = false;
async function tick() {
  if (running) return; running = true;
  try {
    const paths = await queueFiles(root);
    for (const path of paths) {
      try { await deliverSummary(path, ownerId, transport); await deliverCollection(path, ownerId, transport); }
      catch (e) { await logFailure('discord_delivery', e); }
    }
    // Só limpa quando todos os recibos conhecidos para o mesmo TXT venceram.
    const groups = new Map<string, { path: string; state: any }[]>();
    for (const path of paths) {
      try {
        const queue = JSON.parse(await readFile(path, 'utf8'));
        const receipt = queue.summary + '.state.json';
        const state = JSON.parse(await readFile(receipt, 'utf8'));
        const key = resolve(state.input).toLowerCase();
        groups.set(key, [...(groups.get(key) ?? []), { path: receipt, state }]);
      } catch {}
    }
    for (const group of groups.values()) {
      if (!group.every(item => item.state.retention && eligibleForDeletion(item.state.retention))) continue;
      try { if (await cleanupTranscript(group[0].path, managedRoot)) console.log('Transcrição com prazo vencido removida.'); } catch (e) { await logFailure('retention_cleanup', e); }
    }
    await library.cleanupAudio();
    await guildControls.checkAll();
  } catch (e) { await logFailure('discord_queue', e); }
  finally { running = false; }
}
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!initialized) {
      if (interaction.isRepliable()) await interaction.reply({ content: t('dm.iniciando'), flags: 64 });
      return;
    }
    if (await menu.interaction(interaction)) return;
    if (interaction.isChatInputCommand()) { await guildControls.command(interaction); return; }
  } catch (e) { await logFailure('discord_controls', e); return; }
  if (!interaction.isButton() || !interaction.customId.startsWith('wizard:')) return;
  try {
    if (interaction.user.id !== ownerId || interaction.inGuild()) { await interaction.reply({ content: t('decisao.so_dono') }); return; }
    const match = interaction.customId.match(/^wizard:(add|skip):([a-f0-9]{32})$/);
    if (!match) return;
    await interaction.deferUpdate();
    let path: string | undefined;
    for (const candidate of await queueFiles(root)) {
      const state = JSON.parse(await readFile(candidate, 'utf8'));
      if (collectionId(candidate) === match[2] || state.collectionId === match[2]) { path = candidate; break; }
    }
    if (!path) throw new Error('Pendência não encontrada.');
    const result = await decideCollection({ path, ownerId, actorId: interaction.user.id, messageId: interaction.message.id, channelId: interaction.channelId, action: match[1] as 'add' | 'skip' });
    await interaction.editReply({ content: t(result.status === 'added' ? 'decisao.adicionado' : 'decisao.nao_adicionado'), components: [] });
    await deliverCollection(path, ownerId, transport);
  } catch (e) {
    await logFailure('discord_decision', e);
    const content = t('decisao.falhou');
    try { if (interaction.deferred || interaction.replied) await interaction.followUp({ content }); else await interaction.reply({ content }); } catch {}
  }
});
client.once(Events.ClientReady, () => {
  void (async () => {
    await library.recover(); await jobs.recover(); await guildControls.enforcePrivacy().catch(e => logFailure('guild_privacy', e)); await guildControls.load();
    try { await guildControls.register(); } catch (e) { await logFailure('discord_commands', e); }
    initialized = true;
    console.log('WIZArd conectado. Menu privado, fila e comandos disponíveis.');
    void tick(); void jobs.tick().catch(e => logFailure('session_jobs', e));
  })().catch(e => { clearInterval(timer); void logFailure('startup', e); process.exitCode = 1; void client.destroy(); });
});
client.on(Events.MessageCreate, message => {
  if (initialized) void menu.message(message).catch(e => logFailure('private_menu', e));
});
client.on(Events.VoiceStateUpdate, (before, after) => {
  if (!initialized) return;
  const channels = new Map([before.channel, after.channel].filter(c => c?.type === 2).map(c => [c!.id, c!]));
  for (const channel of channels.values()) void guildControls.evaluate(channel as any).catch(e => logFailure('voice_auto', e));
});
client.on(Events.GuildCreate, () => {
  if (initialized) void guildControls.enforcePrivacy().then(() => guildControls.load()).catch(e => logFailure('guild_config', e));
});
client.on(Events.Error, e => { void logFailure('discord_connection', e); });
const timer = setInterval(() => {
  if (client.isReady() && initialized) { void tick(); void jobs.tick().catch(e => logFailure('session_jobs', e)); }
}, 30000);
async function stop() { initialized = false; clearInterval(timer); await recorder.close(); await client.destroy(); }
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
try { await client.login(token); } catch (e) { clearInterval(timer); await logFailure('discord_login', e); await client.destroy(); process.exitCode = 1; }
