#!/usr/bin/env bash
# One-shot: generate a new Cloud API signing secret (W3-INT-03, decision Г-9) and set it as the Convex
# env variable CLOUD_API_SECRET on the chosen deployment. Same idea as rotate-ci-deploy-key.sh: the
# secret is written to a local 0600 file and never printed, so it never lands in a terminal transcript.
#
#   scripts/rotate-cloud-api-secret.sh --prod    # production
#   scripts/rotate-cloud-api-secret.sh           # the dev deployment of this checkout
#
# After the run, hand .cloud-api-secret.txt to the sandyq.kz admin over a secure channel, set it on
# the website, then delete the file. Until the website has the new value its requests get 401.
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET_FILE=".cloud-api-secret.txt"
WHERE="dev"
if [[ "${1:-}" == "--prod" ]]; then WHERE="prod"; fi

umask 077
openssl rand -hex 32 > "$SECRET_FILE"
if [[ "$WHERE" == "prod" ]]; then
  npx convex env set --prod CLOUD_API_SECRET "$(cat "$SECRET_FILE")" > /dev/null
else
  npx convex env set CLOUD_API_SECRET "$(cat "$SECRET_FILE")" > /dev/null
fi

echo "Done: CLOUD_API_SECRET set on $WHERE. The value is only in $SECRET_FILE — pass it to the website admin, then delete the file."
