#!/usr/bin/env bash
# Manual prod deploy of the frontend — the same steps as .github/workflows/deploy-frontend.yml, for when
# GitHub Actions cannot run (billing, outage). Backend is NOT touched: it goes through deploy-backend.yml.
#
#   bash scripts/deploy-frontend-prod.sh            # full gate (scripts/verify.sh) + build + deploy
#   bash scripts/deploy-frontend-prod.sh --skip-verify   # only when verify just passed on this exact commit
#
# Needs: `az login` with access to resource group sandyq-prod, Node 24, and a machine that can run the
# Azure SWA deploy client — Linux x64, Intel Mac, or Apple Silicon WITH Rosetta (the client is x86_64 only).
# The deployment token is fetched into a 0600 temp file, passed to the SWA CLI through the environment,
# never printed, and deleted on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=sandyq-frontend
RG=sandyq-prod
CONVEX_URL=https://clear-flamingo-97.convex.cloud
SKIP_VERIFY="${1:-}"

fail() { echo "✖ $*" >&2; exit 1; }

# 1. The deploy client must be runnable here.
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  fail "Apple Silicon without Rosetta: the Azure SWA deploy client is x86_64 only. Run this on Linux x64 / Intel Mac, or install Rosetta: softwareupdate --install-rosetta --agree-to-license"
fi
command -v az >/dev/null || fail "Azure CLI (az) not found"
az account show >/dev/null 2>&1 || fail "Not logged in to Azure: run az login"

# 2. Deploy exactly what is on origin/main — nothing local, nothing unpushed.
git fetch -q origin main
[ -z "$(git status --porcelain)" ] || fail "Working tree is not clean — commit or stash first"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "HEAD is not origin/main — checkout main and pull"
COMMIT="$(git rev-parse --short HEAD)"

# 3. Gate + build (same env as CI).
if [ "$SKIP_VERIFY" != "--skip-verify" ]; then bash scripts/verify.sh; fi
rm -rf dist
VITE_CONVEX_URL="$CONVEX_URL" npm run build
cp staticwebapp.config.json dist/staticwebapp.config.json
grep -rqs "clear-flamingo-97" dist/assets || fail "Build does not point at the prod Convex deployment"
if grep -rqs "dapper-lobster-404" dist; then fail "Build still references the dev Convex deployment"; fi
BUILT_INDEX="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)"

# 4. Deploy with a token that never reaches the terminal.
TOKEN_FILE="$(mktemp)"; chmod 600 "$TOKEN_FILE"
trap 'rm -f "$TOKEN_FILE"' EXIT
az staticwebapp secrets list --name "$APP" --resource-group "$RG" --query properties.apiKey -o tsv > "$TOKEN_FILE"
[ -s "$TOKEN_FILE" ] || fail "Could not fetch the SWA deployment token"
LOG_FILE="$(mktemp)"
trap 'rm -f "$TOKEN_FILE" "$LOG_FILE"' EXIT
set +e
SWA_CLI_DEPLOYMENT_TOKEN="$(cat "$TOKEN_FILE")" npx -y @azure/static-web-apps-cli@2 deploy ./dist --env production --no-use-keychain >"$LOG_FILE" 2>&1
SWA_STATUS=$?
set -e
rm -f "$TOKEN_FILE"
grep -vi token "$LOG_FILE" | tail -15 || true
[ "$SWA_STATUS" -eq 0 ] || fail "SWA CLI exited with $SWA_STATUS"

# 5. Prove the new build is live (the SWA CLI can exit 0 without deploying).
HOST="$(az staticwebapp show --name "$APP" --resource-group "$RG" --query defaultHostname -o tsv)"
for _ in 1 2 3 4 5 6; do
  LIVE_INDEX="$(curl -s "https://$HOST/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
  [ "$LIVE_INDEX" = "$BUILT_INDEX" ] && { echo "✔ Deployed $COMMIT to https://$HOST ($BUILT_INDEX)"; exit 0; }
  sleep 10
done
fail "Prod still serves ${LIVE_INDEX:-nothing} instead of $BUILT_INDEX — the deploy did not land"
