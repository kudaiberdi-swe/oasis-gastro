#!/usr/bin/env bash
# Local gate before a commit: the same checks as the CI verify jobs. Stops at the first failure.
set -euo pipefail
npm run typecheck
npm test
npm run guards
npm run contrast
