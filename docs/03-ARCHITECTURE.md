# Architecture — Sandyq

This is the technical reference for the implemented system — every table, every API function, every cross-domain side effect, both deployments. For the product framing and open business questions, see [02-BRD.md](02-BRD.md). For the iiko side specifically, see [06-IIKO-RUNBOOK.md](06-IIKO-RUNBOOK.md).

This document describes what's actually built, not a plan. Where something is intentionally deferred or incomplete, it's called out explicitly rather than omitted — see [Known gaps and deferred work](#known-gaps-and-deferred-work) at the end.

**Coverage (updated 2026-09-26).** The per-table and per-function reference below was written for the Phase 1–4 core — POS sign-in, catalog, orders, shifts, kitchen, office bootstrap and the first stock/finance/workforce/loyalty/reports screens — and is kept current for the POS. The W1–W3 waves of [08-IMPLEMENTATION-PLAN.md](08-IMPLEMENTATION-PLAN.md) added about 90 more tables and 20 more domains; they are mapped in [Domains added in W1–W3](#domains-added-in-w1w3), and for their fields `convex/schema.ts` (113 tables, most fields commented with their task id) is the reference. Line numbers (`file.ts:NN`) date from 2026-09-23 and have drifted since — search by the symbol name.

## Stack

- **Backend**: Convex (queries/mutations/actions, realtime subscriptions, its own document database with indexes and search indexes). No separate API server.
- **Frontend**: React 19 + Vite 8 + Tailwind 4, `react-router` 7 data router (`createBrowserRouter` in `frontend/app/App.tsx`, route table in `frontend/app/shared/routing/routes.tsx`). The POS, the kitchen and every office section are lazy chunks. See [Frontend structure](#frontend-structure).
- **Auth**: two independent systems on purpose — POS PIN sessions (custom) and office email/password (`@convex-dev/auth`). See [Two application surfaces, two auth models](#two-application-surfaces-two-auth-models).
- **External integration**: iiko Server API (XML/REST), read-only, for the chain's real data — branches, staff, stores, registers, products, assembly charts, balances, prices, cash shifts and orders.

## Two application surfaces, two auth models

| | `/pos` | `/office` |
|---|---|---|
| Who | Cashiers, managers, on a physical terminal | Administrators, on any device |
| Auth | Employee code + 4–6 digit PIN (`lib/policy.ts:29-34` `PIN_MIN`/`PIN_MAX`/`isValidPin`) → `posSessions` row, `sha256(token)` stored, never the raw token | Email + password via Convex Auth (`authTables`) → `officeUsers` row links the account to a role |
| Session lifetime | 12h operator / 5min single-use manager-approval (`lib/policy.ts`) | Convex Auth's own session handling |
| Identity table | `employees` (`code` + PIN hash) | `officeUsers` (`email`) + `officeRoles` (capability strings) |

These are deliberately never merged. A POS PIN never grants office access and vice versa — an `employees` row and an `officeUsers` row for the same real person are two separate, unlinked records. The one bridge between them is one-directional: `domains/workforce/mutations.ts:provisionPosAccess` lets an office user turn a real (`iikoEmployees`-mirrored) person into a POS login, generating the code+PIN locally — iiko never supplies a credential, and no office identity is created from that action.

Office capability strings are `"*"` (full access), `office.<section>.<action>` or `office.<section>.*`, plus the special `office.guests.pii` and `office.employees.pii` (the catalog is `convex/lib/capabilities.ts`, W1-ACL-01; sections follow the 91 navigation ids). The old module rights (`office.catalog.*`, `office.stock.*`, …) still open their sections through aliases; `lib/officeAccess.ts` `allowsCapability` is the matching rule. Every navigation item carries `office.<item-id>.view` (`frontend/app/office/model/navigation.ts`). System roles are created at bootstrap (`lib/systemRoles.ts`). `domains/office/mutations.ts:17` `bootstrap` is the only way to create the first `officeRoles`/`officeUsers` rows — it's gated on an exact match against the `OFFICE_BOOTSTRAP_EMAIL` deployment env var, set once via `npx convex env set` (never in code, never in the dashboard by convention — see [Environments](#environments)).

**Office restaurant scoping.** `officeUsers.restaurantScopes` is enforced server-side by the helpers in `lib/officeAccess.ts`, not by the UI:

- `requireRestaurantScope` (`:40`) — a mutation touching one restaurant (stock, finance, workforce branch assignment) throws «Нет доступа к ресторану» outside scope. `catalog.setProductPrice` does the same check inline (`catalog/mutations.ts:98`).
- `restaurantScopeFilter(user, requested?)` (`:53-60`) — the predicate every per-restaurant office query filters rows through (stock, finance, reports, workforce branch lists). A requested restaurant outside scope throws; rows with no restaurant are visible only with network scope (`"*"`).
- `requireNetworkScope(user, role)` (`:67-70`) — network-level data (the guest base: `loyalty/queries.ts:34,46`, `loyalty/mutations.ts:50`) needs `restaurantScopes: ["*"]` or a `"*"` role.
- `requireEmployeeInScope` (`:73-79`) — a workforce change on an existing POS login (`setEmployeeActive`, `updateEmployeeAssignment`, `resetPin`, re-provisioning) needs at least one of the employee's restaurants in scope.

`scripts/check-guards.mjs:86-90` flags any office function that takes a `restaurantExternalId`/`restaurantId` argument without one of these helpers. Tested in `tests/convex/officeScope.test.ts`.

## Backend structure

```
convex/
  schema.ts              single source of truth for every table (113)
  auth.ts / auth.config.ts / http.ts    Convex Auth wiring (office) + the Cloud API / telephony HTTP routes
  crons.ts                              session cleanup, outbox and integration queue, sales facts, 24h
                                        shifts, loyalty expiry, report mailings, price-order statuses…
  migrations/                           data migrations M-2…M-9 (dryRun first; M-1 and M-6 live in
                                        domains/catalog and domains/office, M-8 in domains/reports)
  lib/                                  shared, no business-domain ownership — the Phase 1–4 files below,
                                        plus W1–W3 cores: checkoutCore, orderPricing, modifierPricing,
                                        recipeConsumption, stockAccounting/stockPosting, ledger/accounts,
                                        periods, domainRecords, outbox/integrationQueue, payroll, reportFacts…
    auth.ts             PIN hashing (PBKDF2-SHA256/120k/256-bit), requireOperator,
                        requireManagerApproval, session helpers — POS side
    officeAccess.ts     getOfficeAuthEmail, allowsCapability, requireOfficeCapability, writeOfficeAudit,
                        and the restaurant-scope helpers (requireRestaurantScope, restaurantScopeFilter,
                        requireNetworkScope, requireEmployeeInScope) — office side, see above
    audit.ts            writeAudit — POS-side auditEvents helper (paired with officeAccess's
                        writeOfficeAudit for the office side)
    finance.ts           postLedgerEntry — called directly from orders/stock mutations
    loyalty.ts           normalizePhone, findOrCreateGuest, accrueLoyaltyPoints, reverseLoyaltyPoints
    restaurants.ts       listOperationalRestaurants — see note below
    money.ts             integer-tenge rounding, service-charge/total/cash-reconciliation math
    time.ts               almatyBusinessDate (fixed UTC+5 offset, no DST)
    policy.ts             every tunable business constant + the PIN rule (see table below)
    validators.ts         shared v.* unions/objects
  domains/
    auth/        actions.ts (login, "use node")  internal.ts  mutations.ts  queries.ts
    catalog/     queries.ts  mutations.ts  pos.ts (product configuration, favorites, stop list)
                 office.ts (nomenclature, product card, groups, «Показать блюда iiko с ценой»)  types.ts
    orders/      queries.ts  mutations.ts  floor.ts (the POS hall grid)  types.ts
    shifts/      queries.ts  mutations.ts        (blind count: reconcileCount)
    kitchen/     access.ts (ticketRestaurantId)  queries.ts  mutations.ts
    pos/         queries.ts  mutations.ts  internal.ts   (notifications, upsell suggestion, terminal settings)
    office/      queries.ts  mutations.ts  access.ts  favorites.ts  adminMaintenance.ts  migrations.ts
    iiko/        mutations.ts  internal.ts (sync, internal)  office.ts (office screen)
                 catalog.ts  projections.ts  operations.ts (projections into canonical tables)
    seed/        mutations.ts                         (internal — scripts/seed-sandyq.mjs)
    …and the W1–W3 domains: corporation, modifiers, sizeScales, pricing, recipes, retail, stock,
    stockDocuments, purchasing, production, productionLogistics, finance, workforce, loyalty,
    delivery, telephony, integrations, platform, reports — see «Domains added in W1–W3»
```

**Domain-first, not layer-first** (locked decision from the original planning pass): a business concept owns one folder with its own `queries.ts`/`mutations.ts`, rather than one giant `queries.ts` for the whole app. A domain's mutations *are allowed* to write directly into another domain's tables when that's the natural side effect of an event — `checkout` posts into `journalEntries` (finance's table), `stockMovements` (stock's) and `loyaltyAccounts`/`loyaltyTransactions` (loyalty's) in the same transaction, rather than routing through a separate finance/loyalty mutation call. This keeps money-and-points events atomic with the event that caused them. See [How mutations talk across domains](#how-mutations-talk-across-domains-real-side-effects).

**`lib/restaurants.ts:listOperationalRestaurants`** is worth calling out specifically: Phase 3's iiko import writes its own `restaurants` row per iiko department (see [iiko integration](#iiko-integration)), so a city that already has a seeded, terminal-bound restaurant ends up with **two** rows sharing a city but not an `externalId`. A cashier can only ever be assigned to the seeded one (it's the only one with a `posTerminals` row), so every office-facing restaurant list goes through this helper, which filters to restaurants that actually have an active terminal. `domains/workforce/queries.ts` additionally resolves an iiko department code to the *operational* restaurant by city-name match when the two diverge (see the `CITY_ALIASES` table there) — without that, the "assign to branch" checkbox in the office «Сотрудники» screen would silently fail to pre-check anything for Алматы/Шымкент/Түркістан candidates.

## Domains added in W1–W3

One line per domain; task ids are those of [08-IMPLEMENTATION-PLAN.md](08-IMPLEMENTATION-PLAN.md), whose §0 has the status.

| Domain (`convex/domains/…`) | What it holds | Tasks |
|---|---|---|
| `corporation` | Organizations, restaurants, departments | W2-ADM-06/07/08 |
| `office` (grown) | Roles and users with restaurant/organization/warehouse scopes, favorites, admin maintenance | W1-ACL, W1-ADM, W3-ADM-13 |
| `platform` | Terminals, period locks, audit log, print templates, equipment, system settings (`platformRecords`) | W1-ADM, W3-ADM-10/11/12 |
| `catalog` (grown), `modifiers`, `sizeScales`, `pricing` | Product groups, nomenclature and product card, modifier groups, size scales, price orders, stop list, favorites | W1-CAT |
| `recipes` | Recipe versions and lines, consumption by sale | W1-RCP |
| `retail` | Payment/order/discount types, deletion reasons, cash operation types (versioned reference data, `activeForPos`); the office «Заказы и чеки» and «Кассовые смены», iiko history merged in | W1-RTL, W2-RTL-01 |
| `orders` (grown), `shifts` (grown), `pos` | Order types, modifiers, split, move, void, «На кухню», the hall grid, Z-reports, blind count; POS notifications and upsell | W1-POS, redesign 2026-09-26 |
| `kitchen` (grown) | Stations, timers, bump-back, delivery tickets | W1-KDS, W2-KDS-01 |
| `stock`, `stockDocuments`, `purchasing` | Warehouses, units, suppliers, items, balances on a date, stock documents, receipts, supplier returns, price lists | W1-STK, W2-STK-13, W2-CAT-15 |
| `production`, `productionLogistics` | Preparations, production/processing/sales acts, internal and purchase orders, the kitchen plan and semi-finished sheet | W2-PRD, W3-PRD-07/08 |
| `finance` (grown) | Chart of accounts, double-entry journal, cash-flow categories, counterparties, shift acceptance, obligations, payments, bank statements, payment calendar, budgets | W1-FIN, W2-FIN, W3-FIN-11/12/13 |
| `workforce` (grown) | HR card, positions, shift types, schedule, attendance, payroll (KZ 2026 rules), motivation, medical records | W1-HR, W2-HR, W3-HR-07/08 |
| `loyalty` (grown) | Programs, accounts, guest categories, consents, redemption, campaigns, reservations and hall plan | W1-LOY, W2-LOY, W3-LOY-08 |
| `delivery`, `telephony` | Delivery orders, sources, zones, couriers and settlement; call journal and provider webhook | W2-DLV, W3-DLV-09 |
| `integrations` | Integration cards, the Cloud API for sandyq.kz (`docs/07-CLOUD-API.md`), external menu versions, provider adapters with a queue and dead-letter | W2-ADM-09, W3-INT-01…04, 06 |
| `reports` (grown) | The 190-report catalog, calculators, facts, favorites and saved views, export, schedules | W1-RPT, W2-RPT, W3-RPT-01…06 |
| `iiko` (grown) | Restaurant ↔ department links and the projections of stores, registers, units, suppliers, products, charts, balances, prices, cash shifts and orders | W1-IIKO, W2-IIKO-08/09 |

## Database schema

All tables live in `convex/schema.ts`. Grouped by domain below; every table's real fields, not a summary — this is the part meant to save someone a `Read` of the file.

### Office identity

- **`officeRoles`** `{externalId, name, capabilities: string[], system}` — `capabilities` is `["*"]` or a list of `office.<section>.<action>` / `office.<section>.*` strings (see above).
- **`officeUsers`** `{externalId, email, name, roleExternalId, restaurantScopes: string[], organizationScopes?, warehouseScopes?, active}` — `restaurantScopes` is `restaurants.externalId[]` or `["*"]`; organization and warehouse scopes came with W1-ACL-01 (migration M-6).
- Convex Auth's own tables (`authTables` spread into the schema — accounts, sessions, users, etc.) back the email/password login itself.

### Identity & org (POS)

- **`organizations`** `{externalId, name, currency, timezone, active, sourceSystem?, sourceHash?, importedAt?}` — `sourceSystem: "iiko-server"` marks a row written by the iiko sync.
- **`restaurants`** `{externalId, organizationExternalId, name, address, timezone, city?, currency?, active, sourceSystem?, sourceHash?, importedAt?}`.
- **`posTerminals`** `{externalId, restaurantId, name, terminalNumber, nextOrderNumber, active}` — `nextOrderNumber` is the human-facing order-number source, incremented on every new draft.
- **`employees`** `{code, displayName, role: cashier|manager|administrator|kitchen, restaurantIds: Id<restaurants>[], terminalIds?, pinSalt, pinHash, active, failedAttempts, lockedUntil?, iikoEmployeeExternalId?}` — the last field is set only when this login was created via `provisionPosAccess`.
- **`posSessions`** `{tokenHash, purpose: operator|manager-approval, employeeId, terminalId, createdAt, lastActivityAt, expiresAt, revokedAt?}` — the raw session token is never stored, only its SHA-256.

### Catalog

- **`categories`** `{externalId, label, shortLabel, sortOrder, active?, parentExternalId?, colorToken?, sourceSystem?, sourceHash?, importedAt?}` — `parentExternalId` is the product-group hierarchy (W1-CAT-03); `colorToken` (optional `cat-*` literal union) is the POS category strip, set in the office («Группы товаров» → «Цвет в кассе») and returned to the POS; unset, the POS guesses it from the label. No Kazakh name yet (`nameKk` exists on products and modifiers only).
- **`products`** `{externalId, name, nameKk, nameSort, searchText, description, category, categorySort, basePrice, popular, badge?, sku, baseUnit, enabled, …}` — bilingual (`name` Russian primary, `nameKk` Kazakh secondary); `basePrice` is the fallback when no price matches the requesting restaurant. Catalog v2 (W1-CAT-01) added item type, units, images, barcodes, sizes, modifier rules and stop-list fields; iiko-imported products carry `sourceSystem: "iiko-server"` and arrive hidden (`enabled: false`) unless matched to a seed dish. Modifier groups and modifiers (`modifierGroups`, `modifiers`, with `nameKk`), size scales and price orders have their own tables.
- **`productPrices`** `{productId, restaurantExternalId, priceKzt, …}` — per-branch price override. Sandyq's real menu prices genuinely differ by city for the same dish. Prices from iiko (`v2/price`) land here with `sourceSystem: "iiko-server"`; a price set in Sandyq wins.

### Orders & checkout

- **`orders`** — the big one: `{number, orderType: dine-in|takeaway, tableLabel?, status, discountPercent, discountReason?, discountApprovedBy?, subtotal, serviceChargePercent, serviceChargeAmount, serviceChargeWaived?, total, paymentMethod?, checkoutIdempotencyKey?, clientOrderId?, restaurantId?, terminalId?, originatingShiftId?, currentShiftId?, createdBy?, updatedBy?, comment?, guestId?, version?, createdAt, updatedAt?, heldAt?, paidAt?, cancelledAt?, searchText}`. `status` is `draft|held|paid|cancelled|partially_refunded|refunded`; `orderType` is `dine-in|takeaway|delivery`. W1 added `businessDate`, the order type / discount type from the retail reference data, loyalty accrual/redemption fields, `splitFromOrderId`, `kitchenSentAt`, and the seat: `hallLabel` + `tableLabel` (picked on the POS hall grid) and `guestCount` (the cashier's «Гостей» stepper, 1–30, never defaulted from table capacity). **No single-draft-per-terminal constraint** — Sandyq is full-service, several tables stay open at once, each its own `orders` row keyed by hall + table. `version` is the optimistic-concurrency field every content-editing mutation bumps (see [invariants](#invariants-that-matter)).
- **`orderLines`** `{orderId, clientLineId?, productId, productExternalId?, productName, quantity, unitPrice, sizeLabel?, modifiers: string[], sizeOptionId?, modifierSelections?, kitchenModifiers?, lineTotal?, sentToKitchenAt?, kitchenTicketId?, voidedAt?, voidReasonExternalId?, course?}` — `modifierSelections` are priced choices from the modifier catalog, `kitchenModifiers` what the kitchen sees (by modifier `externalId`); `modifiers` is the older free-text note list. `orders.getCheck`/`hydrateOrder` add `modifierNamesKk` (resolved from `modifiers.nameKk` by externalId, no schema field) so the POS can show the Kazakh line.
- **`orderDeletionEvents`** `{orderId, orderLineId?, deletionReasonName, deletionReasonExternalId?, writeOff, comment, actorId, managerId?, createdAt}` — written by `cancel` (one row per cancelled order; the reason from the «Причины удалений» reference data when chosen, otherwise «Отмена заказа») and by `voidLine` (one row per voided sent line, with `orderLineId` and the reason's `writeOff` flag).

### Shifts & money

- **`shifts`** `{restaurantId, terminalId, number, businessDate, status: open|closed, openedBy, openedAt, openingCash, openingNote, expectedCash?, countedCash?, variance?, closeNote?, closedBy?, closedAt?, managerApprovedBy?, zReportNumber?}`. The expected cash of an open shift is computed, never stored until close, and hidden from cashiers (see [blind cash](#blind-cash-count)).
- **`shiftEvents`** `{shiftId, type, amount, reason, actorId, orderId?, idempotencyKey?, createdAt}` — `type` is `open|cash-in|cash-out|order-paid|order-transfer-out|order-transfer-in|refund|manager-override|close`. This is the shift's own audit/reconstruction log; `shifts/queries.ts:calculateSummary` replays it (plus `payments`) to compute expected cash.
- **`xReports`** — an immutable snapshot, inserted only by `shifts/mutations.ts:123` `createXReport` (`:167`). `close` stamps `zReportNumber` (`Z-<date>-<terminal>-<shift>`) and the cash totals on the `shifts` row and, in the same transaction, inserts an immutable **`zReports`** row (W1-POS-08: number, shift, restaurant, terminal, counted cash, variance and the same totals snapshot as an X-report, `nonFiscal: true`); `shifts.queries.getZReport` reads it and `history` links it. Every `xReports` row is `nonFiscal: true` (see the fiscalization note in the BRD). Full shape: `{reportVersion, idempotencyKey, reportNumber, sequence, shiftId, shiftNumber, terminalId, terminalName, terminalNumber, restaurantId, restaurantName, restaurantAddress, businessDate, openedAt, generatedAt, openedByName, generatedByName, generatedByRole, openingCash, catalogGrossSales, discounts, serviceCharge, sales, refunds, netSales, averageCheck, expectedCash, payments: {cash|card|qr: {sales, refunds, net, saleCount, refundCount}}, cashMovements: {cashIn, cashOut, cashInCount, cashOutCount}, orderCounts: {paid, partiallyRefunded, refunded, cancelled, draft, held, discounted}, openOrders: {count, total}, heldOrders: {count, total}, cancelledAmount, saleOrderCount, refundOrderCount, nonFiscal}`.
- **`payments`** `{orderId, shiftId, type: sale|refund, method: cash|card|qr, amount, tendered?, change?, idempotencyKey, status: "recorded", createdBy, createdAt}` — immutable, idempotency-keyed; a refund is a new row with `type: "refund"`, never an edit to the original.

### Kitchen

- **`kitchenTickets`** `{orderId, orderNumber, status: queued|preparing|ready|completed, fulfillment, source, restaurantId?, …}` — created by «На кухню» (`sendToKitchen`, only the new lines) and by `checkout` for whatever was not sent yet; also by delivery orders (W2-KDS-01). `restaurantId` was added by migration M-7 (W1-KDS-01); `domains/kitchen/access.ts` `ticketRestaurantId` still derives it from the order for older rows. Stations (`prepArea`) and per-line status live on `kitchenTicketLines`.
- **`kitchenTicketLines`** `{ticketId, productExternalId, productName, quantity, instructions: string[], prepArea?, bundleComponents?, orderLineId?, status?}`.

### Audit

- **`auditEvents`** `{actorKey, action, summary, resourceType, resourceExternalId, organizationExternalId, restaurantExternalId?, occurredAt, terminalId?, actorId?, shiftId?, orderId?, managerId?}` — one shared table for both POS (`lib/audit.ts:writeAudit`) and office (`lib/officeAccess.ts:writeOfficeAudit`) actions. `restaurantExternalId` is optional specifically because office actions like a catalog edit aren't scoped to one branch.

### Loyalty (Phase 4)

- **`guests`** `{phone (normalized digits), name?, points, createdAt}` — never imported from iiko; created only when a cashier attaches a phone number to an order, or an office user does a manual adjustment on an unrecognized phone.
- **`loyaltyTransactions`** `{guestId, kind: accrual|redemption|adjustment|reversal, points (signed), orderId?, reason? (required for adjustment), balanceAfter, actorEmail? (office adjustments only), paymentId? (reversal: the refund payment), shortfall? (reversal: points owed back but already spent), occurredAt}`. Loyalty v2 (W1-LOY-01/02, migration M-5) moved the balance into **`loyaltyAccounts`** per program (`loyaltyPrograms`, «Базовая»), added `guestConsents` and `guestCategories`; `lib/loyaltyCore.ts` writes `accrual`, `redemption` and `reversal` rows with an idempotency key. Guests are still never imported from iiko.

### Finance (Phase 4)

- **`ledgerEntries`** `{restaurantExternalId, businessDate, occurredAt, kind: revenue|expense, category (free text), amount (always positive — kind carries the sign), sourceModuleId: orders|stock|manual, sourceExternalId, description, createdByEmail? (manual only), createdAt}` — the Phase 4 flat P&L, now legacy: migration M-4 moved it into **`journalEntries`**, the double-entry journal on the Kazakhstan chart of accounts (`lib/accounts.ts`, `lib/ledger.ts`, W1-FIN-01/02/07). New postings go to the journal.

### iiko sync mirror (Phase 3 — read-only)

- **`iikoImportRuns`** `{runExternalId, status: running|completed|failed, startedAt, completedAt?, counts?, error?}`.
- **`iikoEndpointStates`** `{endpointKey, lastStatus, lastRunAt, message?}`.
- **`iikoDepartments`** `{externalId, parentExternalId?, code?, name, type ("DEPARTMENT"|"JURPERSON"|…), sourceHash, importedAt}` — allowlisted fields only.
- **`iikoEmployees`** `{externalId, code?, displayName, mainRoleCode?, departmentCodes: string[], active, sourceHash, importedAt}` — **never carries phone/email/IIN/login** — those keys are never even read out of the source response (see `scripts/iiko/lib.mjs:sanitizeRecord`'s allowlist, not a blocklist).
- **`iikoMirrorRecords`** `{mirrorKey, endpointKey, recordExternalId, payloadHash, importedAt}` — lets a re-import detect "nothing changed" without touching canonical tables.
- **`iikoEntityOverlays`** `{overlayKey, entityType, sourceExternalId, …typed fields}` — local edits layered on an iiko entity that a re-import must not clobber. The product card writes them (`catalog/office.ts` `saveProductCard`, and «Показать блюда iiko с ценой» keeps a shown dish shown after a re-import); M-1b moved the old untyped `data` into typed fields.
- W1–W3 iiko projections also write `iikoCashShifts` / `iikoOrders` (read-only history, «Источник: iiko» in the office, no personal data), `restaurantSourceLinks` (restaurant ↔ iiko department, set in the office) and `recipeLines.iikoDepartmentExternalIds` (an iiko chart line that applies only to some departments).

### Stock (Phase 4)

- **`inventoryItems`** `{externalId, name, nameSort, searchText, unit, minimumStock?, active}`.
- **`stockBalances`** `{restaurantExternalId, inventoryItemId, quantity, averageUnitCost, updatedAt}` — denormalized cache; `stockMovements` is the source of truth.
- **`stockMovements`** `{restaurantExternalId, inventoryItemId, kind: receipt|writeoff|adjustment, quantityDelta (signed), unitCost, balanceAfter, averageUnitCostAfter, reason? (required for writeoff/adjustment), actorEmail, occurredAt}`.

These are the Phase 4 tables. W1 replaced the per-restaurant stockroom with **`warehouses`** (migration M-3 moved balances and movements to `<restaurant>-main`), immutable movements with weighted-average cost (`lib/stockAccounting.ts`), stock documents, receipts, units and suppliers, and **`recipes`** / `recipeVersions` / `recipeLines` — checkout consumes stock by recipe (`lib/recipeConsumption.ts`).

## Complete API surface

Every exported `query`/`mutation`/`action` by domain. "Office" or "POS" in the Auth column means `requireOfficeCapability`/`requireOperator` respectively; "internal" means it's not callable from a client at all (internal-only, or a plain exported function other mutations call directly).

**Only two public functions run without a session**, and both are listed with a reason in `scripts/guards/public-allowlist.json`: `domains/auth/actions:login` and `domains/auth/queries:posTerminalOptions`. The two office-shell functions (`office.context`, `office.bootstrap`) need a signed-in Convex Auth account (`getOfficeAuthEmail`) but no capability. Every other public function calls `requireOperator`/`requireManagerApproval` or `requireOfficeCapability`; `npm run guards` fails on a new public function that doesn't (`scripts/check-guards.mjs:75-81`).

### `domains/auth` — POS sign-in

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `actions.login` | action (`"use node"`) | none (this *is* login; allowlisted) | Rejects a PIN failing `isValidPin` with the same message as a wrong PIN (`actions.ts:27`), then verifies code+PIN (PBKDF2-SHA256/120k) and returns a session token |
| `queries.posTerminalOptions` | query | none (allowlisted) | Terminal picker before sign-in (`queries.ts:39-59`): active restaurants that have at least one active terminal, as `{restaurantExternalId, restaurantName, city, terminals: [{externalId, name, terminalNumber}]}` — no Convex ids, no staff |
| `internal.getLoginRecord` | internal query | — | Looks up the employee by code, for the login action |
| `internal.recordFailedAttempt` | internal mutation | — | Increments `failedAttempts`, locks after `LOCKOUT_THRESHOLD` |
| `internal.createSession` | internal mutation | — | Inserts the `posSessions` row after a successful PIN check |
| `internal.cleanupExpiredSessions` | internal mutation | — | Hourly cron (`crons.ts`) |
| `internal.revoke` | internal mutation | — | Revokes a session by raw token (`internal.ts:78-89`). Internal because a public version would let anyone revoke any session without authenticating; nothing calls it today (manager-approval tokens are revoked inline by `requireManagerApproval`) |
| `queries.current` | query | POS | Current session's employee/terminal/restaurant |
| `mutations.logout` | mutation | POS | Revokes the current session |
| `mutations.lock` | mutation | POS | Idle-lock — revokes without a full logout |

### `domains/catalog`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listCategories` | query | POS (`queries.ts:28`) | Active categories, sorted |
| `queries.listProducts` | query | POS (`queries.ts:43`) | Paginated, searchable, price resolved for the session's restaurant |
| `queries.getProduct` | query | POS (`queries.ts:72`) | One product with resolved price |
| `queries.findByBarcode` | query | POS | Barcode scanner lookup (W3-POS-01) |
| `pos.getProductConfiguration` | query | POS | Sizes and modifier groups of one dish for the modifier dialog; options carry `nameKk` |
| `pos.favoriteIds` / `favoriteProducts` / `toggleFavorite` | query / mutation | POS | The cashier's favorites (W1-CAT-13) |
| `pos.setAvailability` / `setAvailabilityFromPos` | mutation | office / POS | Branch stop list (W1-CAT-14) |
| `queries.listAllForOffice` | query | office `catalog.*` | Every category/product regardless of active/enabled, with all per-branch prices attached |
| `office.listProductGroups` / `saveProductGroup` | query / mutation | office | Product groups, including the POS colour (`colorToken`, «Цвет в кассе») |
| `office.listNomenclature` / `getProductCard` / `saveProductCard` | query / mutation | office | The nomenclature register and the product card (W1-CAT-04/05); edits of an iiko product go to its overlay |
| `office.showPricedIikoDishes` | mutation | office | «Показать блюда iiko с ценой»: dry run counts first, then shows the hidden iiko dishes priced in the user's branches; a dish hidden on purpose in its card stays hidden |
| `office.generateImageUploadUrl` / `attachProductImage` | mutation | office | Product images (W1-CAT-06) |
| `queries.resolveProductPrice` / `resolveProductPrices` | plain functions | — | Shared price-resolution logic (also used by `orders/mutations.ts`) |
| `mutations.createCategory` / `updateCategory` | mutation | office `catalog.*` | |
| `mutations.createProduct` / `updateProduct` | mutation | office `catalog.*` | |
| `mutations.setProductPrice` | mutation | office `catalog.*` | Upserts a `productPrices` row, checked against the caller's `restaurantScopes` |

### `domains/orders`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `floor.floor` | query | POS | The POS hall grid («Зал · N открыто», `orders/floor.ts`): active `diningTables` of the terminal's restaurant grouped by hall, the open checks sitting at each (total, age, status, `kitchenSentAt`, `mine` — only this terminal's checks are editable here — or the other terminal's name), plus this terminal's open checks whose table is not on the plan (typed by hand, takeaway, a removed table). Capped at 200 tables / 200 open checks, `truncated` says so |
| `queries.listOpenChecks` | query | POS | Every draft/held order at this terminal (parallel tables) |
| `queries.getCheck` | query | POS | One hydrated order (lines + payments; lines carry `productNameKk` and `modifierNamesKk`) |
| `queries.list` | query | POS | Paginated order history, searchable; lines carry `productNameKk` (refund list) |
| `queries.hydrateOrder` | plain function | — | Shared order→lines/payments hydration, resolves Kazakh modifier names by externalId |
| `mutations.saveDraft` | mutation | POS | Create-or-update a draft/held order; OCC via `expectedVersion`; re-prices every line server-side (modifiers, sizes, order type, discounts, service charge by order type); saves `hallLabel`/`tableLabel` and `guestCount` |
| `mutations.hold` / `resume` | mutation | POS | Park a check / bring it back to draft |
| `mutations.sendToKitchen` | mutation | POS | «На кухню»: sends the not-yet-sent lines as a kitchen ticket |
| `mutations.voidLine` | mutation | POS | Removes a line with a reason from «Причины удалений»; a sent line (or a reason with `requireManager`) needs manager approval; writes `orderDeletionEvents` with `orderLineId` |
| `mutations.split` | mutation | POS | Moves chosen lines/quantities into a new check (`splitFromOrderId`) |
| `mutations.moveToTable` | mutation | POS | «Перенести на стол»: new hall + table for the check (OCC) |
| `mutations.cancel` | mutation | POS | Draft/held only; reason ≥ 3 chars; requires manager approval; writes an `orderDeletionEvents` row |
| `mutations.checkout` | mutation | POS | Records payment(s), consumes stock by recipe, sends unsent lines to the kitchen, marks paid, posts to the journal, applies loyalty — via `lib/checkoutCore.ts`; see [side effects](#how-mutations-talk-across-domains-real-side-effects). Idempotent by the caller's key: the POS keeps one key per payment attempt (below) |
| `mutations.refund` | mutation | POS | Manager approval required; enforces original payment method; reverses stock, cost and loyalty points proportionally |
| `mutations.transfer` | mutation | POS | «Перенести на кассу»: moves a held order to another terminal of the restaurant with an open shift (`shifts.availableTransferTargets`); manager approval |

### `domains/shifts`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.current` | query | POS | Open shift + live summary, `cashVisible`; for a cashier the summary leaves out the expected cash and every figure it follows from (blind cash) |
| `queries.closePreview` | query | POS | What closing now would look like (blockers; expected cash for managers/administrators only) |
| `queries.history` | query | POS | Paginated past shifts with their Z-report id; the still-open shift is blind for a cashier, closed ones show their totals |
| `queries.availableTransferTargets` / `getZReport` | query | POS | Terminals of the restaurant with an open shift; one stored Z-report |
| `queries.calculateSummary` / `buildClosePreview` / `buildXReportSnapshot` | plain functions | — | Shared math, replayed from `payments`/`shiftEvents`/`orders` |
| `mutations.open` | mutation | POS | One open shift per terminal |
| `mutations.recordCashMovement` | mutation | POS | Cash-in / cash-out by operation type; every cash-out and a cash-in type with `requireManager` need manager approval. The cash-out limit error names no amount («Сумма больше, чем учтено в кассе») |
| `mutations.reconcileCount` | mutation | POS | «Сверить»: logs the counted cash (audit `shift.count` with counted, expected and variance) and only then returns the expected cash, the variance and the manager threshold |
| `mutations.close` | mutation | POS | Blocked while any draft/held order remains; note required on any variance; manager approval if `\|variance\| ≥ VARIANCE_APPROVAL_KZT`; stamps `zReportNumber` on the shift and writes the `zReports` row |
| `mutations.createXReport` | mutation | POS | Manager approval required for a cashier; idempotent replay by key; doesn't close the shift |

### `domains/kitchen`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.board` | query | POS | Not-completed tickets **of the session's restaurant only** (`queries.ts:21-22`, via `ticketRestaurantId`), gated on `requireOperator` (in the reference this was office-gated — the POS-side kitchen display has no office auth dependency, so it's operator-gated instead) |
| `queries.officeSummary` | query | office | The office «Экран кухни» section (W1-KDS-03) |
| `mutations.setStatus` | mutation | POS | Advances a ticket one step (`queued → preparing → ready → completed`); another restaurant's ticket is reported as «Тикет не найден» (`mutations.ts:21`); writes a `kitchen.status` audit event |

### `domains/office` — bootstrap only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.context` | query | any signed-in office account | `{email, ready, canBootstrap, user, capabilities, restaurants, organization}` (`queries.ts:12-38`) — drives the office shell's gating. `restaurants` is filtered to the user's scope; `canBootstrap` is true only for a not-yet-ready account whose email equals `OFFICE_BOOTSTRAP_EMAIL` (`:31`) — everyone else gets the "no access" screen; `organization` (`{name, timezone, currency}`, `:35`) feeds the sidebar footer |
| `mutations.bootstrap` | mutation | exact `OFFICE_BOOTSTRAP_EMAIL` match | One-shot: creates the `administrator` role (`["*"]`) and links the caller's email to it with `restaurantScopes: ["*"]` (`mutations.ts:38` — network-wide, including branches added later). Requires at least one operational restaurant. Idempotent — safe to re-run |

### `domains/stock`

The Phase 4 functions (`listInventoryForOffice`, `receiveStock`, `writeOffStock`, `adjustStock`) are gone with migration M-3 and W1-STK-12. Stock master data is `stock/master.ts` (units, warehouses, suppliers, inventory items, balances on a date), price lists `stock/priceLists.ts`, `stock/internal.ts` `recalculateChain` re-costs a movement chain; documents (write-off, inventory, transfer…) are `domains/stockDocuments`, receipts `domains/purchasing/receipts.ts` — all office-capability-gated and scope-checked.

### `domains/finance`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.summary` / `listEntries` / `restaurantsForFilter` | query | office `finance.*` | The Phase 4 P&L views, scope-filtered |
| `queries.journal` / `overview` / `counterpartyDebt` | query | office | The double-entry journal, `finance.overview`, debts by counterparty (W1-FIN-05) |
| `mutations.recordExpense` | mutation | office `finance.*` | Manual expense |

Cash-flow categories, counterparties, shift acceptance, obligations, payments, bank statements, the payment calendar and budgets live in the other `domains/finance/*.ts` files (W1-FIN, W2-FIN, W3-FIN-11/12/13). The one-off `backfillFromPayments` is gone — M-4 moved `ledgerEntries` into `journalEntries`.

### `domains/workforce`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listBranches` | query | office `workforce.*` | In-scope operational restaurants |
| `queries.listPosEmployees` | query | office `workforce.*` | `employees` rows with at least one in-scope branch (all of them with network scope), with resolved branch names; **never returns `pinSalt`/`pinHash`** |
| `queries.listUnprovisioned` | query | office `workforce.*` | Active `iikoEmployees` not yet linked to a POS login, each with its resolved branch (see the `listOperationalRestaurants` note above), limited to in-scope branches |
| `queries.suggestCredentials` | query | office `workforce.*` | Fresh random 6-digit code (checked for uniqueness) + 4-digit PIN, for prefilling the provision/reset-PIN forms |
| `mutations.provisionPosAccess` | mutation | office `workforce.*` | Bridges an `iikoEmployees` row to a real `employees` login; code+PIN always chosen and hashed locally; PIN must pass `isValidPin` (4–6 digits, `mutations.ts:39`); target branches scope-checked |
| `mutations.setEmployeeActive` | mutation | office `workforce.*` | Toggle active; reactivating also clears `failedAttempts`/`lockedUntil`; `requireEmployeeInScope` |
| `mutations.updateEmployeeAssignment` | mutation | office `workforce.*` | Change role/branches; the employee and every new branch must be in the caller's scope |
| `mutations.resetPin` | mutation | office `workforce.*` | Regenerates salt+hash for an existing login; same PIN rule; `requireEmployeeInScope` |
| `queries.listEmployees` / `getEmployee`, `mutations.createPosEmployee` / `updateEmployeeProfile` | query / mutation | office | The HR card over the POS login (W1-HR-01); PII masked without `office.employees.pii` |

Positions, shift types, schedule, attendance (`clockIn`/`clockOut` from the POS profile), payroll, motivation and medical records are the other `domains/workforce/*.ts` files (W1-HR, W2-HR, W3-HR-07/08).

### `domains/loyalty`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.getOrderGuest` | query | POS | The guest currently attached to an order, if any |
| `queries.findGuestByPhone` | query | POS | Live lookup while a cashier types a phone number |
| `queries.listGuests` | query | office `loyalty.*` + network scope | Searchable guest directory (guests are network-wide, so `requireNetworkScope`) |
| `queries.guestHistory` | query | office `loyalty.*` + network scope | One guest's `loyaltyTransactions` |
| `mutations.attachGuestToOrder` | mutation | POS | Find-or-create by phone; **deliberately doesn't bump `orders.version`** (see the comment in the file — it's not a content edit, and bumping it desyncs the POS draft hook's cached version) |
| `mutations.detachGuestFromOrder` | mutation | POS | Same non-bump rule |
| `mutations.adjustPoints` | mutation | office `loyalty.*` + network scope | Manual +/- correction with a required reason; blocked if it would go negative |
| `queries.searchForPos` / `quoteForPos`, `mutations.setOrderRedemption` | query / mutation | POS | «Гость и лояльность» on the POS: guest search, the points quote and a planned (partial) redemption, reserved until checkout (W1-LOY-03) |

Programs, accounts, guest categories, campaigns, reservations (with the hall plan) and point expiry are the other `domains/loyalty/*.ts` files.

### `domains/reports` — read-only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.restaurantsForFilter` | query | office `reports.*` | In-scope operational restaurants |
| `queries.salesSummary` | query | office `reports.*` | `{revenue, grossSales, refunds, orderCount, averageCheck, byDate, topProducts, byPaymentMethod}` from `payments` in the date range; `revenue` and the by-date/by-method figures are **net of refunds** (`queries.ts:53`, `:82`); scope-filtered — goes to line-item detail the finance P&L can't answer |
| `queries.listShiftReports` | query | office `reports.*` | Browsable `xReports` history with full detail, scope-filtered (this data existed since Phase 1 but had no office-side viewer until Phase 4) |
| `queries.execute` / `coverage` / `dashboardSummary` | query | office | The report engine (W1-RPT-01): runs any of the 190 catalog reports through its calculator (`reports/registry.ts`, `reports/calculators/`), coverage for the «Все отчёты» badge, the dashboard KPIs. Schedules and mailings — `reports/schedules.ts` |

### `domains/iiko` — read-only sync internals

The sync functions (`mutations.ts`, `internal.ts`) are called by `scripts/iiko/*.mjs` via `npx convex run` and are **internal** — none is callable from a client. The office screen «Корпорация → Обмен данными с iiko» (`/office/data-exchange`) uses the capability-gated `office.ts`: `integrationOverview`, `listEndpointStates`, `listImportRuns`, `restaurantLinkOptions` and `linkRestaurantToIikoDepartment` (the only write — a Sandyq-side `restaurantSourceLinks` row, nothing goes to iiko). The projections into canonical tables are `catalog.ts`, `projections.ts` and `operations.ts`.

| Function | Kind | Purpose |
|---|---|---|
| `mutations.beginRun` / `completeRun` / `failRun` | internal mutation | `iikoImportRuns` lifecycle |
| `mutations.recordEndpointState` | internal mutation | `iikoEndpointStates` per-endpoint health |
| `mutations.upsertDepartment` / `upsertEmployee` | internal mutation | Single-record upsert (thin wrappers) |
| `mutations.importBatch` | internal mutation | Batched upsert — the script uses this instead of one `convex run` per record to stay under Convex's per-mutation operation budget |
| `internal.saveOverlay` | internal mutation | Writes an `iikoEntityOverlays` row |
| `internal.productsForMatching` / `linkedDepartments` | internal query | Seed-dish matching for the product import; restaurant ↔ department links |
| `internal.importRun` | internal query | One run's status |
| `internal.endpointStates` | internal query | All endpoints' last-known health |
| `internal.mirrorCounts` | internal query | `{departments, employees}` counts, used by `scripts/iiko/reconcile.mjs:25` |

### `domains/seed` — internal, dev-time only

| Function | Kind | Purpose |
|---|---|---|
| `mutations.seedAll` | internal mutation | Idempotent upsert of org/restaurants/terminals/categories/products/prices/employees from `scripts/seed-sandyq.mjs`'s parsed payload |

## How mutations talk across domains: real side effects

These aren't documented anywhere else as a single list — this is exactly the kind of thing that's easy to lose track of:

1. **`checkout`** (`orders/mutations.ts` → `lib/checkoutCore.ts` `settleOrder`) → in the same transaction as the `payments` rows:
   - `lib/kitchen.ts` `createKitchenTicket` — a ticket for the lines not sent with «На кухню» yet (none, if everything was sent).
   - a `shiftEvents` row `type: "order-paid"`.
   - `lib/recipeConsumption.ts` `consumeOrderStock` — stock movements by recipe at weighted-average cost, for dishes that have a recipe.
   - `lib/ledger.ts` `postJournalEntry` — the double-entry posting by payment type (the legacy `lib/finance.ts` `postLedgerEntry` only before M-4 has run).
   - loyalty accrual and the planned redemption (`lib/loyaltyCore.ts`), if a guest is attached.
2. **`refund`** → a `shiftEvents` row `type: "refund"`, a reversing journal entry, `reverseOrderConsumption` (stock and cost back in proportion to the refunded share), and the proportional loyalty reversal: computed cumulatively (target minus already reversed) so a series of partial refunds adds up to exactly what was accrued. The guest balance never goes below 0 — points already spent are recorded as `shortfall`. A replayed refund (same idempotency key) returns before any of this runs.
3. **`cancel`** / **`voidLine`** → an `orderDeletionEvents` row alongside the `order.cancel` / line audit event.
4. **Stock receipts and documents** (`stockDocuments`, `purchasing/receipts.ts`) → stock movements plus their journal entries (`lib/stockPosting.ts`).
5. **`loyalty/mutations.ts:attachGuestToOrder` / `detachGuestFromOrder`** → patch `orders.guestId` directly, **without** bumping `orders.version` (see the table row above for why — this is a documented exception to invariant #2 below).
6. **`shifts.reconcileCount`** → an `auditEvents` row `shift.count` (counted, expected, variance) before the expected cash is returned — every look at the expected cash by a cashier leaves a trace.

## Invariants that matter

Don't simplify these away without understanding why they're there:

1. **Idempotency everywhere money moves.** `checkout`/`refund`/`recordCashMovement`/`createXReport` all take a caller-supplied `idempotencyKey` and short-circuit on replay — a network retry must never double-charge or double-post. On the POS, `checkout/model/use-checkout-attempt.ts` keeps **one key per payment attempt of an order** until the payment succeeds, the dialog is cancelled or another order is opened; after 10 s without an answer (`CHECKOUT_TIMEOUT_MS`) the dialog shows «Нет ответа сервера. Повторите — повторная оплата не пройдёт.» and keeps the key, so the retry is deduplicated, and a late answer still completes the attempt.
2. **Optimistic concurrency on order content.** Every mutation that edits an order's lines/discount/table bumps `orders.version`; `saveDraft` rejects a stale `expectedVersion` with "Заказ изменён на другой кассе". This is what two cashiers editing the same table's order at once actually collide against — see the [check-switching bug](#a-fixed-bug-worth-understanding) below for what happens when a client's cached version drifts from the server's for an unrelated reason.
3. **Manager approval is single-use by construction.** A `posSessions` row with `purpose: "manager-approval"` is revoked the instant `requireManagerApproval` validates it (`lib/auth.ts`) — reusing a token would silently turn a one-time approval into a standing one. Gated actions: discount >`DISCOUNT_APPROVAL_PERCENT`, service-charge waiver, cancel, refund, transfer, voiding a line already sent to the kitchen (or with a reason that requires it), every cash-out and a cash-in type with `requireManager`, shift close with `|variance| ≥ VARIANCE_APPROVAL_KZT`, and an X-report generated by a `cashier` (not required for `manager`/`administrator`).
4. **Session tokens are never stored raw** — only `sha256(token)`, on both the POS (`posSessions.tokenHash`) and (via Convex Auth) the office side.
5. **PIN hashing**: PBKDF2-SHA256, 120,000 iterations, 256-bit output, salted per employee, constant-time comparison (`lib/auth.ts`). The same helpers back both `provisionPosAccess` and `resetPin` so a PIN set either way verifies identically. One length rule everywhere: `lib/policy.ts:32` `isValidPin` (4–6 digits) is checked at login (`domains/auth/actions.ts:27`) and whenever a PIN is issued or reset (`domains/workforce/mutations.ts:39`, `:119`).
6. <a id="blind-cash-count"></a>**Blind cash count.** `lib/policy.ts` `seesExpectedCash(role)` — only `manager` and `administrator` see the expected cash of an open shift. For a cashier `shifts.current` / `closePreview` / `history` return a blind summary (no expected cash, cash sales/refunds or revenue), and the close flow is: enter the counted cash → «Сверить» (`reconcileCount`, audited) → expected, counted and variance → «Закрыть смену и напечатать Z-отчёт?». The server does not yet stop inference from the order history or from probing `close` errors (see Known gaps).

## Every policy constant (`convex/lib/policy.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `SERVICE_CHARGE_PERCENT` | 15 | Printed on every Sandyq menu as «Қызмет ақысы» |
| `DISCOUNT_APPROVAL_PERCENT` | 10 | Above this, a discount needs manager approval |
| `VARIANCE_APPROVAL_KZT` | 1000 | Shift-close cash variance threshold for manager approval |
| `SESSION_TTL_MS` | 12h | Operator PIN session lifetime |
| `APPROVAL_TTL_MS` | 5min | Manager-approval session lifetime (single-use regardless) |
| `LOCKOUT_THRESHOLD` / `LOCKOUT_DURATION_MS` | 5 / 10min | Failed-PIN lockout |
| `IDLE_LOCK_MS` | 5min | Client-side POS idle lock |
| `LOYALTY_ACCRUAL_PER_TENGE` | 100 | 1 point per 100 ₸ on a paid order's total |
| `PIN_MIN` / `PIN_MAX` | 4 / 6 | POS PIN length in digits; `isValidPin(pin)` is the single check |
| `seesExpectedCash(role)` | manager, administrator | Who sees the expected cash of an open shift (blind count for cashiers) |

## Frontend structure

Role-first, not layer-first — mirrors the backend's domain-first choice at the top level:

```
frontend/app/
  main.tsx        fonts (self-hosted @fontsource Golos Text + Cormorant) → ConvexAuthProvider
                  → ThemeProvider → ToastProvider → App; reloads once on a stale chunk after a deploy
  App.tsx          createBrowserRouter(appRoutes) + RouterProvider
  pos/
    router.tsx → LocaleProvider → PosWorkspace
    i18n/            the RU/KK interface: ru.ts (keys + Russian), kk.ts (Kazakh), core.ts (translator,
                     plurals), locale-provider.tsx (localStorage "sandyq-pos-locale", per terminal; also
                     passes the shared primitives' words through shared/lib/ui-labels), language-switch.tsx
                     (the «Язык интерфейса» control in the profile), names.ts (which name leads: Russian in
                     ru, Kazakh in kk; the Kazakh part gets lang="kk"), errors.ts (client-side error texts in
                     the interface language; a server's own Russian message passes as it is)
    model/           use-connection.ts — useServerOffline() over the Convex connection state
    components/      app-header (Sandyq mark, shift pill, sync indicator), order-panel, product-card,
                     live-sync-indicator — presentational
    features/<name>/{data,model,ui}
      session/       terminal-picker (+ data/use-terminal-options), login-screen (code → PIN,
                     also the locked screen), manager-approval-dialog, main-menu-dialog, profile-dialog
                     (attendance, theme, density, interface language), model/use-pos-session
                     (terminal choice, session, idle lock)
      catalog/        product browsing: catalog-panel (toolbar, chips, favorites, «Последние»; sorted by
                      name), modifier-dialog, model/catalog-view, model/modifier-selection
      order-taking/   pos-workspace.tsx (the main screen + the picker/login gate), useOrderDraft
                      (the cart hook), checks-switcher («Зал · N открыто» in the order panel title),
                      floor-grid (the hall: tables by hall with their open checks, «Без стола», move
                      to a table), guest-count-control («Гостей» 1–30), discount-dialog (live «Итого
                      после скидки»), order-actions-dialog (four frequent tiles + «Ещё»), split,
                      transfer, void-line, cancel, comment dialogs
      checkout/       payment-dialog (method as a radio group, nothing preselected with more than one
                      method), payment-split-list, payment-complete («Оплачено»: check number, methods,
                      change, «Печать чека», «Новый стол»), model/use-checkout-attempt (one idempotency key
                      per attempt, 10 s timeout), receipt formatting
      shifts/         shift dialog (open, cash in/out, blind close: count → «Сверить» → close + Z), history,
                      X/Z report forms
      history/        order history and refund panel
      loyalty/        guest-dialog — attach/detach a guest, points quote and partial redemption
      hotkeys/, notifications/, print/, retail/   hotkeys + barcode scanner, notifications, print documents,
                      the POS copy of the retail reference data
  kitchen/
    router.tsx        /kitchen (and the /pos/kitchen redirect): terminal → PIN (reuses pos/features/session
                      components) → full-screen board; model/use-kitchen-session (own storage keys, no idle lock)
    features/board/   ui/{kitchen-board,ticket-card,station-filter,completed-journal},
                      data/use-kitchen-board (also embedded by the POS «Экран кухни» button),
                      model/{timer (thresholds config),ticket,sound,use-vanishing}
  office/
    router.tsx        auth gate: sign-in → (not ready) bootstrap or "no access" → shell + section
    model/            navigation.ts (12 groups / 91 items), nav-filter.ts (capability filter,
                      search), capabilities.ts (client mirror of allowsCapability), section-preload.ts
                      (a sidebar link preloads its section's chunk on hover/focus)
    components/        office-shell, sidebar, can, state-page, right-panel, unsaved-changes,
                      period-locked-banner
    hooks/ data/       use-unsaved-changes; use-office-navigation (expanded groups, collapsed sidebar)
    engine/            register engine — module-config, define-module-api, register-page,
                      master-page (+ SettingsPage), editor-page, domain-form, format-value,
                      mock-module-api, reference-configs
    features/<name>/{data,model,ui}   one folder per section family: access-control, catalog, corporation,
                      dashboard, data-exchange (iiko), delivery, favorites, finance, integrations, kitchen,
                      loyalty, modifiers, nomenclature, platform, price-lists, price-orders, product-groups,
                      production, production-logistics, receipts, reports, retail, retail-settings, session,
                      size-scales, stock, stock-documents, workforce
  dev/                 ui-showcase, office-showcase, engine-showcase — dev-only routes
  shared/
    routing/           routes.tsx (the route table), not-found.tsx
    components/ui/     the primitive library, exported from index.ts (see below)
    components/theme-provider.tsx   day/night mode + density on <html data-theme / data-density>
    hooks/             use-breakpoint (office breakpoints)
    lib/                format.ts, status-dictionary.ts, cn/focusRingClass (utils.ts),
                        error-message (network / validator / masked server errors → short Russian,
                        fallback «Не получилось. Повторите.»), ui-labels (the primitives' own words,
                        overridable per surface), almaty-time, plural, phone, audit-actions
    styles/{theme.css,index.css}   design tokens, bridged into Tailwind 4 (see below)
```

**Routes** (`frontend/app/shared/routing/routes.tsx`): `/` redirects to `/pos`, keeping the query string so `?terminal=` survives (`RootRedirect`); `/pos`; `/kitchen` (terminal → PIN → the board, `frontend/app/kitchen/router.tsx`) and `/pos/kitchen` redirecting to it; `/office` redirects to `/office/dashboard` (`DEFAULT_OFFICE_DESTINATION`, falls back to the first allowed section); `/office/:section/:id?/:subId?`; `*` → `NotFound`. `PosRouter`, `KitchenRouter` and `OfficeRouter` are `lazy` chunks, and every office section is its own chunk (`lazySection` in `frontend/app/office/router.tsx`), so a register downloads no office code. The office section lives in the URL, so deep links and reloads keep it; old section ids (`catalog`, `finance`, `workforce`, `loyalty`) redirect to their new ids (`LEGACY_OFFICE_SECTIONS`). Dev-only routes `/dev/ui`, `/dev/office/:section?`, `/dev/engine/:module?/:id?` exist only when `import.meta.env.DEV` is true — the dynamic imports are dropped from production builds; Playwright uses them for screenshots. The Azure Static Web App rewrites every unknown path to `index.html` (`staticwebapp.config.json`), so client routes work on reload.

**POS entry: terminal picker → login → lock.** `PosWorkspace` (`frontend/app/pos/features/order-taking/ui/pos-workspace.tsx`) gates the cashier screen:

1. **Which terminal.** `use-pos-session.ts:20-34` resolves it in order: `?terminal=<externalId>` (also remembered), then `localStorage["sandyq-pos-terminal"]`, then the build-time `VITE_POS_TERMINAL_ID`. With none, the `TerminalPicker` is shown — branch select, then terminal cards — fed by the public query `domains/auth/queries:posTerminalOptions` (`frontend/app/pos/features/session/data/use-terminal-options.ts`). A remembered terminal that is no longer offered (disabled or removed) shows the picker again instead of failing at login.
2. **Login.** `LoginScreen` takes the employee code, then the PIN (4–6 digits, from the on-screen `PinPad` or the physical keyboard; Enter submits). The caption «Sandyq · <филиал> · <касса>» comes from the terminal options, not a constant. «Сменить рабочее место» clears the choice (and drops `?terminal=` from the URL).
3. **Lock.** After `IDLE_LOCK_MS_CLIENT` (5 min, `use-pos-session.ts:105`) without interaction the client calls `auth.mutations.lock` and the same `LoginScreen` renders in `locked` mode («Касса заблокирована»).

The session itself is kept in `sessionStorage`, so it doesn't outlive the tab.

**The cashier screen** (POS redesign, 2026-09-26):

- **Hall.** The order panel title «Зал · N открыто» (`checks-switcher.tsx`) opens `floor-grid.tsx` over `orders.floor`: hall tabs, table tiles with their open checks (total, age, «на кухне», another terminal's checks only mark a table as taken), search and sort from 30 tables, «Без стола», and the same grid in «move» mode for «Перенести на стол». There is no typed table number any more (`table-dialog.tsx` is gone). `guest-count-control.tsx` («Гостей: —», 1–30) saves `guestCount` with the draft.
- **Money and control.** Payment: with more than one method nothing is preselected and «Подтвердить» waits for a choice; `useCheckoutAttempt` keeps the idempotency key per attempt with a 10 s timeout ([invariant 1](#invariants-that-matter)); `payment-complete.tsx` shows «Оплачено». Shift close is a [blind count](#blind-cash-count). The discount dialog previews «Итого после скидки»; «−» on the last portion of an unsent line asks «Убрать позицию?».
- **Offline.** `useServerOffline()` (`frontend/app/pos/model/use-connection.ts`) follows the Convex connection: a status strip under the header, «Оплатить» and «На кухню» disabled with the reason beside them, F4 and «Подтвердить» blocked.
- **Touch and language.** Every POS target is at least 48px (`--control-h-pos`); dish, modifier and refund lines carry the Kazakh name (`lang="kk"`); the interface language RU/KK is switched in the profile and kept per terminal (`frontend/app/pos/i18n`). Theme and density moved from the header to the profile; the header carries the Sandyq mark (`frontend/public/branding/sandyq-group-logo.svg`) and the shift pill («Смена №12 · открыта 09:41»). Order actions are four frequent tiles plus «Ещё».
- **Category colours** come from `categories.colorToken` when set, else from the label.

**Office shell** (`frontend/app/office/`). `OfficeRouter` (`router.tsx:34-85`) goes sign-in → `office.context` → bootstrap (only when `canBootstrap`) or `OfficeAccessDenied` → `OfficeShell`. The shell is a dark 264px sidebar (72px with tooltips/flyouts when collapsed, automatic below 1280px) with the 12 groups / 91 items of `navigation.ts` — the same ids and order as bahandi-pos — filtered by the user's capabilities (hidden, not disabled; empty groups disappear) and searchable. Every item has a working screen (`WORKSPACES` in `router.tsx`) except «План счетов» (`chart-of-accounts`), which still renders the "Раздел в разработке" page, and `pos`, which links out to `/pos` (`OFFICE_LINKS`); ЕГАИС says it isn't used in Kazakhstan, the integration cards share one register. A section header carries the «Избранное» star. A section the user has no right to shows the `denied` state. Building blocks: `Can`/`useCan` (`components/can.tsx` — hides an action without the right; the server checks again), `OfficeStatePage` (loading / empty / error / denied, `state-page.tsx`), `RightPanel` (440px master-detail panel, beside the list at ≥1440px, overlay below), `useUnsavedChanges` + `UnsavedChangesDialog` + `SaveStatus` (browser prompt on reload, blocked router navigation), `PeriodLockedBanner`.

**Register engine** (`frontend/app/office/engine/`). Config-driven office pages for the modules still to come: a `ModuleConfig` declares lifecycle (`master` / `publish` / `approval` / `document` → the status tabs), typed columns (`ValueKind`: money, hours, qty, percent, status, … — each column has its own kind and unit), KPIs, form fields and document lines; `defineModuleApi` adapts Convex list/get/save/transition functions (paginated, `PAGE_SIZE = 50`) to the engine, `createMockModuleApi` is the in-memory equivalent. Pages: `RegisterPage` (tabs, search, "Показать ещё"), `MasterPage`/`SettingsPage` (master-detail), `EditorPage` (document editor; posted documents are read-only with «Сторно»), `DomainForm`. Most sections were built as their own workspaces; the engine's pages are used by the staff sections (`features/workforce`: employees, references, attendance, payroll) and exercised by the two reference configs (`reference-configs.ts`, on the mock adapter) at `/dev/engine` and by `tests/office/engine.test.tsx`.

**Design tokens.** `frontend/app/shared/styles/theme.css` is the only file with raw color values: `:root, [data-theme="day"]` and `[data-theme="night"]` define semantic tokens (`--background`, `--card`, `--primary`, `--accent`, `--nav`, the status colours with their opaque surfaces `--success-surface` / `--warning-surface` / `--destructive-surface`, `--destructive-muted` for refunded checks, `--chip-active`, the `--cat-*` category marks, `--control-h-pos` 48px, …) from the sandyqgroup.com palette (decision D2, `docs/04-POS-DESIGN.md` §2); the design-skill palette stays available as `[data-palette="skill"]`. `index.css` maps them into Tailwind with `@theme inline`, defines the type scale (`text-caption` 12px … `text-hero` 44px) in `@theme`, and binds Tailwind's `dark:` variant to the app's night theme rather than the OS (`@custom-variant dark`). `ThemeProvider` writes `data-theme` / `data-density` on `<html>` and remembers them in `localStorage` (`sandyq-pos-theme`, `sandyq-pos-density`). `npm run contrast` (`scripts/check-contrast.mjs`) checks every text pair ≥ 4.5:1 and borders/focus ring ≥ 3:1 in both themes.

**Primitives** (`frontend/app/shared/components/ui`, one barrel `index.ts`): Button, Input, Field, Textarea, MoneyInput, NumericCodeInput, Select, Combobox, Checkbox, Switch, RadioGroup (radio cards), SegmentedControl, Tabs/FilterTabs, Chip, Dialog, ConfirmDialog, Banner, Toast, Breadcrumb, PageHeader, EmptyState, KpiCard, Money, Ornament, Skeleton, StatusPill/TonePill, DataTable, PinPad, ScrollArea. The showcase is `/dev/ui`. The words the primitives say themselves (dialog close, PIN pad, loading, status pills) come from `frontend/app/shared/lib/ui-labels.tsx` — Russian by default, the POS passes its interface language through `UiLabelsProvider`. Two shared libraries replace ad-hoc formatting: `frontend/app/shared/lib/format.ts` (`formatTenge`, `formatAmount`, `formatQuantity`, `formatHours`, `formatPercent` — thin-space digit groups, real minus sign, no tiyn; components don't call `toLocaleString`/`Intl` directly) and `frontend/app/shared/lib/status-dictionary.ts` (`STATUS_DICTIONARY` + `describeStatus`: every backend status shown through `StatusPill` with a Russian label and a tone, per domain — document, order, kitchen, shift, courier, call, job).

**`useOrderDraft`** (`pos/features/order-taking/model/use-order-draft.ts`) owns one open check's cart, local-first with autosave-per-edit. It's the most subtle piece of frontend state in the app — every edit computes the next state inside a `setState` functional updater and calls `persist()` from inside that updater, which looks like a code smell but is load-bearing: see the comment directly above `addItem`/`setQuantity` in that file before touching it, and [the note below](#a-fixed-bug-worth-understanding).

## A fixed bug worth understanding

`useOrderDraft` only synced its internal `orderId` state from a `useState` *initializer*, which React only runs on mount — selecting a *different* already-open check via `OpenChecksList` never updated it. Depending on timing, editing the newly selected check either silently created a duplicate order or patched the wrong one, and the hydration effect had its own single-fire guard (`hydratedOnce`) that blocked it from ever re-syncing displayed lines/discount/guest after the first real check load in a session — so switching checks could show one check's data under another's id.

Fixed (commit `a1ebcc9`) by threading a `selectionKey` (bumped by the caller on every explicit `selectCheck()`) through the hook, and resyncing only once hydration for the *newly selected* id actually arrives. Regression-tested in `use-order-draft.test.ts` — those three tests were verified to fail against the pre-fix hook before being trusted.

A follow-up attempt to also clean up the "`persist()` inside a `setState` updater" pattern (to quiet a cosmetic, dev-only React 18 StrictMode double-invoke warning) turned out to be a real bug: reading the computed value back out of the updater into an outer variable assumes the updater runs synchronously, which React doesn't guarantee — `persist()` ran with the *old* (empty, on a new order) value and silently saved an empty order. Reverted; left as a comment in the code so it isn't attempted again without solving that.

## iiko integration

Read-only, forever — see the rule in [README.md](../README.md). `scripts/iiko/lib.mjs`'s `IikoClient` only ever exposes `.get()`.

```
scripts/iiko/
  lib.mjs                IikoClient (session-key auth via GET /auth?login=&pass=sha1(password)),
                          XML tokenizer/parser, sanitizeRecord allowlists, hashing
  endpoint-registry.mjs   every endpoint ever called (all GET): corporation/departments and employees
                          by default; stores, groups, units, suppliers, products, assembly charts,
                          balances, prices, cash shifts and OLAP sales behind --with-* flags (see the runbook)
  extract.mjs             --discover-only maps the API surface (application.wadl) without
                          pulling data; otherwise fetches, filters, sanitizes, stages to
                          .iiko-cache/<run>/staging.jsonl
  import-convex.mjs       reads the staged file, chunks into batches of 50 (Convex's
                          per-mutation operation budget), calls domains/iiko/mutations:
                          beginRun / importBatch / completeRun (all internal)
  reconcile.mjs           compares staged vs mirrored counts (domains/iiko/internal:mirrorCounts),
                          exits non-zero on mismatch
  seed.mjs                orchestrates extract → import → reconcile
scripts/prod-iiko-import.sh   the whole import against prod, with a one-off deploy key (mint → use → delete)
```

The imported rows are projected into canonical tables by `convex/domains/iiko/{catalog,projections,operations}.ts`: stores → `warehouses`, points of sale → `posTerminals` (inactive), units, suppliers, product groups and products (hidden unless matched to a seed dish), assembly charts → recipe versions «из iiko» (lines per department in `recipeLines.iikoDepartmentExternalIds`), opening balances, branch prices (Sandyq's own price wins), cash shifts and orders without personal data. Stores, registers, prices and sales of a restaurant not linked to its iiko department in «Обмен данными с iiko» are skipped, never attached to the first restaurant at hand.

**Brand scoping**: the iiko account is a holding of 8 brands sharing one corporate structure (~30 branches, ~2,700+ employees). `extract.mjs` filters department names by `["sandyq", "сандык"]` (case-insensitive substring — the Cyrillic alias exists because one real department, "Сандык Кайнар", has no Latin spelling) before anything reaches the local staging file, let alone Convex.

**PII-safe by allowlist, not blocklist**: `sanitizeRecord`'s field lists (`lib.mjs`) are the *only* fields ever read out of a source response. `iikoEmployees` structurally cannot carry a phone/email/IIN/login, because those keys are never selected in the first place — there's no PII-strip regex to keep in sync.

**Idempotent re-import**: `mirrorKey = "<endpointKey>:<recordExternalId>"`; a record is only re-applied to canonical tables when its `payloadHash` actually changed since the last import.

## Environments

| | dev | production |
|---|---|---|
| Deployment | `dapper-lobster-404` | `clear-flamingo-97` |
| Reference | `echo-dev-echo:sandyq-9e7e9:dev/dapper-lobster-404` | `echo-dev-echo:sandyq-9e7e9:production` |
| Data | Full of test data from building this project | Real catalog (135 products, 3 branches) + real iiko mirror (12 departments, 363 employees) |
| `employees`/`officeRoles`/`officeUsers` | Has test rows | **Deliberately empty** — see below |
| Reached by | `npx convex dev`, all `npm run iiko:*` / `npm run seed` by default | `npx convex deploy`, `npm run seed -- --prod`, any command with `CONVEX_DEPLOY_KEY` set |

**Production is infrastructure-ready, not live.** `scripts/seed-sandyq.mjs --prod` is a deliberate, explicit override of the script's default dev-only guard — and as its own hard safety rail, it never generates employee PIN credentials, only catalog/org data. Nobody can sign into `/pos` or `/office` on prod until PINs are provisioned (via «Сотрудники» or «Обмен данными с iiko → Доступ сотрудников к Sandyq POS» in the office) and the office is bootstrapped — both need an explicit go-ahead, not an assumption. Every prod deploy key used to set this up was minted one-off (`npx convex deployment token create … --deployment prod`), used inline as `CONVEX_DEPLOY_KEY`, and revoked immediately after (`deployment token delete`) — never leave a standing prod credential around.

Frontend is hosted on an Azure Static Web App (`sandyq-frontend`, resource group `sandyq-prod`) at `https://thankful-moss-04c3d4a0f.4.azurestaticapps.net` — see [README § Environments](../README.md#environments) for the per-branch POS/office links and [README § CI/CD](../README.md#cicd) for the workflows that deploy it. `VITE_CONVEX_URL` is baked in at build time pointing at `https://clear-flamingo-97.convex.cloud`. Prod's `SITE_URL` (used by Convex Auth) and what is left to set on prod are tracked in `TODO.md` §1 and §5.

## Quality gates

Five local checks, run by CI's `verify` jobs before any deploy (see [README § CI/CD](../README.md#cicd)); `bash scripts/verify.sh` runs them all locally:

- **`npm run typecheck`** — `tsc -b` (frontend + tests via `tsconfig.test.json`) and `tsc -p convex`.
- **`npm test`** — vitest over `tests/**/*.test.{ts,tsx,mjs}` only (`vite.config.ts`), setup in `tests/setup.ts` (a `ResizeObserver` stub for Radix under jsdom):
  - `tests/convex/` (`convex-test`, backend, no DOM), one file per domain or flow — among them `blindCash.test.ts` (blind shift queries for a cashier, `reconcileCount` audit) and `posFloor.test.ts` (`orders.floor`); `posFlows.test.ts`: the core POS flow (parallel table checks with independent service-charge math, checkout, shift close, stale-`expectedVersion` rejection, loyalty accrual, refund method enforcement + ledger posting, X-report manager approval + idempotent replay), loyalty reversal on refund, reports / X-report / ledger backfill agreeing, public-function access, kitchen isolation by restaurant. `officeScope.test.ts`: a branch-scoped office user never sees or changes another branch. `posAccess.test.ts`: `posTerminalOptions` returns only active terminals and no staff fields; the 4–6 digit PIN rule.
  - `tests/pos/` (`@testing-library/react` + jsdom) — `use-order-draft.test.ts` (the check-selection-sync regression suite described above), `pos-money-control.test.tsx` (blind count, payment method choice, key reuse and timeout, «Оплачено», offline), `floor-grid.test.tsx`, `pos-touch-kazakh.test.tsx`, `pos-i18n.test.tsx` (RU/KK), `pos-followups.test.tsx` (guest count, Kazakh modifiers, move to a table), POS dialogs, terminal picker / login / terminal caption, routes, UI primitives, `format.ts` and the status dictionary, and the office navigation, sign-in, states and workspaces.
  - `tests/kitchen/` — the kitchen board, router and timers.
  - `tests/office/engine.test.tsx` — the register engine (value formatting per column kind, lifecycle tabs, Register / Master / Editor pages).
  - `tests/scripts/` — `check-guards`, `check-contrast`, `check-unbounded-queries` and `compare-screens` themselves, and `iikoReadOnly.test.ts` (GET only, allowlists).
- **`npm run guards`** (`scripts/check-guards.mjs`) — static checks for the plan's hard rules. Backend: a public `query`/`mutation`/`action` without an auth helper and not in `scripts/guards/public-allowlist.json` (`be/public-without-auth`), `throw new Error(` instead of `ConvexError` (`be/throw-error`), `v.any()` in public args (`be/any-arg`), an office function taking a restaurant argument without a scope helper (`be/office-without-restaurant-scope`). Frontend (`frontend/app/**/*.tsx`, print forms excepted): hex/`rgb()` colors, `bg-white`-style literals, Tailwind palette classes, text under 12px, `font-extrabold`/`font-black`, `uppercase`, `(api as any)`, `outline-none` without a `focus-visible:` style. It's a ratchet against `scripts/guards/baseline.json`, which is **now empty (`{}`)** — any violation fails; `--update-baseline` rewrites it.
- **`npm run contrast`** (`scripts/check-contrast.mjs`) — WCAG contrast of the day/night tokens in `theme.css`, including the status surfaces and the active chip (frontend workflow).
- **`npm run lint:convex`** (`scripts/check-unbounded-queries.mjs`) — no full-table scans or unbounded `take` in `convex/` (W1-PLT-09, backend workflow).

**End-to-end (local only).** Playwright (`playwright.config.ts`, specs in `e2e/`) starts its own Vite dev server on port 5198 against the dev Convex deployment and uses the installed Chrome. Every spec runs in 8 projects: 4 surfaces (`pos-1280`, `pos-1440`, `office-1440`, `kitchen-1920`) × day/night. `e2e/smoke/` — a cash sale from terminal through the hall grid («Зал · N открыто» → «Без стола») to the kitchen (`pos-sale.spec.ts`, needs `E2E_POS_TERMINAL`/`E2E_POS_CODE`/`E2E_POS_PIN` from `npm run seed:e2e`, skipped otherwise), the kitchen board (`kitchen-board.spec.ts`) and every office section opening (via `/dev/office`); `e2e/fixtures.ts` waits for each login pad before typing, since the POS route is a lazy chunk; `e2e/a11y/axe.spec.ts` — no serious/critical axe violations on the screens reachable without signing in; `e2e/regressions/` — dialog-close click-through; `e2e/screens/` — screenshots to `reference/app-screenshots/W0/<surface>/<name>-<theme>.png` (only with `npm run e2e:screens`, which then runs `scripts/compare-screens.mjs` to build the bahandi-vs-sandyq parity page `reference/app-screenshots/W0/compare.html`). `npm run seed:e2e` (`scripts/seed-e2e.mjs`) refuses anything but a `dev:` deployment and has no prod override. `bash scripts/e2e-pos.sh` does it all in one go: `seed:e2e`, loads `.sandyq-seed/e2e.env` (the PIN is never printed) and runs `npx playwright test` with any extra arguments. **e2e is not a CI job yet.**

## Known gaps and deferred work

Real gaps, not oversights — each was a deliberate call given what data actually exists. Owner-side open items (keys, accountant questions, prod launch) are in `TODO.md`.

- ~~No recipes/BOM~~ — W1-RCP: checkout consumes stock by recipe. What is still thin is the data: recipes come from iiko charts and the technologist's CSV, and **iiko modifiers (~140) are not projected**, so chart lines that use them are skipped.
- ~~No loyalty redemption~~ — W1-LOY-03: a partial redemption is planned on the POS and applied at checkout.
- ~~`transfer` exists but nothing exercises it~~ — «Перенести на кассу» in the order actions calls it.
- ~~`iikoEntityOverlays` unused~~ — the product card and «Показать блюда iiko с ценой» write overlays.
- ~~No line-level deletion with a reason~~ — `voidLine`.
- ~~No stored Z-report~~ — fixed in W1-POS-08: `shifts.close` writes a `zReports` row.
- **Fiscalization is unresolved.** Every `xReports`/`zReports` row is `nonFiscal: true` by design — this is a non-fiscal pilot running alongside iiko, not a registered-cash-register replacement, until that's explicitly confirmed with the business (see the BRD).
- **Blind count leaks sideways.** The server hides the expected cash from a cashier, but it can still be inferred from the shift's order history or by probing `shifts.close` (the variance-note error appears only when counted ≠ expected).
- **Kazakh coverage.** The POS interface is RU/KK; the kitchen screen and the office are Russian only, `categories` have no `nameKk` (category chips stay Russian in KK), server error messages are Russian, and the Kazakh texts in `frontend/app/pos/i18n/kk.ts` await a native speaker's review.
- **Guest count is not printed** — `orders.guestCount` is saved and shown in the office, but not in the check or pre-check header.
- **iiko recipe edits apply to every branch** — editing an iiko chart in the office saves one version for all branches, although iiko lines can differ by department.
- **Kitchen tickets written before M-7** still get their restaurant through `ticketRestaurantId`.
- **«План счетов» has no office screen yet** — the accounts live in `convex/lib/accounts.ts`; every other office section works.
- **e2e isn't in CI** — Playwright runs locally only (see [Quality gates](#quality-gates)); screenshot parity exists for W0 only.
