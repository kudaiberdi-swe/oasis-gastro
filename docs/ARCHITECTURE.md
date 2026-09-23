# Architecture — Sandyq

This is the technical reference for the implemented system — every table, every API function, every cross-domain side effect, both deployments. For the product framing and open business questions, see [BRD.md](BRD.md). For the iiko side specifically, see [iiko-connection-runbook.md](iiko-connection-runbook.md).

This document describes what's actually built, not a plan. Where something is intentionally deferred or incomplete, it's called out explicitly rather than omitted — see [Known gaps and deferred work](#known-gaps-and-deferred-work) at the end.

## Stack

- **Backend**: Convex (queries/mutations/actions, realtime subscriptions, its own document database with indexes and search indexes). No separate API server.
- **Frontend**: React 19 + Vite 8 + Tailwind 4, hand-rolled routing (no router library — `pathname` + `pushState`/`popstate`, see `App.tsx`).
- **Auth**: two independent systems on purpose — POS PIN sessions (custom) and office email/password (`@convex-dev/auth`). See [Two application surfaces, two auth models](#two-application-surfaces-two-auth-models).
- **External integration**: iiko Server API (XML/REST), read-only, for the chain's real branch/employee data.

## Two application surfaces, two auth models

| | `/pos` | `/office` |
|---|---|---|
| Who | Cashiers, managers, on a physical terminal | Administrators, on any device |
| Auth | 4–12 digit PIN → `posSessions` row, `sha256(token)` stored, never the raw token | Email + password via Convex Auth (`authTables`) → `officeUsers` row links the account to a role |
| Session lifetime | 12h operator / 5min single-use manager-approval (`lib/policy.ts`) | Convex Auth's own session handling |
| Identity table | `employees` (`code` + PIN hash) | `officeUsers` (`email`) + `officeRoles` (capability strings) |

These are deliberately never merged. A POS PIN never grants office access and vice versa — an `employees` row and an `officeUsers` row for the same real person are two separate, unlinked records. The one bridge between them is one-directional: `domains/workforce/mutations.ts:provisionPosAccess` lets an office user turn a real (`iikoEmployees`-mirrored) person into a POS login, generating the code+PIN locally — iiko never supplies a credential, and no office identity is created from that action.

Office capability strings are `"*"` (full access) or `"office.<module>.*"` (all six modules currently gate at module granularity — `office.catalog.*`, `office.stock.*`, `office.finance.*`, `office.workforce.*`, `office.loyalty.*`, `office.reports.*`; see `lib/officeAccess.ts:allowsCapability` for the matching rule, which also accepts an exact leaf like `office.catalog.view` if that granularity is ever needed). `domains/office/mutations.ts:bootstrap` is the only way to create the first `officeRoles`/`officeUsers` rows — it's gated on an exact match against the `OFFICE_BOOTSTRAP_EMAIL` deployment env var, set once via `npx convex env set` (never in code, never in the dashboard by convention — see [Environments](#environments)).

## Backend structure

```
convex/
  schema.ts              single source of truth for every table
  auth.ts / auth.config.ts / http.ts    Convex Auth wiring (office only)
  crons.ts                              hourly posSessions cleanup
  lib/                                  shared, no business-domain ownership
    auth.ts             PIN hashing (PBKDF2-SHA256/120k/256-bit), requireOperator,
                        requireManagerApproval, session helpers — POS side
    officeAccess.ts     getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit — office side
    audit.ts            writeAudit — POS-side auditEvents helper (paired with officeAccess's
                        writeOfficeAudit for the office side)
    finance.ts           postLedgerEntry — called directly from orders/stock mutations
    loyalty.ts           normalizePhone, findOrCreateGuest, accrueLoyaltyPoints
    restaurants.ts       listOperationalRestaurants — see note below
    money.ts             integer-tenge rounding, service-charge/total/cash-reconciliation math
    time.ts               almatyBusinessDate (fixed UTC+5 offset, no DST)
    policy.ts             every tunable business constant (see table below)
    validators.ts         shared v.* unions/objects
  domains/
    auth/        actions.ts (login, "use node")  internal.ts  mutations.ts  queries.ts
    catalog/     queries.ts  mutations.ts  types.ts
    orders/      queries.ts  mutations.ts  types.ts
    shifts/      queries.ts  mutations.ts
    kitchen/     queries.ts  mutations.ts
    office/      queries.ts  mutations.ts            (office auth/bootstrap only)
    stock/       queries.ts  mutations.ts
    finance/     queries.ts  mutations.ts
    workforce/   queries.ts  mutations.ts
    loyalty/     queries.ts  mutations.ts
    reports/     queries.ts                          (read-only — no mutations)
    iiko/        queries.ts  mutations.ts             (read-only sync, see below)
    seed/        mutations.ts                         (internal — scripts/seed-sandyq.mjs)
```

**Domain-first, not layer-first** (locked decision from the original planning pass): a business concept owns one folder with its own `queries.ts`/`mutations.ts`, rather than one giant `queries.ts` for the whole app. A domain's mutations *are allowed* to write directly into another domain's tables when that's the natural side effect of an event — `orders/mutations.ts:checkout` posts into `ledgerEntries` (finance's table) and `guests`/`loyaltyTransactions` (loyalty's tables) in the same transaction, rather than routing through a separate finance/loyalty mutation call. This keeps money-and-points events atomic with the event that caused them. See [How mutations talk across domains](#how-mutations-talk-across-domains-real-side-effects).

**`lib/restaurants.ts:listOperationalRestaurants`** is worth calling out specifically: Phase 3's iiko import writes its own `restaurants` row per iiko department (see [iiko integration](#iiko-integration)), so a city that already has a seeded, terminal-bound restaurant ends up with **two** rows sharing a city but not an `externalId`. A cashier can only ever be assigned to the seeded one (it's the only one with a `posTerminals` row), so every office-facing restaurant list goes through this helper, which filters to restaurants that actually have an active terminal. `domains/workforce/queries.ts` additionally resolves an iiko department code to the *operational* restaurant by city-name match when the two diverge (see the `CITY_ALIASES` table there) — without that, the "assign to branch" checkbox in the office Кадры screen would silently fail to pre-check anything for Алматы/Шымкент/Түркістан candidates.

## Database schema

All tables live in `convex/schema.ts`. Grouped by domain below; every table's real fields, not a summary — this is the part meant to save someone a `Read` of the file.

### Office identity

- **`officeRoles`** `{externalId, name, capabilities: string[], system}` — `capabilities` is `["*"]` or a list of `"office.<module>.*"` strings.
- **`officeUsers`** `{externalId, email, name, roleExternalId, restaurantScopes: string[], active}` — `restaurantScopes` is `restaurants.externalId[]` or `["*"]`.
- Convex Auth's own tables (`authTables` spread into the schema — accounts, sessions, users, etc.) back the email/password login itself.

### Identity & org (POS)

- **`organizations`** `{externalId, name, currency, timezone, active, sourceSystem?, sourceHash?, importedAt?}` — `sourceSystem: "iiko-server"` marks a row written by the iiko sync.
- **`restaurants`** `{externalId, organizationExternalId, name, address, timezone, city?, currency?, active, sourceSystem?, sourceHash?, importedAt?}`.
- **`posTerminals`** `{externalId, restaurantId, name, terminalNumber, nextOrderNumber, active}` — `nextOrderNumber` is the human-facing order-number source, incremented on every new draft.
- **`employees`** `{code, displayName, role: cashier|manager|administrator, restaurantIds: Id<restaurants>[], terminalIds?, pinSalt, pinHash, active, failedAttempts, lockedUntil?, iikoEmployeeExternalId?}` — the last field is set only when this login was created via `provisionPosAccess`.
- **`posSessions`** `{tokenHash, purpose: operator|manager-approval, employeeId, terminalId, createdAt, lastActivityAt, expiresAt, revokedAt?}` — the raw session token is never stored, only its SHA-256.

### Catalog

- **`categories`** `{externalId, label, shortLabel, sortOrder, active?}`.
- **`products`** `{externalId, name, nameKk, nameSort, searchText, description, category, categorySort, basePrice, popular, badge?, sku, baseUnit, enabled}` — bilingual (`name` Russian primary, `nameKk` Kazakh secondary); `basePrice` is the fallback when no `productPrices` row matches the requesting restaurant.
- **`productPrices`** `{productId, restaurantExternalId, priceKzt}` — per-branch price override. Sandyq's real menu prices genuinely differ by city for the same dish.

### Orders & checkout

- **`orders`** — the big one: `{number, orderType: dine-in|takeaway, tableLabel?, status, discountPercent, discountReason?, discountApprovedBy?, subtotal, serviceChargePercent, serviceChargeAmount, serviceChargeWaived?, total, paymentMethod?, checkoutIdempotencyKey?, clientOrderId?, restaurantId?, terminalId?, originatingShiftId?, currentShiftId?, createdBy?, updatedBy?, comment?, guestId?, version?, createdAt, updatedAt?, heldAt?, paidAt?, cancelledAt?, searchText}`. `status` is `draft|held|paid|cancelled|partially_refunded|refunded`. **No single-draft-per-terminal constraint** — Sandyq is full-service, several tables stay open at once, each its own `orders` row keyed by `tableLabel`. `version` is the optimistic-concurrency field every content-editing mutation bumps (see [invariants](#invariants-that-matter)).
- **`orderLines`** `{orderId, clientLineId?, productId, productExternalId?, productName, quantity, unitPrice, sizeLabel?, modifiers: string[]}` — `modifiers` is free-text kitchen notes; there's no modifier catalog (deferred, see Known gaps).
- **`orderDeletionEvents`** `{orderId, orderLineId?, deletionReasonName, writeOff, comment, actorId, managerId?, createdAt}` — defined but not currently written by any mutation (reserved for a future "remove a line with a reason" flow).

### Shifts & money

- **`shifts`** `{restaurantId, terminalId, number, businessDate, status: open|closed, openedBy, openedAt, openingCash, openingNote, expectedCash?, countedCash?, variance?, closeNote?, closedBy?, closedAt?, managerApprovedBy?, zReportNumber?}`.
- **`shiftEvents`** `{shiftId, type, amount, reason, actorId, orderId?, idempotencyKey?, createdAt}` — `type` is `open|cash-in|cash-out|order-paid|order-transfer-out|order-transfer-in|refund|manager-override|close`. This is the shift's own audit/reconstruction log; `shifts/queries.ts:calculateSummary` replays it (plus `payments`) to compute expected cash.
- **`xReports`** — an immutable snapshot every time `createXReport` or `close` runs (`nonFiscal: true` on every row — see the fiscalization note in the BRD). Full shape: `{reportVersion, idempotencyKey, reportNumber, sequence, shiftId, shiftNumber, terminalId, terminalName, terminalNumber, restaurantId, restaurantName, restaurantAddress, businessDate, openedAt, generatedAt, openedByName, generatedByName, generatedByRole, openingCash, catalogGrossSales, discounts, serviceCharge, sales, refunds, netSales, averageCheck, expectedCash, payments: {cash|card|qr: {sales, refunds, net, saleCount, refundCount}}, cashMovements: {cashIn, cashOut, cashInCount, cashOutCount}, orderCounts: {paid, partiallyRefunded, refunded, cancelled, draft, held, discounted}, openOrders: {count, total}, heldOrders: {count, total}, cancelledAmount, saleOrderCount, refundOrderCount, nonFiscal}`.
- **`payments`** `{orderId, shiftId, type: sale|refund, method: cash|card|qr, amount, tendered?, change?, idempotencyKey, status: "recorded", createdBy, createdAt}` — immutable, idempotency-keyed; a refund is a new row with `type: "refund"`, never an edit to the original.

### Kitchen

- **`kitchenTickets`** `{orderId, orderNumber, status: queued|preparing|ready|completed, fulfillment, source: "pos", createdAt, updatedAt}`.
- **`kitchenTicketLines`** `{ticketId, productExternalId, productName, quantity, instructions: string[]}`.

### Audit

- **`auditEvents`** `{actorKey, action, summary, resourceType, resourceExternalId, organizationExternalId, restaurantExternalId?, occurredAt, terminalId?, actorId?, shiftId?, orderId?, managerId?}` — one shared table for both POS (`lib/audit.ts:writeAudit`) and office (`lib/officeAccess.ts:writeOfficeAudit`) actions. `restaurantExternalId` is optional specifically because office actions like a catalog edit aren't scoped to one branch.

### Loyalty (Phase 4)

- **`guests`** `{phone (normalized digits), name?, points, createdAt}` — never imported from iiko; created only when a cashier attaches a phone number to an order, or an office user does a manual adjustment on an unrecognized phone.
- **`loyaltyTransactions`** `{guestId, kind: accrual|redemption|adjustment, points (signed), orderId?, reason? (required for adjustment), balanceAfter, actorEmail? (office adjustments only), occurredAt}`.

### Finance (Phase 4)

- **`ledgerEntries`** `{restaurantExternalId, businessDate, occurredAt, kind: revenue|expense, category (free text), amount (always positive — kind carries the sign), sourceModuleId: orders|stock|manual, sourceExternalId, description, createdByEmail? (manual only), createdAt}` — a flat P&L, not double-entry; see [How mutations talk across domains](#how-mutations-talk-across-domains-real-side-effects) for what posts into it and when.

### iiko sync mirror (Phase 3 — read-only)

- **`iikoImportRuns`** `{runExternalId, status: running|completed|failed, startedAt, completedAt?, counts?, error?}`.
- **`iikoEndpointStates`** `{endpointKey, lastStatus, lastRunAt, message?}`.
- **`iikoDepartments`** `{externalId, parentExternalId?, code?, name, type ("DEPARTMENT"|"JURPERSON"|…), sourceHash, importedAt}` — allowlisted fields only.
- **`iikoEmployees`** `{externalId, code?, displayName, mainRoleCode?, departmentCodes: string[], active, sourceHash, importedAt}` — **never carries phone/email/IIN/login** — those keys are never even read out of the source response (see `scripts/iiko/lib.mjs:sanitizeRecord`'s allowlist, not a blocklist).
- **`iikoMirrorRecords`** `{mirrorKey, endpointKey, recordExternalId, payloadHash, importedAt}` — lets a re-import detect "nothing changed" without touching canonical tables.
- **`iikoEntityOverlays`** `{overlayKey, entityType, sourceExternalId, data}` — reserved for local edits layered on an iiko entity that a re-import shouldn't clobber. Schema exists; not populated by any current mutation except `domains/iiko/mutations.ts:saveOverlay`, which nothing calls yet.

### Stock (Phase 4)

- **`inventoryItems`** `{externalId, name, nameSort, searchText, unit, minimumStock?, active}`.
- **`stockBalances`** `{restaurantExternalId, inventoryItemId, quantity, averageUnitCost, updatedAt}` — denormalized cache; `stockMovements` is the source of truth.
- **`stockMovements`** `{restaurantExternalId, inventoryItemId, kind: receipt|writeoff|adjustment, quantityDelta (signed), unitCost, balanceAfter, averageUnitCostAfter, reason? (required for writeoff/adjustment), actorEmail, occurredAt}`.

No `warehouses` table — stock is keyed directly by `restaurants.externalId` because Sandyq runs one stockroom per branch today. No recipes/BOM either — see [Known gaps](#known-gaps-and-deferred-work).

## Complete API surface

Every exported `query`/`mutation`/`action` by domain. "Office" or "POS" in the Auth column means `requireOfficeCapability`/`requireOperator` respectively; "internal" means it's not callable from a client at all (internal-only, or a plain exported function other mutations call directly).

### `domains/auth` — POS sign-in

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `actions.login` | action (`"use node"`) | none (this *is* login) | Verifies code+PIN (PBKDF2-SHA256/120k), returns a session token |
| `internal.getLoginRecord` | internal query | — | Looks up the employee by code, for the login action |
| `internal.recordFailedAttempt` | internal mutation | — | Increments `failedAttempts`, locks after `LOCKOUT_THRESHOLD` |
| `internal.createSession` | internal mutation | — | Inserts the `posSessions` row after a successful PIN check |
| `internal.cleanupExpiredSessions` | internal mutation | — | Hourly cron (`crons.ts`) |
| `queries.current` | query | POS | Current session's employee/terminal/restaurant |
| `mutations.logout` | mutation | POS | Revokes the current session |
| `mutations.lock` | mutation | POS | Idle-lock — revokes without a full logout |
| `mutations.revoke` | mutation | POS | Revoke a specific session (used for manager-approval cleanup) |

### `domains/catalog`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listCategories` | query | POS (implicit) | Active categories, sorted |
| `queries.listProducts` | query | POS | Paginated, searchable, price resolved per restaurant |
| `queries.getProduct` | query | POS | One product with resolved price |
| `queries.listAllForOffice` | query | office `catalog.*` | Every category/product regardless of active/enabled, with all per-branch prices attached |
| `queries.resolveProductPrice` / `resolveProductPrices` | plain functions | — | Shared price-resolution logic (also used by `orders/mutations.ts`) |
| `mutations.createCategory` / `updateCategory` | mutation | office `catalog.*` | |
| `mutations.createProduct` / `updateProduct` | mutation | office `catalog.*` | |
| `mutations.setProductPrice` | mutation | office `catalog.*` | Upserts a `productPrices` row, checked against the caller's `restaurantScopes` |

### `domains/orders`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listOpenChecks` | query | POS | Every draft/held order at this terminal (parallel tables) |
| `queries.getCheck` | query | POS | One hydrated order (lines + payments) |
| `queries.list` | query | POS | Paginated order history, searchable |
| `queries.hydrateOrder` | plain function | — | Shared order→lines/payments hydration |
| `mutations.saveDraft` | mutation | POS | Create-or-update a draft/held order; OCC via `expectedVersion`; re-prices every line server-side |
| `mutations.hold` / `resume` | mutation | POS | Park a check / bring it back to draft |
| `mutations.cancel` | mutation | POS | Requires manager approval |
| `mutations.checkout` | mutation | POS | Records payment(s), marks paid, posts revenue to `ledgerEntries`, accrues loyalty points — see [side effects](#how-mutations-talk-across-domains-real-side-effects) |
| `mutations.refund` | mutation | POS | Manager approval required; enforces original payment method; posts an expense ledger entry |
| `mutations.transfer` | mutation | POS | Moves a held order to a different terminal's shift. **Implemented, not wired to any POS UI button yet** |

### `domains/shifts`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.current` | query | POS | Open shift + live summary |
| `queries.closePreview` | query | POS | What closing now would look like (expected cash, blockers) |
| `queries.history` | query | POS | Paginated past shifts |
| `queries.calculateSummary` / `buildClosePreview` / `buildXReportSnapshot` | plain functions | — | Shared math, replayed from `payments`/`shiftEvents`/`orders` |
| `mutations.open` | mutation | POS | One open shift per terminal |
| `mutations.recordCashMovement` | mutation | POS | Cash-in (free) / cash-out (manager approval required) |
| `mutations.close` | mutation | POS | Blocked while any draft/held order remains; manager approval if `\|variance\| ≥ VARIANCE_APPROVAL_KZT` |
| `mutations.createXReport` | mutation | POS | Manager approval required for a cashier; idempotent replay by key; doesn't close the shift |

### `domains/kitchen`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.board` | query | POS | Open tickets, gated on `requireOperator` (in the reference this was office-gated — Phase 1 has no office auth dependency for the POS-side kitchen display, so it's operator-gated instead) |
| `mutations.setStatus` | mutation | POS | Advances a ticket's status |

### `domains/office` — bootstrap only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.context` | query | any signed-in office account | `{ready, user, capabilities, restaurants}` — drives the office shell's gating |
| `mutations.bootstrap` | mutation | exact `OFFICE_BOOTSTRAP_EMAIL` match | One-shot: creates the `administrator` role (`["*"]`) and links the caller's email to it, scoped to every operational restaurant. Idempotent — safe to re-run |

### `domains/stock`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listInventoryForOffice` | query | office `stock.*` | Items + balances across every operational branch |
| `queries.listRecentMovements` | query | office `stock.*` | Flat audit log across all items/branches |
| `mutations.createInventoryItem` | mutation | office `stock.*` | |
| `mutations.receiveStock` | mutation | office `stock.*` | Updates weighted-average cost; posts a "Закупка сырья" expense to `ledgerEntries` |
| `mutations.writeOffStock` | mutation | office `stock.*` | Requires a reason; blocked if it would go negative |
| `mutations.adjustStock` | mutation | office `stock.*` | Sets an exact quantity (inventory count correction); doesn't touch average cost |

### `domains/finance`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.summary` | query | office `finance.*` | Revenue/expense/net + by-category breakdown, filterable by branch/date range |
| `queries.listEntries` | query | office `finance.*` | Filterable ledger entry list |
| `queries.restaurantsForFilter` | query | office `finance.*` | Operational restaurants, for the filter dropdown |
| `mutations.recordExpense` | mutation | office `finance.*` | Manual ledger expense (rent, utilities, payroll — anything with no other source table) |
| `mutations.backfillFromPayments` | internal mutation | — | One-off: posts ledger entries for `payments`/stock receipts that predate the ledger. Idempotent by `(sourceModuleId, sourceExternalId)`. Already run once against dev |

### `domains/workforce`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listBranches` | query | office `workforce.*` | Operational restaurants |
| `queries.listPosEmployees` | query | office `workforce.*` | Every `employees` row, with resolved branch names; **never returns `pinSalt`/`pinHash`** |
| `queries.listUnprovisioned` | query | office `workforce.*` | Active `iikoEmployees` not yet linked to a POS login, each with its resolved branch (see the `listOperationalRestaurants` note above) |
| `queries.suggestCredentials` | query | office `workforce.*` | Fresh random 6-digit code (checked for uniqueness) + 4-digit PIN, for prefilling the provision/reset-PIN forms |
| `mutations.provisionPosAccess` | mutation | office `workforce.*` | Bridges an `iikoEmployees` row to a real `employees` login; code+PIN always chosen and hashed locally |
| `mutations.setEmployeeActive` | mutation | office `workforce.*` | Toggle active; reactivating also clears `failedAttempts`/`lockedUntil` |
| `mutations.updateEmployeeAssignment` | mutation | office `workforce.*` | Change role/branches, scope-checked against the caller |
| `mutations.resetPin` | mutation | office `workforce.*` | Regenerates salt+hash for an existing login |

### `domains/loyalty`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.getOrderGuest` | query | POS | The guest currently attached to an order, if any |
| `queries.findGuestByPhone` | query | POS | Live lookup while a cashier types a phone number |
| `queries.listGuests` | query | office `loyalty.*` | Searchable guest directory |
| `queries.guestHistory` | query | office `loyalty.*` | One guest's `loyaltyTransactions` |
| `mutations.attachGuestToOrder` | mutation | POS | Find-or-create by phone; **deliberately doesn't bump `orders.version`** (see the comment in the file — it's not a content edit, and bumping it desyncs the POS draft hook's cached version) |
| `mutations.detachGuestFromOrder` | mutation | POS | Same non-bump rule |
| `mutations.adjustPoints` | mutation | office `loyalty.*` | Manual +/- correction with a required reason; blocked if it would go negative |

### `domains/reports` — read-only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.restaurantsForFilter` | query | office `reports.*` | |
| `queries.salesSummary` | query | office `reports.*` | Revenue/order-count/average-check + by-date, top-products, by-payment-method, filterable — goes to line-item detail the finance P&L can't answer |
| `queries.listShiftReports` | query | office `reports.*` | Browsable `xReports` history with full detail (this data existed since Phase 1 but had no office-side viewer until Phase 4) |

### `domains/iiko` — read-only sync internals

Called by `scripts/iiko/*.mjs` via `npx convex run`, not by any UI.

| Function | Kind | Purpose |
|---|---|---|
| `mutations.beginRun` / `completeRun` / `failRun` | internal mutation | `iikoImportRuns` lifecycle |
| `mutations.recordEndpointState` | internal mutation | `iikoEndpointStates` per-endpoint health |
| `mutations.upsertDepartment` / `upsertEmployee` | internal mutation | Single-record upsert (thin wrappers) |
| `mutations.importBatch` | internal mutation | Batched upsert — the script uses this instead of one `convex run` per record to stay under Convex's per-mutation operation budget |
| `mutations.saveOverlay` | mutation | Writes an `iikoEntityOverlays` row. Nothing calls this yet |
| `queries.importRun` | query | One run's status |
| `queries.endpointStates` | query | All endpoints' last-known health |
| `queries.mirrorCounts` | query | `{departments, employees}` counts, used by `scripts/iiko/reconcile.mjs` |

### `domains/seed` — internal, dev-time only

| Function | Kind | Purpose |
|---|---|---|
| `mutations.seedAll` | internal mutation | Idempotent upsert of org/restaurants/terminals/categories/products/prices/employees from `scripts/seed-sandyq.mjs`'s parsed payload |

## How mutations talk across domains: real side effects

These aren't documented anywhere else as a single list — this is exactly the kind of thing that's easy to lose track of:

1. **`orders/mutations.ts:checkout`** → after marking the order paid:
   - `lib/finance.ts:postLedgerEntry` — `kind: "revenue"`, category `"Продажи"`, `amount: order.total`.
   - `lib/loyalty.ts:accrueLoyaltyPoints` — if `order.guestId` is set, `floor(order.total / LOYALTY_ACCRUAL_PER_TENGE)` points, no-ops otherwise.
2. **`orders/mutations.ts:refund`** → `postLedgerEntry` with `kind: "expense"`, category `"Возврат"`.
3. **`stock/mutations.ts:receiveStock`** → `postLedgerEntry` with `kind: "expense"`, category `"Закупка сырья"`, `amount: quantity × unitCost`.
4. **`loyalty/mutations.ts:attachGuestToOrder` / `detachGuestFromOrder`** → patch `orders.guestId` directly, **without** bumping `orders.version` (see the table row above for why — this is a documented exception to invariant #2 below).

Nothing auto-consumes `stockBalances` on checkout — there's no recipe/BOM data to drive it (see [Known gaps](#known-gaps-and-deferred-work)).

## Invariants that matter

Don't simplify these away without understanding why they're there:

1. **Idempotency everywhere money moves.** `checkout`/`refund`/`recordCashMovement`/`createXReport` all take a caller-supplied `idempotencyKey` and short-circuit on replay — a network retry must never double-charge or double-post.
2. **Optimistic concurrency on order content.** Every mutation that edits an order's lines/discount/table bumps `orders.version`; `saveDraft` rejects a stale `expectedVersion` with "Заказ изменён на другой кассе". This is what two cashiers editing the same table's order at once actually collide against — see the [check-switching bug](#a-fixed-bug-worth-understanding) below for what happens when a client's cached version drifts from the server's for an unrelated reason.
3. **Manager approval is single-use by construction.** A `posSessions` row with `purpose: "manager-approval"` is revoked the instant `requireManagerApproval` validates it (`lib/auth.ts`) — reusing a token would silently turn a one-time approval into a standing one. Gated actions: discount >`DISCOUNT_APPROVAL_PERCENT`, service-charge waiver, cancel, refund, transfer, every cash-out, shift close with `|variance| ≥ VARIANCE_APPROVAL_KZT`, and an X-report generated by a `cashier` (not required for `manager`/`administrator`).
4. **Session tokens are never stored raw** — only `sha256(token)`, on both the POS (`posSessions.tokenHash`) and (via Convex Auth) the office side.
5. **PIN hashing**: PBKDF2-SHA256, 120,000 iterations, 256-bit output, salted per employee, constant-time comparison (`lib/auth.ts`). The same helpers back both `provisionPosAccess` and `resetPin` so a PIN set either way verifies identically.

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

## Frontend structure

Role-first, not layer-first — mirrors the backend's domain-first choice at the top level:

```
src/
  main.tsx        ConvexAuthProvider → ThemeProvider → App
  App.tsx          routes /office vs everything-else (POS) by pathname
  pos/
    router.tsx → PosWorkspace
    components/      app-header, order-panel, product-card, pin-pad — presentational
    features/<name>/{data,model,ui}
      session/       PIN login, idle-lock, manager-approval dialog
      catalog/        product browsing
      order-taking/   pos-workspace.tsx (the main screen), useOrderDraft (the cart hook),
                      open-checks-list, discount-dialog
      checkout/       payment-dialog, receipt formatting
      shifts/         open/close/X-report dialog
      kitchen-display/
      loyalty/        guest-dialog — attach/detach a guest during order-taking
  office/
    router.tsx        auth-gates → sign-in / bootstrap / shell
    components/        office-layout.tsx — sidebar nav across all six modules
    features/<name>/{data,ui}   catalog, stock, finance, workforce, loyalty, reports
  shared/
    components/ui/     button, dialog, badge, scroll-area (Radix-based)
    components/theme-provider.tsx
    lib/                cn, formatTenge, errorMessage, almaty-time
    styles/{theme.css,index.css}   Sandyq brand tokens (see .claude/sandyq-design.skill),
                                    bridged into Tailwind 4 via @theme inline
```

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
  endpoint-registry.mjs   the only two endpoints ever called: corporation/departments, employees
  extract.mjs             --discover-only maps the API surface (application.wadl) without
                          pulling data; otherwise fetches, filters, sanitizes, stages to
                          .iiko-cache/<run>/staging.jsonl
  import-convex.mjs       reads the staged file, chunks into batches of 50 (Convex's
                          per-mutation operation budget), calls domains/iiko/mutations
  reconcile.mjs           compares staged vs mirrored counts, exits non-zero on mismatch
  seed.mjs                orchestrates extract → import → reconcile
```

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

**Production is infrastructure-ready, not live.** `scripts/seed-sandyq.mjs --prod` is a deliberate, explicit override of the script's default dev-only guard — and as its own hard safety rail, it never generates employee PIN credentials, only catalog/org data. Nobody can sign into `/pos` or `/office` on prod until PINs are provisioned (via the office Кадры screen) and the office is bootstrapped — both need an explicit go-ahead, not an assumption. Every prod deploy key used to set this up was minted one-off (`npx convex deployment token create … --deployment prod`), used inline as `CONVEX_DEPLOY_KEY`, and revoked immediately after (`deployment token delete`) — never leave a standing prod credential around.

Frontend is hosted on an Azure Static Web App (`sandyq-frontend`, resource group `sandyq-prod`) at `https://thankful-moss-04c3d4a0f.4.azurestaticapps.net` — see [README § Environments](../README.md#environments) for the per-branch POS/office links and the CI/CD workflows that deploy it. `VITE_CONVEX_URL` is baked in at build time pointing at `https://clear-flamingo-97.convex.cloud`, and prod's `SITE_URL` (used by Convex Auth) now points at the real Static Web App hostname above.

## Testing

- **`convex/posFlows.test.ts`** (`convex-test`, backend, no DOM) — the core POS flow: two parallel table checks with independent service-charge math, checkout, shift close; a stale-`expectedVersion` rejection; loyalty accrual on checkout; refund method enforcement + ledger posting; X-report manager-approval + idempotent replay.
- **`src/pos/features/order-taking/model/use-order-draft.test.ts`** (`@testing-library/react` + jsdom) — the check-selection-sync regression suite described above.

Run both with `npm run test`. No component/UI tests beyond that — everything else in this project was verified by hand in the browser during development (see commit messages for what was actually clicked through).

## Known gaps and deferred work

Real gaps, not oversights — each was a deliberate call given what data actually exists:

- **No recipes/BOM.** The seeded menu has no ingredient data, so checkout doesn't auto-consume `stockBalances` — stock receipts and write-offs are entered by office staff by hand. Adding recipes is the natural next step once that data exists (from the business or from a future iiko products/technical-cards sync).
- **No loyalty redemption.** Points only accrue. Spending them at checkout would change the payment-total math the same way a discount does, and deserves the same manager-approval treatment `saveDraft`'s discount path already has — not something to bolt on casually.
- **`orders/mutations.ts:transfer` exists and is tested-by-nothing-but-itself** — implemented (move a held order to another terminal's shift, manager-approved) but no POS UI button calls it yet.
- **`iikoEntityOverlays` and `domains/iiko/mutations.ts:saveOverlay`** exist in the schema/API but nothing writes to them — reserved for a future "office edits a field on an iiko-imported entity without a re-import clobbering it" flow.
- **`orderDeletionEvents`** table exists, nothing writes to it yet — reserved for a "remove a line item with a reason" flow distinct from cancelling the whole order.
- **Fiscalization is unresolved.** Every `xReports` row is `nonFiscal: true` by design — this is a non-fiscal pilot running alongside iiko, not a registered-cash-register replacement, until that's explicitly confirmed with the business (see the BRD).
- **Bare root URL has no branch picker.** `/` without `?terminal=<externalId>` throws an unhandled error (blank screen) — the POS has no way to guess which of the three branches to load. Each branch needs its own direct link (see [README § Environments](../README.md#environments)) until a picker screen is built.
