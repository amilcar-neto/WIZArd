# Discord — WIZArd

O bot usa Gateway e funciona no PC ou como serviço na VPS. Código implementado; teste real das novas funções pendente. Para hospedar continuamente, siga [VPS.md](VPS.md).

## Configuração

No Developer Portal, mantenha o token apenas no `.env` privado. Configure `DISCORD_OWNER_ID` com seu ID numérico. Instale no servidor com escopos `bot` e `applications.commands`, permissões Ver canais, Enviar mensagens, Anexar arquivos, Ler histórico e Conectar. Não precisa de Administrator nem dos intents privilegiados de membros/presença/conteúdo para este fluxo de DM e comandos slash.

O código solicita os intents Guilds, DirectMessages e GuildVoiceStates. Recebe mensagens da DM sem precisar ler todas as mensagens do servidor. Se mensagens privadas estiverem bloqueadas, os arquivos permanecem no disco.

```powershell
npm.cmd run bot
```

Esse comando é para desenvolvimento local. Na VPS, systemd assume início e reinício após a instalação.

## Menu privado

Qualquer mensagem sua ao bot abre:

- Transcrições completas: envia os TXT ainda disponíveis, sem substituir por resumos.
- Coleção de resumos: envia o Markdown acumulado que você aprovou.
- Última sessão: estado e ações disponíveis.
- Resumo, transcrição e áudio da última sessão.
- Transcrever última sessão e resumir última sessão.
- Sessões anteriores: lista paginada para selecionar uma gravação.

Outros usuários recebem uma resposta sem botões nem arquivos. Controles privados também verificam o proprietário ao clicar; o ID visual do botão não concede acesso.

Áudio é gravado em partes pequenas e enviado como anexos. TXT grande é dividido em arquivos conservando UTF-8. O menu consulta o disco: conteúdo removido pela retenção aparece como indisponível. Pedidos repetidos de transcrição/resumo não duplicam a tarefa; o bot avisa o dono quando conclui.

## Comandos no servidor

```text
/wizard entrar
/wizard parar
/wizard status
/wizard configurar canal:<canal de voz> minimo:<número> automatico:<true|false> [pos_sessao:<Nada|Transcrever|Transcrever e resumir>]
```

`pos_sessao` (opcional; sem escolher, mantém o valor anterior; padrão Nada) faz o bot pedir sozinho a transcrição, ou a transcrição e o resumo, quando a gravação termina — ao esvaziar o canal ou com `/wizard parar`. Gravação interrompida ou mais curta que `pos_sessao_minimo_minutos` (5) só é transcrita. O resumo automático continua passando pela pergunta "é Serpente?" e pelo clique para entrar na coleção.

Só o proprietário configura. Membros podem chamar o bot para o próprio canal de voz. Quem está no canal gravado e o proprietário podem encerrar. A configuração automática conta humanos, ignora bots, permite uma gravação simultânea e encerra ao esvaziar o canal. Parar manualmente pausa o automático até o canal configurado esvaziar ou o dono configurar novamente.

O bot publica um aviso no canal antes de gravar. Se não consegue publicar o aviso ou conectar, não inicia a gravação. Esta versão grava áudio misturado, sem separar/identificar cada pessoa na transcrição. O limite padrão é 6 horas; ajuste `WIZARD_MAX_RECORDING_HOURS` entre 1 e 12.

## Reconhecimento e coleção

Antes de gerar um resumo novo, a IA verifica se a gravação é uma sessão efetivamente jogada de Serpente de Duas Cabeças. Conversa normal, teste, outro RPG e incerteza bloqueiam o formato e não criam pendência de inclusão. É uma análise probabilística conservadora, a validar com exemplos reais. Downloads e transcrição permanecem disponíveis.

Um resumo aprovado nessa etapa chega em uma única mensagem com Markdown e botões Adicionar à coleção / Não adicionar. Só o dono, na DM e na mensagem correspondente, decide. Adicionar faz backup e evita duplicatas. Não adicionar preserva o resumo individual. Resumos históricos existentes são mantidos; não são reenviados nem reclassificados automaticamente.

```powershell
npm.cmd run enviar -- dados/resumos/sessao-11.md
```

Use o comando acima apenas para enfileirar conscientemente um resumo já pronto. Não o execute só para testar o menu, pois prepara uma entrega real.

## Retenção e falhas

Prazo único de 7 dias (`dias_guarda` em `config/ajustes.txt`), sempre com validação de hash e caminho: áudio expira 7 dias após o fim da gravação, ou após a transcrição se ela vier depois; transcrição sem resumo (conversa, teste, outra mesa) expira 7 dias após ficar pronta; transcrição com resumo expira 7 dias após a entrega completa do resumo na DM, respeitando `--manter-transcricao`. Pedido de transcrição ou resumo na fila impede a exclusão. Resumos e coleção nunca são apagados.

Fila, catálogo, configuração e decisões persistem no disco. Gravações ativas viram interrompidas no reinício e suas partes existentes são preservadas. Gerações interrompidas não repetem automaticamente o consumo do modelo: peça novamente. Locks de escrita deixados por queda abrupta exigem verificar que o processo anterior terminou antes de removê-los; o bot não remove locks antigos às cegas.

Logs em `dados/falhas.jsonl` registram eventos/códigos sem texto da campanha ou token. Voz exige FFmpeg e `npm run setup:voice`; Whisper exige o ambiente Python. Não foi possível instalar/testar essas dependências na execução atual por bloqueio de rede.

Referências: [Gateway Discord](https://docs.discord.com/developers/events/gateway), [Discord.js Voice](https://discord.js.org/docs/packages/voice/main).
