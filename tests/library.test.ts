import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionLibrary, managedFile } from '../src/sessions/library.ts';
import { queueCollection } from '../src/collection/queue.ts';
import { AudioMixer } from '../src/sessions/audio-mixer.ts';

async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-library-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'dados'); await mkdir(root); return { dir, root, library: new SessionLibrary(root, join(root, 'resumos')) };
}
test('catálogo importa resumos antigos e reconhece transcrição removida', async t => {
  const { root, library } = await fixture(t); await mkdir(library.summaries);
  const summary = join(library.summaries, 'sessao-11.md'), input = join(root, 'antiga.txt');
  await writeFile(summary, '# Sessão 11\nExemplo fictício.'); await writeFile(summary + '.state.json', JSON.stringify({ input }));
  await queueCollection({ summary, history: join(root, 'colecao.md') });
  const sessions = await library.list(); assert.equal(sessions.length, 1);
  const files = await library.available(sessions[0]); assert.equal(files.summary, summary); assert.equal(files.transcript, undefined);
});
test('arquivo externo ao diretório gerenciado nunca é oferecido', async t => {
  const { root, dir } = await fixture(t), outside = join(dir, 'privado.txt'); await writeFile(outside, 'fictício');
  assert.equal(await managedFile(root, outside), undefined);
});
test('reinício recupera partes de gravação sem iniciar outra', async t => {
  const { library } = await fixture(t), session = await library.create('1', '2');
  const audio = join(library.sessions, session.id, 'audio-0000.ogg'); await writeFile(audio, 'áudio fictício');
  await library.recover(); const recovered = await library.get(session.id);
  assert.equal(recovered?.status, 'interrupted'); assert.deepEqual(recovered?.audio, [audio]);
});
test('retenção de áudio exige prazo, transcrição ou resumo preservado e hash correspondente', async t => {
  const { library } = await fixture(t), session = await library.create('1', '2');
  session.status = 'ready'; session.transcript = join(library.sessions, session.id, 'transcricao.txt');
  await writeFile(session.transcript, 'Texto fictício.');
  session.audio = [join(library.sessions, session.id, 'audio-0000.ogg'), join(library.sessions, session.id, 'audio-0001.ogg')];
  await Promise.all(session.audio.map(p => writeFile(p, 'áudio fictício')));
  await library.armAudioRetention(session, 14); await library.cleanupAudio(); await access(session.audio[0]);
  await writeFile(session.audio[1], 'alterado'); await library.cleanupAudio(Date.now() + 15 * 86400000);
  await assert.rejects(access(session.audio[0])); assert.equal(await readFile(session.audio[1], 'utf8'), 'alterado');
  await access(session.transcript);
});
test('mixer conserva silêncio, quadros parciais e limita picos de vozes simultâneas', () => {
  const mixer = new AudioMixer(); assert.deepEqual(mixer.frame(), Buffer.alloc(1920));
  const pcm = Buffer.alloc(3840); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(30000, i);
  mixer.push('a', pcm); mixer.push('b', pcm);
  assert.equal(mixer.frame().readInt16LE(0), 32767); assert.equal(mixer.frame().readInt16LE(1918), 32767);
  assert.deepEqual(mixer.frame(), Buffer.alloc(1920));
  assert.throws(() => mixer.push('a', Buffer.alloc(48000 * 2 * 3)), /atrasada/);
});
test('mixer entrega também o quadro de cada pessoa, separado da mistura', () => {
  const mixer = new AudioMixer(), a = Buffer.alloc(1920), b = Buffer.alloc(1920);
  a.writeInt16LE(1000, 0); b.writeInt16LE(-500, 0);
  mixer.push('a', a); mixer.push('b', b);
  const { mix, voices } = mixer.frames();
  assert.equal(voices.get('a')!.readInt16LE(0), 1000); assert.equal(voices.get('b')!.readInt16LE(0), -500);
  assert.equal(mix.readInt16LE(0), Math.round(500 / Math.SQRT2));
  assert.equal(mixer.frames().voices.size, 0);
});
