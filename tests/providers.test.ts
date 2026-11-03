import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, parseResult, ProviderError, subscriptionEnv, runProcess } from '../src/summaries/providers.ts';
import { tmpdir } from 'node:os';
const payload = { resumo: '# Sessão fictícia\nA porta foi aberta.', complete: true };
const codex = { code: 0, stderr: '', stdout: [
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(payload) } },
  { type: 'turn.completed', usage: {} }
].map(e => JSON.stringify(e)).join('\n') };
const claude = { code: 0, stderr: '', stdout: JSON.stringify({ subtype: 'success', is_error: false, structured_output: payload }) };
const base = { formatter: 'Formato original\ncom acentuação.', transcript: 'Uma porta abriu.', glossary: '', resolveExecutable: async (p: any) => p };
test('auto prioriza Codex e envia formato intacto por stdin', async () => {
  const calls: string[] = [];
  const result = await generate({ ...base, runner: async (file, args, stdin) => { calls.push(file); assert.equal(JSON.parse(stdin).formato, base.formatter); assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only')); return codex; } });
  assert.deepEqual(calls, ['codex']); assert.equal(result.provider, 'codex'); assert.equal(result.text, payload.resumo);
});
for (const reason of ['limit', 'auth', 'unavailable'] as const) test('alternativa Claude quando Codex: ' + reason, async () => {
  const calls: string[] = [];
  const result = await generate({ ...base, runner: async (file, args) => {
    calls.push(file);
    if (file === 'codex') throw new ProviderError('codex', reason);
    assert.ok(args.includes('--safe-mode')); assert.ok(args.includes('--no-session-persistence'));
    return claude;
  } });
  assert.deepEqual(calls, ['codex', 'claude']); assert.equal(result.provider, 'claude');
});
test('seleção explícita Claude não chama Codex', async () => {
  await generate({ ...base, selection: 'claude', runner: async file => { assert.equal(file, 'claude'); return claude; } });
});
test('resposta incompleta não é salva nem dispara segunda geração', async () => {
  let calls = 0;
  await assert.rejects(generate({ ...base, runner: async () => { calls++; return { ...codex, stdout: '' }; } }), /incomplete/);
  assert.equal(calls, 1);
});
test('falha de cota é reconhecida sem expor texto do CLI', () => {
  assert.throws(() => parseResult('codex', { code: 1, stdout: '', stderr: 'Usage limit reached. SEGREDO' }), e => e instanceof ProviderError && e.reason === 'limit' && !e.message.includes('SEGREDO'));
});
test('chaves de API não são repassadas aos CLIs', () => {
  const env = subscriptionEnv({ ANTHROPIC_API_KEY: 'fake', OPENAI_API_KEY: 'fake', CODEX_API_KEY: 'fake', CLAUDE_CODE_USE_BEDROCK: '1', PATH: 'caminho', CODEX_HOME: 'login' });
  assert.deepEqual(env, { PATH: 'caminho', CODEX_HOME: 'login' });
});
test('processo recebe stdin com caracteres e metacaracteres sem shell', async () => {
  const input = 'Sessão: ação $() ` & |';
  const result = await runProcess(process.execPath, ['-e', "process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data',x=>s+=x); process.stdin.on('end',()=>process.stdout.write(s));"], input, tmpdir(), 10000);
  assert.equal(result.code, 0); assert.equal(result.stdout, input);
});
test('timeout encerra o processo e não retorna texto parcial', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], '', tmpdir(), 200), (e: any) => e.code === 'WIZARD_TIMEOUT');
});