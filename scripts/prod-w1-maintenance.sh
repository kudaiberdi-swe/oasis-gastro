#!/usr/bin/env bash
# One-off W1 maintenance on production (reference data and migrations, all idempotent):
#   1. chart of accounts        domains/finance/seed:seedChartOfAccounts
#   2. seven system roles       domains/office/internal:seedSystemRoles
#   3. M-6 user scopes          domains/office/migrations:m6BackfillScopes (paged)
#   4. audit search text        domains/platform/internal:backfillAuditSearchText (paged)
#   5. M-1 catalog v2 fields    domains/catalog/migrations:m1BackfillProducts + m1bOverlays (paged)
#   6. M-3 stock → warehouses   migrations/m3StockWarehouses: ensureMainWarehouses, backfillBalances,
#                               backfillMovements (paged), then verify (read-only, must report no mismatches)
#   7. retail defaults          domains/retail/internal:seedDefaults (payment/order types, reasons, cash ops)
#   8. M-2 orders               migrations/m2Orders: backfillOrders, backfillLines, backfillPayments (paged;
#                               needs step 7 — the dry run reports missingSettings until it is applied)
#   9. M-7 kitchen tickets      migrations/m7KitchenTickets:backfill (paged; reports unresolved tickets)
#  10. cashflow categories      domains/finance/seed:seedCashflowCategories
#  11. M-4 ledger → journal     migrations/m4LedgerToJournal:migrateLedgerToJournal (paged; needs step 1;
#                               the dry run prints the sums per account to check against the legacy P&L)
#  12. M-5 loyalty              migrations/m5Loyalty: ensureBaseProgram, migrateGuests (paged; reports mismatches)
#  13. M-8 sales facts          domains/reports/internal:backfillDailySalesFacts (paged; after M-2 business dates)
#  14. KZ payroll rules 2026    domains/workforce/payroll:seedRules2026 (draft; the accountant activates it)
#  15. Delivery sources          domains/delivery/internal:seedSources («Телефон», «Сайт sandyq.kz», 0 %)
#  16. M-9 daily stock facts    migrations/m9DailyStockFacts:backfill (paged; after M-3)
#  17. M-8b sales facts rebuild  domains/reports/internal:rebuildDailySalesFactsRange 2026-01-01…yesterday
#                               (after M-8; one day per scheduled run, adds the W2 station/channel facts)
# Each step runs as a dry run first and prints what it would change; then asks before writing.
#
#   bash scripts/prod-w1-maintenance.sh          # production
#   bash scripts/prod-w1-maintenance.sh --dev    # the dev deployment, no key
#   bash scripts/prod-w1-maintenance.sh --yes    # production, apply after the dry run without asking
#                                                # (for `! bash …` in Claude Code, where there is no prompt input)
#
# Uses a one-off prod deploy key: minted into a temp file (never printed), used, deleted on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

APPLY_WITHOUT_ASKING=false
[ "${1:-}" = "--yes" ] && APPLY_WITHOUT_ASKING=true && shift

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

YESTERDAY="$(node -e 'console.log(new Date(Date.now()+5*3600e3-864e5).toISOString().slice(0,10))')"
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
paged migrations/m9DailyStockFacts:backfill true
run domains/reports/internal:rebuildDailySalesFactsRange "{\"dateFrom\":\"2026-01-01\",\"dateTo\":\"$YESTERDAY\",\"dryRun\":true}"
run domains/retail/internal:seedDefaults '{"dryRun":true}'
paged migrations/m2Orders:backfillOrders true
paged migrations/m2Orders:backfillLines true
paged migrations/m2Orders:backfillPayments true
paged migrations/m7KitchenTickets:backfill true
run domains/finance/seed:seedCashflowCategories '{"dryRun":true}'
paged migrations/m4LedgerToJournal:migrateLedgerToJournal true
run migrations/m5Loyalty:ensureBaseProgram '{"dryRun":true}'
paged migrations/m5Loyalty:migrateGuests true
paged domains/reports/internal:backfillDailySalesFacts true

if $APPLY_WITHOUT_ASKING; then
  ANSWER=y
  echo "--yes: applying the changes shown above."
else
  read -r -p "Apply these changes to production? [y/N] " ANSWER || ANSWER=""
fi
[ "$ANSWER" = "y" ] || { echo "Nothing written (no «y»; run with --yes when there is no prompt input)."; exit 0; }

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
paged migrations/m9DailyStockFacts:backfill false
run domains/retail/internal:seedDefaults '{}'
paged migrations/m2Orders:backfillOrders false
paged migrations/m2Orders:backfillLines false
paged migrations/m2Orders:backfillPayments false
paged migrations/m7KitchenTickets:backfill false
run domains/finance/seed:seedCashflowCategories '{}'
paged migrations/m4LedgerToJournal:migrateLedgerToJournal false
run migrations/m5Loyalty:ensureBaseProgram '{}'
paged migrations/m5Loyalty:migrateGuests false
paged domains/reports/internal:backfillDailySalesFacts false
run domains/workforce/payroll:seedRules2026 '{}'
run domains/delivery/internal:seedSources '{}'
run domains/reports/internal:rebuildDailySalesFactsRange "{\"dateFrom\":\"2026-01-01\",\"dateTo\":\"$YESTERDAY\"}"
echo "── M-3 verify (expect no mismatches) ──"
run migrations/m3StockWarehouses:verify '{"paginationOpts":{"numItems":200,"cursor":null}}'
echo "Done."
