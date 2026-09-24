# Sandyq

A cashier POS + back office for **Sandyq**, a Kazakhstan ethno-restaurant chain (3 branches: Алматы, Шымкент, Түркістан). Built on Convex (backend + realtime database) and React/Vite (frontend), with a read-only sync from the chain's existing iiko Server account for real branch/staff data.

Two people can read this repo cold from here: this file gets you running locally and orients you to what exists; **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the full technical reference — every table, every API function, every cross-domain side effect. **[docs/BRD.md](docs/BRD.md)** has the original business framing and open questions. **[docs/iiko-connection-runbook.md](docs/iiko-connection-runbook.md)** covers the iiko side specifically.

## What's here

- **`/pos`** — the cashier screen. Terminal picker (branch → register), code + PIN login, idle lock, open/close shifts, take orders across several open tables at once, checkout, kitchen display, X-reports.
- **`/office`** — the back office. Email/password login (separate from POS PINs). A dark-sidebar shell with 12 groups / 91 sections (the bahandi-pos structure), filtered by the user's rights; six sections work today: menu & pricing, stock, finance (P&L), workforce (bridges real iiko staff into POS logins), loyalty, sales & shift-report analytics — the rest show a placeholder. Every office query and change is limited to the user's restaurants.
- **`convex/`** — the backend: schema, one folder per business domain (`domains/<name>/{queries,mutations}.ts`), shared helpers in `lib/`.
- **`scripts/iiko/`** — a read-only sync toolkit against the real iiko Server API (GET only, enforced by design — see the rule below).
- **`scripts/seed-sandyq.mjs`** — seeds the real menu (parsed from `public/menu-data/*.json`) plus org/restaurants/terminals.

**Hard rule: never write to iiko.** Every script, action, and ad-hoc call against the iiko API must be GET-only. This is a live production account for a real, currently-operating business — not a sandbox. See `convex/domains/iiko/` and `scripts/iiko/lib.mjs`'s `IikoClient` (which only ever exposes `.get()`).

## Quick start (dev)

```bash
npm install
npx convex dev        # separate terminal — provisions/watches the dev deployment
npm run seed           # one-time: real menu + org/restaurants/terminals + 3 synthetic staff PINs
npm run dev             # http://localhost:5173
```

`npm run seed` prints (and saves to gitignored `.sandyq-seed/credentials-*.json`) a cashier/manager/administrator PIN to log into `/pos` with. For `/office`, sign up with any email/password at `/office`, then set that email as `OFFICE_BOOTSTRAP_EMAIL` (`npx convex env set OFFICE_BOOTSTRAP_EMAIL you@example.com`) and click "Инициализировать офис" on first sign-in — see [Two auth models](docs/ARCHITECTURE.md#two-application-surfaces-two-auth-models) for why POS and office are separate.

Pulling real branch/staff data from iiko (optional, needs `.env` with `IIKO_BASE_URL`/`IIKO_LOGIN`/`IIKO_PASSWORD` — see the runbook):

```bash
npm run iiko:discover   # maps the API surface, pulls no data
npm run iiko:seed       # extract → import → reconcile, scoped to Sandyq only
```

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npx convex dev` | Watches `convex/` and pushes to the dev deployment on save |
| `npm run build` | Typecheck + production frontend build |
| `npm run typecheck` | `tsc -b` across the whole repo (frontend + convex) |
| `npm run test` | Runs every test under `tests/` (vitest): `tests/convex` (backend, `convex-test`), `tests/pos` and `tests/office` (UI, jsdom), `tests/scripts` (guard/contrast/compare scripts) |
| `npm run contrast` | WCAG contrast of the day/night theme tokens in `src/shared/styles/theme.css` |
| `npm run guards` | Static checks for the hard rules (auth on public functions, `ConvexError`, office restaurant scope, design tokens) — ratchet against `scripts/guards/baseline.json` (now empty, so any violation fails); public functions without a session must be listed in `scripts/guards/public-allowlist.json` |
| `npm run e2e` | Playwright e2e (`e2e/`), local only: starts its own Vite dev server on :5198 against the dev deployment, installed Chrome, 4 surfaces × day/night |
| `npm run e2e:screens` | Screenshot run → `docs/app-screenshots/W0/…`, then `scripts/compare-screens.mjs` builds the bahandi-vs-sandyq parity page `docs/app-screenshots/W0/compare.html` |
| `npm run seed:e2e` | Seeds the dev deployment for e2e and writes the cashier login for the sale smoke test to a gitignored local env file (never printed). Refuses any non-dev deployment |
| `npm run seed` | Idempotent — safe to re-run. Refuses to run against anything but a dev deployment unless `--prod` is passed (and `--prod` never creates PIN credentials — see below) |
| `npm run iiko:discover` / `iiko:extract` / `iiko:import` / `iiko:reconcile` / `iiko:seed` | iiko sync pipeline stages — see the runbook |

## Environments

Two Convex deployments exist under project `sandyq-9e7e9` (team `echo-dev-echo`):

- **dev** (`dapper-lobster-404`) — what `npx convex dev` and the commands above target by default. Full of test data from building this project.
- **production** (`clear-flamingo-97`) — real catalog + real iiko department/employee mirror, deployed via `npx convex deploy`. **Deliberately has zero rows in `employees`/`officeRoles`/`officeUsers`** — infrastructure-ready, not live. Nobody can sign into `/pos` or `/office` there until PINs are provisioned and the office is bootstrapped, which needs an explicit decision (see the fiscalization note in the BRD — everything here is `nonFiscal: true`, a pilot alongside iiko, not a cash-register replacement, until that's confirmed with the business).

Deploying to prod, or running any script against it, needs a deploy key: mint one **one-off**, use it inline, delete it immediately —

```bash
npx convex deployment token create some-name --deployment prod   # prints a key to stdout
CONVEX_DEPLOY_KEY=<key> npx convex deploy                        # or npx convex env set ... --prod, npx convex data ... --prod, etc.
npx convex deployment token delete some-name --deployment prod   # never leave a standing prod key around
```

Frontend is hosted on an Azure Static Web App (`sandyq-frontend`, resource group `sandyq-prod`, Free tier, East US 2) — no custom domain yet:

- Office (sign-in/sign-up): https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/office
- POS (terminal picker): https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/pos
- POS — Алматы: https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/?terminal=sandyq-almaty-01
- POS — Шымкент: https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/?terminal=sandyq-shymkent-01
- POS — Түркістан: https://thankful-moss-04c3d4a0f.4.azurestaticapps.net/?terminal=sandyq-turkistan-01

The bare root URL `/` redirects to `/pos` and keeps the query string, so the `?terminal=` links above still pick their register directly. Without `?terminal=` (and no remembered choice in the browser) `/pos` shows a terminal picker fed by the public query `domains/auth/queries:posTerminalOptions` — active branches and registers only, no ids or staff. `.github/workflows/deploy-frontend.yml` and `deploy-backend.yml` redeploy frontend/backend independently on pushes to `main` that touch their respective paths; see [CI/CD](#cicd) below.

**Test office account** (created via the real sign-up flow, then bootstrapped as administrator — not a raw DB insert): `test@sandyq.local` / `TestPass123`. Synthetic, not a real staff member — rotate or delete before any real handoff. `OFFICE_BOOTSTRAP_EMAIL` on prod is currently set to this address.

**Test POS PIN**: cashier code `338395` / PIN `5950`, terminal Sandyq Алматы. Provisioned via the office Кадры → «Из iiko» → «Подключить» flow (real `provisionPosAccess` mutation, not a raw DB insert) against the `iikosup` iiko account — a technical/support identity, not a real staff member. Revoke via Кадры → Сотрудники кассы before any real handoff.

## CI/CD

> On 2026-09-24 the owner briefly paused all prod deploys and CI runs (commits stayed local, and a PreToolUse hook `.claude/hooks/block-prod-and-ci.sh` blocked pushes and deploys). The pause was lifted the same day — commit `31e04aa` removed the hook and its `.claude/settings.json` entry — so pushes to `main` run the workflows below again.

Two independent GitHub Actions workflows on `goecho-ai/sandyq`. Each has a `verify` job that runs on every push to `main` and on every pull request touching its paths: `npm ci` → `npm run typecheck` → `npm test` → `npm run guards`, plus `npm run contrast` in the frontend workflow. The deploy job has `needs: verify`, runs only for pushes to `main` (never for a pull request), and uses the `production` GitHub Environment. Nothing reaches prod unless typecheck, tests and guards (and, for the frontend, contrast) are green; a pull request only verifies and never deploys. Playwright e2e is **not** a CI job yet — it runs locally only.

- **`deploy-frontend.yml`** — path-filtered to `src/**`, `public/**`, `tests/**`, the guard/contrast scripts and other frontend files. Builds with `VITE_CONVEX_URL` pointed at prod, deploys `dist/` to the Azure Static Web App above via `Azure/static-web-apps-deploy@v1`.
- **`deploy-backend.yml`** — path-filtered to `convex/**`, `tests/**`, the guard scripts, `package*.json` and the TS/Vite configs. Runs `npx convex deploy` against prod.

`npm run typecheck` checks both the frontend (`tsc -b`) and the Convex functions (`tsc -p convex`); `tsc -b` alone never looked at `convex/`.

Not done yet (blocker D9 in `docs/IMPLEMENTATION-PLAN.md`):
- **Manual approval before a prod deploy:** add required reviewers to the `production` environment in GitHub repo settings. This needs repo admin rights.
- **Preview deployments per pull request:** Convex preview deployments need a paid Convex plan. Otherwise a separate staging Convex project is needed.

Secrets (`goecho-ai/sandyq` repo settings): `AZURE_STATIC_WEB_APPS_API_TOKEN` and `CONVEX_DEPLOY_KEY`. The latter is a deliberate exception to the mint-use-delete rule above — CI needs a standing credential. Rotate it with `scripts/rotate-ci-deploy-key.sh` (writes the key to a local file via `--save-env`, never prints it, feeds it straight to `gh secret set -f`, then deletes the file).

## Testing

All unit/integration tests live in `tests/` (vitest picks up only `tests/**/*.test.{ts,tsx,mjs}`, setup in `tests/setup.ts`; `npm run typecheck` also typechecks them via `tsconfig.test.json`):

- `tests/convex/` — backend against an in-memory Convex (`convex-test`). `posFlows.test.ts`: parallel table checks and service-charge math, checkout, optimistic concurrency, loyalty accrual and reversal on refund, refund + ledger posting, X-report approval/idempotency and rounded discounts, sales report net of refunds, ledger backfill of split payments, kitchen isolation by restaurant, catalog and iiko access. `officeScope.test.ts`: a branch-scoped office user never sees or changes another branch. `posAccess.test.ts`: the terminal picker query and the 4–6 digit PIN rule.
- `tests/pos/` — UI with `@testing-library/react` + jsdom. `use-order-draft.test.ts` pins the check-selection-sync bug (commit `a1ebcc9`); `pos-dialogs.test.tsx` covers the blind shift count, discount re-sync, guest-detach errors and payment rows/cash presets; `pos-session.test.tsx` the terminal picker and login screen; plus routes, UI primitives, formatting/status dictionary and the office navigation, sign-in, states and workspaces.
- `tests/office/` — the register engine (`engine.test.tsx`).
- `tests/scripts/` — the guard, contrast and screen-compare scripts themselves.

Static checks: `npm run guards` and `npm run contrast` (see [Common commands](#common-commands)).

End-to-end, local only (not in CI): `npm run seed:e2e` once against the dev deployment, load the env file it writes, then `npm run e2e` (smoke sale POS → kitchen, every office section, axe accessibility checks, dialog regressions). `npm run e2e:screens` captures screenshots and builds the parity report. Details: [docs/ARCHITECTURE.md § Quality gates](docs/ARCHITECTURE.md#quality-gates).

## Known gaps

These are real, not oversights papered over — see [docs/ARCHITECTURE.md § Known gaps and deferred work](docs/ARCHITECTURE.md#known-gaps-and-deferred-work) for the full list and reasoning. The two most load-bearing:

- **No recipes/BOM** — checkout doesn't auto-consume stock; office enters stock receipts/write-offs by hand.
- **`useOrderDraft`'s check-switching bug is fixed, but the underlying pattern (side effects inside a `setState` updater) is still there** — don't "clean up" `addItem`/`setQuantity` in `use-order-draft.ts` without reading the comment above them first; a prior attempt silently persisted empty orders.
