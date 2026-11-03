# WIZArd — instruções compartilhadas para agentes

Antes de trabalhar, leia `docs/CONTINUIDADE.md` e `docs/CRONOGRAMA.md`. Ambos são a memória compartilhada entre Codex, Claude e outros agentes. Atualize-os ao terminar uma etapa ou interromper o trabalho: mudanças, testes executados, limitações, descobertas e próximo passo concreto. Não marque como concluído algo apenas planejado ou sem teste real quando esse teste for necessário.

## Autorizações e preferências do usuário

- Implementar o bot Discord WIZArd para RPG, incluindo gravação, transcrição, resumo, biblioteca privada e execução contínua na VPS.
- Só o `DISCORD_OWNER_ID` configura o bot e acessa os arquivos de campanha na DM. Outros usuários recebem uma resposta sem botões nem arquivos.
- Membros do servidor podem chamar o bot para o canal de voz em que eles próprios estão. Configuração de entrada automática (canal e mínimo de pessoas) é exclusiva do proprietário.
- Resumos na DM: uma única mensagem com Markdown e botões. Não repetir o texto integral em mensagens divididas.
- Acrescentar resumo à coleção exige clique explícito do proprietário. Preservar backups e impedir duplicatas.
- Antes de aplicar o formato de Serpente de Duas Cabeças, reconhecer que é uma sessão efetiva dessa mesa. Testes, conversas comuns, outro RPG ou dúvida devem bloquear o formato e a inclusão, preservando os arquivos. Nunca tratar teste do bot como sessão da campanha. Futuramente haverá outras mesas; manter a identificação separada do resumidor.
- Não pedir novamente decisões já registradas. Não enviar mensagens para pessoas nem reenviar resumos reais apenas para testar.
- Não ler/exibir `.env`, senhas, chaves privadas ou transcrições reais nos logs. Usar dados fictícios nos testes.
- Não apagar originais nem sobrescrever resumos/coleções para corrigir testes. Respeitar a retenção descrita na documentação e validar hashes/caminhos antes de excluir.
- O formato real do usuário é `Arquivo Formato Resumo de Sessão.md`; não modificar esse formato por iniciativa própria.

## Ambiente e execução

- Workspace Windows: a pasta deste repositório no PC do dono. PowerShell bloqueia `npm.ps1`: usar `npm.cmd`.
- Node.js >= 24.19. TypeScript executado nativamente pelo Node.
- Testes: `node --test tests/<arquivo>.test.ts`, `npm.cmd test` e `python tests/migration_test.py`. Testes devem usar arquivos temporários fictícios.
- Este diretório não era um repositório Git em 28/10/2026. Não presumir commits, branches ou histórico Git.
- VPS do usuário (Hostinger KVM2): endereço em `WIZARD_DEPLOY_HOST` no `.env` local, nunca nos arquivos versionados. Ubuntu é uma hipótese, não foi confirmado por acesso remoto.
- No ambiente do Codex, rede de shell negou SSH porta 22 e acesso ao registry npm com `EACCES`. Isso não prova falha da VPS, token ou chave. Não pedir senha por chat nem enfraquecer verificação SSH.
- Não instalar/desligar serviços de outros projetos na VPS. Inspecionar antes de qualquer implantação e usar usuário de serviço próprio.

## Desenvolvimento (PC) e produção (VPS)

- O PC é desenvolvimento; a VPS é produção. Editar código só no PC. Não editar arquivos em `/opt/wizard` diretamente.
- Publicar com `npm.cmd run deploy` (testa no PC, envia só os arquivos de `deploy/release-files.txt`, testa na VPS, troca a versão e volta sozinho se falhar). `-- --ligar` também liga o bot. Nunca envia `.env`, `dados/` nem `node_modules`.
- Na VPS o dono opera com o comando `wizard` (`on`, `off`, `restart`, `status`, `logs`, `login`, `versao`, `versoes`, `voltar`, `help`).
- A chave SSH tem senha. Não registrar a senha em arquivos. Para deploy sem interação, o usuário precisa deixar a chave carregada num ssh-agent.
- Não rodar o bot local com o mesmo token enquanto a produção estiver ligada.
- Coleção oficial da Serpente: `%USERPROFILE%/Downloads/serpente de duas cabeças/Transcricoes_Completas_Sessoes.md` no PC. `dados/Transcricoes_Completas_Sessoes.md` faz parte só do fluxo da Serpente e deve ser desconsiderado em outras mesas/fluxos. Não apagar nem mesclar.
- Decisão do dono (28/10/2026): a VPS mantém a própria cópia da coleção (`/opt/wizard/dados/colecao/...`). Não sincronizar automaticamente VPS → PC nem PC → VPS. O dono baixa a coleção pelo Discord (enviada após aprovação ou pelo menu) e substitui o arquivo oficial manualmente.

## Textos e ajustes editáveis

- Todo texto mostrado no Discord fica em `config/textos.txt` (use `t('chave')` de `src/config/texts.ts`); ajustes simples em `config/ajustes.txt`. Não escrever mensagens fixas no código. `tests/texts.test.ts` exige que chaves usadas e existentes batam.
- O dono quer poder mudar textos sem IA: manter `docs/COMO-MUDAR.md` atualizado e os comentários do arquivo claros.

## Atualização da memória

Registre em `docs/CONTINUIDADE.md` o estado real dos arquivos, comandos de validação, resultados e bloqueios. `docs/CRONOGRAMA.md` define etapas, critérios de conclusão e o checklist único de execução/aceitação; atualize as caixas somente com evidência registrada na continuidade. Não crie checklists concorrentes. Prazos são estimativas de trabalho, sem prometer datas de entrega.
