import { readFile, mkdir, open, link, unlink, lstat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generate, type Selection, type GenerateOptions } from './providers.ts';
import { pendingDelivery } from '../storage/retention.ts';
import { classifyTranscript, CAMPAIGN_POLICY_VERSION } from '../sessions/campaign.ts';
import { saveJson } from '../storage/json-state.ts';

type Options = { input: string; output: string; formatter: string; glossary?: string; selection?: Selection; model?: string; timeoutMs?: number; keepInput?: boolean; ownerConfirmed?: boolean; references?: string[]; generator?: typeof generate; classifier?: typeof classifyTranscript; onFallback?: GenerateOptions['onFallback'] };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function nonempty(path: string) {
  const text = await readFile(path, 'utf8');
  if (!text.trim()) throw new Error('Arquivo de entrada vazio.');
  return text;
}
async function exists(path: string) {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
// Publica somente depois de fsync; link exclusivo nunca sobrescreve um resultado.
async function publish(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    const file = await open(tmp, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
    await link(tmp, path);
  } finally { await unlink(tmp).catch(() => {}); }
}
export async function summarize(o: Options) {
  const input = resolve(o.input), output = resolve(o.output);
  const receipt = output + '.state.json';
  if (extname(input).toLowerCase() !== '.txt' || extname(output).toLowerCase() !== '.md') throw new Error('Use entrada .txt e saída .md.');
  const paths = [input, output, receipt, resolve(o.formatter), ...(o.glossary ? [resolve(o.glossary)] : [])];
  if (new Set(paths.map(p => p.toLowerCase())).size !== paths.length) throw new Error('Os caminhos de entrada, saída e configuração devem ser diferentes.');
  const timeoutMs = o.timeoutMs ?? 900000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('O timeout deve ser inteiro positivo.');
  const selection = o.selection ?? 'auto';
  if (!['auto', 'codex', 'claude'].includes(selection)) throw new Error('Use --provedor auto, codex ou claude.');
  const formatter = await nonempty(o.formatter);
  const glossary = o.glossary ? await nonempty(o.glossary) : '';
  const configHash = hash(JSON.stringify(['cli-v1', formatter, glossary, selection, o.model ?? null]));
  if (await exists(input)) {
    const stat = await lstat(input);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A entrada deve ser um arquivo regular, sem link simbólico.');
  }
  // A retomada valida o resultado sem gerar outra vez e nunca apaga a entrada.
  if (await exists(receipt)) {
    const state = JSON.parse(await readFile(receipt, 'utf8'));
    if (state.input !== input || state.configHash !== configHash || hash(await readFile(output, 'utf8')) !== state.outputHash) throw new Error('Resultado existente não corresponde à configuração. Escolha outra saída.');
    if (await exists(input)) {
      if (hash(await readFile(input, 'utf8')) !== state.inputHash) throw new Error('A transcrição mudou. Escolha outra saída.');

    }
    return { output, resumed: true, provider: state.provider };
  }
  if (await exists(output)) throw new Error('A saída já existe. Escolha outro nome; nenhum arquivo foi sobrescrito.');
  const transcript = await nonempty(input);
  const inputHash = hash(transcript);
  // O formato de Serpente só é enviado ao resumidor depois de reconhecer a mesa.
  const classificationPath = output + '.classification.json';
  let classification;
  if (await exists(classificationPath)) {
    classification = JSON.parse(await readFile(classificationPath, 'utf8'));
    if (classification.transcriptHash !== inputHash || classification.policyVersion !== CAMPAIGN_POLICY_VERSION) classification = undefined;
  }
  if (!classification) {
    classification = await (o.classifier ?? classifyTranscript)({ transcript, selection, model: o.model, timeoutMs, references: o.references, onFallback: o.onFallback });
    await mkdir(dirname(output), { recursive: true }); await saveJson(classificationPath, classification);
  }
  // O dono pode confirmar pelo Discord que é a mesa mesmo quando a IA ficou em dúvida.
  if (o.ownerConfirmed && !classification.accepted) classification = { ...classification, ownerConfirmed: true };
  else if (!classification.accepted) throw Object.assign(new Error('Esta gravação não foi reconhecida com segurança como sessão de Serpente de Duas Cabeças (' + classification.category + '). Transcrição preservada; nenhum resumo da campanha foi gerado.'), { code: 'WIZARD_CAMPAIGN_MISMATCH' });
  const result = await (o.generator ?? generate)({ selection, formatter, transcript, glossary, model: o.model, timeoutMs, onFallback: o.onFallback });
  const summary = result.text.trim();
  if (!summary) throw new Error('O provedor devolveu um resumo vazio. Entrada preservada.');
  const markdown = summary + '\n';
  await publish(output, markdown);
  await publish(receipt, JSON.stringify({ version: 4, provider: result.provider, input, inputHash, configHash, outputHash: hash(markdown), campaign: classification, retention: pendingDelivery(new Date().toISOString(), o.keepInput ?? false) }, null, 2) + '\n');
  return { output, resumed: false, provider: result.provider };
}
