// Protege config/textos.txt e config/ajustes.txt contra erros de edição.
// Se um destes testes falhar depois de mudar um texto, a mensagem diz o que corrigir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, t } from '../src/config/texts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const texts = parseConfig(readFileSync(join(root, 'config', 'textos.txt'), 'utf8'), 'config/textos.txt');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : []; });
}
const code = sources(join(root, 'src')).map(p => readFileSync(p, 'utf8')).join('\n');
const used = new Set([...code.matchAll(/\bt\('([a-z_.]+)'/g)].map(m => m[1]));
// Chaves escolhidas com ? : dentro de t(...) também contam.
for (const m of code.matchAll(/'((?:dm|menu|botao|sessoes|sessao|arquivo|fila|confirmacao|gravacao|comando|opcao|status|erro|entrega|decisao|pos_sessao)\.[a-z_]+)'/g)) used.add(m[1]);

test('textos.txt e ajustes.txt estão no formato "chave = texto"', () => {
  assert.ok(texts.size > 50);
  parseConfig(readFileSync(join(root, 'config', 'ajustes.txt'), 'utf8'), 'config/ajustes.txt');
  assert.throws(() => parseConfig('sem igual'), /linha 1/);
  assert.throws(() => parseConfig('a = 1\na = 2'), /duas vezes/);
});
test('todo texto usado pelo bot existe em config/textos.txt', () => {
  const missing = [...used].filter(k => !texts.has(k));
  assert.deepEqual(missing, [], 'Faltam estas linhas em config/textos.txt (talvez o nome antes do "=" tenha sido alterado): ' + missing.join(', '));
});
test('config/textos.txt não tem linhas que o bot não usa', () => {
  const extra = [...texts.keys()].filter(k => !used.has(k));
  assert.deepEqual(extra, [], 'Estas linhas de config/textos.txt não são usadas (nome errado?): ' + extra.join(', '));
});
test('botões e descrições respeitam os limites do Discord', () => {
  for (const [key, value] of texts) {
    if (key.startsWith('botao.')) assert.ok(value.length >= 1 && value.length <= 80, `${key}: botão precisa ter de 1 a 80 letras`);
    if (key.startsWith('comando.') && !/gravacao|auto_|ativada|desativada/.test(key) || key.startsWith('opcao.')) assert.ok(value.length >= 1 && value.length <= 100, `${key}: descrição precisa ter de 1 a 100 letras`);
  }
});
test('{palavras} são trocadas e quebras de linha funcionam', () => {
  assert.equal(parseConfig('x = a\\nb {nome}').get('x'), 'a\nb {nome}');
  assert.match(t('fila.transcricao_pronta', { titulo: 'Sessão X' }), /^Sessão X\n/);
  assert.equal(t('chave.que.nao.existe'), 'chave.que.nao.existe');
});
