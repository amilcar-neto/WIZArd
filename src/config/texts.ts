// Lê os arquivos editáveis da pasta config/ (textos.txt e ajustes.txt).
// Formato de cada linha:  chave = valor   ·  linhas com # são comentários  ·  \n quebra linha.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const configDir = fileURLToPath(new URL('../../config/', import.meta.url));

export function parseConfig(text: string, file = 'config'): Map<string, string> {
  const map = new Map<string, string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 1) throw new Error(`${file}, linha ${i + 1}: use o formato "chave = texto".`);
    const key = line.slice(0, eq).trim(), value = line.slice(eq + 1).trim();
    if (map.has(key)) throw new Error(`${file}, linha ${i + 1}: "${key}" aparece duas vezes.`);
    map.set(key, value.replace(/\\n/g, '\n'));
  });
  return map;
}

const cache = new Map<string, Map<string, string>>();
function load(name: string) {
  let map = cache.get(name);
  if (!map) { map = parseConfig(readFileSync(join(configDir, name), 'utf8'), 'config/' + name); cache.set(name, map); }
  return map;
}

// Texto mostrado no Discord. {nome} é trocado pelo valor correspondente.
// Chave ausente aparece como o próprio nome da chave, para ser fácil de notar e corrigir.
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = load('textos.txt').get(key);
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

export function setting(key: string, fallback: string): string {
  return load('ajustes.txt').get(key) ?? fallback;
}
export const enabled = (key: string, fallback: boolean) => /^(sim|s|true|1|yes)$/i.test(setting(key, fallback ? 'sim' : 'não'));
