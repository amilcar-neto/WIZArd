#!/usr/bin/env bash
# Comando "wizard" na VPS (instalado em /usr/local/bin/wizard pelo deploy).
# O código é atualizado a partir do PC com "npm run deploy"; aqui só se opera o bot.
set -uo pipefail
APP=/opt/wizard; BK=/opt/wizard-versoes

ajuda() {
  cat <<'EOF'
🧙 wizard — controle do bot na VPS

  wizard on        | ligar      liga o bot (e ele volta sozinho após reboot)
  wizard off       | desligar   desliga o bot (não volta no reboot)
  wizard restart   | reiniciar  reinicia o bot
  wizard status               estado, versão, login da IA e disco
  wizard logs [N]             últimas N linhas do log (padrão 50)
  wizard logs -f              acompanha o log ao vivo (Ctrl+C sai)
  wizard login [codex|claude] login da IA dos resumos (sem nome: os dois)
                              Codex é o principal; Claude entra se o Codex falhar
  wizard vocabulario         quais termos de config/vocabulario.txt o Whisper usa
  wizard versao    | version  versão em produção
  wizard versoes   | versions versões anteriores guardadas
  wizard voltar    | rollback volta para a versão anterior
  wizard help      | ajuda    mostra esta ajuda

Atualizar o código: no PC, "npm run deploy".
EOF
}
root() { [ "$(id -u)" -eq 0 ] || { echo 'Use como root (ou: sudo wizard ...).'; exit 1; }; }
versao() { [ -f "$APP/RELEASE" ] && sed -n 's/^versao=//p' "$APP/RELEASE" || echo 'instalação inicial (sem deploy)'; }
logado_codex() { local s; s=$(cd /tmp && sudo -u wizard -H codex login status 2>&1) || return 1; ! grep -qi 'not logged' <<<"$s"; }
logado_claude() { (cd /tmp && sudo -u wizard -H claude auth status 2>/dev/null) | grep -q '"loggedIn": *true'; }
logado() { logado_codex || logado_claude; }

cmd=${1:-help}; shift || true
case "$cmd" in
  on|ligar)
    root
    logado || echo '⚠️  Nenhuma IA com login: gravação funciona, mas resumo/reconhecimento não. Rode "wizard login".'
    systemctl enable --now wizard; sleep 3
    echo "Bot: $(systemctl is-active wizard)  •  versão $(versao)";;
  off|desligar)
    root; systemctl disable --now wizard; echo "Bot: $(systemctl is-active wizard || true)";;
  restart|reiniciar)
    root; systemctl restart wizard; sleep 3; echo "Bot: $(systemctl is-active wizard)";;
  status)
    echo "Bot:        $(systemctl is-active wizard || true) ($(systemctl is-enabled wizard 2>/dev/null || true) no boot)"
    since=$(systemctl show -p ActiveEnterTimestamp --value wizard); [ -n "$since" ] && [ "$since" != n/a ] && echo "Desde:      $since"
    mem=$(systemctl show -p MemoryCurrent --value wizard); [[ "$mem" =~ ^[0-9]+$ ]] && echo "Memória:    $((mem / 1048576)) MB"
    echo "Versão:     $(versao)"
    if logado_codex; then echo 'Codex:      logado (principal)'; else echo 'Codex:      SEM login (wizard login codex)'; fi
    if logado_claude; then echo 'Claude:     logado (reserva)'; else echo 'Claude:     SEM login (wizard login claude)'; fi
    echo "Dados:      $(du -sh /var/lib/wizard/dados 2>/dev/null | cut -f1)  •  livre: $(df -h --output=avail /var/lib/wizard | tail -1 | tr -d ' ')";;
  logs)
    if [ "${1:-}" = -f ]; then journalctl -u wizard -f -o short-iso; else journalctl -u wizard -n "${1:-50}" --no-pager -o short-iso; fi;;
  login)
    root
    if [ "${1:-codex}" = codex ]; then echo '== Codex: abra o link e digite o código =='; (cd /tmp && sudo -u wizard -H codex login --device-auth); fi
    if [ -z "${1:-}" ] || [ "$1" = claude ]; then echo '== Claude: abra o link, entre e cole o código aqui =='; (cd /tmp && sudo -u wizard -H claude auth login); fi;;
  vocabulario)
    # Mesma lista que a transcrição usa: config/vocabulario.txt primeiro, depois nomes da coleção (mais recentes antes).
    lista=$(cd "$APP" && sudo -u wizard -H node --env-file="$APP/.env" --input-type=module -e '
import { campaignContext } from "/opt/wizard/src/sessions/campaign-glossary.ts";
import { resolve } from "node:path";
const c = await campaignContext(resolve(process.env.WIZARD_HISTORY_PATH ?? "dados/Transcricoes_Completas_Sessoes.md"), "/opt/wizard/config/vocabulario.txt");
console.log(JSON.stringify({ manual: c.manual.length, terms: c.whisper }));') || exit 1
    (cd /tmp && WIZ_LISTA="$lista" sudo --preserve-env=WIZ_LISTA -u wizard -H /opt/wizard/.venv/bin/python -c '
import glob, json, os, sys, tokenizers
sys.path.insert(0, "/opt/wizard/scripts")
import transcribe
found = glob.glob("/var/lib/wizard/.cache/huggingface/hub/models--Systran--faster-whisper-*/snapshots/*/tokenizer.json")
if not found:
    sys.exit("O modelo do Whisper ainda não foi baixado. Faça uma transcrição primeiro.")
tok = tokenizers.Tokenizer.from_file(found[0])
data = json.loads(os.environ["WIZ_LISTA"])
terms, manual = data["terms"], data["manual"]
chosen = transcribe.fit(terms, lambda s: len(tok.encode(s).ids))
print(f"Entram {len(chosen)} termos: {min(len(chosen), manual)} de {manual} do config/vocabulario.txt e {max(0, len(chosen) - manual)} nomes da coleção.")
print("Entram: " + ", ".join(chosen))
left = terms[len(chosen):manual]
if left:
    print("Do seu arquivo, ficam de fora: " + ", ".join(left))
');;
  versao|version) echo "$(versao)"; [ -f "$APP/RELEASE" ] && sed -n 's/^enviada_de=/enviada de: /p' "$APP/RELEASE";;
  versoes|versions)
    echo "Em produção: $(versao)"
    for d in $(ls -1dt "$BK"/*/ 2>/dev/null); do echo "  guardada: $(sed -n 's/^versao=//p' "$d/RELEASE" 2>/dev/null || echo 'instalação inicial')  ($d)"; done;;
  voltar|rollback)
    root
    prev=$(ls -1dt "$BK"/*/ 2>/dev/null | head -1); [ -n "$prev" ] || { echo 'Nenhuma versão anterior guardada.'; exit 1; }
    alvo=$(sed -n 's/^versao=//p' "$prev/RELEASE" 2>/dev/null || echo 'instalação inicial')
    if [ "${1:-}" != --sim ]; then read -r -p "Voltar de $(versao) para $alvo? [s/N] " r; [ "$r" = s ] || [ "$r" = S ] || exit 0; fi
    was=$(systemctl is-active wizard || true); [ "$was" = active ] && systemctl stop wizard
    atual="$BK/$(date +%Y%m%d-%H%M%S)-desfeita"; mkdir -p "$atual"
    for p in "$prev"*; do i=$(basename "$p"); [ -e "$APP/$i" ] && mv "$APP/$i" "$atual/"; mv "$p" "$APP/"; done
    [ -e "$atual/RELEASE" ] || touch "$atual/RELEASE"
    rmdir "$prev"
    [ "$was" = active ] && systemctl start wizard
    echo "Produção agora: $(versao). A versão desfeita ficou em $atual.";;
  help|ajuda|-h|--help) ajuda;;
  *) echo "Comando desconhecido: $cmd"; echo; ajuda; exit 1;;
esac
