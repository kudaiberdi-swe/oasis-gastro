# Sandyq

A cashier POS + back office for **Sandyq**, a Kazakhstan ethno-restaurant chain (3 branches: Алматы, Шымкент, Түркістан). Built on Convex (backend + realtime database) and React/Vite (frontend), with a read-only sync from the chain's existing iiko Server account for real branch/staff data.

Two people can read this repo cold from here: this file gets you running locally and orients you to what exists; **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** is the full technical reference — every table, every API function, every cross-domain side effect. **[docs/BRD.md](docs/BRD.md)** has the original business framing and open questions. **[docs/iiko-connection-runbook.md](docs/iiko-connection-runbook.md)** covers the iiko side specifically.

## What's here

- **`/pos`** — the cashier screen. PIN login, open/close shifts, take orders across several open tables at once, checkout, kitchen display, X-reports.
- **`/office`** — the back office. Email/password login (separate from POS PINs). Menu & pricing, stock, finance (P&L), workforce (bridges real iiko staff into POS logins), loyalty, sales & shift-report analytics.
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
| `npm run test` | Runs `convex/posFlows.test.ts` (backend, `convex-test`) and any `*.test.ts` under `src/` |
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

No frontend hosting is set up yet (no Vercel/Netlify project, no domain chosen).

## Testing

`convex/posFlows.test.ts` exercises the core POS flow end-to-end against a real (in-memory) Convex instance via `convex-test`: two parallel table checks with independent service-charge math, checkout, optimistic-concurrency rejection, loyalty accrual, refund + ledger posting, and X-report manager-approval/idempotency.

`src/pos/features/order-taking/model/use-order-draft.test.ts` is a frontend regression suite (`@testing-library/react` + jsdom) pinning down the check-selection-sync bug described in `git log` (commit `a1ebcc9`) — switching between two already-open checks must load the newly selected one's own data, not the previous check's under the new id.

## Known gaps

These are real, not oversights papered over — see [docs/ARCHITECTURE.md § Known gaps and deferred work](docs/ARCHITECTURE.md#known-gaps-and-deferred-work) for the full list and reasoning. The two most load-bearing:

- **No recipes/BOM** — checkout doesn't auto-consume stock; office enters stock receipts/write-offs by hand.
- **`useOrderDraft`'s check-switching bug is fixed, but the underlying pattern (side effects inside a `setState` updater) is still there** — don't "clean up" `addItem`/`setQuantity` in `use-order-draft.ts` without reading the comment above them first; a prior attempt silently persisted empty orders.
