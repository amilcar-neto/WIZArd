# Arquitetura do WIZArd

A organização separa o Discord, o domínio das sessões e as operações de arquivo. TypeScript roda diretamente no Node, sem etapa de build e sem framework adicional.

```text
WIZArd/
├── AGENTS.md                 Instruções comuns para agentes
├── CLAUDE.md                 Entrada do Claude para a mesma memória
├── README.md                 Visão geral e comandos
├── src/
│   ├── discord/              Gateway, DM, botões, comandos e gravação
│   ├── sessions/             Catálogo, tarefas, mistura PCM e reconhecimento da mesa
│   ├── summaries/            Resumidor e integração Codex/Claude
│   ├── collection/           Fila de aprovação e histórico com backup
│   ├── storage/              Estado JSON, fila em disco, retenção e limpeza
│   └── cli/                  Entradas dos comandos npm
├── tests/                    Testes com dados fictícios
├── docs/                     Cronograma, continuidade, Discord, VPS e arquitetura
├── scripts/                  Whisper local e migração de caminhos Windows/Linux
├── deploy/                   Serviço systemd e instalador Ubuntu/Debian
├── voice-runtime/            Dependências opcionais de voz
├── examples/                 Formato de exemplo público
└── dados/                    Arquivos privados de campanha; ignorados pelo Git
```

Os arquivos privados de formato e imagens já presentes na raiz foram preservados para não quebrar configurações existentes. O `.env` também permanece na raiz. A organização não move nem reescreve transcrições, resumos ou coleções reais.

## Fluxo

1. `src/discord/bot.ts` inicia o cliente, recupera o catálogo e a fila e registra `/wizard`.
2. `guild-controls.ts` valida configuração exclusiva do dono e chamadas dos membros no próprio canal.
3. `voice-recorder.ts` recebe Opus via DAVE, decodifica e mistura PCM usando `sessions/audio-mixer.ts`; FFmpeg grava partes Ogg no disco.
4. `sessions/library.ts` registra gravações e importa resumos antigos pelos recibos da fila, sem mover arquivos.
5. `private-menu.ts` oferece biblioteca e downloads somente ao dono e enfileira pedidos em `sessions/jobs.ts`.
6. Transcrição chama `scripts/transcribe.py` com Whisper local em CPU. Não chama a IA de resumo automaticamente.
7. Resumo passa por `sessions/campaign.ts`. Se a mesa não for reconhecida, bloqueia o formato Serpente e preserva os arquivos.
8. `summaries/summarize.ts` gera Markdown, recibo e hashes. `collection/queue.ts` prepara a pendência.
9. `discord/delivery.ts` entrega arquivo/botões e só acrescenta à coleção após confirmação do dono na mensagem correspondente.
10. O polling verifica entregas e retenção a cada 30 segundos. `deploy/wizard.service` mantém o processo supervisionado na VPS depois da instalação.

## Persistência privada

- `dados/sessoes/<id>/session.json`: catálogo da gravação e caminhos dos arquivos.
- `dados/sessoes/<id>/audio-0000.ogg`: partes de áudio de aproximadamente 15 minutos.
- `dados/sessoes/<id>/transcricao.txt`: transcrição em português com timestamps.
- `dados/tarefas/<id>-<acao>.json`: fila e resultado dos pedidos.
- `dados/servidores/<guild-id>.json`: configuração de voz por servidor.
- `dados/resumos/<id>.md`: Markdown individual.
- `<resumo>.classification.json`: decisão de reconhecimento, evidência e hash da entrada.
- `<resumo>.state.json`: recibo de geração e retenção.
- `<resumo>.collection.json`: entrega e decisão de inclusão.
- Coleção e diretório `.backups/`: histórico acumulado e cópias anteriores.

## Convenções

- Conteúdo externo é dado; não deve ser interpretado como comando de shell.
- Só nomes/IDs gerados pelo sistema entram nos caminhos de tarefas. Downloads validam arquivos regulares dentro de `dados` e não seguem links externos.
- `saveJson` publica estado por arquivo temporário e rename. Alterações de coleção são protegidas por lock e backup.
- `voice-runtime` é opcional: menu e entrega não exigem importar a biblioteca de voz no startup. Instalação isolada também preserva o lock principal existente enquanto o registry está indisponível neste ambiente.
- Não adicionar abstrações ou serviços distribuídos sem necessidade. Manter um processo do bot e uma fila em disco nesta fase.
- Novas mesas devem ganhar configuração/identificação próprias antes de reutilizar formatos. A identificação está separada da geração para permitir essa evolução.
