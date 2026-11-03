// Menu privado do dono na DM. Todos os textos vêm de config/textos.txt.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, type Client, type Interaction, type Message } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SessionLibrary, managedFile, type Session } from '../sessions/library.ts';
import { SessionJobs } from '../sessions/jobs.ts';
import { t } from '../config/texts.ts';
import { localDate } from '../config/time.ts';

export const isOwnerDm = (actorId: string, ownerId: string, guildId: string | null) => actorId === ownerId && guildId === null;
const button = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId('library:' + id).setLabel(label).setStyle(style);
const row = (...items: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...items);
// Voltar leva à tela anterior; "Menu inicial" só aparece quando a tela anterior não é o próprio início.
const navRow = (back = 'home') => row(button(back, t('botao.voltar')), ...(back === 'home' ? [] : [button('home', t('botao.menu_inicial'))]));
const quiet = { allowedMentions: { parse: [] as string[] } };
// A mesa só fica pendente de confirmação quando a IA não reconheceu e o dono ainda não respondeu.
export const needsConfirmation = (s: Session) => s.classification?.accepted === false && !s.classification.ownerDecision;
export const confirmRow = (id: string) => row(button(`confirm:${id}:yes`, t('botao.e_mesa'), ButtonStyle.Primary), button(`confirm:${id}:no`, t('botao.nao_e_mesa')));

export function mainMenu() {
  return { content: t('menu.titulo'), components: [
    row(button('latest', t('botao.ultima_sessao'), ButtonStyle.Primary), button('page:0', t('botao.outra_sessao'))),
    row(button('collection', t('botao.baixar_colecao')), button('all', t('botao.baixar_transcricoes')))
  ], ...quiet };
}
// Conserva a codificação UTF-8 ao dividir anexos maiores que o limite conservador.
export function fileParts(data: Buffer, limit = 7 * 1024 * 1024): Buffer[] {
  if (limit < 4) throw new Error('Limite inválido.');
  const parts: Buffer[] = [];
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + limit, data.length);
    if (end < data.length) while (end > start && (data[end] & 0xc0) === 0x80) end--;
    parts.push(data.subarray(start, end)); start = end;
  }
  return parts;
}
export class PrivateMenu {
  private sending = new Set<string>();
  private client: Client; private ownerId: string; private library: SessionLibrary; private jobs: SessionJobs;
  constructor(client: Client, ownerId: string, library: SessionLibrary, jobs: SessionJobs) {
    this.client = client; this.ownerId = ownerId; this.library = library; this.jobs = jobs;
  }
  async message(message: Message) {
    if (message.author.bot || message.inGuild()) return;
    if (!isOwnerDm(message.author.id, this.ownerId, message.guildId)) {
      await message.reply({ content: t('dm.terceiros'), ...quiet }); return;
    }
    await message.reply(mainMenu() as any);
  }
  private async sendFile(path: string, label: string, audio = false) {
    const data = await readFile(path), user = await this.client.users.fetch(this.ownerId);
    if (audio && data.length > 7 * 1024 * 1024) throw new Error(t('erro.audio_grande'));
    const parts = audio ? [data] : fileParts(data);
    if (!parts.length) throw new Error(t('erro.arquivo_indisponivel'));
    for (let i = 0; i < parts.length; i++) {
      const name = parts.length === 1 ? basename(path) : `${basename(path)}.parte-${i + 1}.txt`;
      await user.send({ content: label + (parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''), files: [new AttachmentBuilder(parts[i], { name })], ...quiet });
    }
  }
  private async details(session: Session, back = 'home') {
    const files = await this.library.available(session), id = session.id, recording = session.status === 'recording';
    const confirm = needsConfirmation(session), notCampaign = session.classification?.ownerDecision === 'no';
    const downloads: ButtonBuilder[] = [], actions: ButtonBuilder[] = [];
    if (files.summary) downloads.push(button(`file:${id}:summary`, t('botao.baixar_resumo')));
    if (files.transcript) downloads.push(button(`file:${id}:transcript`, t('botao.baixar_transcricao')));
    if (files.audio.length && !recording) downloads.push(button(`file:${id}:audio`, files.audio.length > 1 ? t('botao.baixar_audio_partes', { partes: files.audio.length }) : t('botao.baixar_audio')));
    if (!files.transcript && files.audio.length && !recording) actions.push(button(`job:${id}:transcribe`, t('botao.transcrever'), ButtonStyle.Primary));
    if (files.transcript && !files.summary && !recording && !confirm && !notCampaign) actions.push(button(`job:${id}:summarize`, t('botao.gerar_resumo'), ButtonStyle.Primary));
    const lines = [t('sessao.cabecalho', { titulo: session.title, data: localDate(session.startedAt) })];
    if (recording) lines.push(t('sessao.gravando'));
    if (session.status === 'interrupted') lines.push(t('sessao.interrompida'));
    if (confirm) lines.push(t('sessao.pergunta_mesa'));
    if (notCampaign) lines.push(t('sessao.nao_e_mesa'));
    if (session.audioExpiresAt) lines.push(t('sessao.audio_ate', { data: localDate(session.audioExpiresAt) }));
    if (!downloads.length && !actions.length && !confirm) lines.push(t('sessao.sem_arquivos'));
    const components = [];
    if (downloads.length) components.push(row(...downloads));
    if (actions.length) components.push(row(...actions));
    if (confirm) components.push(confirmRow(id));
    components.push(navRow(back));
    return { content: lines.join('\n'), components, ...quiet };
  }
  private async page(number: number) {
    const sessions = await this.library.list();
    if (!sessions.length) return { content: t('sessoes.vazio'), components: [navRow()], ...quiet };
    const pages = Math.ceil(sessions.length / 20), page = Math.max(0, Math.min(number, pages - 1));
    const select = new StringSelectMenuBuilder().setCustomId(`library:select:${page}`).setPlaceholder(t('sessoes.escolha')).addOptions(sessions.slice(page * 20, page * 20 + 20).map(s => ({ label: s.title.slice(0, 100), value: s.id, description: localDate(s.startedAt) + (s.status === 'recording' ? ' · ' + t('sessoes.gravando') : '') })));
    const nav = [button('home', t('botao.voltar'))];
    if (page > 0) nav.push(button(`page:${page - 1}`, t('botao.sessoes_recentes')));
    if (page < pages - 1) nav.push(button(`page:${page + 1}`, t('botao.sessoes_antigas')));
    return { content: pages > 1 ? t('sessoes.titulo_paginas', { pagina: page + 1, total: pages }) : t('sessoes.titulo'), components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), row(...nav)], ...quiet };
  }
  private async queued(result: { queued: boolean }) {
    if (!result.queued) return t('fila.ja_existe');
    return await this.jobs.waiting() ? t('fila.entrou_esperando') : t('fila.entrou');
  }
  async interaction(interaction: Interaction) {
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith('library:')) return false;
    if (!isOwnerDm(interaction.user.id, this.ownerId, interaction.guildId)) {
      await interaction.reply({ content: t('dm.so_dono'), flags: 64 }); return true;
    }
    await interaction.deferUpdate();
    const action = interaction.customId.slice('library:'.length);
    if (this.sending.has(this.ownerId)) { await interaction.followUp({ content: t('erro.enviando') }); return true; }
    this.sending.add(this.ownerId);
    try {
      if (action === 'home' || action === 'files') await interaction.editReply(mainMenu() as any);
      else if (/^page:\d+$/.test(action)) await interaction.editReply(await this.page(Number(action.split(':')[1])) as any);
      else if (/^select(:\d+)?$/.test(action) && interaction.isStringSelectMenu()) {
        const session = await this.library.get(interaction.values[0]);
        if (!session) throw new Error(t('erro.sessao_nao_encontrada'));
        await interaction.editReply(await this.details(session, `page:${action.split(':')[1] ?? 0}`) as any);
      } else if (action === 'collection') {
        const file = await managedFile(this.library.root, process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md');
        if (!file) throw new Error(t('erro.colecao_indisponivel'));
        await this.sendFile(file, t('arquivo.colecao'));
      } else if (action === 'all') {
        let count = 0;
        const seen = new Set<string>();
        for (const session of await this.library.list()) {
          const { transcript } = await this.library.available(session);
          if (!transcript || seen.has(transcript)) continue;
          seen.add(transcript); await this.sendFile(transcript, t('arquivo.transcricao', { titulo: session.title })); count++;
        }
        await interaction.followUp({ content: count ? t('arquivo.transcricoes_enviadas', { quantidade: count }) : t('arquivo.sem_transcricoes') });
      } else if (/^confirm:[a-f0-9]{32}:(yes|no)$/.test(action)) {
        const [, id, answer] = action.split(':');
        const result = await this.jobs.confirmCampaign(id, answer === 'yes');
        const session = await this.library.get(id);
        if (session && interaction.message.content.startsWith(t('sessao.cabecalho', { titulo: session.title, data: localDate(session.startedAt) }))) await interaction.editReply(await this.details(session) as any);
        else await interaction.editReply({ components: [] });
        await interaction.followUp({ content: answer === 'yes' ? (result?.queued === false ? t('fila.ja_existe') : t('confirmacao.sim')) : t('confirmacao.nao') });
      } else {
        const match = action.match(/^(file|job):([a-f0-9]{32}):(summary|transcript|audio|transcribe|summarize)$/);
        const session = match ? await this.library.get(match[2]) : (await this.library.list())[0];
        if (!session) throw new Error(t('erro.sem_sessoes'));
        const operation = match?.[3] ?? action;
        if (operation === 'latest') await interaction.editReply(await this.details(session) as any);
        else if (operation === 'transcribe' || operation === 'summarize') {
          await interaction.followUp({ content: await this.queued(await this.jobs.enqueue(session.id, operation)) });
        } else if (['summary', 'transcript', 'audio'].includes(operation)) {
          const files = await this.library.available(session);
          const paths = operation === 'audio' ? files.audio : [files[operation as 'summary' | 'transcript']].filter((p): p is string => !!p);
          if (!paths.length || session.status === 'recording') throw new Error(t('erro.arquivo_indisponivel'));
          for (let i = 0; i < paths.length; i++) await this.sendFile(paths[i], `${session.title}${paths.length > 1 ? ` — ${i + 1}/${paths.length}` : ''}`, operation === 'audio');
        } else throw new Error(t('erro.opcao_invalida'));
      }
    } catch (e) {
      const message = e as NodeJS.ErrnoException;
      await interaction.followUp({ content: message.code || !(e instanceof Error) ? t('erro.generico') : message.message });
    } finally { this.sending.delete(this.ownerId); }
    return true;
  }
}
