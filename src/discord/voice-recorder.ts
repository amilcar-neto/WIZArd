import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { VoiceChannel } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { AudioMixer } from '../sessions/audio-mixer.ts';
import { SessionLibrary, type Session } from '../sessions/library.ts';
import { t } from '../config/texts.ts';

type Active = { channelId: string; stop: (interrupted?: boolean) => Promise<Session> };
type Track = { userId: string; name: string; file: string; offset: number; encoder: ReturnType<typeof spawn>; done: Promise<number | null>; failed: boolean };
const SILENCE = Buffer.alloc(1920);
// Nome mostrado na transcrição: apelido no servidor, sem quebras de linha nem dois-pontos.
export const speakerName = (name: string | undefined) => (name ?? '').replace(/[\r\n:]+/g, ' ').trim().slice(0, 64) || 'Participante';
export class VoiceRecorder {
  active = new Map<string, Active>();
  private starting = new Set<string>();
  private onStopped: (s: Session) => Promise<void>;
  private library: SessionLibrary;
  constructor(library: SessionLibrary, onStopped: (s: Session) => Promise<void>) { this.library = library; this.onStopped = onStopped; }
  async start(channel: VoiceChannel) {
    const guildId = channel.guild.id;
    if (this.active.has(guildId) || this.starting.has(guildId)) throw new Error(t('erro.ja_gravando_aqui'));
    if (this.active.size + this.starting.size >= 1) throw new Error(t('erro.ja_gravando_outra'));
    this.starting.add(guildId);
    let connection: any, encoder: ReturnType<typeof spawn> | undefined, timer: NodeJS.Timeout | undefined, session: Session | undefined;
    const tracks = new Map<string, Track>();
    try {
      const me = await channel.guild.members.fetchMe(), permissions = channel.permissionsFor(me);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages])) throw new Error(t('erro.sem_permissao'));
      const require = createRequire(new URL('../../voice-runtime/package.json', import.meta.url));
      let voice: any, Opus: any;
      try { voice = require('@discordjs/voice'); Opus = require('opusscript'); }
      catch { throw new Error(t('erro.sem_voz')); }
      // Não conecta se o codificador não existir. Nunca encaminha stderr com dados da campanha.
      await new Promise<void>((ok, fail) => {
        const probe = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
        probe.once('error', () => fail(new Error(t('erro.sem_ffmpeg'))));
        probe.once('exit', code => code === 0 ? ok() : fail(new Error(t('erro.sem_ffmpeg'))));
      });
      await channel.send({ content: t('gravacao.aviso_canal'), allowedMentions: { parse: [] } });
      session = await this.library.create(guildId, channel.id);
      connection = voice.joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
      connection.on('error', () => { void this.active.get(guildId)?.stop(true).catch(() => {}); });
      await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 30000);
      const mixer = new AudioMixer(), listeners = new Map<string, { stream: any; decoder: any }>();
      let frames = 0;
      encoder = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '48000', '-f', 'segment', '-segment_time', '900', '-reset_timestamps', '1', join(this.library.sessions, session.id, 'audio-%04d.ogg')], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      const processEncoder = encoder;
      let stopping: Promise<Session> | undefined, encoderFailed = false, resolveEncoder!: (code: number | null) => void;
      const encoderDone = new Promise<number | null>(resolve => { resolveEncoder = resolve; });
      const fail = () => { encoderFailed = true; void this.active.get(guildId)?.stop(true).catch(() => {}); };
      encoder.on('error', () => { resolveEncoder(-1); fail(); });
      encoder.once('close', code => { resolveEncoder(code); if (!stopping) fail(); });
      encoder.stdin!.on('error', fail);
      const stop = (interrupted = false): Promise<Session> => {
        if (stopping) return stopping;
        stopping = (async () => {
          clearInterval(timer); clearTimeout(maxTimer);
          connection.receiver.speaking.removeListener('start', subscribe);
          for (const { stream, decoder } of listeners.values()) { stream.destroy(); decoder.delete(); }
          listeners.clear();
          if (connection.state.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
          processEncoder.stdin?.end();
          for (const track of tracks.values()) track.encoder.stdin?.end();
          const killTimer = setTimeout(() => { processEncoder.kill('SIGKILL'); for (const track of tracks.values()) track.encoder.kill('SIGKILL'); }, 10000);
          const exitCode = await encoderDone;
          const trackCodes = await Promise.all([...tracks.values()].map(t => t.done)); clearTimeout(killTimer);
          session!.speakers = [...tracks.values()].map((t, i) => ({ userId: t.userId, name: t.name, file: t.file, offset: t.offset, complete: !t.failed && trackCodes[i] === 0 }));
          session!.endedAt = new Date().toISOString(); session!.status = interrupted || encoderFailed || exitCode !== 0 ? 'interrupted' : 'ready';
          session!.audio = await this.library.audioFiles(session!.id);
          await this.library.save(session!); return session!;
        })().finally(() => { this.active.delete(guildId); });
        void stopping.then(this.onStopped).catch(() => {});
        return stopping;
      };
      const subscribe = (id: string) => {
        if (listeners.has(id) || stopping || channel.members.get(id)?.user.bot) return;
        if (listeners.size >= 25) { fail(); return; }
        const stream = connection.receiver.subscribe(id, { end: { behavior: voice.EndBehaviorType.Manual } });
        const decoder = new Opus(48000, 1, Opus.Application.AUDIO);
        listeners.set(id, { stream, decoder });
        openTrack(id);
        stream.on('data', (packet: Buffer) => { try { mixer.push(id, decoder.decode(packet)); } catch { fail(); } });
        stream.once('error', fail);
      };
      // Faixa individual: se falhar, só ela é descartada; a gravação misturada continua.
      const openTrack = (id: string) => {
        if (tracks.has(id)) return;
        const member = channel.members.get(id), file = join(this.library.sessions, session!.id, `falante-${id}.ogg`);
        const trackEncoder = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32000', '-f', 'ogg', file], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
        let resolveTrack!: (code: number | null) => void;
        const track: Track = { userId: id, name: speakerName(member?.displayName ?? member?.user.username), file, offset: frames * 0.02, encoder: trackEncoder, done: new Promise(r => { resolveTrack = r; }), failed: false };
        trackEncoder.on('error', () => { track.failed = true; resolveTrack(-1); });
        trackEncoder.once('close', code => { if (!stopping) track.failed = true; resolveTrack(code); });
        trackEncoder.stdin!.on('error', () => { track.failed = true; });
        tracks.set(id, track);
      };
      connection.receiver.speaking.on('start', subscribe);
      const started = performance.now();
      const maxTimer = setTimeout(() => { void stop().catch(() => {}); }, Number(process.env.WIZARD_MAX_RECORDING_HOURS ?? 6) * 3600000);
      timer = setInterval(() => {
        const due = Math.floor((performance.now() - started) / 20) - frames;
        if (due > 100) { fail(); return; }
        for (let i = 0; i < due; i++) {
          if (!processEncoder.stdin?.writable || processEncoder.stdin.writableLength > 2 * 48000 * 2) { fail(); return; }
          const { mix, voices } = mixer.frames();
          processEncoder.stdin.write(mix); frames++;
          for (const track of tracks.values()) {
            if (track.failed) continue;
            const input = track.encoder.stdin;
            if (!input?.writable || input.writableLength > 2 * 48000 * 2) { track.failed = true; track.encoder.kill('SIGKILL'); continue; }
            input.write(voices.get(track.userId) ?? SILENCE);
          }
        }
      }, 20);
      connection.on(voice.VoiceConnectionStatus.Disconnected, () => { void stop(true).catch(() => {}); });
      this.active.set(guildId, { channelId: channel.id, stop });
      return session;
    } catch (e) {
      clearInterval(timer); encoder?.kill('SIGKILL'); for (const track of tracks.values()) track.encoder.kill('SIGKILL');
      try { connection?.destroy(); } catch {}
      if (session) { session.status = 'interrupted'; session.endedAt = new Date().toISOString(); session.audio = await this.library.audioFiles(session.id); await this.library.save(session); }
      throw e;
    } finally { this.starting.delete(guildId); }
  }
  async stop(guildId: string) {
    const active = this.active.get(guildId);
    if (!active) throw new Error('Não estou gravando neste servidor.');
    return active.stop();
  }
  async close() { await Promise.allSettled([...this.active.values()].map(s => s.stop(true))); }
}
