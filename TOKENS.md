# Keys and where to get them

Names only. Values live in `.env.local` / `.env` (local, gitignored), in the Convex deployment's environment (dev `dapper-lobster-404`, prod `clear-flamingo-97`) and in the GitHub repo secrets of `goecho-ai/sandyq`. This file is in git: anything that lands here counts as leaked and gets rotated, not deleted from a commit.

A key name is written in backticks: that is how `check-tokens.mjs` finds it. Status comes from `TODO.md` §1, `README.md` and code comments; «unknown» means no source says.

## Front

Everything prefixed VITE_ ships to the browser inside the bundle. Secrets do not belong here. Set at build time: `.env.local` locally, the `env:` block of the deploy workflow in CI.

| Key | What for | Where it is set | Status |
| --- | --- | --- | --- |
| `VITE_CONVEX_URL` | backend address for the front (`frontend/app/main.tsx`) | `.env.local` (written by `npx convex dev`); `deploy-frontend.yml` (prod), `deploy-demo-frontend.yml` and `scripts/deploy-demo-frontend.sh` (demo) | set |
| `VITE_DEMO_MODE` | `true` builds the demo frontend: role buttons on the sign-in screens, demo banner | `deploy-demo-frontend.yml`, `scripts/deploy-demo-frontend.sh`; not set for prod | set (demo only) |
| `VITE_POS_TERMINAL_ID` | POS terminal the build opens by default (`shafran-09-01` on demo) | `deploy-demo-frontend.yml`, `scripts/deploy-demo-frontend.sh` | set (demo only) |

## Backend

Set with `npx convex env set NAME value` (dev) or with `--prod` under the mint → use → delete rule (see `docs/01-ONBOARDING.md` §6). Read through `convex/lib/env.ts` / `convex/lib/hmac.ts` or `process.env` directly.

| Key | What for | Where it is set | Required | Status |
| --- | --- | --- | --- | --- |
| `OFFICE_BOOTSTRAP_EMAIL` | the only e-mail that may initialise the office (first administrator) — `convex/domains/office/mutations.ts`, `queries.ts` | Convex env dev and prod | yes, for the first office sign-in | unknown (`TODO.md` §5: owner registers on prod with it, not ticked) |
| `SITE_URL` | public office address for Convex Auth | Convex env dev and prod | yes | prod: placeholder `https://sandyq-office.example` until a domain exists (`TODO.md` §1) |
| `JWT_PRIVATE_KEY` | signs Convex Auth session tokens; read by the `@convex-dev/auth` library, not by project code | Convex env dev and prod | yes | unknown |
| `JWKS` | public key set for Convex Auth tokens; read by `@convex-dev/auth` | Convex env dev and prod | yes | unknown |
| `CONVEX_SITE_URL` | issuer domain in `convex/auth.config.ts` | provided by Convex automatically, never set by hand | — | built-in |
| `CONVEX_CLOUD_URL` | the deployment's own address; the demo seed (`convex/domains/seed/shafran.ts`) refuses to run unless it is the dev `dapper-lobster-404` | provided by Convex automatically, never set by hand | — | built-in |
| `CLOUD_API_SECRET` | HMAC secret of the Cloud API for sandyq.kz (`convex/lib/hmac.ts`); without it every route answers 503 | Convex env; the same value goes to the sandyq.kz developer. Create with `scripts/rotate-cloud-api-secret.sh [--prod]` | for the site integration | unknown (`TODO.md` §1: code ready) |
| `CLOUD_API_WEBHOOK_URL` | where order-status webhooks go (`convex/domains/integrations/adapters/cloudApiWebhook.ts`) | Convex env | for the site integration | unknown |

## CI and deploy

GitHub Actions secrets of `goecho-ai/sandyq` (repo settings → Secrets), plus env names the deploy scripts pass for one command.

| Key | What for | Where it is set | Status |
| --- | --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `npx convex deploy` to prod in `deploy-backend.yml`; the scripts `prod-iiko-import.sh`, `prod-w1-maintenance.sh`, `set-office-password.sh --prod` mint a one-off key and delete it | GitHub secret (environment `production`); rotate with `scripts/rotate-ci-deploy-key.sh` | set (`README.md` § CI/CD) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | deploys the prod front to SWA `sandyq-frontend` (`deploy-frontend.yml`) | GitHub secret; issued in Azure portal, SWA → Manage deployment token | set (`README.md` § CI/CD) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_DEMO` | deploys the demo front to SWA `sandyq-demo` (`deploy-demo-frontend.yml`) | GitHub secret; issued in Azure portal, SWA `sandyq-demo` | unknown |
| `GITHUB_TOKEN` | repo token for the SWA deploy action | provided by GitHub Actions automatically | built-in |
| `SWA_CLI_DEPLOYMENT_TOKEN` | SWA token for the manual deploy scripts `deploy-frontend-prod.sh`, `deploy-demo-frontend.sh` | fetched by the script with `az staticwebapp secrets list` into a 0600 temp file, deleted on exit; never stored | transient |
| `CONVEX_DEPLOYMENT` | which Convex deployment the CLI and seed scripts target (`seed-sandyq.mjs`, `seed-e2e.mjs`, `seed-demo-logins.mjs`, `dev-iiko-menu.mjs`) | `.env.local` (written by `npx convex dev`) | set locally |
| `CONVEX_URL` | not used by this project; `scripts/seed-demo-logins.mjs` refuses to run when it is set (it would redirect the CLI) | nowhere — keep unset | not set |
| `CONVEX_SELF_HOSTED_URL` | not used (Convex Cloud); `scripts/seed-demo-logins.mjs` refuses to run when it is set | nowhere — keep unset | not set |

## iiko (local scripts only)

Read-only access to the client's iiko account for `scripts/iiko/*` (`scripts/iiko/lib.mjs`). Never in Convex env or CI.

| Key | What for | Where it is set | Status |
| --- | --- | --- | --- |
| `IIKO_BASE_URL` | iiko server address | local `.env`, or the gitignored `iiko-credentials.md` | unknown |
| `IIKO_LOGIN` | iiko API user | local `.env`, or `iiko-credentials.md` | unknown |
| `IIKO_PASSWORD` | iiko API password | local `.env`, or `iiko-credentials.md` | unknown |
| `IIKO_BRAND_ALIASES` | brand scope of the extract (`scripts/iiko/extract.mjs`): comma list of spellings of the brand name in iiko department and product group names; the extract refuses to run without it (or `--brand`) | local `.env` | not set (new; the existing deployment needs its brand's spellings) |

## Not issued yet

Rows for keys nobody has handed over. In this state the product says honestly that the capability is absent rather than show a button to nowhere.

| Key | Why it is needed | Who to ask | What the product does without it |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | e-mail: office password reset (W2-ACL-08), report mailing (W2-RPT-06); Convex env dev and prod | TODO(client): who issues the Resend account | the «email» adapter goes to dead-letter |
| `EMAIL_FROM` | sender address, for example `noreply@sandyq.kz`; Convex env dev and prod | TODO(client): confirm the sender address | as above |
| `MOBIZON_API_KEY` | SMS campaigns and guest notifications (W3-LOY-08, W3-INT-06); Convex env | TODO(client): who issues the Mobizon account | the SMS adapter is «not configured» |
| `SMS_SENDER` | SMS sender name; Convex env | TODO(client) | as above |
| `VITE_2GIS_API_KEY` | 2GIS map in the browser for delivery zones (W2-DLV-06); `.env` / GitHub secret for the front build | TODO(client): who issues the 2GIS key | manual coordinates instead of the map |
| `DGIS_API_KEY` | server-side geocoding (W2-DLV-06); Convex env | TODO(client) | the maps adapter ends every job in dead-letter |
| `TELEPHONY_WEBHOOK_SECRET` | signs the telephony provider's webhooks (W3-DLV-09); Convex env | TODO(client): choose the cloud PBX provider | `/api/v1/webhooks/telephony` answers 401 |
