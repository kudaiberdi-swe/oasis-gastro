import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { makeFunctionReference, type FunctionArgs } from "convex/server"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

type TestConvex = ReturnType<typeof convexTest>

/** saveDraft returns `{ outcome: "not-editable" }` for closed checks; tests only ever expect a saved draft. */
async function saveDraft(t: TestConvex, args: FunctionArgs<typeof api.domains.orders.mutations.saveDraft>) {
  const result = await t.mutation(api.domains.orders.mutations.saveDraft, args)
  if ("outcome" in result) throw new Error(`saveDraft returned ${result.outcome}`)
  return result
}

describe("POS core flow", () => {
  it("handles two parallel table checks, service-charge math, checkout, and shift close", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)

    await t.mutation(api.domains.shifts.mutations.open, {
      sessionToken: fixture.cashierToken,
      openingCash: 20_000,
      note: "Открытие",
    })

    const tableOne = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "table-1",
      orderType: "dine-in",
      tableLabel: "Стол 1",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 2 }],
    })
    const tableTwo = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "table-2",
      orderType: "dine-in",
      tableLabel: "Стол 2",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 1 }],
    })

    // Sandyq is full-service — both checks stay open at once, each with its own 15% service charge.
    expect(tableOne).toMatchObject({ subtotal: 2000, serviceChargeAmount: 300, total: 2300, status: "draft" })
    expect(tableTwo).toMatchObject({ subtotal: 1000, serviceChargeAmount: 150, total: 1150, status: "draft" })

    const openChecks = await t.query(api.domains.orders.queries.listOpenChecks, { sessionToken: fixture.cashierToken })
    expect(openChecks).toHaveLength(2)
    expect(openChecks.map((check) => check.tableLabel).sort()).toEqual(["Стол 1", "Стол 2"])

    const checkoutOne = await t.mutation(api.domains.orders.mutations.checkout, {
      sessionToken: fixture.cashierToken,
      orderId: tableOne._id,
      idempotencyKey: "checkout-1",
      payments: [{ method: "cash", amount: 2300, tendered: 2500 }],
    })
    expect(checkoutOne.duplicate).toBe(false)
    expect(checkoutOne.receipt).toMatchObject({ status: "paid" })

    const checkoutTwo = await t.mutation(api.domains.orders.mutations.checkout, {
      sessionToken: fixture.cashierToken,
      orderId: tableTwo._id,
      idempotencyKey: "checkout-2",
      payments: [{ method: "card", amount: 1150 }],
    })
    expect(checkoutTwo.receipt).toMatchObject({ status: "paid" })

    // Replaying the same idempotency key must not double-charge or double-post the ledger.
    const replay = await t.mutation(api.domains.orders.mutations.checkout, {
      sessionToken: fixture.cashierToken,
      orderId: tableOne._id,
      idempotencyKey: "checkout-1",
      payments: [{ method: "cash", amount: 2300, tendered: 2500 }],
    })
    expect(replay.duplicate).toBe(true)

    const revenue = await t.run(async (ctx) => ctx.db.query("ledgerEntries").withIndex("by_occurred_at").collect())
    expect(revenue.filter((entry) => entry.kind === "revenue")).toHaveLength(2)
    expect(revenue.reduce((sum, entry) => sum + entry.amount, 0)).toBe(3450)

    // Blind count: a cashier's preview has no expected cash; «Сверить» (reconcileCount) reveals it.
    const preview = await t.query(api.domains.shifts.queries.closePreview, { sessionToken: fixture.cashierToken })
    expect(preview).toMatchObject({ expectedCash: null, blockers: [] })
    const reconciled = await t.mutation(api.domains.shifts.mutations.reconcileCount, { sessionToken: fixture.cashierToken, countedCash: 22_300 })
    expect(reconciled).toMatchObject({ expectedCash: 22_300, variance: 0 }) // only the cash sale hits the drawer

    const closed = await t.mutation(api.domains.shifts.mutations.close, {
      sessionToken: fixture.cashierToken,
      countedCash: 22_300,
      note: "Сверено",
    })
    expect(closed).toMatchObject({ variance: 0 })
    expect(closed.zReportNumber).toMatch(/^Z-/)
  })

  it("rejects a draft edit against a stale version (optimistic concurrency)", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 10_000, note: "Открытие" })

    const created = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "occ-check",
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 1 }],
    })
    expect(created.version).toBe(1)

    // Simulates a second terminal having already saved an edit — this order's real version is now 2.
    await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "occ-check",
      orderId: created._id,
      expectedVersion: 1,
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 2 }],
    })

    await expect(
      t.mutation(api.domains.orders.mutations.saveDraft, {
        sessionToken: fixture.cashierToken,
        clientOrderId: "occ-check",
        orderId: created._id,
        expectedVersion: 1, // stale on purpose
        orderType: "dine-in",
        discountPercent: 0,
        comment: "",
        lines: [{ productId: fixture.productId, quantity: 3 }],
      }),
    ).rejects.toThrow("изменён на другой кассе")
  })

  it("accrues loyalty points on checkout for an attached guest", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 10_000, note: "Открытие" })

    const order = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "guest-check",
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 5 }], // subtotal 5000, +15% = 5750
    })
    const attached = await t.mutation(api.domains.loyalty.mutations.attachGuestToOrder, {
      sessionToken: fixture.cashierToken,
      orderId: order._id,
      phone: "+7 701 000 00 00",
      name: "Тест Гость",
    })
    expect(attached.points).toBe(0)

    await t.mutation(api.domains.orders.mutations.checkout, {
      sessionToken: fixture.cashierToken,
      orderId: order._id,
      idempotencyKey: "guest-checkout",
      payments: [{ method: "cash", amount: 5750, tendered: 5750 }],
    })

    const guest = await t.run(async (ctx) => ctx.db.get(attached.guestId))
    expect(guest?.points).toBe(57) // floor(5750 / 100)

    const transactions = await t.run(async (ctx) =>
      ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", attached.guestId)).collect(),
    )
    expect(transactions).toMatchObject([{ kind: "accrual", points: 57, balanceAfter: 57 }])
  })

  it("refunds only through the original payment method and posts a ledger expense", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 10_000, note: "Открытие" })

    const order = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "refund-check",
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 1 }], // total 1150
    })
    await t.mutation(api.domains.orders.mutations.checkout, {
      sessionToken: fixture.cashierToken,
      orderId: order._id,
      idempotencyKey: "refund-checkout",
      payments: [{ method: "card", amount: 1150 }],
    })

    const approval = await createManagerApproval(t, fixture)
    await expect(
      t.mutation(api.domains.orders.mutations.refund, {
        sessionToken: fixture.cashierToken,
        orderId: order._id,
        idempotencyKey: "refund-wrong-method",
        amount: 500,
        method: "cash",
        reason: "Тест возврата",
        managerApprovalToken: approval,
      }),
    ).rejects.toThrow("исходный способ")

    // A manager-approval token is single-use — the rejected attempt above must not have consumed it.
    await t.mutation(api.domains.orders.mutations.refund, {
      sessionToken: fixture.cashierToken,
      orderId: order._id,
      idempotencyKey: "refund-card",
      amount: 500,
      method: "card",
      reason: "Тест возврата",
      managerApprovalToken: approval,
    })

    const order2 = await t.run(async (ctx) => ctx.db.get(order._id))
    expect(order2?.status).toBe("partially_refunded")

    const expense = await t.run(async (ctx) => ctx.db.query("ledgerEntries").withIndex("by_occurred_at").collect())
    expect(expense).toContainEqual(expect.objectContaining({ kind: "expense", category: "Возврат", amount: 500 }))
  })

  it("requires a manager PIN for a cashier's X-report and replays idempotently", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 10_000, note: "Открытие" })

    await expect(
      t.mutation(api.domains.shifts.mutations.createXReport, {
        sessionToken: fixture.cashierToken,
        idempotencyKey: "x-report-1",
      }),
    ).rejects.toThrow("Требуется подтверждение менеджера")

    const approval = await createManagerApproval(t, fixture)
    const first = await t.mutation(api.domains.shifts.mutations.createXReport, {
      sessionToken: fixture.cashierToken,
      idempotencyKey: "x-report-1",
      managerApprovalToken: approval,
    })
    expect(first.sequence).toBe(1)
    expect(first.reportNumber).toMatch(/^X-/)

    const retry = await t.mutation(api.domains.shifts.mutations.createXReport, {
      sessionToken: fixture.cashierToken,
      idempotencyKey: "x-report-1",
    })
    expect(retry._id).toBe(first._id)
    expect(retry.sequence).toBe(1)
  })
})

describe("loyalty reversal on refund (W0-BUG-04, S-8)", () => {
  it("reverses accrued points in proportion to each refund and ignores replays", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 10_000, note: "" })
    const order = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "refund-points",
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 5 }], // 5000 + 15% = 5750
    })
    const { guestId } = await t.mutation(api.domains.loyalty.mutations.attachGuestToOrder, { sessionToken: fixture.cashierToken, orderId: order._id, phone: "+7 701 111 22 33" })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: fixture.cashierToken, orderId: order._id, idempotencyKey: "points-checkout", payments: [{ method: "cash", amount: 5750, tendered: 5750 }] })
    const points = async () => (await t.run(async (ctx) => ctx.db.get(guestId)))?.points
    expect(await points()).toBe(57)

    const refund = async (key: string, amount: number) =>
      t.mutation(api.domains.orders.mutations.refund, {
        sessionToken: fixture.cashierToken,
        orderId: order._id,
        idempotencyKey: key,
        amount,
        method: "cash",
        reason: "Гость отказался",
        managerApprovalToken: await createManagerApproval(t, fixture),
      })

    await refund("refund-half", 2875)
    expect(await points()).toBe(29) // floor(57 × 2875 / 5750) = 28 reversed
    await refund("refund-half", 2875) // replay of the same refund
    expect(await points()).toBe(29)
    await refund("refund-rest", 2875)
    expect(await points()).toBe(0) // the two reversals add up to exactly the 57 accrued

    const reversals = await t.run(async (ctx) =>
      (await ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", guestId)).collect()).filter((tx) => tx.kind === "reversal"),
    )
    expect(reversals.map((tx) => tx.points)).toEqual([-28, -29])
  })
})

describe("reports, X-report and ledger backfill agree (W0-BUG-05)", () => {
  async function asOfficeAdmin(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    })
    return t.withIdentity({ email: "admin@sandyq.test" })
  }

  async function paidOrder(t: ReturnType<typeof convexTest>, fixture: Awaited<ReturnType<typeof seedFixture>>, key: string, lines: { productId: Id<"products">; quantity: number }[], payments: { method: "cash" | "card" | "qr"; amount: number }[], discountPercent = 0) {
    const draft = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: key,
      orderType: "dine-in",
      discountPercent,
      ...(discountPercent ? { discountReason: "Постоянный гость" } : {}),
      comment: "",
      lines,
    })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: fixture.cashierToken, orderId: draft._id, idempotencyKey: `${key}-pay`, payments })
    return draft
  }

  it("nets refunds out of sales revenue (S-9)", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const office = await asOfficeAdmin(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 0, note: "" })
    const order = await paidOrder(t, fixture, "sale", [{ productId: fixture.productId, quantity: 1 }], [{ method: "card", amount: 1150 }])
    await t.mutation(api.domains.orders.mutations.refund, {
      sessionToken: fixture.cashierToken,
      orderId: order._id,
      idempotencyKey: "sale-refund",
      amount: 575,
      method: "card",
      reason: "Частичный возврат",
      managerApprovalToken: await createManagerApproval(t, fixture),
    })

    const summary = await office.query(api.domains.reports.queries.salesSummary, {})
    expect(summary).toMatchObject({ grossSales: 1150, refunds: 575, revenue: 575, orderCount: 1 })
    expect(summary.byPaymentMethod).toEqual([{ method: "card", amount: 575 }])
  })

  it("sums the orders' rounded discounts in the X-report (S-10)", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const oddPriced = await t.run(async (ctx) =>
      ctx.db.insert("products", {
        externalId: "odd",
        name: "Блюдо 1999",
        nameKk: "Тағам 1999",
        nameSort: "блюдо 1999",
        searchText: "блюдо 1999",
        description: "",
        category: "hot",
        categorySort: 1,
        basePrice: 1999,
        popular: false,
        sku: "ODD-1",
        baseUnit: "порц." as const,
        enabled: true,
      }),
    )
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 0, note: "" })
    // 7 % of 1 999 = 139.93 → each order discounts 140 ₸; the old X-report summed the raw 279.86.
    for (const key of ["disc-1", "disc-2"]) {
      const draft = await saveDraft(t, {
        sessionToken: fixture.cashierToken,
        clientOrderId: key,
        orderType: "dine-in",
        discountPercent: 7,
        discountReason: "Постоянный гость",
        comment: "",
        lines: [{ productId: oddPriced, quantity: 1 }],
      })
      await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: fixture.cashierToken, orderId: draft._id, idempotencyKey: `${key}-pay`, payments: [{ method: "card", amount: draft.total }] })
    }
    const report = await t.mutation(api.domains.shifts.mutations.createXReport, {
      sessionToken: fixture.cashierToken,
      idempotencyKey: "x-disc",
      managerApprovalToken: await createManagerApproval(t, fixture),
    })
    expect(report.discounts).toBe(280)
  })

  it("M-4 moves legacy sales to the journal per payment (a split stays split, S-11) and never duplicates journal sales", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 0, note: "" })
    // Before the chart of accounts: the sale goes to the flat ledger only.
    const split = await paidOrder(t, fixture, "split", [{ productId: fixture.productId, quantity: 2 }], [{ method: "cash", amount: 1300 }, { method: "card", amount: 1000 }])
    await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
    // With it: the sale is in the journal and the ledger gets nothing.
    const live = await paidOrder(t, fixture, "live", [{ productId: fixture.productId, quantity: 1 }], [{ method: "card", amount: 1150 }])
    const ledger = await t.run((ctx) => ctx.db.query("ledgerEntries").take(10))
    expect(ledger.map((entry) => entry.sourceExternalId)).toEqual([String(split._id)])

    const all = { paginationOpts: { numItems: 100, cursor: null } }
    const dry = await t.mutation(internal.migrations.m4LedgerToJournal.migrateLedgerToJournal, { ...all, dryRun: true })
    expect(dry).toMatchObject({ migrated: 1, lines: 2, byAccount: { cash: { debit: 1300, credit: 0 }, inTransit: { debit: 1000, credit: 0 }, revenue: { debit: 0, credit: 2300 } } })
    await t.mutation(internal.migrations.m4LedgerToJournal.migrateLedgerToJournal, all)
    expect((await t.mutation(internal.migrations.m4LedgerToJournal.migrateLedgerToJournal, { ...all, dryRun: true })).migrated).toBe(0)
    const journal = await t.run((ctx) => ctx.db.query("journalEntries").take(20))
    const revenue = journal.filter((entry) => entry.creditAccountExternalId === "acc-6010").reduce((sum, entry) => sum + entry.amount, 0)
    expect(revenue).toBe(2300 + 1150)
    expect(journal.filter((entry) => entry.sourceExternalId === String(live._id) && entry.creditAccountExternalId === "acc-6010")).toHaveLength(1)

    await t.mutation(internal.migrations.m4LedgerToJournal.rollbackM4, all)
    expect((await t.run((ctx) => ctx.db.query("journalEntries").take(20))).filter((entry) => entry.migration === "M-4")).toHaveLength(0)
  })
})

describe("public function access (W0-BUG-01)", () => {
  it("requires a POS session for the catalog and prices from the session's restaurant", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.run(async (ctx) => {
      await ctx.db.insert("productPrices", { productId: fixture.productId, restaurantExternalId: "sandyq-test", priceKzt: 1500 })
      await ctx.db.insert("productPrices", { productId: fixture.productId, restaurantExternalId: "other-branch", priceKzt: 9999 })
    })

    await expect(t.query(api.domains.catalog.queries.listCategories, { sessionToken: "not-a-session" })).rejects.toThrow()
    await expect(
      t.query(api.domains.catalog.queries.listProducts, { sessionToken: "not-a-session", paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow()

    const categories = await t.query(api.domains.catalog.queries.listCategories, { sessionToken: fixture.cashierToken })
    expect(categories.map((category) => category.externalId)).toEqual(["hot"])
    // The office's strip color reaches the POS with the category.
    await t.run(async (ctx) => {
      const hot = await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", "hot")).unique()
      await ctx.db.patch(hot!._id, { colorToken: "cat-meat" })
    })
    expect((await t.query(api.domains.catalog.queries.listCategories, { sessionToken: fixture.cashierToken }))[0].colorToken).toBe("cat-meat")
    const page = await t.query(api.domains.catalog.queries.listProducts, { sessionToken: fixture.cashierToken, paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page.map((product) => product.price)).toEqual([1500])
    const product = await t.query(api.domains.catalog.queries.getProduct, { sessionToken: fixture.cashierToken, productId: fixture.productId })
    expect(product?.price).toBe(1500)
  })

  it("keeps iiko sync bookkeeping and session revocation off the public API", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    // The old public paths are gone. Public vs internal visibility itself is enforced statically by
    // scripts/check-guards.mjs — convex-test lets tests call internal functions directly.
    await expect(t.query(makeFunctionReference<"query">("domains/iiko/queries:mirrorCounts"), {})).rejects.toThrow()
    await expect(
      t.mutation(makeFunctionReference<"mutation">("domains/iiko/mutations:saveOverlay"), { entityType: "product", sourceExternalId: "x", data: {} }),
    ).rejects.toThrow()
    await expect(t.mutation(makeFunctionReference<"mutation">("domains/auth/mutations:revoke"), { sessionToken: fixture.cashierToken })).rejects.toThrow()
    expect(await t.query(internal.domains.iiko.internal.mirrorCounts, {})).toEqual({ departments: 0, employees: 0 })
  })
})

describe("kitchen isolation (W0-BUG-02)", () => {
  it("shows and advances tickets only within the operator's restaurant, with an audit trail", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const otherToken = "other-restaurant-token"
    await t.run(async (ctx) => {
      const restaurantId = await ctx.db.insert("restaurants", {
        externalId: "sandyq-other",
        organizationExternalId: "sandyq",
        name: "Sandyq · Другой",
        address: "Другая, 2",
        timezone: "Asia/Almaty",
        city: "Шымкент",
        currency: "KZT",
        active: true,
      })
      const terminalId = await ctx.db.insert("posTerminals", { externalId: "terminal-other-1", restaurantId, name: "Касса 1", terminalNumber: 1, nextOrderNumber: 1, active: true })
      const employeeId = await ctx.db.insert("employees", { code: "201", displayName: "Кассир 2", role: "cashier" as const, restaurantIds: [restaurantId], pinSalt: "test", pinHash: "test", active: true, failedAttempts: 0 })
      await ctx.db.insert("posSessions", { tokenHash: await digest(otherToken), purpose: "operator", employeeId, terminalId, createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 60_000 })
    })

    await t.mutation(api.domains.shifts.mutations.open, { sessionToken: fixture.cashierToken, openingCash: 0, note: "" })
    const draft = await saveDraft(t, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "kitchen-1",
      orderType: "dine-in",
      tableLabel: "Стол 1",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 1 }],
    })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: fixture.cashierToken, orderId: draft._id, idempotencyKey: "kitchen-checkout", payments: [{ method: "card", amount: 1150 }] })

    const own = await t.query(api.domains.kitchen.queries.board, { sessionToken: fixture.cashierToken })
    expect(own).toHaveLength(1)
    expect(await t.query(api.domains.kitchen.queries.board, { sessionToken: otherToken })).toEqual([])

    await expect(t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: otherToken, ticketId: own[0]._id, status: "preparing" })).rejects.toThrow("Тикет не найден")
    await t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: fixture.cashierToken, ticketId: own[0]._id, status: "preparing" })

    const audit = await t.run(async (ctx) => ctx.db.query("auditEvents").collect())
    expect(audit.filter((event) => event.action === "kitchen.status")).toHaveLength(1)
  })
})

async function seedFixture(t: ReturnType<typeof convexTest>) {
  const cashierToken = "cashier-test-token"
  const result = await t.run(async (ctx) => {
    const restaurantId = await ctx.db.insert("restaurants", {
      externalId: "sandyq-test",
      organizationExternalId: "sandyq",
      name: "Sandyq · Тест",
      address: "Тестовая, 1",
      timezone: "Asia/Almaty",
      city: "Алматы",
      currency: "KZT",
      active: true,
    })
    const terminalId = await ctx.db.insert("posTerminals", {
      externalId: "terminal-test-1",
      restaurantId,
      name: "Касса 1",
      terminalNumber: 1,
      nextOrderNumber: 1,
      active: true,
    })
    const employeeBase = { restaurantIds: [restaurantId], pinSalt: "test", pinHash: "test", active: true, failedAttempts: 0 }
    const cashierId = await ctx.db.insert("employees", { ...employeeBase, code: "101", displayName: "Кассир", role: "cashier" as const })
    const managerId = await ctx.db.insert("employees", { ...employeeBase, code: "900", displayName: "Менеджер", role: "manager" as const })
    await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
    const productId = await ctx.db.insert("products", {
      externalId: "test-dish",
      name: "Тестовое блюдо",
      nameKk: "Тест тағамы",
      nameSort: "тестовое блюдо",
      searchText: "тестовое блюдо",
      description: "",
      category: "hot",
      categorySort: 1,
      basePrice: 1000,
      popular: false,
      sku: "TEST-1",
      baseUnit: "порц." as const,
      enabled: true,
    })
    await ctx.db.insert("posSessions", {
      tokenHash: await digest(cashierToken),
      purpose: "operator",
      employeeId: cashierId,
      terminalId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })
    return { restaurantId, terminalId, cashierId, managerId, productId }
  })
  return { ...result, cashierToken }
}

async function createManagerApproval(t: ReturnType<typeof convexTest>, fixture: Awaited<ReturnType<typeof seedFixture>>) {
  const token = crypto.randomUUID()
  await t.run(async (ctx) => {
    await ctx.db.insert("posSessions", {
      tokenHash: await digest(token),
      purpose: "manager-approval",
      employeeId: fixture.managerId,
      terminalId: fixture.terminalId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })
  })
  return token
}

async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
