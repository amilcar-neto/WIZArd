import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCollection, whisperTerms, glossaryText, properName, manualTerms } from '../src/sessions/campaign-glossary.ts';
import { validateClassification } from '../src/sessions/campaign.ts';

// Coleção fictícia no mesmo formato dos resumos.
const collection = `# Sessão 1: Início
## Resumo executivo
Texto que não entra no glossário.
## Personagens e NPCs introduzidos
- *Ana Tester* — guia fictícia.
- *Líder dos guardas* — descrição genérica.
## Itens, locais e referências
- **Vila Exemplo** (vilarejo) — lugar fictício.
## Pontas soltas
- nada
# Sessão 2: Depois
## Personagens e NPCs introduzidos
- *Zorvak* — vilão fictício.
- *Ana Tester* — de novo.
`;

test('glossário pega só personagens, itens e lugares, sem descrições genéricas', () => {
  const sessions = parseCollection(collection);
  assert.deepEqual(sessions.map(s => s.names), [['Ana Tester', 'Vila Exemplo'], ['Zorvak', 'Ana Tester']]);
  const text = glossaryText(sessions, ['Sekiro']);
  assert.match(text, /Vila Exemplo/); assert.match(text, /Sekiro/); assert.doesNotMatch(text, /Texto que não entra/);
  assert.equal(properName('Líder dos guardas'), false); assert.equal(properName('Ilha da Queimada Grande'), true);
});
test('Whisper: vocabulário manual primeiro, depois nomes da sessão mais recente', () => {
  assert.deepEqual(whisperTerms(parseCollection(collection), manualTerms('# comentário\nSekiro\nzorvak\n')), ['Sekiro', 'zorvak', 'Ana Tester', 'Vila Exemplo']);
});
test('nomes da coleção também contam como referência da mesa', () => {
  const transcript = 'Mestre: Zorvak aparece na porta.\nJogador: Ana Tester corre para a Vila Exemplo.';
  const answer = { category: 'campaign', campaignId: 'serpente-duas-cabecas', confidence: 0.95, reason: 'cenas', evidence: ['Zorvak aparece na porta.', 'Ana Tester corre para a Vila Exemplo.'] };
  assert.equal(validateClassification(answer, transcript).accepted, false);
  assert.equal(validateClassification(answer, transcript, ['Zorvak', 'Ana Tester']).accepted, true);
});
