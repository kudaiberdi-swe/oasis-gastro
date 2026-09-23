import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

describe("POS core flow", () => {
  it("handles two parallel table checks, service-charge math, checkout, and shift close", async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)

    await t.mutation(api.domains.shifts.mutations.open, {
      sessionToken: fixture.cashierToken,
      openingCash: 20_000,
      note: "Открытие",
    })

    const tableOne = await t.mutation(api.domains.orders.mutations.saveDraft, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "table-1",
      orderType: "dine-in",
      tableLabel: "Стол 1",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 2 }],
    })
    const tableTwo = await t.mutation(api.domains.orders.mutations.saveDraft, {
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

    const preview = await t.query(api.domains.shifts.queries.closePreview, { sessionToken: fixture.cashierToken })
    expect(preview).toMatchObject({ expectedCash: 22_300, blockers: [] }) // only the cash sale hits the drawer

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

    const created = await t.mutation(api.domains.orders.mutations.saveDraft, {
      sessionToken: fixture.cashierToken,
      clientOrderId: "occ-check",
      orderType: "dine-in",
      discountPercent: 0,
      comment: "",
      lines: [{ productId: fixture.productId, quantity: 1 }],
    })
    expect(created.version).toBe(1)

    // Simulates a second terminal having already saved an edit — this order's real version is now 2.
    await t.mutation(api.domains.orders.mutations.saveDraft, {
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

    const order = await t.mutation(api.domains.orders.mutations.saveDraft, {
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

    const order = await t.mutation(api.domains.orders.mutations.saveDraft, {
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
