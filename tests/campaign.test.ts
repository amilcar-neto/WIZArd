import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CAMPAIGN, validateClassification, classifyTranscript } from '../src/sessions/campaign.ts';
import { summarize } from '../src/summaries/summarize.ts';

const transcript = 'Wolfgang abre a porta da Caduceus. Cecília acompanha a investigação.';
const positive = { category: 'campaign', campaignId: CAMPAIGN.id, confidence: 0.98, reason: 'Cena da mesa com referências distintas.', evidence: ['Wolfgang abre a porta da Caduceus.', 'Cecília acompanha a investigação.'] };
test('identificação exige campanha exata, alta confiança e evidências literais distintas', () => {
  assert.equal(validateClassification(positive, transcript).accepted, true);
  assert.equal(validateClassification({ ...positive, confidence: 0.7 }, transcript).accepted, false);
  assert.equal(validateClassification({ ...positive, campaignId: 'outra-mesa' }, transcript).accepted, false);
  assert.equal(validateClassification({ ...positive, evidence: ['Cecília', 'Cecília'] }, transcript).accepted, false);
  assert.throws(() => validateClassification({ ...positive, evidence: ['evidência inventada'] }, transcript), /inválido/);
});
for (const category of ['test', 'conversation', 'other_rpg', 'uncertain']) test(category + ' não usa formato da campanha mesmo mencionando nomes', async () => {
  const result = await classifyTranscript({ transcript, generator: async request => {
    assert.match(request.formatter, /Não escreva resumo/); assert.equal(request.glossary, '');
    return { text: JSON.stringify({ ...positive, category, campaignId: null }), provider: 'codex' };
  } });
  assert.equal(result.accepted, false);
});
test('resumidor bloqueia conversa/teste antes de chamar geração e conserva transcrição', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-campaign-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'teste.txt'), output = join(dir, 'resumo.md'), formatter = join(dir, 'formato.md');
  await writeFile(input, 'Estamos testando o bot enquanto jogamos com amigos.'); await writeFile(formatter, 'Formato privado da campanha.');
  let calls = 0;
  await assert.rejects(summarize({ input, output, formatter,
    classifier: async o => validateClassification({ category: 'test', campaignId: null, confidence: 1, reason: 'Teste do bot.', evidence: [] }, o.transcript),
    generator: async () => { calls++; return { text: 'Nunca gerar', provider: 'codex' }; }
  }), /nenhum resumo/);
  assert.equal(calls, 0); await access(input); await assert.rejects(access(output));
  const cached = JSON.parse(await readFile(output + '.classification.json', 'utf8')); assert.equal(cached.category, 'test');
});
