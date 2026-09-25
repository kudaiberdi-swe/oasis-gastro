# Architecture — Sandyq

This is the technical reference for the implemented system — every table, every API function, every cross-domain side effect, both deployments. For the product framing and open business questions, see [BRD.md](BRD.md). For the iiko side specifically, see [iiko-connection-runbook.md](iiko-connection-runbook.md).

This document describes what's actually built, not a plan. Where something is intentionally deferred or incomplete, it's called out explicitly rather than omitted — see [Known gaps and deferred work](#known-gaps-and-deferred-work) at the end.

## Stack

- **Backend**: Convex (queries/mutations/actions, realtime subscriptions, its own document database with indexes and search indexes). No separate API server.
- **Frontend**: React 19 + Vite 8 + Tailwind 4, `react-router` 7 data router (`createBrowserRouter` in `src/App.tsx:5`, route table in `src/shared/routing/routes.tsx:30-38`). See [Frontend structure](#frontend-structure).
- **Auth**: two independent systems on purpose — POS PIN sessions (custom) and office email/password (`@convex-dev/auth`). See [Two application surfaces, two auth models](#two-application-surfaces-two-auth-models).
- **External integration**: iiko Server API (XML/REST), read-only, for the chain's real branch/employee data.

## Two application surfaces, two auth models

| | `/pos` | `/office` |
|---|---|---|
| Who | Cashiers, managers, on a physical terminal | Administrators, on any device |
| Auth | Employee code + 4–6 digit PIN (`lib/policy.ts:29-34` `PIN_MIN`/`PIN_MAX`/`isValidPin`) → `posSessions` row, `sha256(token)` stored, never the raw token | Email + password via Convex Auth (`authTables`) → `officeUsers` row links the account to a role |
| Session lifetime | 12h operator / 5min single-use manager-approval (`lib/policy.ts`) | Convex Auth's own session handling |
| Identity table | `employees` (`code` + PIN hash) | `officeUsers` (`email`) + `officeRoles` (capability strings) |

These are deliberately never merged. A POS PIN never grants office access and vice versa — an `employees` row and an `officeUsers` row for the same real person are two separate, unlinked records. The one bridge between them is one-directional: `domains/workforce/mutations.ts:provisionPosAccess` lets an office user turn a real (`iikoEmployees`-mirrored) person into a POS login, generating the code+PIN locally — iiko never supplies a credential, and no office identity is created from that action.

Office capability strings are `"*"` (full access) or `"office.<module>.*"` (all six modules currently gate at module granularity — `office.catalog.*`, `office.stock.*`, `office.finance.*`, `office.workforce.*`, `office.loyalty.*`, `office.reports.*`; see `lib/officeAccess.ts:21` `allowsCapability` for the matching rule, which also accepts an exact leaf like `office.catalog.view`). The office sidebar uses exactly such leaves: every navigation item carries a capability, `office.<module>.view` for the six sections that have a backend module and `office.<item-id>.view` for the rest (`src/office/model/navigation.ts:17-19`, `:40-46`), so a module-level `office.catalog.*` role unlocks the matching item. `domains/office/mutations.ts:17` `bootstrap` is the only way to create the first `officeRoles`/`officeUsers` rows — it's gated on an exact match against the `OFFICE_BOOTSTRAP_EMAIL` deployment env var, set once via `npx convex env set` (never in code, never in the dashboard by convention — see [Environments](#environments)).

**Office restaurant scoping.** `officeUsers.restaurantScopes` is enforced server-side by the helpers in `lib/officeAccess.ts`, not by the UI:

- `requireRestaurantScope` (`:40`) — a mutation touching one restaurant (stock, finance, workforce branch assignment) throws «Нет доступа к ресторану» outside scope. `catalog.setProductPrice` does the same check inline (`catalog/mutations.ts:98`).
- `restaurantScopeFilter(user, requested?)` (`:53-60`) — the predicate every per-restaurant office query filters rows through (stock, finance, reports, workforce branch lists). A requested restaurant outside scope throws; rows with no restaurant are visible only with network scope (`"*"`).
- `requireNetworkScope(user, role)` (`:67-70`) — network-level data (the guest base: `loyalty/queries.ts:34,46`, `loyalty/mutations.ts:50`) needs `restaurantScopes: ["*"]` or a `"*"` role.
- `requireEmployeeInScope` (`:73-79`) — a workforce change on an existing POS login (`setEmployeeActive`, `updateEmployeeAssignment`, `resetPin`, re-provisioning) needs at least one of the employee's restaurants in scope.

`scripts/check-guards.mjs:86-90` flags any office function that takes a `restaurantExternalId`/`restaurantId` argument without one of these helpers. Tested in `tests/convex/officeScope.test.ts`.

## Backend structure

```
convex/
  schema.ts              single source of truth for every table
  auth.ts / auth.config.ts / http.ts    Convex Auth wiring (office only)
  crons.ts                              hourly posSessions cleanup
  lib/                                  shared, no business-domain ownership
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
    catalog/     queries.ts  mutations.ts  types.ts
    orders/      queries.ts  mutations.ts  types.ts
    shifts/      queries.ts  mutations.ts
    kitchen/     access.ts (ticketRestaurantId)  queries.ts  mutations.ts
    office/      queries.ts  mutations.ts            (office auth/bootstrap only)
    stock/       queries.ts  mutations.ts
    finance/     queries.ts  mutations.ts
    workforce/   queries.ts  mutations.ts
    loyalty/     queries.ts  mutations.ts
    reports/     queries.ts                          (read-only — no mutations)
    iiko/        internal.ts  mutations.ts            (read-only sync, all internal — see below)
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
- **`orderDeletionEvents`** `{orderId, orderLineId?, deletionReasonName, writeOff, comment, actorId, managerId?, createdAt}` — written by `orders/mutations.ts:228` `cancel` (`:241-249`): one row per cancelled order, `deletionReasonName: "Отмена заказа"`, `writeOff: false`, the cashier's reason as `comment`, the approving manager as `managerId`. `orderLineId` is never set yet — there's no "remove one line with a reason" flow.

### Shifts & money

- **`shifts`** `{restaurantId, terminalId, number, businessDate, status: open|closed, openedBy, openedAt, openingCash, openingNote, expectedCash?, countedCash?, variance?, closeNote?, closedBy?, closedAt?, managerApprovedBy?, zReportNumber?}`.
- **`shiftEvents`** `{shiftId, type, amount, reason, actorId, orderId?, idempotencyKey?, createdAt}` — `type` is `open|cash-in|cash-out|order-paid|order-transfer-out|order-transfer-in|refund|manager-override|close`. This is the shift's own audit/reconstruction log; `shifts/queries.ts:calculateSummary` replays it (plus `payments`) to compute expected cash.
- **`xReports`** — an immutable snapshot, inserted only by `shifts/mutations.ts:123` `createXReport` (`:167`). `close` stamps `zReportNumber` (`Z-<date>-<terminal>-<shift>`) and the cash totals on the `shifts` row and, in the same transaction, inserts an immutable **`zReports`** row (W1-POS-08: number, shift, restaurant, terminal, counted cash, variance and the same totals snapshot as an X-report, `nonFiscal: true`); `shifts.queries.getZReport` reads it and `history` links it. Every `xReports` row is `nonFiscal: true` (see the fiscalization note in the BRD). Full shape: `{reportVersion, idempotencyKey, reportNumber, sequence, shiftId, shiftNumber, terminalId, terminalName, terminalNumber, restaurantId, restaurantName, restaurantAddress, businessDate, openedAt, generatedAt, openedByName, generatedByName, generatedByRole, openingCash, catalogGrossSales, discounts, serviceCharge, sales, refunds, netSales, averageCheck, expectedCash, payments: {cash|card|qr: {sales, refunds, net, saleCount, refundCount}}, cashMovements: {cashIn, cashOut, cashInCount, cashOutCount}, orderCounts: {paid, partiallyRefunded, refunded, cancelled, draft, held, discounted}, openOrders: {count, total}, heldOrders: {count, total}, cancelledAmount, saleOrderCount, refundOrderCount, nonFiscal}`.
- **`payments`** `{orderId, shiftId, type: sale|refund, method: cash|card|qr, amount, tendered?, change?, idempotencyKey, status: "recorded", createdBy, createdAt}` — immutable, idempotency-keyed; a refund is a new row with `type: "refund"`, never an edit to the original.

### Kitchen

- **`kitchenTickets`** `{orderId, orderNumber, status: queued|preparing|ready|completed, fulfillment, source: "pos", createdAt, updatedAt}` — created by `checkout` (`orders/mutations.ts:61-83`, called at `:303`). There's no `restaurantId` column yet: a ticket's restaurant is derived from its order (`order.restaurantId`, falling back to the order terminal's restaurant) by `domains/kitchen/access.ts:8` `ticketRestaurantId`.
- **`kitchenTicketLines`** `{ticketId, productExternalId, productName, quantity, instructions: string[]}`.

### Audit

- **`auditEvents`** `{actorKey, action, summary, resourceType, resourceExternalId, organizationExternalId, restaurantExternalId?, occurredAt, terminalId?, actorId?, shiftId?, orderId?, managerId?}` — one shared table for both POS (`lib/audit.ts:writeAudit`) and office (`lib/officeAccess.ts:writeOfficeAudit`) actions. `restaurantExternalId` is optional specifically because office actions like a catalog edit aren't scoped to one branch.

### Loyalty (Phase 4)

- **`guests`** `{phone (normalized digits), name?, points, createdAt}` — never imported from iiko; created only when a cashier attaches a phone number to an order, or an office user does a manual adjustment on an unrecognized phone.
- **`loyaltyTransactions`** `{guestId, kind: accrual|redemption|adjustment|reversal, points (signed), orderId?, reason? (required for adjustment), balanceAfter, actorEmail? (office adjustments only), paymentId? (reversal: the refund payment), shortfall? (reversal: points owed back but already spent), occurredAt}`. `redemption` is in the union but nothing writes it (see Known gaps).

### Finance (Phase 4)

- **`ledgerEntries`** `{restaurantExternalId, businessDate, occurredAt, kind: revenue|expense, category (free text), amount (always positive — kind carries the sign), sourceModuleId: orders|stock|manual, sourceExternalId, description, createdByEmail? (manual only), createdAt}` — a flat P&L, not double-entry; see [How mutations talk across domains](#how-mutations-talk-across-domains-real-side-effects) for what posts into it and when.

### iiko sync mirror (Phase 3 — read-only)

- **`iikoImportRuns`** `{runExternalId, status: running|completed|failed, startedAt, completedAt?, counts?, error?}`.
- **`iikoEndpointStates`** `{endpointKey, lastStatus, lastRunAt, message?}`.
- **`iikoDepartments`** `{externalId, parentExternalId?, code?, name, type ("DEPARTMENT"|"JURPERSON"|…), sourceHash, importedAt}` — allowlisted fields only.
- **`iikoEmployees`** `{externalId, code?, displayName, mainRoleCode?, departmentCodes: string[], active, sourceHash, importedAt}` — **never carries phone/email/IIN/login** — those keys are never even read out of the source response (see `scripts/iiko/lib.mjs:sanitizeRecord`'s allowlist, not a blocklist).
- **`iikoMirrorRecords`** `{mirrorKey, endpointKey, recordExternalId, payloadHash, importedAt}` — lets a re-import detect "nothing changed" without touching canonical tables.
- **`iikoEntityOverlays`** `{overlayKey, entityType, sourceExternalId, data}` — reserved for local edits layered on an iiko entity that a re-import shouldn't clobber. Schema exists; not populated by any current mutation except the internal `domains/iiko/internal.ts:32` `saveOverlay`, which nothing calls yet.

### Stock (Phase 4)

- **`inventoryItems`** `{externalId, name, nameSort, searchText, unit, minimumStock?, active}`.
- **`stockBalances`** `{restaurantExternalId, inventoryItemId, quantity, averageUnitCost, updatedAt}` — denormalized cache; `stockMovements` is the source of truth.
- **`stockMovements`** `{restaurantExternalId, inventoryItemId, kind: receipt|writeoff|adjustment, quantityDelta (signed), unitCost, balanceAfter, averageUnitCostAfter, reason? (required for writeoff/adjustment), actorEmail, occurredAt}`.

No `warehouses` table — stock is keyed directly by `restaurants.externalId` because Sandyq runs one stockroom per branch today. No recipes/BOM either — see [Known gaps](#known-gaps-and-deferred-work).

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
| `mutations.cancel` | mutation | POS | Draft/held only; reason ≥ 3 chars; requires manager approval; writes an `orderDeletionEvents` row |
| `mutations.checkout` | mutation | POS | Records payment(s), creates the kitchen ticket, marks paid, posts revenue to `ledgerEntries`, accrues loyalty points — see [side effects](#how-mutations-talk-across-domains-real-side-effects) |
| `mutations.refund` | mutation | POS | Manager approval required; enforces original payment method; posts an expense ledger entry; reverses loyalty points proportionally |
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
| `mutations.close` | mutation | POS | Blocked while any draft/held order remains; note required on any variance; manager approval if `\|variance\| ≥ VARIANCE_APPROVAL_KZT`; stamps `zReportNumber` on the shift and writes the `zReports` row |
| `mutations.createXReport` | mutation | POS | Manager approval required for a cashier; idempotent replay by key; doesn't close the shift |

### `domains/kitchen`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.board` | query | POS | Not-completed tickets **of the session's restaurant only** (`queries.ts:21-22`, via `ticketRestaurantId`), gated on `requireOperator` (in the reference this was office-gated — the POS-side kitchen display has no office auth dependency, so it's operator-gated instead) |
| `mutations.setStatus` | mutation | POS | Advances a ticket one step (`queued → preparing → ready → completed`); another restaurant's ticket is reported as «Тикет не найден» (`mutations.ts:21`); writes a `kitchen.status` audit event |

### `domains/office` — bootstrap only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.context` | query | any signed-in office account | `{email, ready, canBootstrap, user, capabilities, restaurants, organization}` (`queries.ts:12-38`) — drives the office shell's gating. `restaurants` is filtered to the user's scope; `canBootstrap` is true only for a not-yet-ready account whose email equals `OFFICE_BOOTSTRAP_EMAIL` (`:31`) — everyone else gets the "no access" screen; `organization` (`{name, timezone, currency}`, `:35`) feeds the sidebar footer |
| `mutations.bootstrap` | mutation | exact `OFFICE_BOOTSTRAP_EMAIL` match | One-shot: creates the `administrator` role (`["*"]`) and links the caller's email to it with `restaurantScopes: ["*"]` (`mutations.ts:38` — network-wide, including branches added later). Requires at least one operational restaurant. Idempotent — safe to re-run |

### `domains/stock`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.listInventoryForOffice` | query | office `stock.*` | Items + balances across the caller's in-scope branches (`restaurantScopeFilter`) |
| `queries.listRecentMovements` | query | office `stock.*` | Flat audit log across all items, in-scope branches only |
| `mutations.createInventoryItem` | mutation | office `stock.*` | |
| `mutations.receiveStock` | mutation | office `stock.*` | Updates weighted-average cost; posts a "Закупка сырья" expense to `ledgerEntries` |
| `mutations.writeOffStock` | mutation | office `stock.*` | Requires a reason; blocked if it would go negative |
| `mutations.adjustStock` | mutation | office `stock.*` | Sets an exact quantity (inventory count correction); doesn't touch average cost |

### `domains/finance`

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.summary` | query | office `finance.*` | Revenue/expense/net + by-category breakdown, filterable by branch/date range; scope-filtered |
| `queries.listEntries` | query | office `finance.*` | Filterable ledger entry list; scope-filtered |
| `queries.restaurantsForFilter` | query | office `finance.*` | In-scope operational restaurants, for the filter dropdown |
| `mutations.recordExpense` | mutation | office `finance.*` | Manual ledger expense (rent, utilities, payroll — anything with no other source table) |
| `mutations.backfillFromPayments` | internal mutation | — | One-off: posts ledger entries for `payments`/stock receipts that predate the ledger. Sale payments are summed **per order** into one revenue entry keyed by the order id — the same key live `checkout` uses, so split payments are neither dropped nor double-posted; refunds post one expense per refund payment. Idempotent by `(sourceModuleId, sourceExternalId)`. Already run once against dev |

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
| `mutations.resetPin` | mutation | office `workforce.*` | Regenerates salt+hash for an existing login; same PIN rule (`mutations.ts:119`); `requireEmployeeInScope` |

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

### `domains/reports` — read-only

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `queries.restaurantsForFilter` | query | office `reports.*` | In-scope operational restaurants |
| `queries.salesSummary` | query | office `reports.*` | `{revenue, grossSales, refunds, orderCount, averageCheck, byDate, topProducts, byPaymentMethod}` from `payments` in the date range; `revenue` and the by-date/by-method figures are **net of refunds** (`queries.ts:53`, `:82`); scope-filtered — goes to line-item detail the finance P&L can't answer |
| `queries.listShiftReports` | query | office `reports.*` | Browsable `xReports` history with full detail, scope-filtered (this data existed since Phase 1 but had no office-side viewer until Phase 4) |

### `domains/iiko` — read-only sync internals

Called by `scripts/iiko/*.mjs` via `npx convex run`, not by any UI. **Every function here is internal** — none is callable from a client (the office iiko screen will get its own capability-gated queries later, see the comment at `internal.ts:5-6`).

| Function | Kind | Purpose |
|---|---|---|
| `mutations.beginRun` / `completeRun` / `failRun` | internal mutation | `iikoImportRuns` lifecycle |
| `mutations.recordEndpointState` | internal mutation | `iikoEndpointStates` per-endpoint health |
| `mutations.upsertDepartment` / `upsertEmployee` | internal mutation | Single-record upsert (thin wrappers) |
| `mutations.importBatch` | internal mutation | Batched upsert — the script uses this instead of one `convex run` per record to stay under Convex's per-mutation operation budget |
| `internal.saveOverlay` | internal mutation | Writes an `iikoEntityOverlays` row (`internal.ts:32`; `data` is still `v.any()`). Nothing calls this yet |
| `internal.importRun` | internal query | One run's status |
| `internal.endpointStates` | internal query | All endpoints' last-known health |
| `internal.mirrorCounts` | internal query | `{departments, employees}` counts, used by `scripts/iiko/reconcile.mjs:25` |

### `domains/seed` — internal, dev-time only

| Function | Kind | Purpose |
|---|---|---|
| `mutations.seedAll` | internal mutation | Idempotent upsert of org/restaurants/terminals/categories/products/prices/employees from `scripts/seed-sandyq.mjs`'s parsed payload |

## How mutations talk across domains: real side effects

These aren't documented anywhere else as a single list — this is exactly the kind of thing that's easy to lose track of:

1. **`orders/mutations.ts:254` `checkout`** → in the same transaction as the `payments` rows:
   - `ensurePosKitchenTicket` (`:303`) — inserts the `kitchenTickets` row + one `kitchenTicketLines` row per order line (idempotent: an existing ticket for the order is reused).
   - a `shiftEvents` row `type: "order-paid"` (`:313`).
   - `lib/finance.ts:postLedgerEntry` (`:314`) — `kind: "revenue"`, category `"Продажи"`, `amount: order.total`, `sourceExternalId` = the order id.
   - `lib/loyalty.ts:accrueLoyaltyPoints` (`:324`) — if `order.guestId` is set, `floor(order.total / LOYALTY_ACCRUAL_PER_TENGE)` points, no-ops otherwise.
2. **`orders/mutations.ts:331` `refund`** → a `shiftEvents` row `type: "refund"`, `postLedgerEntry` with `kind: "expense"`, category `"Возврат"`, `sourceExternalId` = the refund payment id (`:380`), then `lib/loyalty.ts:48` `reverseLoyaltyPoints` (`:390`): takes back the accrued points in proportion to the refunded share, computed cumulatively (target minus already reversed) so a series of partial refunds adds up to exactly what was accrued. The guest balance never goes below 0 — points already spent are recorded as `shortfall` on the `reversal` row, which also carries the refund `paymentId`. A replayed refund (same idempotency key) returns before any of this runs.
3. **`orders/mutations.ts:228` `cancel`** → an `orderDeletionEvents` row (`:241`) alongside the `order.cancel` audit event.
4. **`stock/mutations.ts:40` `receiveStock`** → `postLedgerEntry` with `kind: "expense"`, category `"Закупка сырья"`, `amount: quantity × unitCost`.
5. **`loyalty/mutations.ts:attachGuestToOrder` / `detachGuestFromOrder`** → patch `orders.guestId` directly, **without** bumping `orders.version` (see the table row above for why — this is a documented exception to invariant #2 below).

Nothing auto-consumes `stockBalances` on checkout — there's no recipe/BOM data to drive it (see [Known gaps](#known-gaps-and-deferred-work)).

## Invariants that matter

Don't simplify these away without understanding why they're there:

1. **Idempotency everywhere money moves.** `checkout`/`refund`/`recordCashMovement`/`createXReport` all take a caller-supplied `idempotencyKey` and short-circuit on replay — a network retry must never double-charge or double-post.
2. **Optimistic concurrency on order content.** Every mutation that edits an order's lines/discount/table bumps `orders.version`; `saveDraft` rejects a stale `expectedVersion` with "Заказ изменён на другой кассе". This is what two cashiers editing the same table's order at once actually collide against — see the [check-switching bug](#a-fixed-bug-worth-understanding) below for what happens when a client's cached version drifts from the server's for an unrelated reason.
3. **Manager approval is single-use by construction.** A `posSessions` row with `purpose: "manager-approval"` is revoked the instant `requireManagerApproval` validates it (`lib/auth.ts`) — reusing a token would silently turn a one-time approval into a standing one. Gated actions: discount >`DISCOUNT_APPROVAL_PERCENT`, service-charge waiver, cancel, refund, transfer, every cash-out, shift close with `|variance| ≥ VARIANCE_APPROVAL_KZT`, and an X-report generated by a `cashier` (not required for `manager`/`administrator`).
4. **Session tokens are never stored raw** — only `sha256(token)`, on both the POS (`posSessions.tokenHash`) and (via Convex Auth) the office side.
5. **PIN hashing**: PBKDF2-SHA256, 120,000 iterations, 256-bit output, salted per employee, constant-time comparison (`lib/auth.ts`). The same helpers back both `provisionPosAccess` and `resetPin` so a PIN set either way verifies identically. One length rule everywhere: `lib/policy.ts:32` `isValidPin` (4–6 digits) is checked at login (`domains/auth/actions.ts:27`) and whenever a PIN is issued or reset (`domains/workforce/mutations.ts:39`, `:119`).

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
| `PIN_MIN` / `PIN_MAX` | 4 / 6 | POS PIN length in digits; `isValidPin(pin)` is the single check (`:29-34`) |

## Frontend structure

Role-first, not layer-first — mirrors the backend's domain-first choice at the top level:

```
src/
  main.tsx        fonts (self-hosted @fontsource Golos Text + Cormorant) → ConvexAuthProvider
                  → ThemeProvider → ToastProvider → App
  App.tsx          createBrowserRouter(appRoutes) + RouterProvider
  pos/
    router.tsx → PosWorkspace
    components/      app-header, order-panel, product-card — presentational
    features/<name>/{data,model,ui}
      session/       terminal-picker (+ data/use-terminal-options), login-screen (code → PIN,
                     also the locked screen), manager-approval-dialog, model/use-pos-session
                     (terminal choice, session, idle lock)
      catalog/        product browsing: catalog-panel (toolbar, chips, sort, favorites, «Последние»), model/catalog-view
      order-taking/   pos-workspace.tsx (the main screen + the picker/login gate), useOrderDraft
                      (the cart hook), checks-switcher («Стол ▾» in the order panel), discount-dialog
      checkout/       payment-dialog, receipt formatting
      shifts/         open/close/X-report dialog
      loyalty/        guest-dialog — attach/detach a guest during order-taking
  kitchen/
    router.tsx        /kitchen (and the /pos/kitchen redirect): terminal → PIN (reuses pos/features/session
                      components) → full-screen board; model/use-kitchen-session (own storage keys, no idle lock)
    features/board/   ui/{kitchen-board,ticket-card,station-filter,completed-journal},
                      data/use-kitchen-board (also embedded by the POS «Экран кухни» button),
                      model/{timer (thresholds config),ticket,sound,use-vanishing}
  office/
    router.tsx        auth gate: sign-in → (not ready) bootstrap or "no access" → shell + section
    model/            navigation.ts (12 groups / 91 items), nav-filter.ts (capability filter,
                      search), capabilities.ts (client mirror of allowsCapability)
    components/        office-shell, sidebar, can, state-page, right-panel, unsaved-changes,
                      period-locked-banner
    hooks/ data/       use-unsaved-changes; use-office-navigation (expanded groups, collapsed sidebar)
    engine/            register engine — module-config, define-module-api, register-page,
                      master-page (+ SettingsPage), editor-page, domain-form, format-value,
                      mock-module-api, reference-configs
    features/<name>/{data,ui}   session, catalog, stock, finance, workforce, loyalty, reports
  dev/                 ui-showcase, office-showcase, engine-showcase — dev-only routes
  shared/
    routing/           routes.tsx (the route table), not-found.tsx
    components/ui/     the primitive library, exported from index.ts (see below)
    components/theme-provider.tsx   day/night mode + density on <html data-theme / data-density>
    hooks/             use-breakpoint (office breakpoints)
    lib/                format.ts, status-dictionary.ts, cn/focusRingClass (utils.ts),
                        errorMessage, almaty-time
    styles/{theme.css,index.css}   design tokens, bridged into Tailwind 4 (see below)
```

**Routes** (`src/shared/routing/routes.tsx:30-38`): `/` redirects to `/pos`, keeping the query string so `?terminal=` survives (`RootRedirect`, `:10-14`); `/pos`; `/kitchen` (placeholder, `src/kitchen/router.tsx`); `/office` redirects to `/office/nomenclature` (`DEFAULT_OFFICE_DESTINATION`, `src/office/model/navigation.ts:251`); `/office/:section/:id?`; `*` → `NotFound`. The office section lives in the URL, so deep links and reloads keep it; old section ids (`catalog`, `finance`, `workforce`, `loyalty`) redirect to their new ids (`LEGACY_OFFICE_SECTIONS`, `navigation.ts:254`). Dev-only routes `/dev/ui`, `/dev/office/:section?`, `/dev/engine/:module?/:id?` exist only when `import.meta.env.DEV` is true (`routes.tsx:16-27`) — the dynamic imports are dropped from production builds; Playwright uses them for screenshots. The Azure Static Web App rewrites every unknown path to `index.html` (`staticwebapp.config.json`), so client routes work on reload.

**POS entry: terminal picker → login → lock.** `PosWorkspace` (`src/pos/features/order-taking/ui/pos-workspace.tsx:29-56`) gates the cashier screen:

1. **Which terminal.** `use-pos-session.ts:20-34` resolves it in order: `?terminal=<externalId>` (also remembered), then `localStorage["sandyq-pos-terminal"]`, then the build-time `VITE_POS_TERMINAL_ID`. With none, the `TerminalPicker` is shown — branch select, then terminal cards — fed by the public query `domains/auth/queries:posTerminalOptions` (`src/pos/features/session/data/use-terminal-options.ts`). A remembered terminal that is no longer offered (disabled or removed) shows the picker again instead of failing at login.
2. **Login.** `LoginScreen` takes the employee code, then the PIN (4–6 digits, from the on-screen `PinPad` or the physical keyboard; Enter submits). The caption «Sandyq · <филиал> · <касса>» comes from the terminal options, not a constant. «Сменить рабочее место» clears the choice (and drops `?terminal=` from the URL).
3. **Lock.** After `IDLE_LOCK_MS_CLIENT` (5 min, `use-pos-session.ts:105`) without interaction the client calls `auth.mutations.lock` and the same `LoginScreen` renders in `locked` mode («Касса заблокирована»).

The session itself is kept in `sessionStorage`, so it doesn't outlive the tab.

**Office shell** (`src/office/`). `OfficeRouter` (`router.tsx:34-85`) goes sign-in → `office.context` → bootstrap (only when `canBootstrap`) or `OfficeAccessDenied` → `OfficeShell`. The shell is a dark 264px sidebar (72px with tooltips/flyouts when collapsed, automatic below 1280px) with the 12 groups / 91 items of `navigation.ts` — the same ids and order as bahandi-pos — filtered by the user's capabilities (hidden, not disabled; empty groups disappear) and searchable. Six sections have a working screen (`WORKSPACES`, `router.tsx:25-32`: `nomenclature`, `stock`, `transactions`, `employees`, `guests`, `reports`); every other item renders a "Раздел в разработке" page (ЕГАИС says it isn't used in Kazakhstan), and the `pos` / `kitchen-board` items link out to `/pos` and `/kitchen` (`OFFICE_LINKS`, `navigation.ts:249`). A section the user has no right to shows the `denied` state. Building blocks: `Can`/`useCan` (`components/can.tsx` — hides an action without the right; the server checks again), `OfficeStatePage` (loading / empty / error / denied, `state-page.tsx`), `RightPanel` (440px master-detail panel, beside the list at ≥1440px, overlay below), `useUnsavedChanges` + `UnsavedChangesDialog` + `SaveStatus` (browser prompt on reload, blocked router navigation), `PeriodLockedBanner` (contract only — no period-close domain yet).

**Register engine** (`src/office/engine/`). Config-driven office pages for the modules still to come: a `ModuleConfig` declares lifecycle (`master` / `publish` / `approval` / `document` → the status tabs), typed columns (`ValueKind`: money, hours, qty, percent, status, … — each column has its own kind and unit), KPIs, form fields and document lines; `defineModuleApi` adapts Convex list/get/save/transition functions (paginated, `PAGE_SIZE = 50`) to the engine, `createMockModuleApi` is the in-memory equivalent. Pages: `RegisterPage` (tabs, search, "Показать ещё"), `MasterPage`/`SettingsPage` (master-detail), `EditorPage` (document editor; posted documents are read-only with «Сторно»), `DomainForm`. **No production office section uses the engine yet** — it's exercised by the two reference configs (`reference-configs.ts`: Статьи ДДС, Проводки, both on the mock adapter) at `/dev/engine` and by `tests/office/engine.test.tsx`.

**Design tokens.** `src/shared/styles/theme.css` is the only file with raw color values: `:root, [data-theme="day"]` and `[data-theme="night"]` (`:85`) define semantic tokens (`--background`, `--card`, `--primary`, `--accent`, `--nav`, status colors, …) from the sandyqgroup.com palette (decision D2, `docs/POS-DESIGN.md` §2); the design-skill palette stays available as `[data-palette="skill"]`. `index.css` maps them into Tailwind with `@theme inline`, defines the type scale (`text-caption` 12px … `text-hero` 44px) in `@theme`, and binds Tailwind's `dark:` variant to the app's night theme rather than the OS (`@custom-variant dark`, `index.css:6`). `ThemeProvider` writes `data-theme` / `data-density` on `<html>` and remembers them in `localStorage` (`sandyq-pos-theme`, `sandyq-pos-density`). `npm run contrast` (`scripts/check-contrast.mjs`) checks every text pair ≥ 4.5:1 and borders/focus ring ≥ 3:1 in both themes.

**Primitives** (`src/shared/components/ui`, one barrel `index.ts`): Button, Input, Field, Textarea, MoneyInput, NumericCodeInput, Select, Combobox, Checkbox, Switch, RadioGroup (radio cards), SegmentedControl, Tabs/FilterTabs, Chip, Dialog, ConfirmDialog, Banner, Toast, Breadcrumb, PageHeader, EmptyState, KpiCard, Money, Ornament, Skeleton, StatusPill/TonePill, DataTable, PinPad, ScrollArea. The showcase is `/dev/ui`. Two shared libraries replace ad-hoc formatting: `src/shared/lib/format.ts` (`formatTenge`, `formatAmount`, `formatQuantity`, `formatHours`, `formatPercent` — thin-space digit groups, real minus sign, no tiyn; components don't call `toLocaleString`/`Intl` directly) and `src/shared/lib/status-dictionary.ts` (`STATUS_DICTIONARY` + `describeStatus`: every backend status shown through `StatusPill` with a Russian label and a tone, per domain — document, order, kitchen, shift, courier, call, job).

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
                          per-mutation operation budget), calls domains/iiko/mutations:
                          beginRun / importBatch / completeRun (all internal)
  reconcile.mjs           compares staged vs mirrored counts (domains/iiko/internal:mirrorCounts),
                          exits non-zero on mismatch
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

Frontend is hosted on an Azure Static Web App (`sandyq-frontend`, resource group `sandyq-prod`) at `https://thankful-moss-04c3d4a0f.4.azurestaticapps.net` — see [README § Environments](../README.md#environments) for the per-branch POS/office links and [README § CI/CD](../README.md#cicd) for the workflows that deploy it. `VITE_CONVEX_URL` is baked in at build time pointing at `https://clear-flamingo-97.convex.cloud`, and prod's `SITE_URL` (used by Convex Auth) now points at the real Static Web App hostname above.

## Quality gates

Four local checks, all run by CI's `verify` job before any deploy (see [README § CI/CD](../README.md#cicd)):

- **`npm run typecheck`** — `tsc -b` (frontend + tests via `tsconfig.test.json`) and `tsc -p convex`.
- **`npm test`** — vitest over `tests/**/*.test.{ts,tsx,mjs}` only (`vite.config.ts`), setup in `tests/setup.ts` (a `ResizeObserver` stub for Radix under jsdom):
  - `tests/convex/` (`convex-test`, backend, no DOM) — `posFlows.test.ts`: the core POS flow (parallel table checks with independent service-charge math, checkout, shift close, stale-`expectedVersion` rejection, loyalty accrual, refund method enforcement + ledger posting, X-report manager approval + idempotent replay), loyalty reversal on refund, reports / X-report / ledger backfill agreeing, public-function access, kitchen isolation by restaurant. `officeScope.test.ts`: a branch-scoped office user never sees or changes another branch. `posAccess.test.ts`: `posTerminalOptions` returns only active terminals and no staff fields; the 4–6 digit PIN rule.
  - `tests/pos/` (`@testing-library/react` + jsdom) — `use-order-draft.test.ts` (the check-selection-sync regression suite described above), POS dialogs, terminal picker / login / terminal caption, routes, UI primitives, `format.ts` and the status dictionary, and the office navigation, sign-in, states and workspaces.
  - `tests/office/engine.test.tsx` — the register engine (value formatting per column kind, lifecycle tabs, Register / Master / Editor pages).
  - `tests/scripts/` — `check-guards`, `check-contrast` and `compare-screens` themselves.
- **`npm run guards`** (`scripts/check-guards.mjs`) — static checks for the plan's hard rules. Backend: a public `query`/`mutation`/`action` without an auth helper and not in `scripts/guards/public-allowlist.json` (`be/public-without-auth`), `throw new Error(` instead of `ConvexError` (`be/throw-error`), `v.any()` in public args (`be/any-arg`), an office function taking a restaurant argument without a scope helper (`be/office-without-restaurant-scope`). Frontend (`src/**/*.tsx`, print forms excepted): hex/`rgb()` colors, `bg-white`-style literals, Tailwind palette classes, text under 12px, `font-extrabold`/`font-black`, `uppercase`, `(api as any)`, `outline-none` without a `focus-visible:` style. It's a ratchet against `scripts/guards/baseline.json`, which is **now empty (`{}`)** — any violation fails; `--update-baseline` rewrites it.
- **`npm run contrast`** (`scripts/check-contrast.mjs`) — WCAG contrast of the day/night tokens in `theme.css`.

**End-to-end (local only).** Playwright (`playwright.config.ts`, specs in `e2e/`) starts its own Vite dev server on port 5198 against the dev Convex deployment and uses the installed Chrome. Every spec runs in 8 projects: 4 surfaces (`pos-1280`, `pos-1440`, `office-1440`, `kitchen-1920`) × day/night. `e2e/smoke/` — a cash sale from terminal to kitchen (`pos-sale.spec.ts`, needs `E2E_POS_TERMINAL`/`E2E_POS_CODE`/`E2E_POS_PIN` from `npm run seed:e2e`, skipped otherwise) and every office section opening (via `/dev/office`); `e2e/a11y/axe.spec.ts` — no serious/critical axe violations on the screens reachable without signing in; `e2e/regressions/` — dialog-close click-through; `e2e/screens/` — screenshots to `docs/app-screenshots/W0/<surface>/<name>-<theme>.png` (only with `npm run e2e:screens`, which then runs `scripts/compare-screens.mjs` to build the bahandi-vs-sandyq parity page `docs/app-screenshots/W0/compare.html`). `npm run seed:e2e` (`scripts/seed-e2e.mjs`) refuses anything but a `dev:` deployment and has no prod override. **e2e is not a CI job yet.**

## Known gaps and deferred work

Real gaps, not oversights — each was a deliberate call given what data actually exists:

- **No recipes/BOM.** The seeded menu has no ingredient data, so checkout doesn't auto-consume `stockBalances` — stock receipts and write-offs are entered by office staff by hand. Adding recipes is the natural next step once that data exists (from the business or from a future iiko products/technical-cards sync).
- **No loyalty redemption.** Points only accrue. Spending them at checkout would change the payment-total math the same way a discount does, and deserves the same manager-approval treatment `saveDraft`'s discount path already has — not something to bolt on casually.
- **`orders/mutations.ts:396` `transfer` exists but nothing exercises it** — implemented (move a held order to another terminal's shift, manager-approved), but no POS UI button calls it and no test covers it.
- **`iikoEntityOverlays` and the internal `domains/iiko/internal.ts:32` `saveOverlay`** exist but nothing writes to them — reserved for a future "office edits a field on an iiko-imported entity without a re-import clobbering it" flow.
- **No line-level deletion with a reason.** `orderDeletionEvents` is written only for a whole-order `cancel`; `orderLineId` is never set, because there's no "remove one line with a reason / write-off" flow yet.
- **Fiscalization is unresolved.** Every `xReports` row is `nonFiscal: true` by design — this is a non-fiscal pilot running alongside iiko, not a registered-cash-register replacement, until that's explicitly confirmed with the business (see the BRD).
- ~~No stored Z-report~~ — fixed in W1-POS-08: `shifts.close` writes a `zReports` row.
- **Kitchen tickets have no `restaurantId` column.** Isolation by restaurant works through `domains/kitchen/access.ts:ticketRestaurantId` (derived from the order); the board still reads the 200 oldest open tickets across all restaurants and filters in memory. `/kitchen` is a placeholder page — the kitchen board opens from the POS toolbar.
- **The register engine has no real module yet** — only the two mock-backed reference configs at `/dev/engine`. Of the 91 office navigation items, 6 have a working screen and 2 link out to `/pos`/`/kitchen`; the other 83 show a placeholder page.
- **e2e isn't in CI** — Playwright runs locally only (see [Quality gates](#quality-gates)).
