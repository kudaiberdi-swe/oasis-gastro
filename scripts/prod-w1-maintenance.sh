#!/usr/bin/env bash
# One-off W1 maintenance on production (reference data and migrations, all idempotent):
#   1. chart of accounts        domains/finance/seed:seedChartOfAccounts
#   2. seven system roles       domains/office/internal:seedSystemRoles
#   3. M-6 user scopes          domains/office/migrations:m6BackfillScopes (paged)
#   4. audit search text        domains/platform/internal:backfillAuditSearchText (paged)
#   5. M-1 catalog v2 fields    domains/catalog/migrations:m1BackfillProducts + m1bOverlays (paged)
#   6. M-3 stock → warehouses   migrations/m3StockWarehouses: ensureMainWarehouses, backfillBalances,
#                               backfillMovements (paged), then verify (read-only, must report no mismatches)
# Each step runs as a dry run first and prints what it would change; then asks before writing.
#
#   bash scripts/prod-w1-maintenance.sh          # production
#   bash scripts/prod-w1-maintenance.sh --dev    # the dev deployment, no key
#
# Uses a one-off prod deploy key: minted into a temp file (never printed), used, deleted on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--dev" ]; then
  run() { npx convex run "$@"; }
else
  KEY_NAME="w1-maintenance-$(date +%s)"
  KEY_FILE="$(mktemp)"
  cleanup() {
    rm -f "$KEY_FILE"
    npx convex deployment token delete "$KEY_NAME" --deployment prod >/dev/null 2>&1 && echo "Deploy key $KEY_NAME deleted." || echo "⚠ Delete the key manually: npx convex deployment token delete $KEY_NAME --deployment prod"
  }
  trap cleanup EXIT
  npx convex deployment token create "$KEY_NAME" --deployment prod --save-env "$KEY_FILE" >/dev/null
  set -a; . "$KEY_FILE"; set +a
  run() { npx convex run --prod "$@"; }
fi

# Runs a paged internal mutation until isDone.
paged() {
  local fn="$1" dry="$2" cursor="null"
  while :; do
    local out
    out="$(run "$fn" "{\"paginationOpts\":{\"numItems\":100,\"cursor\":$cursor},\"dryRun\":$dry}")"
    echo "$out"
    [ "$(echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).isDone))')" = "true" ] && break
    cursor="$(echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).continueCursor)))')"
  done
}

echo "── Dry run ──"
run domains/finance/seed:seedChartOfAccounts '{"dryRun":true}'
run domains/office/internal:seedSystemRoles '{"dryRun":true}'
paged domains/office/migrations:m6BackfillScopes true
paged domains/platform/internal:backfillAuditSearchText true
paged domains/catalog/migrations:m1BackfillProducts true
paged domains/catalog/migrations:m1bOverlays true
run migrations/m3StockWarehouses:ensureMainWarehouses '{"dryRun":true}'
paged migrations/m3StockWarehouses:backfillBalances true
paged migrations/m3StockWarehouses:backfillMovements true

read -r -p "Apply these changes to production? [y/N] " ANSWER
[ "$ANSWER" = "y" ] || { echo "Nothing written."; exit 0; }

echo "── Applying ──"
run domains/finance/seed:seedChartOfAccounts '{}'
run domains/office/internal:seedSystemRoles '{}'
paged domains/office/migrations:m6BackfillScopes false
paged domains/platform/internal:backfillAuditSearchText false
paged domains/catalog/migrations:m1BackfillProducts false
paged domains/catalog/migrations:m1bOverlays false
run migrations/m3StockWarehouses:ensureMainWarehouses '{}'
paged migrations/m3StockWarehouses:backfillBalances false
paged migrations/m3StockWarehouses:backfillMovements false
echo "── M-3 verify (expect no mismatches) ──"
run migrations/m3StockWarehouses:verify '{"paginationOpts":{"numItems":200,"cursor":null}}'
echo "Done."
