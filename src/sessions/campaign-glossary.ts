// Glossário automático tirado da coleção de resumos: nomes de personagens, NPCs, itens e lugares
// já registrados. Serve para o resumo corrigir nomes que a transcrição errou, para o Whisper
// (nomes recentes) e para reconhecer a mesa. Atualiza sozinho quando a coleção cresce.
import { readFile } from 'node:fs/promises';

const SECTIONS = ['Personagens e NPCs introduzidos', 'Itens, locais e referências'];
export type CollectionSession = { title: string; names: string[]; text: string };

// Nome próprio: uma palavra com maiúscula, ou várias com alguma maiúscula depois da primeira.
// Descarta descrições genéricas como "Líder dos guardiões".
export function properName(name: string) {
  const words = name.trim().split(/\s+/);
  if (!words[0] || words.length > 6) return false;
  return words.length === 1 ? /^\p{Lu}/u.test(words[0]) : words.slice(1).some(w => /^["'(]?\p{Lu}/u.test(w));
}
const clean = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/[.,;:]+$/, '').trim();

export function parseCollection(markdown: string): CollectionSession[] {
  return markdown.split(/^# /m).slice(1).map(block => {
    const title = block.split('\n', 1)[0].trim();
    const kept = block.split(/^## /m).slice(1).filter(part => SECTIONS.includes(part.split('\n', 1)[0].trim()));
    const text = kept.map(part => '## ' + part.trimEnd()).join('\n\n');
    const names = [...text.matchAll(/^\s*[-*]\s+\*{1,2}([^*\n]+?)\*{1,2}/gm)].map(m => clean(m[1])).filter(properName);
    return { title, names, text };
  }).filter(s => s.text);
}

// Ordem para o Whisper: primeiro o vocabulário manual, depois nomes da sessão mais recente para trás.
export function whisperTerms(sessions: CollectionSession[], manual: string[]) {
  const seen = new Set<string>(), terms: string[] = [];
  for (const term of [...manual, ...sessions.slice().reverse().flatMap(s => s.names)]) {
    const key = term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (!seen.has(key)) { seen.add(key); terms.push(term); }
  }
  return terms;
}

export function glossaryText(sessions: CollectionSession[], manual: string[]) {
  const parts = ['# Glossário da campanha (gerado da coleção de resumos)',
    'Grafia correta de nomes e termos já registrados. A transcrição automática costuma errar estes nomes; use esta lista para identificar o que deveria ser.'];
  if (manual.length) parts.push('## Vocabulário extra\n' + manual.map(t => '- ' + t).join('\n'));
  for (const s of sessions) parts.push(`# ${s.title}\n${s.text}`);
  return parts.join('\n\n') + '\n';
}

export function manualTerms(text: string) {
  return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')))];
}

// Lê a coleção e o vocabulário manual; arquivos ausentes viram listas vazias.
export async function campaignContext(historyPath: string, vocabularyPath: string) {
  const read = async (p: string) => { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; } };
  const sessions = parseCollection(await read(historyPath)), manual = manualTerms(await read(vocabularyPath));
  return {
    sessions, manual,
    names: [...new Set(sessions.flatMap(s => s.names))],
    whisper: whisperTerms(sessions, manual),
    glossary: sessions.length || manual.length ? glossaryText(sessions, manual) : '',
  };
}
