import { parseArgs } from 'node:util';
import { resolve, relative, isAbsolute } from 'node:path';
import { queueCollection } from '../collection/queue.ts';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { historico: { type: 'string', default: process.env.WIZARD_HISTORY_PATH ?? 'dados/Transcricoes_Completas_Sessoes.md' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) console.log('Uso: npm run enviar -- dados/resumos/resumo.md [--historico colecao.md]. O bot precisa estar rodando.');
  else {
    if (positionals.length !== 1) throw new Error('Informe um resumo pronto.');
    const summary = resolve(positionals[0]), root = resolve(process.env.WIZARD_SUMMARY_DIR ?? 'dados/resumos'), rel = relative(root, summary);
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Coloque o resumo dentro de WIZARD_SUMMARY_DIR (padrão dados/resumos).');
    await queueCollection({ summary, history: values.historico! });
    console.log('Resumo na fila. Com o bot conectado, será entregue pela DM. Nenhuma inclusão automática na coleção.');
  }
} catch (e) { const err = e as Error & { code?: string }; console.error(err.code ? 'Falha local ao preparar entrega; confira os caminhos.' : err.message); process.exitCode = 1; }