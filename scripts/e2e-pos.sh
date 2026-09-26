#!/usr/bin/env bash
# Full cashier smoke on the dev deployment: seeds dev (idempotent, dev only), writes the e2e cashier
# login to .sandyq-seed/e2e.env without printing it, then runs every e2e suite with that login loaded.
#   bash scripts/e2e-pos.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npm run seed:e2e
set -a
. .sandyq-seed/e2e.env
set +a
npx playwright test --reporter=line "$@"
