# Cronograma do WIZArd

Atualizado em 28/10/2026 (Claude: implantação preparada na VPS). Estimativas de trabalho ativo aproximado, condicionadas a acesso à VPS e testes reais. Não são datas prometidas.

| Etapa | Critério de conclusão | Estimativa restante | Estado real |
| --- | --- | --- | --- |
| 0. Memória compartilhada | AGENTS.md e CLAUDE.md apontam para cronograma/continuidade atualizados | Concluído | Implementado |
| 1. Arquitetura organizada | Código por responsabilidade, imports e comandos atualizados, testes passam | Concluído | Implementado e validado localmente |
| 2. Entrega limpa | Uma mensagem com Markdown e botões; aprovação mantém backup e não duplica | 15–30 min de teste real | Implementado e testado; validar visualmente no Discord |
| 3. Menu privado e biblioteca | Dono vê arquivos e sessões; terceiro recebe resposta sem controles | 30–60 min de teste real | Implementado com testes simulados; falta validação real |
| 4. Comandos e automático | Só dono configura; membros chamam para próprio canal; mínimo conta humanos | 30–60 min de teste real | Implementado com testes de autorização; falta validar registro/voz no servidor |
| 5. Gravação | Áudio simultâneo, partes baixáveis, parada/reconexão e duração verificadas | 2–4 h | Código implementado; dependências e FFmpeg não instalados/testados neste ambiente |
| 6. Transcrição e fila | Whisper CPU em português, pedido persistido, notificação e download real | 1–3 h | Integração implementada; tarefas testadas com backend simulado; falta Whisper real |
| 7. Reconhecimento da mesa | Testes/conversa/outro RPG bloqueiam Serpente; sessão real reconhecida com evidência | 1–3 h | Gate implementado e testes passam; validar modelo com exemplos reais positivos/negativos |
| 8. Retenção | Hash/caminho/prazos respeitados, catálogo indica indisponibilidade | 1–2 h | TXT antigo e áudio implementados/testados; definir prazo de TXT para conversas sem resumo |
| 9. VPS e serviço contínuo | Ubuntu confirmado, dados migrados, login de IA, systemd e reboot validados | Concluído (falta reboot) | Ubuntu 22.04; bot ligado via systemd, deploy pelo PC, Codex e Claude logados; validar reboot e permissões Discord |
| 10. Aceitação completa | Dono e outro membro testam DM → gravar → baixar → transcrever → reconhecer → resumir → aprovar → reiniciar | 1–2 h | Pendente |

## Checklist de execução e aceitação

Este é o checklist único do projeto. A tabela acima resume as etapas; `CONTINUIDADE.md` registra contexto, evidências e bloqueios. Atualizar ambos ao concluir trabalho, sem manter listas concorrentes. Marcar `[x]` somente após cumprir o item e registrar a evidência na continuidade. Código implementado não significa função validada no Discord.

### Implementação e validação local

- [x] Criar instruções comuns para Codex/Claude e memória compartilhada.
- [x] Organizar código por responsabilidade e atualizar imports/comandos.
- [x] Implementar entrega única com Markdown e botões, preservando retomada antiga.
- [x] Implementar menu privado, biblioteca e paginação de sessões.
- [x] Implementar autorização: dono configura/acessa arquivos; membros chamam no próprio canal.
- [x] Implementar comandos, entrada automática por canal/mínimo e parada.
- [x] Implementar captura/mistura de áudio e partes para download — código ainda sem teste de voz real.
- [x] Implementar fila persistida e integração Whisper — backend real ainda sem teste.
- [x] Implementar reconhecimento conservador antes do formato Serpente — modelo real ainda sem teste.
- [x] Implementar retenção de áudio e preservar regras de TXT/coleção existentes.
- [x] Preparar instalador, serviço systemd e migração Windows/Linux.
- [x] Passar a suíte local: 61 testes Node e 2 testes Python, com dados fictícios.

### Instalação e ativação na VPS — executar nesta ordem

- [x] Conectar por SSH e confirmar sistema operacional, CPU/RAM/disco e serviços existentes.
- [x] Conferir instalação de Node.js >= 24.19 sem afetar outros projetos.
- [x] Transferir código, formato e dados privados com backup; revisar caminhos do `.env` para Linux.
- [x] Instalar dependências Node/voz, FFmpeg e ambiente Python com Whisper.
- [x] Gerar e preservar o lock das dependências de voz após instalação validada.
- [x] Preparar usuário `wizard`, permissões e armazenamento conforme `VPS.md`.
- [x] Simular e aplicar migração dos recibos; verificar caminhos, hashes e IDs dos botões antigos.
- [x] Autenticar Codex (principal) e Claude (reserva) na VPS como `wizard` com `wizard login`; CLIs já instalados.
- [ ] Conferir escopos/permissões Discord e registro de `/wizard`.
- [x] Parar a instância local do mesmo bot antes de ativar a VPS.
- [x] Ativar systemd e confirmar serviço ativo e conexão do bot pelo log.

### Aceitação real — ambiente já instalado

- [ ] Dono envia qualquer DM e recebe o menu.
- [ ] Outro usuário envia DM e recebe resposta sem botões nem arquivos.
- [ ] Conferir visualmente uma entrega autorizada: somente Markdown/prévia e botões, sem repetição do texto.
- [ ] Conferir coleção, transcrições completas, última sessão e paginação das anteriores.
- [ ] Membro chama para o próprio canal; configuração é recusada para quem não é dono.
- [ ] Validar canal automático, mínimo de humanos, bots ignorados e parada ao esvaziar.
- [x] Gravar conversa curta com participantes cientes e conferir aviso, vozes simultâneas e áudio baixado.
- [x] Transcrever com Whisper real; verificar português, timestamps, notificação e download do TXT.
- [x] Confirmar que conversa normal e gravação de teste bloqueiam o formato Serpente e não criam pendência na coleção.
- [ ] Testar reconhecimento com trecho real autorizado de Serpente e com trecho de outro RPG; registrar erros/acertos.
- [ ] Validar resumo da campanha e decisão do dono, com backup e sem duplicatas.
- [x] Reiniciar serviço e depois a VPS; confirmar reconexão, catálogo, configurações e recuperação dos pedidos.
- [ ] Simular falha de DM e interrupção de gravação; conferir arquivos preservados e retomada.
- [ ] Medir CPU/RAM/disco e tempo de transcrição para uma duração representativa.
- [ ] Validar retenção com arquivos fictícios e conferir indisponibilidade no menu após expiração.

### Pendências de produto e evolução

- [x] Fluxo dev (PC) → produção (VPS): `npm run deploy` com testes, troca segura e volta automática; comando `wizard` na VPS.
- [x] Definir como a coleção oficial do PC recebe as aprovações feitas pela produção: download manual pelo Discord.

- [x] Definir a política de retenção com o dono (28/10/2026): prazo único de 7 dias para áudio e transcrições (o dono costuma resumir logo após a sessão); resumos e coleção para sempre. Ver "Política de retenção decidida" em CONTINUIDADE.md.
- [ ] Implementar a política de 7 dias (NÃO iniciado; o dono pediu só o planejamento): áudio transcrito (hoje 14), áudio nunca transcrito, transcrição sem resumo e transcrição com resumo passam todos a expirar em 7 dias; testar com arquivos fictícios.
- [x] Definir tratamento de classificação incerta/falso negativo: o bot pergunta ao dono (botões) em vez de bloquear sozinho.
- [ ] Pós-sessão automático (planejado, NÃO iniciado): nova opção em `/wizard configurar` para, quando a gravação terminar porque o canal esvaziou, já pedir transcrição (e opcionalmente resumo). Desligado por padrão. Ver "Pós-sessão automático" em CONTINUIDADE.md.
- [ ] Futuro: perfis/formatos e botões separados por mesa.
- [ ] Futuro: avaliar identificação de falantes, gravações simultâneas e backup externo.

## Decisões permanentes

- Só o dono configura e acessa arquivos na DM; membros podem chamar no próprio canal.
- Uma única mensagem por resumo final com Markdown e botões.
- Identificação da mesa antecede o uso do formato. Na dúvida, bloquear Serpente e preservar os arquivos.
- Conversa normal/teste/outro RPG não entra como sessão da campanha.
- Aprovação explícita para incluir na coleção, com backup e prevenção de duplicatas.
- Outras mesas e botões por mesa são evolução futura. Não reutilizar o formato Serpente como padrão para tudo.
- Reaproveitar a mesma memória entre IAs; registrar resultados reais e não presumir serviço implantado.

## Limites atuais que precisam ficar visíveis

- Recepção de áudio/DAVE precisa de teste real; a biblioteca não garante estabilidade dessa API não documentada pelo Discord.
- Gravação mista, sem identificação de falantes; uma sessão simultânea, máximo padrão de 6 h.
- Classificação por IA é probabilística. Limite 0,90 e evidências reduzem aceitação indevida, mas não provam infalibilidade; pode bloquear uma sessão real curta/sem referências conhecidas.
- Política decidida e ainda não implementada: tudo de áudio/transcrição expira em 7 dias. Até a implementação, valem os prazos atuais (áudio transcrito 14 dias; TXT com resumo 7 dias; TXT sem resumo e áudio não transcrito preservados).
- Gerações interrompidas exigem novo pedido. Locks remanescentes de queda abrupta podem exigir manutenção após verificar o processo antigo.
- Suporte a várias mesas, separação de falantes, gravação de canais simultâneos e backup externo automático não estão implementados.
