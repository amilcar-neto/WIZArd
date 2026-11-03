import { parseArgs } from 'node:util';
import { appendHistory } from '../collection/history.ts';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    arquivo: { type: 'string', default: process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md' },
    confirmar: { type: 'boolean', default: false }, sessao: { type: 'string' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) console.log('Uso: npm run historico -- resumo.md --confirmar [--arquivo caminho/historico.md] [--sessao identificador]');
  else {
    if (positionals.length !== 1) throw new Error('Informe um resumo pronto. Use --help para ajuda.');
    if (!values.confirmar) throw new Error('Inclusão automática desativada. Aguarde a confirmação pela DM; para uma inclusão manual explícita, use --confirmar.');
    const result = await appendHistory({ summary: positionals[0], history: values.arquivo!, sessionId: values.sessao });
    console.log(result.added ? 'Resumo acrescentado ao histórico.' : 'Sessão já registrada; histórico preservado.');
    console.log(result.history);
    if (result.backup) console.log('Backup: ' + result.backup);
  }
} catch (e) {
  const err = e as Error & { code?: string };
  console.error(err.code ? 'Falha de leitura ou escrita. Confira os caminhos e as permissões; o resumo individual foi preservado.' : err.message);
  process.exitCode = 1;
}