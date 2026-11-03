import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { listReleaseFiles, makeTarGz } from '../deploy/publish.ts';

test('pacote do deploy guarda caminho UTF-8 e conteúdo intactos', () => {
  const data = Buffer.from('conteúdo fictício\n');
  const tar = gunzipSync(makeTarGz([{ path: 'Arquivo Formato Resumo de Sessão.md', data }]));
  assert.equal(tar.length % 512, 0);
  assert.ok(tar.includes(Buffer.from(' path=Arquivo Formato Resumo de Sessão.md\n')));
  assert.ok(tar.includes(data));
  const sum = (h: Buffer) => { let s = 0; h.forEach((b, i) => { s += i >= 148 && i < 156 ? 32 : b; }); return s; };
  const first = tar.subarray(0, 512);
  assert.equal(parseInt(first.subarray(148, 154).toString(), 8), sum(first));
});

test('deploy nunca inclui .env, dados nem node_modules', () => {
  const files = listReleaseFiles(fileURLToPath(new URL('..', import.meta.url)));
  assert.ok(files.includes('src/discord/bot.ts'));
  assert.ok(files.includes('deploy/wizard-cli.sh'));
  assert.ok(!files.some(f => f === '.env' || f.startsWith('dados/') || f.includes('node_modules/') || f.includes('__pycache__')));
});
