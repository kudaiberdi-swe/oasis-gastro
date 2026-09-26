#!/usr/bin/env bash
# Loads the Sandyq data of iiko into PRODUCTION (decisions Б-B4 and D7 of 2026-09-26):
#   stores, POS cash registers, units, suppliers, product groups, products, assembly charts, opening
#   balances, branch prices, and the cash shifts and orders (no personal data) since --from.
# iiko is only read (GET); every import step is idempotent — a re-run only touches changed records.
#
# Before the first run: in the prod office, «Корпорация → Обмен данными с iiko → Сопоставление филиалов», link every Sandyq
# restaurant to its iiko department. Without a link its stores, cash registers, prices and sales are skipped.
#
#   bash scripts/prod-iiko-import.sh                      # sales of the last 7 days, asks before importing
#   bash scripts/prod-iiko-import.sh --from 2026-09-01    # sales since a date
#   bash scripts/prod-iiko-import.sh --yes                # no question (for `! bash …` in Claude Code)
#
# Uses a one-off prod deploy key: minted into a temp file (never printed), used, deleted on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

APPLY_WITHOUT_ASKING=false
FROM="$(node -e 'console.log(new Date(Date.now()+5*3600e3-7*864e5).toISOString().slice(0,10))')"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) APPLY_WITHOUT_ASKING=true ;;
    --from) FROM="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

RUN_ID="prod-$(date +%Y%m%d-%H%M%S)"
echo "── 1/3 Extract from iiko (GET only) → .iiko-cache/$RUN_ID ──"
node --env-file=.env scripts/iiko/extract.mjs --with-stock-master --with-products --with-balances --with-prices --with-sales --from "$FROM" --run-id "$RUN_ID"

KEY_NAME="iiko-import-$(date +%s)"
KEY_FILE="$(mktemp)"
cleanup() {
  rm -f "$KEY_FILE"
  npx convex deployment token delete "$KEY_NAME" --deployment prod >/dev/null 2>&1 && echo "Deploy key $KEY_NAME deleted." || echo "⚠ Delete the key manually: npx convex deployment token delete $KEY_NAME --deployment prod"
}
trap cleanup EXIT
npx convex deployment token create "$KEY_NAME" --deployment prod --save-env "$KEY_FILE" >/dev/null
set -a; . "$KEY_FILE"; set +a

echo "── 2/3 Restaurant links on prod ──"
LINKS="$(npx convex run --prod domains/iiko/internal:linkedDepartments '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')"
echo "Linked iiko departments: $LINKS"
[ "$LINKS" = "0" ] && echo "⚠ No restaurant is linked yet: stores, cash registers, prices and sales will be skipped (products and recipes still load)."

if [ "$APPLY_WITHOUT_ASKING" = false ]; then
  read -r -p "Import into PRODUCTION now? [y/N] " ANSWER || ANSWER=""
  [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ] || { echo "Nothing imported."; exit 0; }
fi

echo "── 3/3 Import into prod ──"
node scripts/iiko/import-convex.mjs --input ".iiko-cache/$RUN_ID" --prod
echo "Done. Check «Обмен данными» in the prod office for skipped records."
