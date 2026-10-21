<!-- echo-sdlc:init -->
# sandyq

Client: Sandyq Group. Executor: Echo Brain. Set up with `/echo-sdlc:init` on 2026-10-21.

Pipeline: run `/echo-sdlc:start`. It finds the current stage from the repo files and continues.
The pipeline rules come from the echo-sdlc plugin. This file holds project facts only.

## Project facts

| Item | Value |
| --- | --- |
| Convex mode | cloud (Convex Cloud) |
| Azure | hosting on Azure |
| Data residency | none |
| UI language | Russian |
| Linear issue | ECH-42 |

Apps and architecture: `decisions/ARCHITECTURE.md` (stage 1).
Blocked-time limit: 2 h by default. To change it, add a line here: `Blocked limit: <duration>` (for example `Blocked limit: 30m`).
Blocked longer than the limit: stop and ask the user.

## Hard rules

- Data residency: no rule given. Confirm with the client before the first production deploy.
- Development and test use synthetic or anonymized data only.
- Real personal data lives only on production. A change to where production data is hosted is a human checkpoint.
- UI strings are in Russian only, from one shared strings module.
- Missing client data becomes `TODO(client): <question>`. Never invent it.
- Permissions are enforced server-side in Convex functions. Hiding a control in the UI is not a control.

## Where things are

| Path | Content |
| --- | --- |
| `docs/client/` | Client documents (input, gitignored) |
| `docs/SoW.md` | Statement of Work (10 sections) |
| `docs/explainer/` | Explainer page |
| `PRODUCT.md` | Product context for UI work |
| `decisions/` | `ARCHITECTURE.md` and ADRs (`NNNN-*.md`), index in `README.md` |
| `openspec/` | Specs (`specs/`), changes (`changes/`), plan (`changes/PLAN.md`) |
| `costs/` | `COSTS.md` report and `time-log.jsonl` |
| `TOKENS.md` | Key names (never values) |
