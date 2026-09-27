# Business Requirements Document — Sandyq

Status: draft. Sections marked ⚠️ need sign-off from the lead (Haidar) before implementation starts. Updated 2026-09-26: implementation went ahead on the working assumptions below (plan: `08-IMPLEMENTATION-PLAN.md`, owner decisions in its §2.5); the status column of §5 says what is decided and what is still open. Open questions for people are tracked in `../TODO.md`.

## 1. Background

The client is a Kazakhstan restaurant/coffeehouse holding running its operations on iiko (a third-party restaurant management platform: POS + back office) through one shared account. Confirmed via a live read-only API call against that account:

- **~30 branches** across Almaty, Astana, Shymkent, Turkestan, Burabay, Charyn, and other cities
- **~2,716 employees**
- **8 legal entities (brands)** operating under the same account: `Sandyq`, `Tary`, `Shopan`, `Salam Bro`, `Cinotti`, `Anor Korday`, `Kainar`, `BURABAY SKY`

This project is scoped to the **Sandyq** brand specifically — the ethno-restaurant chain (public presence: `sandyq.kz`, `sandyqgroup.com`, branches in Almaty, Shymkent, Turkestan). ⚠️ Scope of the other 7 brands in the same iiko account is not yet confirmed — assume out of scope unless the lead says otherwise.

## 2. Problem statement

The business currently runs its cashier and back-office operations entirely on a third-party commercial product (iiko). ⚠️ The specific gap(s) this project is meant to close have not been stated explicitly by the lead yet. Working assumption, pending confirmation:

- a modern, owned, customizable cashier and back-office system instead of (or alongside) the current one
- consolidated cross-branch reporting
- specific features the current system doesn't support (custom loyalty rules, custom reports, Kazakhstan-specific payroll handling)

**Action needed:** confirm the actual driving problem with the lead before committing to a specific feature set — this materially changes scope (see §5).

## 3. Goals

- Build an owned, modern cashier + back-office system for the Sandyq brand.
- Source real operational data (menu, employees, branches, stock, historical sales) from the existing iiko account rather than manual data entry.
- Ship a frontend on Sandyq's own visual identity (logo, colors, typography, imagery — already collected from `sandyq.kz` / `sandyqgroup.com` into `frontend/public/`).

## 4. Non-goals / explicit constraints

- **No writes to iiko.** All iiko API usage is read-only (GET / semantically read-only operations only). iiko is a live production system for a currently-operating business — nothing here may mutate it.
- **No replacement of iiko as the system of record** unless/until explicitly decided otherwise — this project reads from iiko, it does not aim to migrate the business off it as a first step.
- iiko credentials are handled only via gitignored local files, never committed, never exposed to the client/browser.

## 5. Scope — ⚠️ needs confirmation

| Question | Why it matters | Status |
|---|---|---|
| Which Sandyq branches are in scope — all, or a pilot subset? | Determines import volume and rollout risk | Working: pilot on 3 branches (Алматы, Шымкент, Түркістан). The other Sandyq departments in iiko — open (`TODO.md` §5) |
| Is this meant to fully replace the current cashier/back-office system for staff, or run alongside it? | Changes UX requirements and change-management needs | Working: a non-fiscal pilot alongside iiko; iiko keeps printing fiscal receipts (D6, to confirm with the accountant) |
| Does Sandyq need a public-facing customer ordering site, or is this strictly an internal staff tool? | Changes scope significantly — internal tool vs. customer product | Decided (Г-9): an internal tool; sandyq.kz reads the menu and stop list and sends delivery orders through the Cloud API (`07-CLOUD-API.md`) |
| Design/branding source of truth — an official brand guide, or the public site assets already collected? | Confirms whether current asset set is sufficient | Working (D2): the public site palette and assets plus the Sandyq design skill — `../DESIGN.md` |
| Any Sandyq-specific features beyond a standard cashier/back-office (e.g. delivery-platform integrations)? | Determines what to build beyond the baseline | Partly decided: phone and site delivery first, aggregators later (Г-3); no kiosk (Г-8); a Russian / Kazakh cashier interface |

## 6. Functional scope (baseline, pending confirmation)

- **Cashier**: PIN login per employee, order taking with modifiers/sizes, kitchen ticket generation and live kitchen display, payment (card/cash/QR), refunds/voids with manager approval, shift open/close with X/Z cash reports.
- **Back office**: menu & recipe management, weighted-average inventory costing, production tracking, purchasing, double-entry finance, Kazakhstan payroll, workforce scheduling/attendance, loyalty & guest management, delivery dispatch, reporting.
- **Data source**: real Sandyq data pulled from iiko (menu, employees, branches, stock, historical sales) instead of manual entry.

See `03-ARCHITECTURE.md` for how this scope maps to the technical system.

## 7. Data & integration

- Source: iiko Server REST API, read-only.
- Sync is manual/on-demand, not a live real-time feed.
- POS PIN access is provisioned inside the app itself, not sourced from iiko — imported employee records carry no login credentials.
- See `06-IIKO-RUNBOOK.md` for the connection procedure.

## 8. Non-functional requirements

- Isolated backend environment per stage (dev, and eventually production) — no shared state between developers or environments.
- Email-based login for back-office staff, separate PIN-based login for cashiers.
- Secrets (iiko credentials, signing keys, admin bootstrap email) live in gitignored local files or the backend's own environment-variable store — never in the client bundle, never committed.

## 9. Open risks

- Importing real employee PII (names, logins, codes) from iiko needs a data-handling/retention decision before any production import. Decided (D7, 2026-09-26): iiko orders and shifts come in without guest names or phones, staff only by code; iiko guests are not imported. Consent texts and cross-border storage still need the lawyer (`TODO.md` §4).
- No confirmed timeline, budget, or success metric yet.
- Scope (§5) blocks final feature and design decisions until resolved.

## 10. Sign-off

| Role | Name | Status |
|---|---|---|
| Lead | Haidar | Pending review |
| Developer | Beket Nurzhanov | Draft author |
