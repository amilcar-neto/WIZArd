import { parseArgs } from 'node:util';
import { appendFile, mkdir } from 'node:fs/promises';
import { summarize } from '../summaries/summarize.ts';
import { queueCollection } from '../collection/queue.ts';
import type { Selection } from '../summaries/providers.ts';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    saida: { type: 'string' }, formatador: { type: 'string', default: process.env.FORMATADOR_PATH ?? 'Arquivo Formato Resumo de Sessão.md' },
    glossario: { type: 'string' }, 'manter-transcricao': { type: 'boolean', default: false },
    provedor: { type: 'string', default: process.env.WIZARD_PROVIDER ?? 'auto' }, modelo: { type: 'string' },
    historico: { type: 'string', default: process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md' }, 'sem-historico': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) {
    console.log('Uso: npm run resumir -- entrada.txt --saida dados/resumo.md [--formatador caminho.md] [--glossario glossario.txt] [--manter-transcricao] [--provedor auto|codex|claude] [--modelo nome] [--historico caminho.md] [--sem-historico]');
    return;
  }
  if (positionals.length !== 1 || !values.saida) throw new Error('Informe uma entrada .txt e --saida resumo.md. Use --help para ajuda.');
  const result = await summarize({ input: positionals[0], output: values.saida, formatter: values.formatador!, glossary: values.glossario,
    keepInput: values['manter-transcricao'], selection: values.provedor as Selection, model: values.modelo,
    timeoutMs: Number(process.env.WIZARD_TIMEOUT_MS ?? 900000),
    onFallback: (_provider, reason) => console.log('Codex indisponível (' + reason + '). Tentando Claude Code...') });
  if (!values['sem-historico']) {
    const pending = await queueCollection({ summary: result.output, history: values.historico! });
    console.log('Coleção não alterada. Resumo na fila; mantenha o bot conectado para receber a DM e decidir.');
    console.log(pending.path);
  }
  console.log(result.resumed ? 'Resultado validado; retomada concluída.' : 'Resumo salvo com sucesso.');
  console.log('Provedor: ' + result.provider);
  console.log('Transcrição preservada. O prazo de 7 dias depende da entrega completa confirmada pelo bot.');
  console.log(result.output);
}
try { await main(); } catch (error) {
  // Mensagens da rede e do filesystem podem conter nomes privados: só erros próprios são exibidos.
  const err = error as Error & { code?: string };
  const safe = (err.code && err.code !== 'WIZARD_CAMPAIGN_MISMATCH') || err.name === 'TypeError' || err.name === 'TimeoutError' || err.name === 'SyntaxError';
  console.error(safe ? 'Falha local, de rede ou configuração. Confira caminhos, conexão e login do Codex/Claude Code; entrada preservada se ainda não houve sucesso.' : err.message);
  try { await mkdir('dados', { recursive: true }); await appendFile('dados/falhas.jsonl', JSON.stringify({ at: new Date().toISOString(), event: 'pipeline_failed' }) + '\n'); } catch { console.error('Não foi possível registrar a falha em disco.'); }
  process.exitCode = 1;
}
