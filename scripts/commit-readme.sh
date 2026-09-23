#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

git add README.md
git commit -m "Document test office account and POS PIN in README"
git push origin main
