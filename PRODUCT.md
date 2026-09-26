# Product

<!-- impeccable:product-schema 1 -->

Scope: the internal restaurant system in this repo — the cashier (`/pos`), the kitchen screen (`/kitchen`)
and the back office (`/office`). The marketing site in `website/` is a separate product; the root `DESIGN.md`
describes that site, while `docs/POS-DESIGN.md` and `docs/OFFICE-DESIGN.md` describe this app.

## Platform

web

## Users

- **Primary: cashiers and waiters** of Sandyq restaurants, on touch terminals in the dining room, taking
  and paying orders for several open tables at once during peak hours. The interface is optimized for them first.
- Kitchen staff on the kitchen screen (tickets by station, statuses).
- Branch managers, accountants, stock keepers, HR and payroll, CRM/loyalty staff in the office, at a
  computer; the owner and leadership read network-wide reports.

## Product Purpose

Sandyq's own cashier and back-office system, built to replace iiko (a third-party restaurant platform)
over time. Today it runs as a pilot alongside iiko on three Sandyq branches (Алматы, Шымкент, Түркістан):
iiko stays the source of real data (catalog, recipes, prices, stock, staff, sales) and is only ever read.
Success means the branches can run sales, kitchen, stock, finance and payroll in Sandyq without iiko.

## Positioning

An owned system for one Kazakhstan ethno-restaurant brand rather than a generic product: bilingual
Kazakh/Russian menu, Kazakhstan accounting (chart of accounts, VAT, payroll 2026 rules), full-service
dining (many open table checks, 15 % service charge in the hall), and Sandyq's own identity — while
reading everything that already exists in iiko instead of re-entering it.

## Operating Context

- Full-service restaurants: table checks, hold/resume, split payments, manager PIN approvals (discounts,
  service-charge waiver, refunds, cash-out, shift close with variance), X/Z reports, kitchen tickets.
- Staff sign in to the POS with a local code + PIN; the office uses email sign-in with roles and
  restaurant/warehouse scopes.
- Money in whole tenge (KZT), time zone Asia/Almaty, business day with a cutoff.
- Receipts are non-fiscal during the pilot; fiscal receipts are still printed by iiko.
- iiko account `sandy-co-co` hosts 8 brands; this product covers the Sandyq brand only.

## Capabilities and Constraints

- Never write to iiko: every call is a read (GET). Imports are manual, idempotent, and never overwrite
  edits made in Sandyq.
- Personal data of guests and employees is masked without a dedicated right; iiko sales come in without
  guest personal data.
- Interface language: Russian today; **Kazakh + Russian interface is required** (a language switch, at
  least on the POS) — not built yet. Dish names already carry both `name` (ru) and `nameKk` (kk).
- Undecided / pending: VAT rate and payers, chart-of-accounts codes and payroll rates (accountant);
  kitchen stations (chef); email, SMS, maps, telephony providers' keys; custom domain.

## Brand Commitments

- Name: Sandyq (Сандық). Logos and ornaments in `public/branding/` (`sandyq-kz-logo.svg`,
  `sandyq-kz-hidden-menu-logo.svg`, `ornament.svg`, …).
- Brand design reference: `../.claude/sandyq-design.skill` (real tokens and patterns), taken from the
  public sites sandyq.kz / sandyqgroup.com.
- Printed receipts carry the service-charge line «Қызмет ақысы 15 % / Обслуживание 15 %».

## Evidence on Hand

- Real menus: `public/menu-pdfs/`, parsed per city in `public/menu-data/{almaty,shymkent,turkistan}.json`.
- Real operational data mirrored read-only from iiko (products, recipes, prices, stock, staff, shifts, orders).
- Site imagery in `public/images/`.
- No customer testimonials, benchmarks or metrics to cite — do not invent any.

## Product Principles

1. The cashier's speed at the table comes first: a check in a few touches, nothing that slows peak hours.
2. Honest states: a missing provider, key, recipe or report says so — never a fake success or a zero.
3. iiko is read, never written; Sandyq's own edits always survive a re-import.
4. Kazakhstan first: tenge, KZ accounting and payroll, Kazakh and Russian side by side.
5. One brand, one system: Sandyq's identity in every surface, not a generic POS skin.

## Accessibility & Inclusion

- Touch-first POS and kitchen screens (large targets, used standing, in a busy hall).
- Bilingual audience: Kazakh and Russian text must both render correctly (Kazakh letters ә ғ қ ң ө ұ ү һ і).
- Day and night themes; contrast is checked in CI (`npm run contrast`).
