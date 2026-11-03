#!/usr/bin/env bash
set -euo pipefail
umask 077
if [ "$(id -u)" -ne 0 ]; then echo 'Execute como root na VPS.'; exit 1; fi
if [ "$(pwd -P)" != /opt/wizard ]; then echo 'Execute dentro de /opt/wizard.'; exit 1; fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then echo 'Instale Node.js >= 24.19 e npm antes de continuar, preservando os outros serviços.'; exit 1; fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<24||(a===24&&b<19))process.exit(1)' || { echo 'Requer Node.js >= 24.19.'; exit 1; }
if ! command -v systemctl >/dev/null || ! command -v apt-get >/dev/null; then echo 'Instalador preparado para Ubuntu/Debian com systemd.'; exit 1; fi
if [ -e /etc/systemd/system/wizard.service ]; then echo 'Serviço WIZArd já existe. Use o procedimento de atualização de VPS.md.'; exit 1; fi
if [ ! -f .env ]; then echo 'Transfira o .env privado e revise os caminhos Linux antes de instalar.'; exit 1; fi
if ! id wizard >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/wizard --shell /bin/bash wizard; fi
apt-get update
apt-get install -y ffmpeg python3 python3-venv
npm ci --ignore-scripts
npm run setup:voice
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
install -d -o wizard -g wizard -m 700 /var/lib/wizard/dados
if [ -L dados ]; then
  if [ "$(readlink -f dados)" != /var/lib/wizard/dados ]; then echo 'Link dados inesperado; revise manualmente.'; exit 1; fi
elif [ -d dados ]; then
  if [ -n "$(find /var/lib/wizard/dados -mindepth 1 -maxdepth 1 -print -quit)" ]; then echo 'Destino de dados já contém arquivos. Revise antes de migrar.'; exit 1; fi
  cp -a dados/. /var/lib/wizard/dados/
  mv dados "dados.migracao-$(date +%Y%m%d-%H%M%S)"
  ln -s /var/lib/wizard/dados dados
else
  ln -s /var/lib/wizard/dados dados
fi
chown -R wizard:wizard /var/lib/wizard
chmod -R go-rwx /var/lib/wizard
chown root:wizard .env
chmod 640 .env
chown root:wizard /opt/wizard
chmod 750 /opt/wizard
chgrp -R wizard src scripts deploy voice-runtime node_modules .venv
chmod -R g+rX src scripts deploy voice-runtime node_modules .venv
if [ -f 'Arquivo Formato Resumo de Sessão.md' ]; then
  chgrp wizard 'Arquivo Formato Resumo de Sessão.md'
  chmod g+r 'Arquivo Formato Resumo de Sessão.md'
fi
install -o root -g root -m 644 deploy/wizard.service /etc/systemd/system/wizard.service
systemctl daemon-reload
echo 'Instalação preparada. Serviço ainda não iniciado. Migre caminhos, valide configuração e login; depois systemctl enable --now wizard.'
