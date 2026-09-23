#!/usr/bin/env bash
# One-shot: mint a named, long-lived Convex prod deploy key for CI and store it as the
# GitHub Actions secret CONVEX_DEPLOY_KEY. Unlike the mint-use-delete pattern used for
# manual prod access, this key is meant to stand (CI needs a persistent credential) —
# see CLAUDE.md's sandyq section for that exception.
#
# The key is written to a local .env file (deleted at the end) and never printed to
# stdout, so it never lands in a terminal transcript.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY_FILE=".ci-key.env"

npx convex deployment token create sandyq-ci-prod --deployment prod --save-env "$KEY_FILE"
gh secret set -f "$KEY_FILE" --repo goecho-ai/sandyq
rm -f "$KEY_FILE"

echo "Done: CONVEX_DEPLOY_KEY set on goecho-ai/sandyq, local key file removed."
