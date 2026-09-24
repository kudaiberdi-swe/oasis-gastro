#!/usr/bin/env bash
# Commit gate for backend work while the frontend tree may be mid-edit: convex typecheck, the test
# files' typecheck (which also covers src they import), backend and script tests, guards, query lint.
set -euo pipefail
npx tsc -p convex --pretty false
npx tsc -b tsconfig.test.json --pretty false
npx vitest run tests/convex tests/scripts >/dev/null
npm run guards >/dev/null
npm run lint:convex >/dev/null
echo "Backend gate: OK"
