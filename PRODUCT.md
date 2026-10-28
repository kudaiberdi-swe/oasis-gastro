# Product

<!-- impeccable:product-schema 1 -->

Scope: OASIS Gastro, the restaurant system in this repo — the cashier (`/pos`), the kitchen screen (`/kitchen`)
and the back office (`/office`). A restaurant chain's guest website is separate and talks to this system through the Cloud API (`docs/07-CLOUD-API.md`). The unfinished rebuild of the first client's marketing site in `reference/site-rebuild/` is reference material, not a product. The root `DESIGN.md`
holds the app's design system (its first eight sections) and, in its last section **Website**, the spec of
that site; detailed screen rules for this app live in `docs/04-POS-DESIGN.md` and `docs/05-OFFICE-DESIGN.md`.

## Platform

web

## Users

- **Primary: cashiers and waiters** of the chain's restaurants, on touch terminals in the dining room, taking
  and paying orders for several open tables at once during peak hours. The interface is optimized for them first.
- Kitchen staff on the kitchen screen (tickets by station, statuses).
- Branch managers, accountants, stock keepers, HR and payroll, CRM/loyalty staff in the office, at a
  computer; the owner and leadership read network-wide reports.

## Product Purpose

A cashier and back-office system for restaurant chains, built to replace iiko (a third-party restaurant
platform) over time. A chain starts with a pilot alongside iiko: iiko stays the source of real data (catalog,
recipes, prices, stock, staff, sales) and is only ever read. Success means the branches can run sales,
kitchen, stock, finance and payroll in OASIS Gastro without iiko. Each client chain is a deployment with its
own organization, restaurants and data; the first one runs a pilot on three branches.

## Positioning

A system for Kazakhstan full-service restaurant chains rather than a generic POS: bilingual
Kazakh/Russian menu, Kazakhstan accounting (chart of accounts, VAT, payroll 2026 rules), full-service
dining (many open table checks, a service charge in the hall) — while reading everything that already
exists in iiko instead of re-entering it.

## Operating Context

- Full-service restaurants: table checks, hold/resume, split payments, manager PIN approvals (discounts,
  service-charge waiver, refunds, cash-out, shift close with variance), X/Z reports, kitchen tickets.
- Staff sign in to the POS with a local code + PIN; the office uses email sign-in with roles and
  restaurant/warehouse scopes.
- Money in whole tenge (KZT), time zone Asia/Almaty, business day with a cutoff.
- Receipts are non-fiscal during the pilot; fiscal receipts are still printed by iiko.
- One iiko account may host several brands; a deployment covers one brand, set by `IIKO_BRAND_ALIASES`.

## Capabilities and Constraints

- Never write to iiko: every call is a read (GET). Imports are manual, idempotent, and never overwrite
  edits made in OASIS Gastro.
- Personal data of guests and employees is masked without a dedicated right; iiko sales come in without
  guest personal data.
- Interface language: the POS has a Russian / Kazakh interface switch («Язык интерфейса» in the staff
  profile, remembered per terminal; texts in `frontend/app/pos/i18n/`). The Kazakh texts still need a review by a
  native speaker. The kitchen screen and the office are Russian only. Dishes and modifiers carry both `name`
  (ru) and `nameKk` (kk) and show both, Kazakh with `lang="kk"`; product groups have no Kazakh name yet.
- Undecided / pending: VAT rate and payers, chart-of-accounts codes and payroll rates (accountant);
  kitchen stations (chef); email, SMS, maps, telephony providers' keys; custom domain.

## Brand Commitments

- Product name: OASIS Gastro (restaurant operating system). Logo in `frontend/public/branding/`:
  `oasis-gastro-mark.svg` (mark, favicon), `oasis-gastro-logo-on-dark.svg` (sidebar, sign-in screens),
  `oasis-gastro-logo.svg` (on light). The mark is a restaurant cloche in a violet gradient; the browser tab,
  the logo and texts that mean the system say «OASIS Gastro».
- No client is named in the product. Restaurant and organization names come from the data: printed receipts
  and X/Z reports head with the restaurant's name (no client logo), the office says «сеть» / «ресторан».
- Printed receipts carry the service-charge line «Қызмет ақысы N % / Обслуживание N %».

## Evidence on Hand

- The first deployment's real menus: `scripts/legacy-sandyq/menu-pdfs/`, parsed per city in `scripts/legacy-sandyq/menu-data/{almaty,shymkent,turkistan}.json` (seed input, not served by the frontend).
- Real operational data mirrored read-only from iiko (products, recipes, prices, stock, staff, shifts, orders).
- The first client's website photos in `scripts/legacy-sandyq/images/` (not served, not used by the product; dish cards without a photo show the DishPhoto placeholder).
- No customer testimonials, benchmarks or metrics to cite — do not invent any.

## Product Principles

1. The cashier's speed at the table comes first: a check in a few touches, nothing that slows peak hours.
2. Honest states: a missing provider, key, recipe or report says so — never a fake success or a zero.
3. iiko is read, never written; edits made in OASIS Gastro always survive a re-import.
4. Kazakhstan first: tenge, KZ accounting and payroll, Kazakh and Russian side by side.
5. One product, many chains: the chain's own names and data in every surface, OASIS Gastro's identity in the frame.

## Accessibility & Inclusion

- Touch-first POS and kitchen screens (large targets, used standing, in a busy hall).
- Bilingual audience: Kazakh and Russian text must both render correctly (Kazakh letters ә ғ қ ң ө ұ ү һ і).
- Day and night themes; contrast is checked in CI (`npm run contrast`).
