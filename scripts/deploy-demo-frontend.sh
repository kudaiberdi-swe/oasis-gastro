#!/usr/bin/env bash
# Demo frontend for clients: the same app built with VITE_DEMO_MODE=true against the DEV Convex deployment
# (dapper-lobster-404), deployed to the Azure Static Web App sandyq-demo (resource group sandyq-dev).
# Never prod: the build is refused if it mentions the prod deployment. CI does the same in
# .github/workflows/deploy-demo-frontend.yml.
#
#   bash scripts/deploy-demo-frontend.sh
#
# Needs: `az login` with access to sandyq-dev, Node 24, and a machine that can run the Azure SWA deploy
# client — Linux x64, Intel Mac, or Apple Silicon WITH Rosetta (the client is x86_64 only).
# The deployment token is fetched into a 0600 temp file, passed to the SWA CLI through the environment,
# never printed, and deleted on exit. Demo sign-ins: npm run demo:logins (dev only).
set -euo pipefail
cd "$(dirname "$0")/.."

APP=sandyq-demo
RG=sandyq-dev
CONVEX_URL=https://dapper-lobster-404.convex.cloud

fail() { echo "✖ $*" >&2; exit 1; }

# 1. The deploy client must be runnable here.
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  fail "Apple Silicon without Rosetta: the Azure SWA deploy client is x86_64 only. Run this on Linux x64 / Intel Mac, or install Rosetta: softwareupdate --install-rosetta --agree-to-license"
fi
command -v az >/dev/null || fail "Azure CLI (az) not found"
az account show >/dev/null 2>&1 || fail "Not logged in to Azure: run az login"

COMMIT="$(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain)" ] || echo "⚠ Working tree has local changes — deploying them on top of $COMMIT"
echo "Building demo of $COMMIT against $CONVEX_URL"

# 2. Build (explicit env wins over any .env.local value).
rm -rf dist
VITE_CONVEX_URL="$CONVEX_URL" VITE_DEMO_MODE=true VITE_POS_TERMINAL_ID=sandyq-almaty-01 npm run build
cp staticwebapp.config.json dist/staticwebapp.config.json
grep -rqs "dapper-lobster-404" dist/assets || fail "Build does not point at the dev Convex deployment"
if grep -rqs "clear-flamingo-97" dist; then fail "Build references the PROD Convex deployment"; fi
BUILT_INDEX="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)"

# 3. Deploy with a token that never reaches the terminal.
TOKEN_FILE="$(mktemp)"; chmod 600 "$TOKEN_FILE"
LOG_FILE="$(mktemp)"
trap 'rm -f "$TOKEN_FILE" "$LOG_FILE"' EXIT
az staticwebapp secrets list --name "$APP" --resource-group "$RG" --query properties.apiKey -o tsv > "$TOKEN_FILE"
[ -s "$TOKEN_FILE" ] || fail "Could not fetch the SWA deployment token"
set +e
SWA_CLI_DEPLOYMENT_TOKEN="$(cat "$TOKEN_FILE")" npx -y @azure/static-web-apps-cli@2 deploy ./dist --env production --no-use-keychain >"$LOG_FILE" 2>&1
SWA_STATUS=$?
set -e
rm -f "$TOKEN_FILE"
grep -vi token "$LOG_FILE" | tail -15 || true
[ "$SWA_STATUS" -eq 0 ] || fail "SWA CLI exited with $SWA_STATUS"

# 4. Prove the new build is live (the SWA CLI can exit 0 without deploying).
HOST="$(az staticwebapp show --name "$APP" --resource-group "$RG" --query defaultHostname -o tsv)"
for _ in 1 2 3 4 5 6; do
  LIVE_INDEX="$(curl -s "https://$HOST/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
  [ "$LIVE_INDEX" = "$BUILT_INDEX" ] && { echo "✔ Deployed demo $COMMIT to https://$HOST ($BUILT_INDEX)"; exit 0; }
  sleep 10
done
fail "Demo still serves ${LIVE_INDEX:-nothing} instead of $BUILT_INDEX — the deploy did not land"
