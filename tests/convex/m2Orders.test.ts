import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const m2 = internal.migrations.m2Orders
const all = { paginationOpts: { numItems: 100, cursor: null } }

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  await t.mutation(internal.domains.retail.internal.seedDefaults, {})
  // Documents shaped as before W1-POS-01: no settings links, no businessDate.
  await t.run(async (ctx) => {
    const restaurantId = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true, businessDayCutoffMinutes: 240 })
    const employeeId = await ctx.db.insert("employees", { code: "1", displayName: "Кассир", role: "cashier", restaurantIds: [restaurantId], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    const terminalId = await ctx.db.insert("posTerminals", { externalId: "t", restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 2, active: true })
    const shiftId = await ctx.db.insert("shifts", { restaurantId, terminalId, number: 1, businessDate: "2026-09-20", status: "closed", openedBy: employeeId, openedAt: 0, openingCash: 0, openingNote: "" })
    const createdAt = Date.parse("2026-09-21T02:00:00+05:00") // before the 04:00 cutoff → 2026-09-20
    const paid = await ctx.db.insert("orders", { number: 1, orderType: "dine-in", status: "paid", discountPercent: 0, subtotal: 1000, serviceChargePercent: 15, serviceChargeAmount: 150, total: 1150, restaurantId, createdAt, searchText: "1" })
    await ctx.db.insert("orders", { number: 2, orderType: "takeaway", status: "draft", discountPercent: 0, subtotal: 500, serviceChargePercent: 0, serviceChargeAmount: 0, total: 500, restaurantId, originatingShiftId: shiftId, createdAt, searchText: "2" })
    const productId = await ctx.db.insert("products", { externalId: "p", name: "Бешбармак", nameKk: "Бешбармақ", nameSort: "бешбармак", searchText: "бешбармак", description: "", category: "c", categorySort: 1, basePrice: 500, popular: false, sku: "p", baseUnit: "порц.", enabled: true })
    await ctx.db.insert("orderLines", { orderId: paid, productId, productName: "Бешбармак", quantity: 2, unitPrice: 500, modifiers: ["без лука"] })
    await ctx.db.insert("payments", { orderId: paid, shiftId, type: "sale", method: "qr", amount: 1150, idempotencyKey: "k", status: "recorded", createdBy: employeeId, createdAt })
  })
  return t
}

describe("M-2 orders migration (W1-POS-01)", () => {
  it("dry run counts without writing, then fills links, business dates and kitchen modifiers", async () => {
    const t = await setup()
    expect(await t.mutation(m2.backfillOrders, { ...all, dryRun: true })).toMatchObject({ scanned: 2, patched: 2, missingSettings: [], isDone: true })
    expect(await t.mutation(m2.backfillLines, { ...all, dryRun: true })).toMatchObject({ patched: 1 })
    expect(await t.mutation(m2.backfillPayments, { ...all, dryRun: true })).toMatchObject({ patched: 1, missingSettings: [] })
    expect((await t.run((ctx) => ctx.db.query("orders").take(10))).every((order) => order.orderTypeExternalId === undefined)).toBe(true)

    await t.mutation(m2.backfillOrders, all)
    await t.mutation(m2.backfillLines, all)
    await t.mutation(m2.backfillPayments, all)
    const orders = await t.run((ctx) => ctx.db.query("orders").take(10))
    expect(orders.map((order) => [order.number, order.orderTypeName, order.businessDate])).toEqual([
      [1, "В зале", "2026-09-20"],
      [2, "С собой", "2026-09-20"],
    ])
    const [line] = await t.run((ctx) => ctx.db.query("orderLines").take(1))
    expect(line).toMatchObject({ kitchenModifiers: [{ label: "без лука", quantity: 1 }], lineTotal: 1000, migratedBy: "M-2" })
    const [payment] = await t.run((ctx) => ctx.db.query("payments").take(1))
    expect(payment).toMatchObject({ paymentTypeExternalId: "payment-type-kaspi-qr", paymentTypeName: "Kaspi QR", processorKind: "qr" })
    expect(payment.restaurantId).toBeDefined()

    expect((await t.mutation(m2.backfillOrders, all)).patched).toBe(0) // idempotent
    expect((await t.mutation(m2.backfillPayments, all)).patched).toBe(0)
  })

  it("rollback removes only what M-2 added", async () => {
    const t = await setup()
    await t.mutation(m2.backfillPayments, all)
    expect(await t.mutation(m2.rollback, { table: "payments", ...all, dryRun: true })).toMatchObject({ reverted: 1 })
    await t.mutation(m2.rollback, { table: "payments", ...all })
    const [payment] = await t.run((ctx) => ctx.db.query("payments").take(1))
    expect(payment.paymentTypeExternalId).toBeUndefined()
    expect(payment.migratedBy).toBeUndefined()
    expect(payment.method).toBe("qr")
  })
})
