import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server"

const unit = v.union(v.literal("кг"), v.literal("л"), v.literal("шт"), v.literal("порц."))

const employeeRole = v.union(v.literal("cashier"), v.literal("manager"), v.literal("administrator"))

const orderStatus = v.union(
  v.literal("draft"),
  v.literal("held"),
  v.literal("paid"),
  v.literal("cancelled"),
  v.literal("partially_refunded"),
  v.literal("refunded"),
)

const orderType = v.union(v.literal("dine-in"), v.literal("takeaway"))

const paymentMethod = v.union(v.literal("card"), v.literal("cash"), v.literal("qr"))

const kitchenStatus = v.union(
  v.literal("queued"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("completed"),
)

export default defineSchema({
  ...authTables,

  // --- Office identity ----------------------------------------------------
  // Office sign-in (Convex Auth, email+password) is entirely separate from POS PIN
  // sessions — an authTables user only gets office access once bootstrap() or an
  // administrator links their email to an officeUsers row.

  officeRoles: defineTable({
    externalId: v.string(),
    name: v.string(),
    capabilities: v.array(v.string()), // "*" or "office.<module>.*" or "office.<module>.<action>"
    system: v.boolean(), // seeded by bootstrap(); not user-deletable
  }).index("by_external_id", ["externalId"]),

  officeUsers: defineTable({
    externalId: v.string(),
    email: v.string(),
    name: v.string(),
    roleExternalId: v.string(),
    restaurantScopes: v.array(v.string()), // restaurants.externalId[], or ["*"] for all branches
    active: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_email", ["email"]),

  // --- Identity & org ---------------------------------------------------

  organizations: defineTable({
    externalId: v.string(),
    name: v.string(),
    currency: v.string(),
    timezone: v.string(),
    active: v.boolean(),
    sourceSystem: v.optional(v.string()), // "iiko-server" when this row was created/updated by the iiko sync
    sourceHash: v.optional(v.string()),
    importedAt: v.optional(v.number()),
  }).index("by_external_id", ["externalId"]),

  restaurants: defineTable({
    externalId: v.string(),
    organizationExternalId: v.string(),
    name: v.string(),
    address: v.string(),
    timezone: v.string(),
    city: v.optional(v.string()),
    currency: v.optional(v.string()),
    active: v.boolean(),
    sourceSystem: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    importedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_active_and_name", ["active", "name"])
    .index("by_organization", ["organizationExternalId", "name"]),

  posTerminals: defineTable({
    externalId: v.string(),
    restaurantId: v.id("restaurants"),
    name: v.string(),
    terminalNumber: v.number(),
    nextOrderNumber: v.number(),
    active: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_restaurant_number", ["restaurantId", "terminalNumber"])
    .index("by_restaurant_active_and_number", ["restaurantId", "active", "terminalNumber"]),

  employees: defineTable({
    code: v.string(),
    displayName: v.string(),
    role: employeeRole,
    restaurantIds: v.array(v.id("restaurants")),
    terminalIds: v.optional(v.array(v.id("posTerminals"))),
    pinSalt: v.string(),
    pinHash: v.string(),
    active: v.boolean(),
    failedAttempts: v.number(),
    lockedUntil: v.optional(v.number()),
    // Set when this POS login was provisioned for a real iiko-imported person — the PIN itself
    // is always generated locally (see domains/workforce/mutations.ts provisionPosAccess); iiko never
    // supplies or sees a credential.
    iikoEmployeeExternalId: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_role_name", ["role", "displayName"])
    .index("by_iiko_employee_external_id", ["iikoEmployeeExternalId"]),

  posSessions: defineTable({
    tokenHash: v.string(),
    purpose: v.union(v.literal("operator"), v.literal("manager-approval")),
    employeeId: v.id("employees"),
    terminalId: v.id("posTerminals"),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_employee_created", ["employeeId", "createdAt"])
    .index("by_terminal_created", ["terminalId", "createdAt"])
    .index("by_expires_at", ["expiresAt"]),

  // --- Catalog ------------------------------------------------------------

  categories: defineTable({
    externalId: v.string(),
    label: v.string(),
    shortLabel: v.string(),
    sortOrder: v.number(),
    active: v.optional(v.boolean()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_sort_order", ["sortOrder"]),

  products: defineTable({
    externalId: v.string(),
    name: v.string(), // Russian name — primary display name
    nameKk: v.string(), // Kazakh name — secondary display name
    nameSort: v.string(),
    searchText: v.string(), // lowercased name + nameKk, for search_products
    description: v.string(),
    category: v.string(), // categories.externalId
    categorySort: v.number(),
    basePrice: v.number(), // fallback when no productPrices row matches the terminal's restaurant
    popular: v.boolean(),
    badge: v.optional(v.string()),
    sku: v.string(),
    baseUnit: unit,
    enabled: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_enabled_and_category_and_name", ["enabled", "category", "nameSort"])
    .index("by_enabled_and_name", ["enabled", "nameSort"])
    .searchIndex("search_products", {
      searchField: "searchText",
      filterFields: ["category", "popular", "enabled"],
    }),

  productPrices: defineTable({
    productId: v.id("products"),
    restaurantExternalId: v.string(),
    priceKzt: v.number(),
  })
    .index("by_product_restaurant", ["productId", "restaurantExternalId"])
    .index("by_restaurant", ["restaurantExternalId"]),

  // --- Orders ---------------------------------------------------------------

  orders: defineTable({
    number: v.number(),
    orderType,
    tableLabel: v.optional(v.string()), // e.g. "Стол 5" — Sandyq is full-service, many checks open at once
    status: orderStatus,
    discountPercent: v.number(),
    discountReason: v.optional(v.string()),
    discountApprovedBy: v.optional(v.id("employees")),
    subtotal: v.number(),
    serviceChargePercent: v.number(), // defaults to POLICY.SERVICE_CHARGE_PERCENT (15) at creation
    serviceChargeAmount: v.number(),
    serviceChargeWaived: v.optional(v.boolean()), // true only via manager approval
    total: v.number(), // subtotal - discount + serviceChargeAmount
    paymentMethod: v.optional(paymentMethod),
    checkoutIdempotencyKey: v.optional(v.string()),
    clientOrderId: v.optional(v.string()),
    restaurantId: v.optional(v.id("restaurants")),
    terminalId: v.optional(v.id("posTerminals")),
    originatingShiftId: v.optional(v.id("shifts")),
    currentShiftId: v.optional(v.id("shifts")),
    createdBy: v.optional(v.id("employees")),
    updatedBy: v.optional(v.id("employees")),
    comment: v.optional(v.string()),
    guestId: v.optional(v.id("guests")), // attached during order-taking — see domains/loyalty
    version: v.optional(v.number()), // optimistic concurrency — bumped on every write
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    heldAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    searchText: v.string(),
  })
    .index("by_number", ["number"])
    .index("by_client_order_id", ["clientOrderId"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_restaurant_created", ["restaurantId", "createdAt"])
    .index("by_terminal_created", ["terminalId", "createdAt"])
    .index("by_terminal_status_created", ["terminalId", "status", "createdAt"])
    .index("by_shift_status_created", ["currentShiftId", "status", "createdAt"])
    .searchIndex("search_orders", {
      searchField: "searchText",
      filterFields: ["status", "terminalId", "currentShiftId"],
    }),

  orderLines: defineTable({
    orderId: v.id("orders"),
    clientLineId: v.optional(v.string()),
    productId: v.id("products"),
    productExternalId: v.optional(v.string()),
    productName: v.string(),
    quantity: v.number(),
    unitPrice: v.number(),
    sizeLabel: v.optional(v.string()), // reserved for Phase 3 size scales — unused in Phase 1
    modifiers: v.array(v.string()), // free-text kitchen notes; no modifier catalog yet
  }).index("by_order", ["orderId"]),

  orderDeletionEvents: defineTable({
    orderId: v.id("orders"),
    orderLineId: v.optional(v.id("orderLines")),
    deletionReasonName: v.string(),
    writeOff: v.boolean(),
    comment: v.string(),
    actorId: v.id("employees"),
    managerId: v.optional(v.id("employees")),
    createdAt: v.number(),
  }).index("by_order", ["orderId", "createdAt"]),

  // --- Shifts & money ---------------------------------------------------------

  shifts: defineTable({
    restaurantId: v.id("restaurants"),
    terminalId: v.id("posTerminals"),
    number: v.number(),
    businessDate: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    openedBy: v.id("employees"),
    openedAt: v.number(),
    openingCash: v.number(),
    openingNote: v.string(),
    expectedCash: v.optional(v.number()),
    countedCash: v.optional(v.number()),
    variance: v.optional(v.number()),
    closeNote: v.optional(v.string()),
    closedBy: v.optional(v.id("employees")),
    closedAt: v.optional(v.number()),
    managerApprovedBy: v.optional(v.id("employees")),
    zReportNumber: v.optional(v.string()),
  })
    .index("by_terminal_status", ["terminalId", "status"])
    .index("by_terminal_opened", ["terminalId", "openedAt"])
    .index("by_restaurant_opened", ["restaurantId", "openedAt"]),

  shiftEvents: defineTable({
    shiftId: v.id("shifts"),
    type: v.union(
      v.literal("open"),
      v.literal("cash-in"),
      v.literal("cash-out"),
      v.literal("order-paid"),
      v.literal("order-transfer-out"),
      v.literal("order-transfer-in"),
      v.literal("refund"),
      v.literal("manager-override"),
      v.literal("close"),
    ),
    amount: v.number(),
    reason: v.string(),
    actorId: v.id("employees"),
    orderId: v.optional(v.id("orders")),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_shift_created", ["shiftId", "createdAt"])
    .index("by_order", ["orderId"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  xReports: defineTable({
    reportVersion: v.number(),
    idempotencyKey: v.string(),
    reportNumber: v.string(),
    sequence: v.number(),
    shiftId: v.id("shifts"),
    shiftNumber: v.number(),
    terminalId: v.id("posTerminals"),
    terminalName: v.string(),
    terminalNumber: v.number(),
    restaurantId: v.id("restaurants"),
    restaurantName: v.string(),
    restaurantAddress: v.string(),
    businessDate: v.string(),
    openedAt: v.number(),
    generatedAt: v.number(),
    openedByName: v.string(),
    generatedByName: v.string(),
    generatedByRole: employeeRole,
    openingCash: v.number(),
    catalogGrossSales: v.number(),
    discounts: v.number(),
    serviceCharge: v.number(),
    sales: v.number(),
    refunds: v.number(),
    netSales: v.number(),
    averageCheck: v.number(),
    expectedCash: v.number(),
    payments: v.object({
      cash: v.object({ sales: v.number(), refunds: v.number(), net: v.number(), saleCount: v.number(), refundCount: v.number() }),
      card: v.object({ sales: v.number(), refunds: v.number(), net: v.number(), saleCount: v.number(), refundCount: v.number() }),
      qr: v.object({ sales: v.number(), refunds: v.number(), net: v.number(), saleCount: v.number(), refundCount: v.number() }),
    }),
    cashMovements: v.object({
      cashIn: v.number(),
      cashOut: v.number(),
      cashInCount: v.number(),
      cashOutCount: v.number(),
    }),
    orderCounts: v.object({
      paid: v.number(),
      partiallyRefunded: v.number(),
      refunded: v.number(),
      cancelled: v.number(),
      draft: v.number(),
      held: v.number(),
      discounted: v.number(),
    }),
    openOrders: v.object({ count: v.number(), total: v.number() }),
    heldOrders: v.object({ count: v.number(), total: v.number() }),
    cancelledAmount: v.number(),
    saleOrderCount: v.number(),
    refundOrderCount: v.number(),
    nonFiscal: v.literal(true),
  })
    .index("by_shift_sequence", ["shiftId", "sequence"])
    .index("by_terminal_generated", ["terminalId", "generatedAt"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  payments: defineTable({
    orderId: v.id("orders"),
    shiftId: v.id("shifts"),
    type: v.union(v.literal("sale"), v.literal("refund")),
    method: paymentMethod,
    amount: v.number(),
    tendered: v.optional(v.number()),
    change: v.optional(v.number()),
    idempotencyKey: v.string(),
    status: v.literal("recorded"),
    createdBy: v.id("employees"),
    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_order_created", ["orderId", "createdAt"])
    .index("by_shift_created", ["shiftId", "createdAt"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  // --- Kitchen ------------------------------------------------------------

  kitchenTickets: defineTable({
    orderId: v.id("orders"),
    orderNumber: v.number(),
    status: kitchenStatus,
    fulfillment: orderType,
    source: v.literal("pos"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_status_created", ["status", "createdAt"]),

  kitchenTicketLines: defineTable({
    ticketId: v.id("kitchenTickets"),
    productExternalId: v.string(),
    productName: v.string(),
    quantity: v.number(),
    instructions: v.array(v.string()),
  }).index("by_ticket", ["ticketId"]),

  // --- Audit ---------------------------------------------------------------

  auditEvents: defineTable({
    actorKey: v.string(),
    action: v.string(),
    summary: v.string(),
    resourceType: v.string(),
    resourceExternalId: v.string(),
    organizationExternalId: v.string(),
    restaurantExternalId: v.optional(v.string()), // absent for office actions that aren't scoped to one branch (e.g. catalog edits)
    occurredAt: v.number(),
    terminalId: v.optional(v.id("posTerminals")),
    actorId: v.optional(v.id("employees")),
    shiftId: v.optional(v.id("shifts")),
    orderId: v.optional(v.id("orders")),
    managerId: v.optional(v.id("employees")),
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_order_created", ["orderId", "occurredAt"])
    .index("by_shift_created", ["shiftId", "occurredAt"]),

  // --- Loyalty (Phase 4) --------------------------------------------------
  // A local guest directory — never imported from iiko (iiko sync stays master-data-only, see
  // domains/iiko). A guest is identified by phone, attached to an order during order-taking, and
  // earns points on checkout (lib/loyalty.ts:accrueLoyaltyPoints). No redemption yet — see
  // lib/policy.ts:LOYALTY_ACCRUAL_PER_TENGE for why.

  guests: defineTable({
    phone: v.string(), // normalized: digits only
    name: v.optional(v.string()),
    points: v.number(), // denormalized current balance — loyaltyTransactions is the audit trail
    createdAt: v.number(),
  }).index("by_phone", ["phone"]),

  loyaltyTransactions: defineTable({
    guestId: v.id("guests"),
    kind: v.union(v.literal("accrual"), v.literal("redemption"), v.literal("adjustment"), v.literal("reversal")),
    points: v.number(), // signed: + for accrual/upward adjustment, - for redemption/downward adjustment/reversal
    orderId: v.optional(v.id("orders")),
    reason: v.optional(v.string()), // required for a manual office adjustment
    balanceAfter: v.number(),
    actorEmail: v.optional(v.string()), // office email for a manual adjustment; absent for POS-sourced accrual
    paymentId: v.optional(v.id("payments")), // reversal: the refund payment that triggered it
    shortfall: v.optional(v.number()), // reversal: points owed back but already spent (balance never goes below 0)
    occurredAt: v.number(),
  })
    .index("by_guest_occurred", ["guestId", "occurredAt"])
    .index("by_occurred_at", ["occurredAt"]),

  // --- Finance (Phase 4) -------------------------------------------------
  // A flat P&L ledger, not double-entry — Sandyq has no chart of accounts yet, so
  // `kind` (revenue/expense) plus a free-text `category` is enough to answer "how much
  // did we make/spend, on what". Revenue posts itself from orders/mutations.ts:checkout
  // (and refunds from :refund); cost of goods posts itself from stock/mutations.ts:receiveStock;
  // everything else (rent, utilities, payroll…) is entered by hand via recordExpense.
  ledgerEntries: defineTable({
    restaurantExternalId: v.string(),
    businessDate: v.string(), // Asia/Almaty "YYYY-MM-DD" — see lib/time.ts:almatyBusinessDate
    occurredAt: v.number(),
    kind: v.union(v.literal("revenue"), v.literal("expense")),
    category: v.string(),
    amount: v.number(), // always positive; `kind` carries the sign in P&L math
    sourceModuleId: v.union(v.literal("orders"), v.literal("stock"), v.literal("manual")),
    sourceExternalId: v.string(), // order/payment/stockMovement _id, or a generated id for manual entries — backfill idempotency key
    description: v.string(),
    createdByEmail: v.optional(v.string()), // office email for manual entries; absent for POS-sourced entries
    createdAt: v.number(),
  })
    .index("by_source", ["sourceModuleId", "sourceExternalId"])
    .index("by_restaurant_date", ["restaurantExternalId", "businessDate"])
    .index("by_occurred_at", ["occurredAt"]),

  // --- iiko sync (read-only mirror — Phase 3) --------------------------------
  // Master-data only: organization structure + workforce. No sales/order/document
  // history is imported — see docs/ARCHITECTURE.md and plans/README.md in the
  // reference implementation for why that stays out of scope here.

  iikoImportRuns: defineTable({
    runExternalId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    counts: v.optional(v.object({ departments: v.number(), employees: v.number() })),
    error: v.optional(v.string()),
  }).index("by_external_id", ["runExternalId"]),

  iikoEndpointStates: defineTable({
    endpointKey: v.string(),
    lastStatus: v.union(v.literal("ok"), v.literal("error"), v.literal("unsupported")),
    lastRunAt: v.number(),
    message: v.optional(v.string()),
  }).index("by_endpoint_key", ["endpointKey"]),

  // Read-only mirror of iiko's organization structure (corporation/departments).
  // Only the fields we actually allowlisted out of the source response — see
  // scripts/iiko/lib.mjs sanitizeDepartment. No PII; department/company records only.
  iikoDepartments: defineTable({
    externalId: v.string(),
    parentExternalId: v.optional(v.string()),
    code: v.optional(v.string()),
    name: v.string(),
    type: v.string(), // "DEPARTMENT" | "JURPERSON" | ...
    sourceHash: v.string(),
    importedAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  // Read-only mirror of iiko employees — allowlisted fields only (see
  // scripts/iiko/lib.mjs sanitizeEmployee). Never carries a login, phone, email,
  // IIN, or any other credential/contact PII — those keys are never even read out
  // of the source response.
  iikoEmployees: defineTable({
    externalId: v.string(),
    code: v.optional(v.string()),
    displayName: v.string(),
    mainRoleCode: v.optional(v.string()),
    departmentCodes: v.array(v.string()),
    active: v.boolean(),
    sourceHash: v.string(),
    importedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_active_and_display_name", ["active", "displayName"]),

  // Generic audit trail of every imported record, keyed by "<endpointKey>:<recordExternalId>" —
  // lets a re-import detect "nothing changed" via sourceHash without re-touching canonical tables.
  iikoMirrorRecords: defineTable({
    mirrorKey: v.string(),
    endpointKey: v.string(),
    recordExternalId: v.string(),
    payloadHash: v.string(),
    importedAt: v.number(),
  }).index("by_mirror_key", ["mirrorKey"]),

  // Sandyq-owned fields layered on top of a read-only iiko entity, so a re-import
  // never clobbers a local edit. Not deeply used yet in Phase 3 — reserved for
  // Phase 4 (e.g. a preferred display name or role override for an imported employee).
  iikoEntityOverlays: defineTable({
    overlayKey: v.string(), // "<entityType>:<sourceExternalId>"
    entityType: v.string(),
    sourceExternalId: v.string(),
    data: v.any(),
  }).index("by_overlay_key", ["overlayKey"]),

  // --- Stock (Phase 4) --------------------------------------------------------
  // Raw-material inventory, tracked per branch. No `warehouses` table — Sandyq runs one stockroom
  // per restaurant today, so stock is keyed directly by restaurants.externalId; a dedicated
  // warehouses table (bar vs. kitchen, etc.) is easy to add later without touching this shape.
  // No recipes/BOM yet either (the seeded menu has no ingredient data), so checkout doesn't
  // auto-consume stock — receipts and write-offs are entered by office staff by hand for now.

  inventoryItems: defineTable({
    externalId: v.string(),
    name: v.string(),
    nameSort: v.string(),
    searchText: v.string(),
    unit,
    minimumStock: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_active_and_name", ["active", "nameSort"])
    .searchIndex("search_inventory_items", { searchField: "searchText", filterFields: ["active"] }),

  // Denormalized current quantity + weighted-average cost per (branch, item) — avoids summing
  // the full stockMovements history on every read. stockMovements is the source of truth/audit
  // trail; this is a cache kept in sync by every mutation that touches it.
  stockBalances: defineTable({
    restaurantExternalId: v.string(),
    inventoryItemId: v.id("inventoryItems"),
    quantity: v.number(),
    averageUnitCost: v.number(),
    updatedAt: v.number(),
  })
    .index("by_restaurant_item", ["restaurantExternalId", "inventoryItemId"])
    .index("by_restaurant", ["restaurantExternalId"]),

  stockMovements: defineTable({
    restaurantExternalId: v.string(),
    inventoryItemId: v.id("inventoryItems"),
    kind: v.union(v.literal("receipt"), v.literal("writeoff"), v.literal("adjustment")),
    quantityDelta: v.number(), // positive for receipt/upward adjustment, negative for writeoff/downward adjustment
    unitCost: v.number(), // receipt: the price paid; writeoff/adjustment: the balance's averageUnitCost at the time (for COGS reporting)
    balanceAfter: v.number(),
    averageUnitCostAfter: v.number(),
    reason: v.optional(v.string()), // required for writeoff/adjustment
    actorEmail: v.string(),
    occurredAt: v.number(),
  })
    .index("by_restaurant_item_occurred", ["restaurantExternalId", "inventoryItemId", "occurredAt"])
    .index("by_occurred_at", ["occurredAt"]),
})
