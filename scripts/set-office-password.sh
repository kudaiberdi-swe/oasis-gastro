#!/usr/bin/env bash
# Sets or resets the office (Convex Auth) password of an existing ACTIVE office user (W1-ACL-07).
#
#   bash scripts/set-office-password.sh <email>          # dev deployment
#   bash scripts/set-office-password.sh <email> --prod   # production: one-off deploy key, deleted after
#
# The password is asked for with a hidden prompt (not an argument, so it never lands in shell history),
# passed to Convex on stdin-built JSON and never printed or written to a file.
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:?Usage: bash scripts/set-office-password.sh <email> [--prod]}"
TARGET="${2:-}"

read -r -s -p "Новый пароль для ${EMAIL}: " PASSWORD; echo
read -r -s -p "Повторите пароль: " CONFIRM; echo
[ "$PASSWORD" = "$CONFIRM" ] || { echo "Пароли не совпадают" >&2; exit 1; }

ARGS="$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" node -e 'console.log(JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }))')"
unset PASSWORD CONFIRM

if [ "$TARGET" = "--prod" ]; then
  KEY_NAME="set-office-password-$(date +%s)"
  KEY_FILE="$(mktemp)"
  trap 'rm -f "$KEY_FILE"; npx convex deployment token delete "$KEY_NAME" --deployment prod >/dev/null 2>&1 || true' EXIT
  npx convex deployment token create "$KEY_NAME" --deployment prod --save-env "$KEY_FILE" >/dev/null
  set -a; . "$KEY_FILE"; set +a
  npx convex run --prod domains/office/adminMaintenance:setOfficePassword "$ARGS" | grep -v password || true
else
  npx convex run domains/office/adminMaintenance:setOfficePassword "$ARGS" | grep -v password || true
fi
