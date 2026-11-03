import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateMenu, mainMenu, isOwnerDm, fileParts } from '../src/discord/private-menu.ts';
import { canConfigure, shouldAutoJoin, shouldLeaveGuild, wizardCommand, GuildControls } from '../src/discord/guild-controls.ts';
import { t } from '../src/config/texts.ts';
const same = (key: string) => (e: any) => String(e?.message ?? e).includes(t(key));

test('painel só reconhece proprietário na DM; nem o dono tem controles privados no servidor', () => {
  assert.equal(isOwnerDm('123', '123', null), true); assert.equal(isOwnerDm('999', '123', null), false); assert.equal(isOwnerDm('123', '123', '456'), false);
  assert.equal(canConfigure('123', '123'), true); assert.equal(canConfigure('999', '123'), false);
});
test('qualquer DM do dono recebe menu; terceiro recebe apenas resposta sem controles', async () => {
  const menu = new PrivateMenu({} as any, '123', { list: async () => [] } as any, {} as any), replies: any[] = [];
  await menu.message({ author: { id: '999', bot: false }, inGuild: () => false, guildId: null, reply: async (p: any) => replies.push(p) } as any);
  assert.equal(replies[0].components, undefined); assert.equal(replies[0].files, undefined);
  await menu.message({ author: { id: '123', bot: false }, inGuild: () => false, guildId: null, reply: async (p: any) => replies.push(p) } as any);
  assert.ok(replies[1].components.length);
});
test('menu principal tem quatro botões claros, sem emojis', () => {
  const ids = (m: any) => m.components.flatMap((r: any) => r.toJSON().components.map((c: any) => c.custom_id));
  assert.deepEqual(ids(mainMenu()), ['library:latest', 'library:page:0', 'library:collection', 'library:all']);
  assert.ok(mainMenu().components.flatMap((r: any) => r.toJSON().components).every((c: any) => !c.emoji));
});
test('bot privado: sai só quando o dono comprovadamente não está no servidor', () => {
  assert.equal(shouldLeaveGuild(false), true);
  assert.equal(shouldLeaveGuild(true), false);
  assert.equal(shouldLeaveGuild(undefined), false);
});
test('entrada automática respeita canal, mínimo de humanos e gravação existente', () => {
  const config = { channelId: '10', minimum: 3, enabled: true };
  assert.equal(shouldAutoJoin(config, '10', 3, false), true);
  assert.equal(shouldAutoJoin(config, '10', 2, false), false);
  assert.equal(shouldAutoJoin(config, '11', 4, false), false);
  assert.equal(shouldAutoJoin(config, '10', 4, true), false);
  assert.equal(shouldAutoJoin({ ...config, enabled: false }, '10', 4, false), false);
  assert.equal(wizardCommand.toJSON().options?.length, 4);
});
test('membro comum não configura e não encerra gravação de outro canal', async () => {
  const member = { id: '999', voice: { channelId: '30' } };
  const client = { guilds: { fetch: async () => ({ id: '1', members: { fetch: async () => member } }) } } as any;
  let stops = 0; const recorder = { active: new Map([['1', { channelId: '20' }]]), stop: async () => { stops++; } } as any;
  const controls = new GuildControls(client, '123', 'dados', recorder);
  const replies: string[] = [];
  const interaction = (action: string) => ({ commandName: 'wizard', inGuild: () => true, guildId: '1', user: { id: '999' }, options: { getSubcommand: () => action }, deferReply: async () => {}, editReply: async (s: string) => replies.push(s) }) as any;
  await controls.command(interaction('configurar')); await controls.command(interaction('parar'));
  assert.equal(replies[0], t('erro.so_dono_configura')); assert.equal(replies[1], t('erro.precisa_estar_no_canal')); assert.equal(stops, 0);
});
test('anexos grandes divididos conservam bytes e português', () => {
  const original = Buffer.from('Sessão 🧙 ação\n'.repeat(100)); const parts = fileParts(original, 31);
  assert.deepEqual(Buffer.concat(parts), original); assert.ok(parts.every(p => p.length <= 31));
  assert.equal(parts.map(p => p.toString('utf8')).join(''), original.toString('utf8'));
});
