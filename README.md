# WIZArd

![WIZArd](docs/capa.webp)

Bot de Discord que **grava conversas de voz, transcreve com Whisper e gera resumos com IA**. Está em produção numa VPS. O primeiro caso de uso real é o meu grupo de RPG: o bot registra cada sessão da campanha e mantém o histórico da mesa.

A arquitetura (gravação por pessoa → transcrição → classificação por LLM → resumo → aprovação humana) serve para qualquer conversa, como reuniões, aulas ou atendimento. O que é específico da campanha fica separado do resto: o formato do resumo e o vocabulário em arquivos de configuração, e as regras de reconhecimento da mesa num módulo próprio (`src/sessions/campaign.ts`).

## Como funciona

```
Canal de voz ──► gravação (uma faixa por pessoa, Opus → Ogg)
             ──► transcrição local (faster-whisper, com nome de quem falou e horário)
             ──► IA classifica: "isto é mesmo uma sessão da campanha?"
                    (confiança ≥ 0,90 + trechos literais como evidência; senão pergunta ao dono)
             ──► IA gera o resumo no formato da mesa, usando um glossário extraído das sessões anteriores
             ──► DM pro dono com o resumo e botões; ele aprova a entrada na coleção oficial
```

## Destaques técnicos

- **Pipeline de IA com proteção contra erro:** o classificador e o resumidor são chamadas separadas. A classificação exige evidência literal da transcrição, e evidência inventada pela IA é rejeitada. Na dúvida, o bot pergunta ao humano em vez de decidir sozinho.
- **Glossário automático:** os nomes de personagens e lugares saem das sessões já aprovadas. Viram *hotwords* do Whisper (pra transcrever certo) e glossário do resumidor (pra corrigir o que o Whisper errou).
- **Sem API paga:** usa Codex CLI e Claude Code autenticados por assinatura, com fallback entre eles.
- **Produção de verdade:** serviço systemd, deploy com testes no PC e na VPS, troca atômica de versão e rollback automático se o bot cair.
- **Privacidade:** só o dono acessa arquivos; o bot sai de servidores onde o dono não está; áudio e transcrições expiram com validação por hash.
- **~80 testes automatizados** (`node --test`), TypeScript rodando direto no Node 24, sem etapa de build.

## Desenvolvido com agentes de IA

O projeto foi construído com Claude Code e Codex trabalhando em revezamento. As regras e autorizações ficam em [`AGENTS.md`](AGENTS.md), e as etapas com critério de conclusão em [`docs/CRONOGRAMA.md`](docs/CRONOGRAMA.md). Um diário de continuidade (mantido fora do repositório, por ter dados da infraestrutura) faz a passagem de contexto entre um agente e outro. Meu papel: definir o produto e as regras, revisar, testar com a mesa de verdade e decidir.

## Comece por aqui

- **[Como mudar mensagens, botões e ajustes](docs/COMO-MUDAR.md)** — sem programar: edite `config/` e rode `npm.cmd run deploy`.

- [Cronograma](docs/CRONOGRAMA.md): etapas, estimativas e critérios de conclusão.
- Continuidade entre IAs (`docs/CONTINUIDADE.md`, só local): estado real, decisões, testes e próximo passo.
- [Arquitetura](docs/ARQUITETURA.md): diretórios e fluxo de dados.
- [Discord](docs/DISCORD.md): menu privado e comandos.
- [VPS](docs/VPS.md): instalação, migração, systemd e teste de aceitação.

Codex deve ler `AGENTS.md`; Claude deve ler `CLAUDE.md`. Ambos apontam para a mesma memória em `docs/`.

## Uso

Requer Node.js >= 24.19. No PowerShell use `npm.cmd`; no Linux, `npm`.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run setup:voice
npm.cmd run bot
```

O `.env.example` documenta as configurações. Token e proprietário ficam somente no `.env` privado. Voz exige FFmpeg e as dependências de `voice-runtime/`; transcrição exige Python e `scripts/requirements.txt` em um ambiente isolado. O serviço systemd preparado em `deploy/` evita iniciar manualmente após cada reinício, depois da instalação na VPS.

Envie qualquer mensagem na DM para abrir o menu. Só o proprietário recebe botões e arquivos. Membros podem usar `/wizard entrar` no próprio canal; apenas o dono usa `/wizard configurar` para definir canal, mínimo de humanos e entrada automática.

## Reconhecimento da mesa

Antes de gerar um novo resumo, uma chamada separada de IA verifica se a transcrição contém uma sessão efetiva de **Serpente de Duas Cabeças**. Testes, conversa comum, outro RPG ou dúvida bloqueiam o formato da campanha. A regra exige confiança de pelo menos 0,90, referências distintas da mesa e trechos literais de evidência. A classificação usa instruções neutras; o formato privado só é enviado na geração aprovada.

Isso é reconhecimento probabilístico e precisa de validação com exemplos reais. Não garante identificação perfeita. Áudio e transcrição continuam acessíveis quando o resumo é bloqueado. Inclusão na coleção ainda exige o clique explícito do proprietário. Os resumos históricos já existentes são preservados, sem reclassificação automática.

Reconhecimento e resumo usam Codex/Claude Code já autenticado por assinatura, sem selecionar API paga automaticamente. A classificação acrescenta uma chamada de IA antes do resumo; o resultado é armazenado por hash para evitar repetir a análise na mesma saída. Na VPS é necessário autenticar o CLI como usuário do serviço. O login do Windows não é transferido automaticamente.

## Comandos de terminal

```powershell
npm.cmd run resumir -- dados/transcricoes/sessao.txt --saida dados/resumos/sessao.md
npm.cmd run enviar -- dados/resumos/sessao.md
npm.cmd run historico -- dados/resumos/sessao.md --confirmar
```

`enviar` enfileira um resumo existente sem gerar novamente. `historico --confirmar` é a alternativa manual explícita à decisão do Discord. `resumir --help` mostra opções de provedor, formato, glossário e preservação da entrada. O formato real é `Arquivo Formato Resumo de Sessão.md`; o exemplo público está em `examples/formatador.md`.

## Dados e retenção

`dados/`, `.env`, formatos reais e imagens pessoais não são publicados. Resumos e coleção são preservados; inclusão faz backup e evita duplicatas. Novas entregas de resumo usam uma única mensagem com Markdown e botões. Entregas antigas em andamento conservam o protocolo anterior para poder retomar.

TXT segue a regra existente: 7 dias após entrega completa do resumo na DM, respeitando `--manter-transcricao`. Conversas/testes sem resumo ainda não têm prazo automático de exclusão de TXT. Áudio expira 14 dias após a transcrição pronta, com validação de hash e existência de transcrição ou resumo; áudio ainda não transcrito é preservado. Os prazos e essa limitação estão registrados no cronograma para revisão após o primeiro teste real.

A gravação salva a mistura (para download) e uma faixa por pessoa (para a transcrição com nomes), com partes de aproximadamente 15 minutos. A implementação limita a uma gravação simultânea e 6 horas por padrão. Pedidos de transcrição/resumo são persistidos e processados um por vez; pedidos interrompidos por reinício exigem novo pedido explícito.
