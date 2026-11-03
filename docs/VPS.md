# WIZArd na VPS

Preparado para Ubuntu/Debian com systemd. O endereço da VPS fica só no `.env` local (`WIZARD_DEPLOY_HOST`). A conexão não pôde ser testada a partir do ambiente do Codex: a rede bloqueou a porta 22 antes de autenticar. Nenhum serviço foi instalado ou alterado remotamente.

## 1. Inspecionar antes de instalar

No seu terminal habitual:

```powershell
ssh root@IP-DA-VPS
```

Na VPS:

```bash
cat /etc/os-release
node --version
npm --version
free -h
df -h /
systemctl --type=service --state=running
```

Requer Node.js >= 24.19 acessível em `/usr/local/bin` ou `/usr/bin`. Não substitua a versão global usada por outros projetos sem verificar compatibilidade. O instalador se recusa a prosseguir se a versão não atender. Não é necessário abrir porta HTTP; Discord usa Gateway de saída. Voz também precisa de conectividade UDP de saída e respostas.

## 2. Transferir o projeto

Use SFTP/SCP pelo seu SSH habitual. Transfira código para `/opt/wizard`, incluindo `src/`, `scripts/`, `deploy/`, `voice-runtime/package.json`, `package.json`, `package-lock.json` e documentação. Não transfira `node_modules` do Windows; as dependências serão instaladas para Linux.

Transfira separadamente o `.env`, o arquivo real de formato e os `dados/` privados. Não envie credenciais ao chat. Se usar arquivo compactado, mantenha-o privado e retire a cópia temporária depois de verificar a extração. Não sobrescreva uma instalação existente sem backup.

Revise o `.env` na VPS. Caminhos Linux esperados:

```dotenv
FORMATADOR_PATH="Arquivo Formato Resumo de Sessão.md"
WIZARD_HISTORY_PATH=dados/Transcricoes_Completas_Sessoes.md
WIZARD_SUMMARY_DIR=dados/resumos
WIZARD_PYTHON=/opt/wizard/.venv/bin/python
```

Mantenha os valores reais de `DISCORD_BOT_TOKEN` e `DISCORD_OWNER_ID` apenas no arquivo privado. Evite imprimir `.env` nos logs.

## 3. Preparar serviço e dependências

Na VPS, como root:

```bash
cd /opt/wizard
bash deploy/install.sh
```

O instalador prepara usuário `wizard`, dependências, ambiente Python isolado, armazenamento em `/var/lib/wizard/dados`, link `dados` e unit systemd. Não inicia o bot automaticamente: ainda é necessário migrar caminhos e configurar o login do resumidor. Se existir `wizard.service`, o script interrompe para evitar sobrescrever uma instalação anterior.

A instalação da voz é separada para manter intacto o lock principal enquanto o desenvolvimento local não tem acesso ao registry:

```bash
npm ci --ignore-scripts
npm run setup:voice
```

`voice-runtime/package-lock.json` é gerado pela instalação real. Preserve-o após validar a instalação. Não existe lock de voz validado neste momento. A recepção depende de @discordjs/voice com DAVE e precisa de teste real no Discord.

## 4. Migrar os caminhos dos recibos Windows

Os recibos antigos guardam caminhos absolutos do Windows. O script abaixo troca somente campos de caminho em JSON, conservando o texto e hashes das transcrições/resumos. Cada arquivo alterado recebe backup `.antes-migracao`. Também preserva o ID dos botões de coleção já enviados.

Primeiro simule, depois aplique com o bot parado:

```bash
python3 scripts/migrate_paths.py --data /var/lib/wizard/dados --from-root 'C:\caminho\do\WIZArd' --to-root /opt/wizard
python3 scripts/migrate_paths.py --data /var/lib/wizard/dados --from-root 'C:\caminho\do\WIZArd' --to-root /opt/wizard --apply
chown -R wizard:wizard /var/lib/wizard/dados
```

Arquivos antigos que estavam fora desse diretório precisam de migração manual explícita. Não apague `.lock` sem verificar que o processo anterior terminou. O script não remove bloqueios.

## 5. Login para reconhecer a mesa e resumir

Gravação/download não exigem login de IA. Reconhecimento da mesa e resumo usam o mesmo mecanismo de assinatura Codex/Claude existente. O login do Windows não fica automaticamente disponível na VPS. Instale o CLI escolhido em caminho acessível ao serviço e autentique como usuário `wizard`, com home `/var/lib/wizard`, pelo fluxo oficial do provedor. Não execute essa etapa como root presumindo que o serviço lerá o login de root. Não há chave de API paga configurada automaticamente.

O systemd protege o diretório pessoal de root e o restante do sistema. Dependências de modelo/cache e login do serviço ficam em `/var/lib/wizard`. O primeiro pedido de transcrição baixa o modelo Whisper; precisa de rede e espaço. Valide uma gravação curta antes de usar uma sessão longa.

## 6. Discord e ativação

Reconvide/atualize a instalação com os escopos `bot` e `applications.commands`. Permissões: Ver canais, Enviar mensagens, Anexar arquivos, Ler histórico de mensagens e Conectar. O bot não precisa de Administrator, nem de intents privilegiadas para este fluxo. Comandos globais são registrados no startup; podem levar algum tempo para aparecer.

Só o proprietário configura:

```text
/wizard configurar canal:<seu canal> minimo:3 automatico:true
```

Membros podem usar `/wizard entrar` no próprio canal. `/wizard parar` funciona para quem está no canal gravado e para o dono. `/wizard status` consulta o estado. A entrada automática conta humanos, ignora bots e encerra ao esvaziar. Parar manualmente pausa a entrada automática até o canal esvaziar ou o proprietário configurar novamente.

Desligue a instância local do mesmo bot antes de ativar a VPS, para não duplicar filas/menus/gravações:

```bash
systemctl enable --now wizard
systemctl status wizard --no-pager
journalctl -u wizard -n 50 --no-pager
```

Depois dessa configuração, systemd inicia no boot e reinicia o processo se ele cair. O limite de falhas de startup impede reinícios ilimitados com configuração inválida; corrija a causa e use `systemctl reset-failed wizard` e `systemctl restart wizard`.

## 7. Teste de aceitação

1. Envie qualquer DM ao bot como proprietário: deve aparecer o menu.
2. Outro usuário envia DM: resposta sem botões nem arquivos.
3. Membro chama no próprio canal: aviso de gravação é publicado, áudio é salvo; outro canal não consegue encerrar.
4. Grave uma conversa de teste curta, encerre e baixe as partes de áudio pelo menu.
5. Peça transcrição, espere a notificação, baixe o TXT.
6. Peça resumo do teste: a verificação deve bloquear o formato Serpente e não criar pendência na coleção.
7. Teste com um trecho real e autorizado da campanha: verificar reconhecimento, resumo, aprovação e backup sem duplicatas.
8. Reinicie o serviço e confira catálogo, configurações e pedidos interrompidos. Não repete gerações interrompidas automaticamente; o dono precisa pedir de novo.

## Atualizações pelo PC (fluxo normal)

No PC: `npm.cmd run deploy` (ou `npm.cmd run deploy -- --ligar`). Na VPS: `wizard help`. Versões anteriores ficam em `/opt/wizard-versoes` (as 5 mais recentes); `wizard voltar` restaura a última. O procedimento manual abaixo é só para emergência.

## Atualizações e manutenção (manual)

Pare `wizard` antes de atualizar código; mantenha backup do `.env`, formato e `/var/lib/wizard/dados`. Não substitua dados por uma cópia antiga do PC. Instale dependências, execute os testes, valide configurações e só então reinicie.

```bash
systemctl stop wizard
# transferir somente o código atualizado e instalar dependências necessárias
npm ci --ignore-scripts
npm run setup:voice
npm run check
systemctl start wizard
```

Logs do aplicativo registram eventos/códigos sem texto de campanha. Resumos e coleção ficam preservados. TXT segue a retenção existente de 7 dias após entrega do resumo; conversas sem resumo não têm exclusão automática de TXT nesta versão. Áudio expira 14 dias após transcrição pronta, com validação do hash e existência de transcrição ou resumo. Áudio não transcrito é preservado. Avaliar disco com `df -h` e revisar esses prazos após teste de uso real.

Referências: [systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [voz Discord.js](https://discord.js.org/docs/packages/voice/main), [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
