import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ReportConfig } from "../../convex/lib/reportConfig"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

// W2-RPT-03: the other 11 sales reports. Every total over the facts reconciles with sales-01.

type T = TestConvex<typeof schema>

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
  })
  return t.withIdentity({ email: "admin@sandyq.test" })
}

const businessDate = (t: T) => t.run(async (ctx) => (await ctx.db.query("dailySalesFacts").take(1))[0].businessDate)
const run = (admin: ReturnType<T["withIdentity"]>, reportId: string, date: string, extra: Partial<{ groupBy: "hour" | "restaurant"; measure: "count"; search: string }> = {}) =>
  admin.query(api.domains.reports.queries.execute, { reportId, config: { dateFrom: date, dateTo: date, restaurantExternalIds: [], ...extra } })

async function saveOrder(t: T, lines: { productId: Id<"products">; quantity: number }[], extra: { tableLabel?: string; guestCount?: number } = {}) {
  const result = await t.mutation(api.domains.orders.mutations.saveDraft, { sessionToken: cashier, clientOrderId: crypto.randomUUID(), orderType: "dine-in", discountPercent: 0, comment: "", lines, ...extra })
  if ("outcome" in result) throw new Error(result.outcome)
  return result
}

/** Three sales: a dish and a bar drink at «Стол 5» for 3 guests (cash), one dish (card), one delivery via «Glovo». */
async function sales() {
  const { t, productId } = await setup()
  const admin = await office(t)
  const teaId = await t.run(async (ctx) => {
    await ctx.db.patch(productId, { prepArea: "hot" })
    const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
    await ctx.db.patch(restaurant._id, { serviceMode: "table-service" })
    return ctx.db.insert("products", { externalId: "tea", name: "Чай", nameKk: "Шай", nameSort: "чай", searchText: "чай", description: "", category: "hot", categorySort: 1, basePrice: 500, popular: false, sku: "T", baseUnit: "порц.", enabled: true, prepArea: "bar" })
  })
  const table = await saveOrder(t, [{ productId, quantity: 2 }, { productId: teaId, quantity: 1 }], { tableLabel: "Стол 5", guestCount: 3 }) // 2500 + 15 % = 2875
  await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: table._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2875 }] })
  const one = await draft(t, productId, 1) // 1150
  await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: one._id, idempotencyKey: "p2", payments: [{ method: "card", amount: 1150 }] })
  const delivered = await draft(t, productId, 1)
  await t.run(async (ctx) => {
    await ctx.db.insert("deliverySources", { externalId: "glovo", name: "Glovo", kind: "aggregator", restaurantExternalIds: ["*"], commissionPercent: 0, confirmationRequired: false, settlementMode: "on-closed", active: true, updatedAt: 0 })
    await ctx.db.insert("deliveryOrders", { externalId: "d1", orderId: delivered._id, organizationExternalId: "sandyq", restaurantExternalId: "almaty", number: "Д-1", status: "on-way", customerName: "Гость", phone: "+77010000000", address: "Абая, 1", sourceExternalId: "glovo", expectedAt: 0, subtotal: 1000, deliveryFee: 0, total: 1150, paymentStatus: "unpaid", comment: "", version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
  })
  await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: delivered._id, idempotencyKey: "p3", payments: [{ method: "card", amount: 1150 }] })
  const date = await businessDate(t)
  const byDay = await run(admin, "sales-01", date)
  return { t, admin, date, productId, total: byDay.totals as Record<string, number> }
}

describe("sales reports W2 (W2-RPT-03)", () => {
  it("stations, terminals × dishes, tables, restaurants, concepts, channels, 15 minutes and guests add up to sales-01", async () => {
    const { t, admin, date, total } = await sales()
    expect(total).toMatchObject({ netAmount: 2875 + 1150 + 1150, orderCount: 3, guestCount: 5 })

    const stations = await run(admin, "sales-03", date)
    expect(stations.totals.total).toBe(total.netAmount)
    expect(stations.rows[0].cells).toMatchObject({ group: date, "station:hot": 2300 + 1150 + 1150, "station:bar": 575 })
    expect(stations.columns.map((column) => column.label)).toEqual(["Дата", "Бар", "Горячий цех", "Итого"])
    expect((await run(admin, "sales-03", date, { measure: "count" })).totals).toMatchObject({ "station:bar": 1, "station:hot": 4 })

    const terminals = await run(admin, "sales-05", date)
    expect(terminals.totals.netAmount).toBe(total.netAmount)
    expect(terminals.rows.map((row) => [row.cells.terminal, row.cells.group, row.cells.quantity, row.cells.netAmount, row.cells.terminalShare])).toEqual([
      ["Касса 1", "Бешбармак", 4, 4600, 88.9],
      ["Касса 1", "Чай", 1, 575, 11.1],
    ])

    const tables = await run(admin, "sales-08", date)
    expect(tables.rows.find((row) => row.cells.group === "Стол 5")?.cells).toMatchObject({ orderCount: 1, guestCount: 3, netAmount: 2875, averageCheck: 2875 })
    expect(tables.totals.netAmount).toBe(total.netAmount)

    const restaurants = await run(admin, "sales-16", date)
    expect(restaurants.rows).toHaveLength(1)
    expect(restaurants.rows[0].cells).toMatchObject({ group: "Алматы", netAmount: total.netAmount, orderCount: 3, averageCheck: Math.round(total.netAmount / 3), share: 100 })

    const concepts = await run(admin, "sales-15", date)
    expect(concepts.rows.map((row) => [row.cells.group, row.cells.restaurants, row.cells.netAmount])).toEqual([["Ресторан с обслуживанием", 1, total.netAmount]])

    const channels = await run(admin, "sales-17", date)
    expect(channels.totals.netAmount).toBe(total.netAmount)
    expect(channels.rows.map((row) => [row.key, row.cells.group, row.cells.orderCount, row.cells.netAmount])).toEqual([
      ["pos", "Касса", 2, 4025],
      ["delivery-glovo", "Доставка · Glovo", 1, 1150],
    ])

    const quarters = await run(admin, "sales-18", date)
    expect(quarters.totals).toMatchObject({ netAmount: total.netAmount, orderCount: 3 })
    expect(quarters.rows.every((row) => /^\d{2}:\d{2}–\d{2}:\d{2}$/.test(String(row.cells.group)))).toBe(true)
    const hours = await run(admin, "sales-18", date, { groupBy: "hour" })
    expect(hours.totals.netAmount).toBe(total.netAmount)
    expect(hours.rows.length).toBeLessThanOrEqual(quarters.rows.length)

    const guests = await run(admin, "sales-25", date)
    expect(guests.rows[0].cells).toMatchObject({ orderCount: 3, guestCount: 5, guestsPerOrder: 1.67, averageCheck: Math.round(total.netAmount / 3), perGuest: Math.round(total.netAmount / 5) })
    expect(guests.kpis.find((kpi) => kpi.key === "guestsPerOrder")?.value).toBe(1.67)

    // The nightly rebuild replays the same events into the same new facts.
    const before = await t.run((ctx) => ctx.db.query("dailySalesFacts").take(200))
    await t.mutation(internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: "almaty", businessDate: date })
    const after = await t.run((ctx) => ctx.db.query("dailySalesFacts").take(200))
    const shape = (rows: typeof before) => rows.map((row) => `${row.factType}|${row.dimensionKey}|${row.netAmount}|${row.quantity}|${row.orderCount}`).sort()
    expect(shape(after)).toEqual(shape(before))
    expect(before.some((row) => row.factType === "terminal-product" && row.dimensionKey === "t1:tea")).toBe(true)
  })

  it("sales-17 nets a refund into its channel", async () => {
    const { t, admin, date } = await sales()
    const [order] = await t.run((ctx) => ctx.db.query("orders").withIndex("by_status_created", (q) => q.eq("status", "paid")).take(1))
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: order._id, idempotencyKey: "r1", amount: 500, method: "cash", reason: "Остыло", managerApprovalToken: "m1" })
    const channels = await run(admin, "sales-17", date)
    expect(channels.rows.find((row) => row.key === "pos")?.cells.refundAmount).toBe(500)
    expect(channels.totals.refundAmount).toBe((await run(admin, "sales-01", date)).totals.refundAmount)
  })

  it("sales-09: cash balance of an open shift from its operations, of a closed one from its Z-report", async () => {
    const { t, productId } = await setup()
    const admin = await office(t)
    const order = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: order._id, idempotencyKey: "r1", amount: 300, method: "cash", reason: "Остыло", managerApprovalToken: "m1" })
    await t.mutation(api.domains.shifts.mutations.recordCashMovement, { sessionToken: cashier, direction: "cash-in", amount: 500, reason: "Размен", idempotencyKey: "c1" })
    const date = await businessDate(t)
    const open = await run(admin, "sales-09", date)
    expect(open.rows[0].cells).toMatchObject({ terminal: "Касса 1", status: "Открыта", openingCash: 0, cashSales: 2300, cashRefunds: 300, cashIn: 500, cashOut: 0, expected: 2500, counted: 0, variance: 0 })
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 2400, note: "Не хватает 100" })
    const closed = await run(admin, "sales-09", date)
    expect(closed.rows[0].cells).toMatchObject({ status: "Закрыта", cashSales: 2300, cashRefunds: 300, cashIn: 500, expected: 2500, counted: 2400, variance: -100 })
    expect(String(closed.rows[0].cells.group)).toMatch(/^№1 · Z-/)
    expect(closed.kpis.find((kpi) => kpi.key === "variance")?.value).toBe(-100)
  })

  it("sales-24: payments of a type without revenue and zero checks at their nominal value", async () => {
    const { t, productId } = await setup()
    const admin = await office(t)
    await t.run((ctx) =>
      ctx.db.insert("retailSettings", { externalId: "payment-type-representation", kind: "payment-type", code: "representation", name: "Представительские", status: "published", effectiveFrom: 0, sortOrder: 9, restaurantExternalIds: [], data: { kind: "payment-type", processorKind: "cash", account: "cash", fiscal: false, revenue: false, manualEntry: false, externalAcceptance: false, combinable: false, allowsChange: false, opensCashDrawer: false }, version: 1, searchText: "", createdAt: 0, updatedAt: 0 }),
    )
    const guest = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: guest._id, idempotencyKey: "p1", payments: [{ paymentTypeExternalId: "payment-type-representation", amount: 2300 }] })
    const paid = await draft(t, productId, 1)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: paid._id, idempotencyKey: "p2", payments: [{ method: "card", amount: 1150 }] })
    const zero = await draft(t, productId, 1)
    await t.run((ctx) => ctx.db.patch(zero._id, { discountPercent: 100, serviceChargeAmount: 0, total: 0 }))
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: zero._id, idempotencyKey: "p3", payments: [] })
    const date = await businessDate(t)
    const report = await run(admin, "sales-24", date)
    expect(report.rows.map((row) => [row.cells.group, row.cells.kind, row.cells.count, row.cells.amount])).toEqual([
      ["Представительские", "Оплата без выручки", 1, 2300],
      ["Нулевой чек · Скидка 100%", "Нулевой чек", 1, 1000],
    ])
    expect(report.kpis).toEqual(expect.arrayContaining([{ key: "nominal", label: "Сумма по номиналу", value: 3300, unit: "money" }, { key: "zeroChecks", label: "Нулевых чеков", value: 1, unit: "count" }]))
  })

  it("sales-26: service time from open → payment and KDS send → ready and start → ready", async () => {
    const { t, productId } = await setup()
    const admin = await office(t)
    const order = await draft(t, productId)
    await t.run((ctx) => ctx.db.patch(order._id, { createdAt: Date.now() - 30 * 60_000 }))
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.run(async (ctx) => {
      const [ticket] = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(1)
      await ctx.db.patch(ticket._id, { status: "ready", startedAt: ticket.createdAt + 5 * 60_000, readyAt: ticket.createdAt + 12 * 60_000 })
    })
    const date = await businessDate(t)
    const report = await run(admin, "sales-26", date)
    expect(report.rows[0].cells).toMatchObject({ group: date, orderCount: 1, serviceMinutes: 30, tickets: 1, kitchenMinutes: 12, cookMinutes: 7 })
    expect(report.kpis.find((kpi) => kpi.key === "kitchen")?.value).toBe(12)
  })
})

// W1-RPT-06 leftovers: the OLAP constructor over the facts, the checks list over the orders and the
// refunds by check over the payments.
type Config = ReportConfig
const execute = (admin: ReturnType<T["withIdentity"]>, reportId: string, date: string, extra: Partial<Config> = {}) =>
  admin.query(api.domains.reports.queries.execute, { reportId, config: { dateFrom: date, dateTo: date, restaurantExternalIds: [], ...extra } })

describe("sales W1 leftovers (W1-RPT-06: sales-olap, sales-10, sales-20)", () => {
  it("sales-olap: groupings × measure from the facts reconcile with sales-01; two sales dimensions are refused", async () => {
    const { admin, date, total } = await sales()
    const byDay = await execute(admin, "sales-olap", date)
    expect(byDay.columns.map((column) => column.label)).toEqual(["День", "Выручка"])
    expect(byDay.rows.map((row) => [row.cells.group, row.cells.value])).toEqual([[date, total.netAmount]])
    expect(byDay.kpis.map((kpi) => kpi.value)).toEqual([total.netAmount, 3, Math.round(total.netAmount / 3)])

    const tables = await execute(admin, "sales-olap", date, { groupBy: "restaurant", secondaryGroupBy: "table", measure: "average" })
    expect(tables.columns.map((column) => column.key)).toEqual(["group", "secondary", "value", "orderCount", "netAmount"])
    expect(tables.rows.map((row) => [row.cells.group, row.cells.secondary, row.cells.value, row.cells.orderCount])).toEqual([["Алматы", "Стол 5", 2875, 1], ["Алматы", "Стол 1", 1150, 2]])
    expect(tables.totals).toEqual({ value: Math.round(total.netAmount / 3), orderCount: 3, netAmount: total.netAmount })

    const payments = await execute(admin, "sales-olap", date, { groupBy: "payment-type", measure: "count" })
    expect(payments.totals.value).toBe(3)
    expect(payments.columns[1].label).toBe("Оплат")
    const dishes = await execute(admin, "sales-olap", date, { groupBy: "product", secondaryGroupBy: "month" })
    expect(dishes.totals.value).toBe(total.netAmount)
    expect(dishes.rows.map((row) => [row.cells.group, row.cells.secondary])).toEqual([["Бешбармак", date.slice(0, 7)], ["Чай", date.slice(0, 7)]])
    const weeks = await execute(admin, "sales-olap", date, { groupBy: "week", measure: "count" })
    expect(weeks.rows).toHaveLength(1)
    expect(String(weeks.rows[0].cells.group)).toMatch(/^\d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/)

    await expect(execute(admin, "sales-olap", date, { groupBy: "product", secondaryGroupBy: "employee" })).rejects.toThrow(/Такая комбинация пока недоступна: «Блюдо» × «Официант»/)
    await expect(execute(admin, "sales-olap", date, { groupBy: "quarter-hour" })).rejects.toThrow(/Такая комбинация пока недоступна/)
  })

  it("sales-10: every check of the day with table, waiter, positions and status; a status filter", async () => {
    const { t, admin, date, total, productId } = await sales()
    await draft(t, productId, 3) // still open
    const report = await execute(admin, "sales-10", date)
    expect(report.rows.map((row) => [row.cells.table, row.cells.waiter, row.cells.lines, row.cells.total, row.cells.status])).toEqual([
      ["Стол 5", "Кассир", 3, 2875, "Оплачен"],
      ["Стол 1", "Кассир", 1, 1150, "Оплачен"],
      ["Стол 1", "Кассир", 1, 1150, "Оплачен"],
      ["Стол 1", "Кассир", 3, 3450, "Открыт"],
    ])
    expect(report.rows.every((row) => /^№\d+$/.test(String(row.cells.group)) && /^\d{2}:\d{2}$/.test(String(row.cells.time)))).toBe(true)
    expect(Object.fromEntries(report.kpis.map((kpi) => [kpi.key, kpi.value]))).toMatchObject({ checks: 4, sold: 3, soldTotal: total.netAmount, cancelled: 0 })
    expect(report.totals).toEqual({ lines: 8, total: total.netAmount + 3450 })
    expect(report.truncated).toBe(false)
    expect((await execute(admin, "sales-10", date, { extra: { status: "draft" } })).rows.map((row) => row.cells.status)).toEqual(["Открыт"])
    expect((await execute(admin, "sales-10", date, { search: "Стол 5" })).rows).toHaveLength(1)
  })

  it("sales-20: refunds by check with reason, cashier and kind; a payment without a restaurant is placed by its shift", async () => {
    const { t, admin, date } = await sales()
    const [table, one] = await t.run((ctx) => ctx.db.query("orders").withIndex("by_status_created", (q) => q.eq("status", "paid")).take(2))
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: table._id, idempotencyKey: "r1", amount: 500, method: "cash", reason: "Остыло", managerApprovalToken: "m1" })
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: one._id, idempotencyKey: "r2", amount: 1150, method: "card", reason: "Не понравилось", managerApprovalToken: "m2" })
    const report = await execute(admin, "sales-20", date)
    expect(report.rows.map((row) => [row.cells.check, row.cells.terminal, row.cells.amount, row.cells.kind, row.cells.reason, row.cells.cashier])).toEqual([
      [`№${table.number}`, "Касса 1", 500, "Частичный", "Остыло", "Кассир"],
      [`№${one.number}`, "Касса 1", 1150, "Полный", "Не понравилось", "Кассир"],
    ])
    expect(report.totals.amount).toBe((await execute(admin, "sales-01", date)).totals.refundAmount)
    expect(report.kpis.map((kpi) => kpi.value)).toEqual([1650, 2, 2])
    expect((await execute(admin, "sales-20", date, { search: "остыло" })).rows).toHaveLength(1)

    // A refund recorded before payments carried a restaurant (M-2) is found through its shift.
    await t.run(async (ctx) => {
      const refund = (await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", table._id)).take(10)).find((payment) => payment.type === "refund")!
      await ctx.db.patch(refund._id, { restaurantId: undefined })
      await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true })
    })
    expect((await execute(admin, "sales-20", date)).rows.map((row) => row.cells.amount)).toEqual([500, 1150])
    expect((await execute(admin, "sales-20", date, { restaurantExternalIds: ["astana"] })).rows).toEqual([])
  })
})
