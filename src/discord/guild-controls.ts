import { ChannelType, SlashCommandBuilder, type Client, type Guild, type ChatInputCommandInteraction, type VoiceChannel } from 'discord.js';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveJson } from '../storage/json-state.ts';
import { VoiceRecorder } from './voice-recorder.ts';
import { t } from '../config/texts.ts';

export type GuildConfig = { channelId: string; minimum: number; enabled: boolean };
export const shouldLeaveGuild = (ownerPresent: boolean | undefined) => ownerPresent === false;
export const canConfigure = (actor: string, owner: string) => actor === owner;
export const shouldAutoJoin = (config: GuildConfig, channelId: string, humans: number, active: boolean) => config.enabled && config.channelId === channelId && humans >= config.minimum && !active;
export const wizardCommand = new SlashCommandBuilder().setName('wizard').setDescription(t('comando.descricao')).setDMPermission(false)
  .addSubcommand(s => s.setName('entrar').setDescription(t('comando.entrar')))
  .addSubcommand(s => s.setName('parar').setDescription(t('comando.parar')))
  .addSubcommand(s => s.setName('status').setDescription(t('comando.status')))
  .addSubcommand(s => s.setName('configurar').setDescription(t('comando.configurar'))
    .addChannelOption(o => o.setName('canal').setDescription(t('opcao.canal')).addChannelTypes(ChannelType.GuildVoice).setRequired(true))
    .addIntegerOption(o => o.setName('minimo').setDescription(t('opcao.minimo')).setMinValue(1).setMaxValue(99).setRequired(true))
    .addBooleanOption(o => o.setName('automatico').setDescription(t('opcao.automatico')).setRequired(true)));

export class GuildControls {
  private cooldown = new Map<string, number>();
  private suppressed = new Set<string>();
  private configs = new Map<string, GuildConfig>();
  private client: Client; private ownerId: string; private root: string; private recorder: VoiceRecorder;
  constructor(client: Client, ownerId: string, root: string, recorder: VoiceRecorder) {
    this.client = client; this.ownerId = ownerId; this.root = root; this.recorder = recorder;
  }
  // O bot é privado: só atua em servidores dos quais o dono participa e sai dos demais.
  // Erro de rede não conta como "dono ausente", para não sair de um servidor legítimo por engano.
  async ownerPresence(guild: Guild): Promise<boolean | undefined> {
    if (guild.ownerId === this.ownerId) return true;
    try { await guild.members.fetch({ user: this.ownerId, cache: true }); return true; }
    catch (e) { return [10007, 10013].includes((e as { code?: number }).code ?? 0) ? false : undefined; }
  }
  async enforcePrivacy() {
    for (const guild of this.client.guilds.cache.values()) {
      if (shouldLeaveGuild(await this.ownerPresence(guild))) {
        console.log(`WIZArd saiu de um servidor sem o proprietário (${guild.id}).`);
        await guild.leave();
      }
    }
  }
  async load() {
    await mkdir(join(this.root, 'servidores'), { recursive: true });
    for (const guild of this.client.guilds.cache.values()) {
      try { this.configs.set(guild.id, JSON.parse(await readFile(join(this.root, 'servidores', guild.id + '.json'), 'utf8'))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
  }
  async register() {
    if (!this.client.application) return;
    // Atualiza apenas este comando, preservando outros comandos eventualmente existentes.
    const commands = await this.client.application.commands.fetch();
    const existing = commands.find(c => c.name === 'wizard');
    if (existing) await existing.edit(wizardCommand.toJSON());
    else await this.client.application.commands.create(wizardCommand.toJSON());
  }
  async command(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName !== 'wizard' || !interaction.inGuild()) return;
    await interaction.deferReply({ flags: 64 });
    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      if (await this.ownerPresence(guild) !== true) throw new Error(t('erro.privado'));
      const member = await guild.members.fetch(interaction.user.id), action = interaction.options.getSubcommand();
      if (action === 'configurar') {
        if (!canConfigure(member.id, this.ownerId)) throw new Error(t('erro.so_dono_configura'));
        const selected = interaction.options.getChannel('canal', true), minimum = interaction.options.getInteger('minimo', true), enabled = interaction.options.getBoolean('automatico', true);
        const channel = await guild.channels.fetch(selected.id);
        if (channel?.type !== ChannelType.GuildVoice || !channel.permissionsFor(member)?.has('ViewChannel')) throw new Error(t('erro.canal_invalido'));
        const config = { channelId: channel.id, minimum, enabled };
        await saveJson(join(this.root, 'servidores', guild.id + '.json'), config); this.configs.set(guild.id, config); this.suppressed.delete(guild.id);
        await interaction.editReply(t('comando.auto_configurado', { estado: t(enabled ? 'comando.ativada' : 'comando.desativada'), canal: `<#${channel.id}>`, minimo: minimum }));
        if (enabled) void this.evaluate(channel).catch(() => {});
      } else if (action === 'entrar') {
        const channel = member.voice.channel;
        if (channel?.type !== ChannelType.GuildVoice) throw new Error(t('erro.entre_em_canal'));
        this.suppressed.delete(guild.id);
        await this.recorder.start(channel); await interaction.editReply(t('comando.gravacao_iniciada'));
      } else if (action === 'parar') {
        const active = this.recorder.active.get(guild.id);
        if (!active) throw new Error(t('erro.sem_gravacao'));
        if (member.id !== this.ownerId && member.voice.channelId !== active.channelId) throw new Error(t('erro.precisa_estar_no_canal'));
        this.suppressed.add(guild.id); await this.recorder.stop(guild.id); await interaction.editReply(t('comando.gravacao_encerrada'));
      } else {
        const active = this.recorder.active.get(guild.id), config = this.configs.get(guild.id);
        await interaction.editReply([active ? t('status.gravando', { canal: `<#${active.channelId}>` }) : t('status.sem_gravacao'),
          config?.enabled ? t('status.auto', { canal: `<#${config.channelId}>`, minimo: config.minimum }) + (this.suppressed.has(guild.id) ? ' ' + t('status.pausado') : '') : t('status.auto_desligado')].join(' '));
      }
    } catch (e) { const err = e as NodeJS.ErrnoException; await interaction.editReply(err.code ? t('erro.falha_comando') : err.message); }
  }
  async evaluate(channel: VoiceChannel) {
    const humans = channel.members.filter(m => !m.user.bot).size, guildId = channel.guild.id;
    const config = this.configs.get(guildId);
    if (!humans) {
      if (config?.channelId === channel.id) this.suppressed.delete(guildId);
      if (this.recorder.active.get(guildId)?.channelId === channel.id) await this.recorder.stop(guildId);
      return;
    }
    if (!config || this.suppressed.has(guildId) || !shouldAutoJoin(config, channel.id, humans, this.recorder.active.has(guildId)) || (this.cooldown.get(guildId) ?? 0) > Date.now()) return;
    this.cooldown.set(guildId, Date.now() + 60000);
    await this.recorder.start(channel);
  }
  async checkAll() {
    for (const [guildId, config] of this.configs) {
      if (!config.enabled) continue;
      const guild = this.client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(config.channelId);
      if (channel?.type === ChannelType.GuildVoice) await this.evaluate(channel);
    }
  }
}
