#!/usr/bin/env bash
# Roda na VPS, chamado pelo "npm run deploy" do PC. Uso: apply-release.sh <pasta-recebida> [--ligar]
# Prepara e testa a versão nova à parte; só troca a produção se tudo passar.
# .env, dados/ e .venv ficam intactos. A versão anterior vai para /opt/wizard-versoes.
set -euo pipefail
umask 027
APP=/opt/wizard; BK=/opt/wizard-versoes
log() { echo "[deploy] $*"; }
[ "$(id -u)" -eq 0 ] || { log 'Execute como root.'; exit 1; }
S=$(readlink -f "${1:?pasta recebida}"); LIGAR=${2:-}
exec 9>/run/wizard-deploy.lock
flock -n 9 || { log 'Outro deploy está em andamento. Tente de novo quando ele terminar.'; rm -rf "$S"; exit 1; }
[ -f "$APP/.env" ] || { log "Produção não encontrada em $APP (rode deploy/install.sh antes)."; exit 1; }
[ -f "$S/RELEASE" ] && [ -f "$S/deploy/release-files.txt" ] || { log 'Pacote incompleto.'; exit 1; }
cd "$S"

log 'Instalando dependências da versão nova...'
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
npm install --prefix voice-runtime --ignore-scripts --no-audit --no-fund --loglevel=error
if ! cmp -s scripts/requirements.txt "$APP/scripts/requirements.txt"; then
  log 'Atualizando dependências Python...'
  "$APP/.venv/bin/python" -m pip install -q -r scripts/requirements.txt
fi

log 'Testando na VPS...'
if ! node --test 'tests/*.test.ts' > "$S/.testes.log" 2>&1; then
  tail -40 "$S/.testes.log"; log 'Testes falharam na VPS. Produção NÃO foi alterada.'; rm -rf "$S"; exit 1
fi
grep -E '^ℹ (tests|pass|fail) ' "$S/.testes.log" | tr '\n' ' '; echo

mapfile -t ITEMS < <({ sed 's#/.*##' deploy/release-files.txt | sed '/^\s*$/d'; echo node_modules; echo RELEASE; } | sort -u)
WAS=$(systemctl is-active wizard 2>/dev/null || true)
OLD="$BK/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OLD"; chmod 700 "$BK"

restore() {
  log 'Voltando para a versão anterior...'
  for i in "${ITEMS[@]}"; do
    if [ -e "$OLD/$i" ]; then rm -rf "${APP:?}/$i"; mv "$OLD/$i" "$APP/"; fi
  done
  rmdir "$OLD" 2>/dev/null || true
}

if [ "$WAS" = active ]; then log 'Parando o bot para trocar a versão...'; systemctl stop wizard; fi
trap 'restore; if [ "$WAS" = active ]; then systemctl start wizard; fi; exit 1' ERR
for i in "${ITEMS[@]}"; do
  if [ -e "$APP/$i" ]; then mv "$APP/$i" "$OLD/"; fi
  if [ -e "$S/$i" ]; then mv "$S/$i" "$APP/"; fi
done
chown root:wizard "$APP"; chmod 750 "$APP"
for i in "${ITEMS[@]}"; do
  if [ -e "$APP/$i" ]; then chown -R root:wizard "$APP/$i"; chmod -R g+rX,g-w,o-rwx "$APP/$i"; fi
done
if ! cmp -s "$APP/deploy/wizard.service" /etc/systemd/system/wizard.service; then
  install -o root -g root -m 644 "$APP/deploy/wizard.service" /etc/systemd/system/wizard.service
  systemctl daemon-reload
fi
install -o root -g root -m 755 "$APP/deploy/wizard-cli.sh" /usr/local/bin/wizard
trap - ERR

if [ "$WAS" = active ] || [ "$LIGAR" = --ligar ]; then
  if [ "$LIGAR" = --ligar ]; then systemctl enable wizard >/dev/null 2>&1; fi
  systemctl start wizard
  sleep 12
  if [ "$(systemctl is-active wizard)" != active ] || [ "$(systemctl show -p NRestarts --value wizard)" != 0 ]; then
    journalctl -u wizard -n 30 --no-pager -o cat || true
    systemctl stop wizard || true
    restore
    if [ "$WAS" = active ]; then systemctl start wizard; fi
    log 'A versão nova não ficou de pé. Produção voltou para a anterior.'; rm -rf "$S"; exit 1
  fi
  log 'Bot ligado com a versão nova.'
else
  log 'Bot continua desligado (use "wizard on" na VPS ou "npm run deploy -- --ligar").'
fi

ls -1dt "$BK"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
rm -rf "$S"
log "Pronto: $(grep '^versao=' "$APP/RELEASE" | cut -d= -f2) em produção."
