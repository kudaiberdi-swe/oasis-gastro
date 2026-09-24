import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server"
import { financeModuleId, financeRecordData } from "./domains/finance/validators"
import { officeDomainStatus } from "./lib/validators"
import { retailKind, retailSettingData } from "./domains/retail/validators"

const unit = v.union(v.literal("кг"), v.literal("л"), v.literal("шт"), v.literal("порц."))

const employeeRole = v.union(v.literal("cashier"), v.literal("manager"), v.literal("administrator"), v.literal("kitchen"))

const orderStatus = v.union(
  v.literal("draft"),
  v.literal("held"),
  v.literal("paid"),
  v.literal("cancelled"),
  v.literal("partially_refunded"),
  v.literal("refunded"),
)

const orderType = v.union(v.literal("dine-in"), v.literal("takeaway"), v.literal("delivery"))

const paymentMethod = v.union(v.literal("card"), v.literal("cash"), v.literal("qr"))

const kitchenStatus = v.union(
  v.literal("queued"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("completed"),
  v.literal("cancelled"),
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
    organizationScopes: v.optional(v.array(v.string())), // W1-ACL: organizations.externalId[] or ["*"]
    warehouseScopes: v.optional(v.array(v.string())), // W1-ACL: warehouses.externalId[] or ["*"]
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
    bin: v.optional(v.string()), // Kazakhstan business identification number
    legalName: v.optional(v.string()),
    jurisdiction: v.optional(v.union(v.literal("KZ"), v.literal("RU"))),
    vatPayer: v.optional(v.boolean()), // receipts cost net of VAT only when the organization and the supplier are VAT payers
    sourceReadOnly: v.optional(v.boolean()),
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
    businessDayCutoffMinutes: v.optional(v.number()), // 0–720: sales before this time of day belong to the previous business day
    departmentExternalId: v.optional(v.string()),
    serviceMode: v.optional(v.string()),
    sourceReadOnly: v.optional(v.boolean()),
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
    sourceSystem: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    importedAt: v.optional(v.number()),
    sourceReadOnly: v.optional(v.boolean()),
    departmentExternalId: v.optional(v.string()),
    salesWarehouseId: v.optional(v.id("warehouses")), // sale write-off warehouse; else the restaurant's isSalesDefault one
    kind: v.optional(v.union(v.literal("pos"), v.literal("kds"), v.literal("office"))),
    lastLoginAt: v.optional(v.number()),
    appVersion: v.optional(v.string()),
    heartbeatUrl: v.optional(v.string()),
    version: v.optional(v.number()), // optimistic concurrency for office edits
  })
    .index("by_external_id", ["externalId"])
    .index("by_restaurant_number", ["restaurantId", "terminalNumber"])
    .index("by_restaurant_active_and_number", ["restaurantId", "active", "terminalNumber"])
    .index("by_restaurant_active_source_number", ["restaurantId", "active", "sourceSystem", "terminalNumber"]),

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
    parentExternalId: v.optional(v.string()), // W1-CAT-03 product-group hierarchy
    sourceSystem: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    importedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_sort_order", ["sortOrder"])
    .index("by_parent", ["parentExternalId", "sortOrder"]),

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
    // Catalog v2 (W1-CAT-01) — optional until migration M-1 has run on prod, then required.
    imageStorageId: v.optional(v.id("_storage")),
    imagePath: v.optional(v.string()),
    itemType: v.optional(v.union(v.literal("dish"), v.literal("good"), v.literal("preparation"))),
    prepArea: v.optional(v.string()), // hot | cold | bar | bakery …
    writeOffMethod: v.optional(v.union(v.literal("ingredients"), v.literal("finished-product"))),
    unitWeightKg: v.optional(v.number()),
    markupPercent: v.optional(v.number()),
    customizable: v.optional(v.boolean()),
    sizeScaleId: v.optional(v.id("sizeScales")),
    firstSaleAt: v.optional(v.number()),
    technology: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    sourceRevision: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    importedAt: v.optional(v.number()),
    sourceDeleted: v.optional(v.boolean()),
    sourceReadOnly: v.optional(v.boolean()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_enabled_and_category_and_name", ["enabled", "category", "nameSort"])
    .index("by_enabled_and_name", ["enabled", "nameSort"])
    .index("by_enabled_and_popular_and_name", ["enabled", "popular", "nameSort"])
    .index("by_category_name", ["category", "nameSort"])
    .index("by_price", ["basePrice"])
    .index("by_size_scale", ["sizeScaleId"])
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
    // W1-POS-01 (optional; M-2 fills historical orders): retail settings snapshot, guests, split, kitchen.
    businessDate: v.optional(v.string()), // YYYY-MM-DD by the restaurant cutoff (W1-PLT-08)
    orderTypeExternalId: v.optional(v.string()),
    orderTypeName: v.optional(v.string()),
    discountTypeExternalId: v.optional(v.string()),
    discountTypeName: v.optional(v.string()),
    discountAmount: v.optional(v.number()), // fixed-amount discounts
    retailConfigVersion: v.optional(v.string()), // "<kind>:<code>@<version>" of the settings applied
    guestExternalId: v.optional(v.string()),
    loyaltyProgramExternalId: v.optional(v.string()),
    loyaltyAccrued: v.optional(v.number()),
    loyaltyRedeemed: v.optional(v.number()),
    hallLabel: v.optional(v.string()),
    guestCount: v.optional(v.number()),
    splitFromOrderId: v.optional(v.id("orders")),
    kitchenSentAt: v.optional(v.number()),
    migratedBy: v.optional(v.literal("M-2")),
  })
    .index("by_number", ["number"])
    .index("by_restaurant_business_date", ["restaurantId", "businessDate"])
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
    sizeLabel: v.optional(v.string()),
    modifiers: v.array(v.string()), // legacy free-text kitchen notes
    // W1-POS-01 (optional until M-2): the chosen size and modifiers, priced by the server.
    sizeOptionId: v.optional(v.id("sizeOptions")),
    modifierSelections: v.optional(
      v.array(v.object({ externalId: v.string(), name: v.string(), quantity: v.number(), unitPrice: v.number(), groupExternalId: v.optional(v.string()), freeQuantity: v.optional(v.number()) })),
    ),
    kitchenModifiers: v.optional(v.array(v.object({ externalId: v.string(), label: v.string(), quantity: v.number(), defaultQuantity: v.number() }))),
    sizeExternalId: v.optional(v.string()),
    lineTotal: v.optional(v.number()),
    sentToKitchenAt: v.optional(v.number()),
    kitchenTicketId: v.optional(v.id("kitchenTickets")),
    voidedAt: v.optional(v.number()),
    voidReasonExternalId: v.optional(v.string()),
    course: v.optional(v.number()),
    migratedBy: v.optional(v.literal("M-2")),
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
    // W1-POS-01 (optional; M-2 fills historical payments).
    restaurantId: v.optional(v.id("restaurants")),
    paymentTypeExternalId: v.optional(v.string()),
    paymentTypeName: v.optional(v.string()),
    processorKind: v.optional(v.union(v.literal("cash"), v.literal("card"), v.literal("qr"))),
    journalEntryId: v.optional(v.string()),
    migratedBy: v.optional(v.literal("M-2")),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_restaurant_created", ["restaurantId", "createdAt"])
    .index("by_order_created", ["orderId", "createdAt"])
    .index("by_shift_created", ["shiftId", "createdAt"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  // --- Kitchen ------------------------------------------------------------

  kitchenTickets: defineTable({
    orderId: v.id("orders"),
    orderNumber: v.number(),
    status: kitchenStatus,
    fulfillment: orderType,
    source: v.union(v.literal("pos"), v.literal("delivery"), v.literal("kiosk")),
    createdAt: v.number(),
    updatedAt: v.number(),
    // W1-KDS-01 (optional until M-7): the ticket's own restaurant and status times. An order can have
    // several tickets — one per send to the kitchen (W1-POS-04).
    restaurantId: v.optional(v.id("restaurants")),
    tableLabel: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    readyAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index("by_order", ["orderId"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_restaurant_status_created", ["restaurantId", "status", "createdAt"]),

  kitchenTicketLines: defineTable({
    ticketId: v.id("kitchenTickets"),
    productExternalId: v.string(),
    productName: v.string(),
    quantity: v.number(),
    instructions: v.array(v.string()),
    // W1-KDS-01 (optional)
    prepArea: v.optional(v.string()),
    bundleComponents: v.optional(v.array(v.string())),
    orderLineId: v.optional(v.id("orderLines")),
    status: v.optional(v.union(v.literal("active"), v.literal("cancelled"))),
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
    capability: v.optional(v.string()),
    details: v.optional(v.any()),
    correlationId: v.optional(v.string()),
    searchText: v.optional(v.string()),
  })
    .index("by_occurred_at", ["occurredAt"])
    .index("by_resource", ["resourceExternalId", "occurredAt"])
    .index("by_restaurant_occurred", ["restaurantExternalId", "occurredAt"])
    .index("by_actor_occurred", ["actorKey", "occurredAt"])
    .index("by_org_occurred", ["organizationExternalId", "occurredAt"])
    .searchIndex("search_audit", { searchField: "searchText", filterFields: ["organizationExternalId", "restaurantExternalId", "action"] })
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
    countsByEndpoint: v.optional(v.record(v.string(), v.number())),
    error: v.optional(v.string()),
  }).index("by_external_id", ["runExternalId"]),

  iikoEndpointStates: defineTable({
    endpointKey: v.string(),
    lastStatus: v.union(v.literal("ok"), v.literal("error"), v.literal("unsupported")),
    lastRunAt: v.number(),
    message: v.optional(v.string()),
    classification: v.optional(v.union(v.literal("mirrored"), v.literal("blocked-one-way"), v.literal("query-template"), v.literal("unsupported"))),
    domain: v.optional(v.string()),
    method: v.optional(v.string()),
    path: v.optional(v.string()),
    recordCount: v.optional(v.number()),
  })
    .index("by_endpoint_key", ["endpointKey"])
    .index("by_domain", ["domain"]),

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
    data: v.optional(v.any()), // legacy untyped overlay; moved into the typed fields by M-1b
    sourceSystem: v.optional(v.literal("iiko-server")),
    label: v.optional(v.string()),
    labelKk: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    visibleInPos: v.optional(v.boolean()),
    popular: v.optional(v.boolean()),
    prepArea: v.optional(v.string()),
    localSettings: v.optional(
      v.object({
        price: v.optional(v.number()),
        writeOffMethod: v.optional(v.union(v.literal("ingredients"), v.literal("finished-product"))),
        unitWeightKg: v.optional(v.number()),
        markupPercent: v.optional(v.number()),
      }),
    ),
    updatedBy: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_overlay_key", ["overlayKey"])
    .index("by_entity_type_and_source_external_id", ["entityType", "sourceExternalId"]),

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
    // W1-STK-01 (optional until M-3): the unit reference is the source of truth, `unit` stays for prod data.
    unitExternalId: v.optional(v.string()),
    maximumStock: v.optional(v.number()),
    shelfLifeHours: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("ingredient"), v.literal("preparation"), v.literal("good"), v.literal("service"), v.literal("modifier"))),
    productExternalId: v.optional(v.string()), // the preparation/good product this item stocks
    defaultVatRate: v.optional(v.number()),
    sourceSystem: v.optional(v.string()),
    importedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_active_and_name", ["active", "nameSort"])
    .index("by_product", ["productExternalId"])
    .index("by_unit", ["unitExternalId"])
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
    warehouseId: v.optional(v.id("warehouses")), // required after M-3
    recalculating: v.optional(v.boolean()), // a backdated movement is re-chaining this balance (B-12)
  })
    .index("by_restaurant_item", ["restaurantExternalId", "inventoryItemId"])
    .index("by_warehouse_item", ["warehouseId", "inventoryItemId"])
    .index("by_restaurant", ["restaurantExternalId"])
    .index("by_item", ["inventoryItemId"]),

  stockMovements: defineTable({
    restaurantExternalId: v.string(),
    inventoryItemId: v.id("inventoryItems"),
    kind: v.union(v.literal("receipt"), v.literal("writeoff"), v.literal("adjustment"), v.literal("document"), v.literal("production"), v.literal("sale"), v.literal("reversal")),
    quantityDelta: v.number(), // positive for receipt/upward adjustment, negative for writeoff/downward adjustment
    unitCost: v.number(), // receipt: the price paid; writeoff/adjustment: the balance's averageUnitCost at the time (for COGS reporting)
    balanceAfter: v.number(),
    averageUnitCostAfter: v.number(),
    reason: v.optional(v.string()), // required for writeoff/adjustment
    actorEmail: v.string(),
    occurredAt: v.number(),
    warehouseId: v.optional(v.id("warehouses")), // required after M-3
    externalId: v.optional(v.string()), // idempotency key of lib/stockAccounting
    sourceModuleId: v.optional(v.string()),
    sourceExternalId: v.optional(v.string()),
    sourceNumber: v.optional(v.string()),
    amount: v.optional(v.number()),
    reversalOf: v.optional(v.id("stockMovements")),
  })
    .index("by_restaurant_item_occurred", ["restaurantExternalId", "inventoryItemId", "occurredAt"])
    .index("by_occurred_at", ["occurredAt"])
    .index("by_external_id", ["externalId"])
    .index("by_source", ["sourceExternalId", "occurredAt"])
    .index("by_warehouse_item_occurred", ["warehouseId", "inventoryItemId", "occurredAt"])
    .index("by_item_occurred", ["inventoryItemId", "occurredAt"]),
  // ── Accounting platform (W1-PLT-01) ─────────────────────────────────────────────────────────
  // Chart of accounts (Kazakhstan standard chart, reference model; UI in W1 finance).
  accounts: defineTable({
    externalId: v.string(),
    code: v.string(), // "1010"
    name: v.string(),
    type: v.union(v.literal("asset"), v.literal("liability"), v.literal("equity"), v.literal("income"), v.literal("expense"), v.literal("contra-income")),
    parentExternalId: v.optional(v.string()),
    allowManualEntries: v.boolean(),
    system: v.boolean(),
    active: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_code", ["code"])
    .index("by_type_active", ["type", "active"]),

  // Double-entry journal. Immutable: a correction is a reversal row pointing at the original.
  journalEntries: defineTable({
    externalId: v.string(),
    organizationExternalId: v.string(),
    restaurantExternalId: v.string(),
    sourceModuleId: v.string(),
    sourceExternalId: v.string(),
    sourceNumber: v.string(),
    occurredAt: v.number(),
    businessDate: v.string(), // YYYY-MM-DD, like lib/time almatyBusinessDate
    debitAccountExternalId: v.string(),
    creditAccountExternalId: v.string(),
    amount: v.number(), // whole tenge (lib/money.ts)
    quantity: v.optional(v.number()),
    itemName: v.optional(v.string()),
    warehouseExternalId: v.optional(v.string()),
    description: v.string(),
    reversalOf: v.optional(v.id("journalEntries")),
    legacyLedgerEntryId: v.optional(v.id("ledgerEntries")),
  })
    .index("by_external_id", ["externalId"])
    .index("by_source", ["sourceExternalId", "occurredAt"])
    .index("by_restaurant_date", ["restaurantExternalId", "businessDate"])
    .index("by_debit_date", ["debitAccountExternalId", "businessDate"])
    .index("by_credit_date", ["creditAccountExternalId", "businessDate"])
    .index("by_org_date", ["organizationExternalId", "businessDate"]),

  // Period close. The organization is part of the index so one brand's lock never blocks another (B-26).
  periodLocks: defineTable({
    externalId: v.string(),
    organizationExternalId: v.string(),
    restaurantExternalId: v.optional(v.string()),
    moduleId: v.optional(v.string()),
    kind: v.union(v.literal("preliminary"), v.literal("final")),
    lockedThrough: v.number(),
    active: v.boolean(),
    reason: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    reopenedBy: v.optional(v.string()),
    reopenedAt: v.optional(v.number()),
    reopenReason: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_org_restaurant_active", ["organizationExternalId", "restaurantExternalId", "active", "lockedThrough"]),

  // Transactional outbox: written in the same mutation as the change it describes.
  outboxEvents: defineTable({
    externalId: v.string(),
    aggregateType: v.string(),
    aggregateExternalId: v.string(),
    eventType: v.string(),
    organizationExternalId: v.string(),
    restaurantExternalId: v.optional(v.string()),
    payload: v.any(),
    status: v.union(v.literal("pending"), v.literal("published"), v.literal("failed")),
    attempts: v.number(),
    availableAt: v.number(),
    createdAt: v.number(),
    publishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_status_available", ["status", "availableAt"])
    .index("by_aggregate", ["aggregateExternalId", "createdAt"]),

  // Integration queue (never an iiko write: iiko stays read-only).
  integrationJobs: defineTable({
    externalId: v.string(),
    provider: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    operation: v.string(),
    sourceExternalId: v.optional(v.string()),
    idempotencyKey: v.string(),
    status: v.union(v.literal("queued"), v.literal("processing"), v.literal("retrying"), v.literal("completed"), v.literal("failed"), v.literal("dead-letter"), v.literal("cancelled")),
    attempts: v.number(),
    payload: v.any(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    nextAttemptAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    organizationExternalId: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_status_attempt", ["status", "nextAttemptAt"]),

  // Server-side document numbering: scopeKey = "<moduleId>:<organizationExternalId>:<yyyy>".
  documentCounters: defineTable({
    scopeKey: v.string(),
    next: v.number(),
  }).index("by_scope_key", ["scopeKey"]),
  // Finance domain records (W1-FIN-01) — lifecycle, numbering and pagination through lib/domainRecords.ts.
  financeRecords: defineTable({
    externalId: v.string(),
    moduleId: financeModuleId,
    number: v.string(),
    name: v.string(),
    status: officeDomainStatus,
    organizationExternalId: v.string(),
    restaurantExternalId: v.string(),
    businessDate: v.string(), // YYYY-MM-DD
    amount: v.number(), // whole tenge
    debitAccountExternalId: v.optional(v.string()),
    creditAccountExternalId: v.optional(v.string()),
    cashflowCategoryExternalId: v.optional(v.string()),
    counterpartyExternalId: v.optional(v.string()),
    data: financeRecordData,
    searchText: v.string(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    postedAt: v.optional(v.number()),
    reversedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_module_status_date", ["moduleId", "status", "businessDate"])
    .index("by_module_restaurant_date", ["moduleId", "restaurantExternalId", "businessDate"])
    .index("by_counterparty_module", ["counterpartyExternalId", "moduleId"])
    .searchIndex("search_finance_records", { searchField: "searchText", filterFields: ["moduleId", "status", "restaurantExternalId"] }),
  // ── Catalog: sizes, price orders, modifiers (W1-CAT-07/09/10; new tables, strict from the start) ──
  sizeScales: defineTable({
    externalId: v.string(),
    name: v.string(),
    nameSort: v.string(),
    searchText: v.string(),
    sortOrder: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_name", ["nameSort"])
    .searchIndex("search_size_scales", { searchField: "searchText" }),

  sizeOptions: defineTable({
    externalId: v.string(),
    scaleId: v.id("sizeScales"),
    label: v.string(),
    labelKk: v.optional(v.string()),
    kitchenLabel: v.string(),
    coefficient: v.number(), // price coefficient over the base price
    writeOffCoefficient: v.optional(v.number()), // stock write-off coefficient, defaults to coefficient
    sortOrder: v.number(),
    isDefault: v.boolean(),
    available: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_scale_sort", ["scaleId", "sortOrder"]),

  priceOrders: defineTable({
    externalId: v.string(),
    number: v.string(), // ЦЕН-<год>-<NNNNN>
    name: v.string(),
    nameSort: v.string(),
    searchText: v.string(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    status: v.union(v.literal("draft"), v.literal("scheduled"), v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    comment: v.string(),
    posName: v.string(),
    replacesPreviousMenu: v.boolean(),
    restaurantExternalIds: v.array(v.string()), // empty = every restaurant
    organizationExternalId: v.string(),
    nextTransitionAt: v.optional(v.number()),
    createdBy: v.string(),
    updatedAt: v.number(),
    cancelReason: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_number", ["number"])
    .index("by_status_start", ["status", "effectiveFrom"])
    .index("by_next_transition", ["nextTransitionAt"])
    .searchIndex("search_price_orders", { searchField: "searchText", filterFields: ["status"] }),

  priceOrderLines: defineTable({
    orderId: v.id("priceOrders"),
    productId: v.id("products"),
    productExternalId: v.string(),
    sizeOptionId: v.optional(v.id("sizeOptions")),
    included: v.boolean(),
    previousPrice: v.number(),
    newPrice: v.number(),
    costAtSave: v.number(),
    productName: v.string(),
    sizeLabel: v.optional(v.string()),
  })
    .index("by_order", ["orderId"])
    .index("by_order_product", ["orderId", "productExternalId"])
    .index("by_size_option", ["sizeOptionId"]),

  priceSchedules: defineTable({
    orderId: v.id("priceOrders"),
    name: v.string(),
    startMinute: v.number(),
    endMinute: v.number(),
    weekdays: v.array(v.number()), // 1 = Monday … 7 = Sunday
  }).index("by_order", ["orderId"]),

  modifierGroups: defineTable({
    externalId: v.string(),
    name: v.string(),
    nameKk: v.optional(v.string()),
    nameSort: v.string(),
    searchText: v.string(),
    sortOrder: v.number(),
    active: v.boolean(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_name", ["nameSort"])
    .searchIndex("search_modifier_groups", { searchField: "searchText" }),

  modifiers: defineTable({
    externalId: v.string(),
    groupId: v.id("modifierGroups"),
    name: v.string(),
    nameKk: v.optional(v.string()),
    nameSort: v.string(),
    searchText: v.string(),
    price: v.number(),
    ingredientInventoryItemId: v.optional(v.id("inventoryItems")),
    ingredientName: v.string(),
    ingredientQuantity: v.number(),
    unit,
    imagePath: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    available: v.boolean(),
    sortOrder: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_group_name", ["groupId", "nameSort"])
    .index("by_price", ["price"])
    .index("by_group_price", ["groupId", "price"])
    .searchIndex("search_modifiers", { searchField: "searchText", filterFields: ["groupId"] }),

  productModifierGroups: defineTable({
    productId: v.id("products"),
    groupId: v.id("modifierGroups"),
    required: v.boolean(),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    freeQuantity: v.number(),
    enforceItemLimits: v.boolean(),
    sortOrder: v.number(),
  })
    .index("by_product", ["productId", "sortOrder"])
    .index("by_product_group", ["productId", "groupId"])
    .index("by_group", ["groupId"]),

  productModifierRules: defineTable({
    productModifierGroupId: v.id("productModifierGroups"),
    modifierId: v.id("modifiers"),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    defaultQuantity: v.number(),
    freeQuantity: v.number(),
    sortOrder: v.number(),
  }).index("by_assignment_sort", ["productModifierGroupId", "sortOrder"]),
  // Cashier favorites (W1-CAT-13): no price copy — prices always come from resolvePrice.
  employeeFavorites: defineTable({
    employeeId: v.id("employees"),
    productId: v.id("products"),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId", "createdAt"])
    .index("by_employee_product", ["employeeId", "productId"])
    .index("by_product", ["productId"]),

  // Stop list per branch (W1-CAT-14).
  productAvailability: defineTable({
    productId: v.id("products"),
    restaurantExternalId: v.string(),
    available: v.boolean(),
    reason: v.optional(v.string()),
    until: v.optional(v.number()), // unavailable until this moment; in the past = available again
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_restaurant_product", ["restaurantExternalId", "productId"])
    .index("by_product", ["productId"])
    .index("by_restaurant_available", ["restaurantExternalId", "available"]),
  // Recipe cards with versions (W1-RCP-01). Line costs are never stored — computed from average stock cost.
  recipes: defineTable({
    productId: v.id("products"),
    activeVersionId: v.optional(v.id("recipeVersions")),
    createdAt: v.number(),
  }).index("by_product", ["productId"]),

  recipeVersions: defineTable({
    recipeId: v.id("recipes"),
    productId: v.id("products"),
    version: v.number(),
    effectiveFrom: v.number(),
    batchYield: v.number(), // portions from one batch
    technology: v.string(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("superseded")),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_product_effective", ["productId", "effectiveFrom"])
    .index("by_recipe_version", ["recipeId", "version"])
    .index("by_product_status_effective", ["productId", "status", "effectiveFrom"]),

  recipeLines: defineTable({
    versionId: v.id("recipeVersions"),
    kind: v.union(v.literal("item"), v.literal("preparation")),
    inventoryItemId: v.optional(v.id("inventoryItems")),
    componentProductId: v.optional(v.id("products")), // a preparation (заготовка) with its own recipe
    name: v.string(),
    unit: v.union(v.literal("кг"), v.literal("л"), v.literal("шт")),
    quantity: v.number(),
    unitWeightKg: v.number(),
    coldLossPercent: v.number(),
    hotLossPercent: v.number(),
    sortOrder: v.number(),
  })
    .index("by_version", ["versionId", "sortOrder"])
    .index("by_component", ["componentProductId"]),
  // ── Stock (W1-STK-01; new tables, empty on prod) ──────────────────────────────────────────────
  units: defineTable({
    externalId: v.string(),
    name: v.string(),
    shortName: v.string(),
    dimension: v.union(v.literal("mass"), v.literal("volume"), v.literal("count"), v.literal("portion")),
    precision: v.number(),
    baseUnitExternalId: v.optional(v.string()),
    coefficient: v.number(), // to the base unit
    active: v.boolean(),
    searchText: v.string(),
    sourceSystem: v.optional(v.string()),
    importedAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_active_name", ["active", "name"]),

  warehouses: defineTable({
    externalId: v.string(),
    name: v.string(),
    shortName: v.string(),
    restaurantExternalId: v.string(),
    organizationExternalId: v.string(),
    kind: v.union(v.literal("storage"), v.literal("kitchen"), v.literal("bar"), v.literal("distribution")),
    responsibleName: v.optional(v.string()),
    allowNegativeStock: v.boolean(),
    internalTransfers: v.boolean(),
    isSalesDefault: v.boolean(), // the branch's sales write-off warehouse (W1-RCP-03)
    active: v.boolean(),
    searchText: v.string(),
    iikoStoreExternalId: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_restaurant_active", ["restaurantExternalId", "active"])
    .index("by_iiko_store", ["iikoStoreExternalId"]),

  suppliers: defineTable({
    externalId: v.string(),
    name: v.string(),
    bin: v.string(),
    supplierType: v.union(v.literal("external"), v.literal("internal")),
    vatPayer: v.optional(v.boolean()),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    legalAddress: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    paymentDelayDays: v.optional(v.number()),
    minimumOrder: v.optional(v.number()),
    priceDeviationPolicy: v.union(v.literal("ignore"), v.literal("warn"), v.literal("block"), v.literal("block-higher")),
    allowedDeviationPercent: v.number(),
    restaurantExternalIds: v.array(v.string()),
    counterpartyExternalId: v.optional(v.string()),
    active: v.boolean(),
    searchText: v.string(),
    sourceSystem: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_bin", ["bin"])
    .index("by_active_name", ["active", "name"])
    .searchIndex("search_suppliers", { searchField: "searchText", filterFields: ["active"] }),

  stockLots: defineTable({
    externalId: v.string(),
    inventoryItemId: v.id("inventoryItems"),
    warehouseId: v.id("warehouses"),
    quantity: v.number(),
    remainingQuantity: v.number(),
    unitCost: v.number(),
    sourceModuleId: v.string(),
    sourceExternalId: v.string(),
    sourceNumber: v.string(),
    receivedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_warehouse_item_received", ["warehouseId", "inventoryItemId", "receivedAt"])
    .index("by_source", ["sourceExternalId"]),

  receipts: defineTable({
    externalId: v.string(),
    number: v.string(),
    date: v.number(),
    supplierId: v.id("suppliers"),
    warehouseId: v.id("warehouses"),
    restaurantExternalId: v.string(),
    organizationExternalId: v.string(),
    invoiceNumber: v.string(),
    purchaseOrderExternalId: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("reversed")),
    totalGross: v.number(),
    totalVat: v.number(),
    totalNet: v.number(),
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    postedAt: v.optional(v.number()),
    reversedAt: v.optional(v.number()),
    reverseReason: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_restaurant_status_date", ["restaurantExternalId", "status", "date"])
    .index("by_restaurant_date", ["restaurantExternalId", "date"])
    .index("by_number", ["number"])
    .index("by_supplier_status", ["supplierId", "status"])
    .searchIndex("search_receipts", { searchField: "searchText", filterFields: ["status", "restaurantExternalId"] }),

  receiptLines: defineTable({
    receiptId: v.id("receipts"),
    lineNo: v.number(),
    inventoryItemId: v.id("inventoryItems"),
    quantity: v.number(),
    unitCostGross: v.number(),
    vatRate: v.number(),
    amountGross: v.number(),
  }).index("by_receipt", ["receiptId", "lineNo"]),

  stockDocuments: defineTable({
    externalId: v.string(),
    type: v.union(v.literal("outgoing-invoice"), v.literal("supplier-return"), v.literal("inventory"), v.literal("transfer"), v.literal("writeoff")),
    number: v.string(),
    date: v.number(),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("reversed")),
    organizationExternalId: v.string(),
    restaurantExternalId: v.string(),
    sourceWarehouseId: v.optional(v.id("warehouses")),
    destinationWarehouseId: v.optional(v.id("warehouses")),
    sourceWarehouseExternalId: v.optional(v.string()),
    destinationWarehouseExternalId: v.optional(v.string()),
    supplierId: v.optional(v.id("suppliers")),
    counterpartyName: v.string(),
    reason: v.string(),
    comment: v.string(),
    totalQuantity: v.number(),
    totalAmount: v.number(),
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    postedAt: v.optional(v.number()),
    reversedAt: v.optional(v.number()),
    reverseReason: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_type_restaurant_status_date", ["type", "restaurantExternalId", "status", "date"])
    .index("by_type_restaurant_date", ["type", "restaurantExternalId", "date"])
    .index("by_type_status_date", ["type", "status", "date"])
    .index("by_source_warehouse_status", ["sourceWarehouseId", "status"])
    .searchIndex("search_stock_documents", { searchField: "searchText", filterFields: ["type", "status", "restaurantExternalId"] }),

  stockDocumentLines: defineTable({
    documentId: v.id("stockDocuments"),
    lineNo: v.number(),
    inventoryItemId: v.id("inventoryItems"),
    quantity: v.number(),
    expectedQuantity: v.optional(v.number()),
    actualQuantity: v.optional(v.number()),
    unitCost: v.number(),
    vatRate: v.number(),
  }).index("by_document", ["documentId", "lineNo"]),
  // Sales that could not write off stock (W1-RCP-03) — the source of «Продажи без техкарты».
  salesWithoutRecipe: defineTable({
    orderId: v.id("orders"),
    orderLineId: v.optional(v.id("orderLines")),
    productId: v.optional(v.id("products")),
    restaurantExternalId: v.string(),
    code: v.union(v.literal("no-recipe"), v.literal("no-inventory-item"), v.literal("zero-weight"), v.literal("no-warehouse"), v.literal("no-accounts")),
    occurredAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_restaurant_occurred", ["restaurantExternalId", "occurredAt"]),
  // Retail settings with versions (W1-RTL-01): payment, order and discount types, deletion reasons,
  // cash operation types. One row per version; the code groups versions.
  retailSettings: defineTable({
    externalId: v.string(),
    kind: retailKind,
    code: v.string(),
    name: v.string(),
    receiptName: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("published"), v.literal("expired")),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    sortOrder: v.number(),
    restaurantExternalIds: v.array(v.string()), // empty = every restaurant
    data: retailSettingData,
    version: v.number(),
    searchText: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_kind_order", ["kind", "sortOrder"])
    .index("by_kind_status_start", ["kind", "status", "effectiveFrom"])
    .index("by_kind_code_version", ["kind", "code", "version"])
    .searchIndex("search_retail_settings", { searchField: "searchText", filterFields: ["kind", "status"] }),
})
