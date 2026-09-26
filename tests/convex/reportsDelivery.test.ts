import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { REPORT_REGISTRY } from "../../convex/domains/reports/registry"
import type { ReportConfig } from "../../convex/lib/reportConfig"
import schema from "../../convex/schema"
import { cashier, setup } from "./fixtures/pos"

// W3-RPT-03: delivery and call-center reports. One real order through the office mutations (the
// status times the office marks, the KDS ticket, the payment), then a synthetic day of orders and
// calls for the numbers: SLA, lateness, courier times, commission, calls, missed calls, conversion.

const modules = import.meta.glob("../../convex/**/*.ts")
const delivery = api.domains.delivery
const at = (date: string, time: string) => Date.parse(`${date}T${time}+05:00`)
const DAY: ReportConfig = { dateFrom: "2026-09-10", dateTo: "2026-09-11", restaurantExternalIds: [] }
const square = [
  { latitude: 43.2, longitude: 76.8 },
  { latitude: 43.2, longitude: 77.0 },
  { latitude: 43.3, longitude: 77.0 },
  { latitude: 43.3, longitude: 76.8 },
]

const cellsOf = (result: { rows: { key: string; cells: Record<string, number | string> }[] }) => Object.fromEntries(result.rows.map((row) => [String(row.cells.group), row.cells]))

describe("delivery status times and the KDS (W3-RPT-03)", () => {
  it("the office marks assignedAt and pickedUpAt; 14, 15, 16 and 19 read the real order", async () => {
    const { t } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Оператор", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    })
    await t.mutation(internal.domains.delivery.internal.seedSources, {})
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    await admin.mutation(delivery.mutations.saveZone, { restaurantExternalId: "almaty", name: "Центр", priority: 1, polygon: square, deliveryFee: 500, minimumOrder: 1500, cookingMinutes: 20, deliveryMinutes: 30, active: true })
    const saved = await admin.mutation(delivery.mutations.saveOrder, { restaurantExternalId: "almaty", customerName: "Айгерим", phone: "+7 701 123 45 67", address: "Абая 10", latitude: 43.25, longitude: 76.9, sourceExternalId: "source-phone", expectedAt: Date.now() + 3_600_000, comment: "", lines: [{ productExternalId: "dish", quantity: 2 }] })
    let version = 1
    const go = async (to: "waiting" | "ready-to-cook" | "cooking" | "on-way" | "delivered" | "closed", extra: Record<string, unknown> = {}) => (version = (await admin.mutation(delivery.mutations.transitionOrder, { externalId: saved.externalId, to, expectedVersion: version, ...extra })).version)
    await go("waiting")
    await go("ready-to-cook")
    await go("cooking")
    const ticket = await t.run(async (ctx) => (await ctx.db.query("kitchenTickets").take(10)).find((row) => row.source === "delivery")!)
    await t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: cashier, ticketId: ticket._id, status: "preparing" })
    await t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: cashier, ticketId: ticket._id, status: "ready" })
    const courier = await admin.mutation(delivery.mutations.saveCourier, { employeeCode: "101", restaurantExternalId: "almaty", name: "", phone: "+77010000090", transport: "scooter", active: true })
    await admin.mutation(delivery.mutations.setCourierStatus, { externalId: courier, status: "available" })
    version = (await admin.query(delivery.queries.order, { externalId: saved.externalId }))!.version
    version = (await admin.mutation(delivery.mutations.assignCourier, { deliveryExternalId: saved.externalId, courierExternalId: courier, expectedVersion: version })).version
    const assigned = await t.run(async (ctx) => (await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", saved.externalId)).unique())!)
    expect(assigned.assignedAt).toBeTypeOf("number")
    expect(assigned.pickedUpAt).toBeUndefined()
    await go("on-way")
    await t.run(async (ctx) => {
      const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "almaty-delivery")).unique())!
      const opener = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!
      await ctx.db.insert("shifts", { restaurantId: terminal.restaurantId, terminalId: terminal._id, number: 1, businessDate: "2026-09-25", status: "open", openedBy: opener._id, openedAt: Date.now(), openingCash: 0, openingNote: "" })
    })
    await go("delivered", { payment: { paymentTypeExternalId: "payment-type-cash", amount: 2500 } })
    const done = await t.run(async (ctx) => (await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", saved.externalId)).unique())!)
    expect(done.assignedAt).toBe(assigned.assignedAt)
    expect(done.pickedUpAt).toBeGreaterThanOrEqual(done.assignedAt!)
    expect(done.actualDeliveredAt).toBeGreaterThanOrEqual(done.pickedUpAt!)

    // Spread the marks over real minutes: 18 in the kitchen, 7 waiting for the courier, 25 on the way.
    const start = done.createdAt
    await t.run(async (ctx) => {
      const tickets = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", done.orderId!)).take(10)
      for (const row of tickets) await ctx.db.patch(row._id, { createdAt: start, readyAt: start + 18 * 60_000 })
      await ctx.db.patch(done._id, { assignedAt: start + 20 * 60_000, pickedUpAt: start + 27 * 60_000, actualDeliveredAt: start + 52 * 60_000 })
    })
    const today = new Date(start + 5 * 3_600_000).toISOString().slice(0, 10)
    const config = { dateFrom: today, dateTo: today, restaurantExternalIds: [] }
    const run = (reportId: string) => t.run((ctx) => REPORT_REGISTRY[reportId].calculator(ctx, config, ["almaty"]))
    expect((await run("delivery-14")).rows[0].cells).toMatchObject({ group: today, orders: 1, average: 18, maximum: 18, norm: 20, withinPercent: 100 })
    expect((await run("delivery-15")).rows[0].cells).toMatchObject({ orders: 1, average: 7 })
    expect((await run("delivery-16")).rows[0].cells).toMatchObject({ orders: 1, average: 25, norm: 30, withinPercent: 100 })
    const payments = await run("delivery-19")
    expect(payments.rows.map((row) => [row.key, row.cells.payments, row.cells.amount, row.cells.net])).toEqual([["payment-type-cash", 1, 2500, 2500]])
  })
})

async function synthetic() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const [externalId, name] of [["almaty", "Алматы"], ["shymkent", "Шымкент"]]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name, address: "—", timezone: "Asia/Almaty", active: true })
    const source = { restaurantExternalIds: ["*"], confirmationRequired: false, settlementMode: "on-delivered" as const, active: true, updatedAt: 0 }
    await ctx.db.insert("deliverySources", { ...source, externalId: "source-phone", name: "Телефон", kind: "phone", commissionPercent: 0 })
    await ctx.db.insert("deliverySources", { ...source, externalId: "source-glovo", name: "Glovo", kind: "aggregator", commissionPercent: 20 })
    await ctx.db.insert("deliveryZones", { externalId: "zone-center", restaurantExternalId: "almaty", name: "Центр", priority: 1, polygon: square, deliveryFee: 500, minimumOrder: 0, cookingMinutes: 20, deliveryMinutes: 30, active: true, updatedAt: 0 })
    await ctx.db.insert("couriers", { externalId: "courier-1", employeeCode: "201", restaurantExternalId: "almaty", name: "Ерлан", phone: "+77010000090", transport: "scooter", status: "available", active: true, updatedAt: 0 })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "asel@sandyq.test", name: "Асель", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    const order = async (externalId: string, fields: { restaurant?: string; date?: string; time: string; status: "cooking" | "delivered" | "closed" | "cancelled"; total: number; phone?: string } & Record<string, unknown>) => {
      const { restaurant = "almaty", date = "2026-09-10", time, phone = "+77011234567", ...rest } = fields
      await ctx.db.insert("deliveryOrders", {
        externalId, organizationExternalId: "sandyq", restaurantExternalId: restaurant, number: externalId.toUpperCase(), customerName: "Айгерим", phone, address: "Абая 10", sourceExternalId: "source-phone",
        expectedAt: at(date, time) + 50 * 60_000, subtotal: fields.total, deliveryFee: 0, paymentStatus: "unpaid", comment: "", version: 1, searchText: "", createdAt: at(date, time), updatedAt: 0, ...rest,
      })
    }
    // o1: taken by the operator, in the zone, on time; o2: an aggregator's order, 20 minutes late.
    await order("o1", { time: "12:00:00", status: "closed", total: 3500, subtotal: 3000, deliveryFee: 500, zoneExternalId: "zone-center", courierExternalId: "courier-1", operatorKey: "asel@sandyq.test", cookingStartAt: at("2026-09-10", "12:00:00"), assignedAt: at("2026-09-10", "12:15:00"), pickedUpAt: at("2026-09-10", "12:25:00"), actualDeliveredAt: at("2026-09-10", "12:45:00"), paymentStatus: "paid" })
    await order("o2", { time: "13:00:00", status: "delivered", total: 5000, sourceExternalId: "source-glovo", phone: "+77015556677", zoneExternalId: "zone-center", courierExternalId: "courier-1", assignedAt: at("2026-09-10", "13:20:00"), pickedUpAt: at("2026-09-10", "13:40:00"), actualDeliveredAt: at("2026-09-10", "14:10:00"), commissionAmount: 1000, paymentStatus: "paid" })
    await order("o3", { time: "14:00:00", status: "cancelled", total: 2000, operatorKey: "asel@sandyq.test", cancelReason: "Гость отказался" })
    await order("o4", { time: "15:00:00", status: "cooking", total: 1500 })
    await order("o5", { restaurant: "shymkent", time: "12:00:00", status: "closed", total: 9999 })
    await order("o6", { date: "2026-09-11", time: "10:00:00", status: "cancelled", total: 1000, cancelReason: "гость отказался" })
  })
  const run = (reportId: string, restaurants = ["almaty"], config: ReportConfig = DAY) => t.run((ctx) => REPORT_REGISTRY[reportId].calculator(ctx, config, restaurants))
  return { t, run }
}

describe("delivery reports (W3-RPT-03)", () => {
  it("01–09: summaries by day, restaurant, source, channel, status, zone, operator, courier and client", async () => {
    const { run } = await synthetic()
    const overall = cellsOf(await run("delivery-01"))
    expect(overall["2026-09-10"]).toMatchObject({ orders: 4, done: 2, cancelled: 1, open: 1, revenue: 8500, averageCheck: 4250, late: 1, latePercent: 50 })
    expect(overall["2026-09-11"]).toMatchObject({ orders: 1, cancelled: 1, revenue: 0 })

    expect((await run("delivery-02", ["almaty", "shymkent"])).rows.map((row) => [row.cells.group, row.cells.orders])).toEqual([["Шымкент", 1], ["Алматы", 5]]) // by revenue
    expect((await run("delivery-02")).rows.map((row) => row.cells.group)).toEqual(["Алматы"]) // scope
    expect(cellsOf(await run("delivery-03"))).toMatchObject({ Телефон: { orders: 4, revenue: 3500 }, Glovo: { orders: 1, revenue: 5000, late: 1 } })
    expect(cellsOf(await run("delivery-04"))).toMatchObject({ Телефон: { orders: 4 }, Агрегатор: { orders: 1 } })
    expect((await run("delivery-05")).rows.map((row) => [row.cells.group, row.cells.orders])).toEqual([["Готовится", 1], ["Доставлен", 1], ["Закрыт", 1], ["Отменён", 2]])
    expect(cellsOf(await run("delivery-06"))).toMatchObject({ Центр: { orders: 2, done: 2 }, "Вне зон": { orders: 3 } })
    expect(cellsOf(await run("delivery-07"))).toMatchObject({ Асель: { orders: 2, done: 1, cancelled: 1 }, "Без оператора (сайт, агрегатор, офис)": { orders: 3 } })
    expect(cellsOf(await run("delivery-08"))).toMatchObject({ Ерлан: { orders: 2, done: 2, late: 1, transit: 25 }, "Не назначен": { orders: 3 } })

    const clients = await run("delivery-09")
    const regular = clients.rows.find((row) => row.cells.orders === 4)!
    expect(regular.cells).toMatchObject({ group: "Айгерим", done: 1, cancelled: 2, revenue: 3500, lastOrder: "2026-09-11" })
    expect(clients.kpis.find((kpi) => kpi.key === "repeat")?.value).toBe(1)
    expect(String(regular.cells.phone)).toContain("•") // no office.guests.pii: the phone is masked
    expect(JSON.stringify(clients)).not.toContain("77011234567")
  })

  it("11–13 cancellations and lateness, 15–17 courier times and the zone norm, 18 commission", async () => {
    const { run } = await synthetic()
    const cancelled = await run("delivery-11")
    expect(cancelled.rows.map((row) => [row.cells.group, row.cells.reason, row.cells.amount])).toEqual([["O3", "Гость отказался", 2000], ["O6", "гость отказался", 1000]])
    expect(cancelled.kpis.find((kpi) => kpi.key === "share")?.value).toBe(40)
    expect((await run("delivery-12")).rows.map((row) => [row.cells.group, row.cells.cancelled, row.cells.amount, row.cells.share])).toEqual([["Гость отказался", 2, 3000, 100]])

    const late = await run("delivery-13")
    expect(late.rows.map((row) => [row.cells.group, row.cells.courier, row.cells.promised, row.cells.delivered, row.cells.lateMinutes])).toEqual([["O2", "Ерлан", "13:50", "14:10", 20]])
    expect(late.kpis.map((kpi) => kpi.value)).toEqual([2, 1, 50, 20])

    expect((await run("delivery-15")).rows[0].cells).toMatchObject({ group: "Ерлан", orders: 2, average: 15, maximum: 20 })
    expect((await run("delivery-16")).rows[0].cells).toMatchObject({ group: "Ерлан", orders: 2, average: 25, maximum: 30, norm: 30, withinPercent: 100 })
    // o1 from its planned cooking start: 45 of 50 minutes; o2 from when it was taken: 70 minutes.
    expect((await run("delivery-17")).rows[0].cells).toMatchObject({ group: "Центр", orders: 2, average: 58, maximum: 70, norm: 50, withinPercent: 50 })

    const money = cellsOf(await run("delivery-18"))
    expect(money.Телефон).toMatchObject({ orders: 1, subtotal: 3000, deliveryFee: 500, total: 3500, commission: 0, net: 3500 })
    expect(money.Glovo).toMatchObject({ orders: 1, total: 5000, commission: 1000, net: 4000, commissionPercent: 20 })
  })

  it("20–23 say «Телефония не подключена» without calls; then calls, missed calls, conversion and operator load", async () => {
    const { t, run } = await synthetic()
    for (const reportId of ["delivery-20", "delivery-21", "delivery-22", "delivery-23"]) {
      const result = await run(reportId)
      expect(result.unavailable?.title, reportId).toBe("Телефония не подключена")
      expect(result.rows).toEqual([])
      expect(result.columns.length).toBeGreaterThan(0)
    }

    await t.run(async (ctx) => {
      const call = async (externalId: string, fields: { direction: "inbound" | "outbound"; status: "answered" | "missed" | "completed"; phone: string; time: string; restaurant?: string; talk?: number; operator?: string }) => {
        const startedAt = at("2026-09-10", fields.time)
        await ctx.db.insert("telephonyCalls", { externalId, provider: "test", direction: fields.direction, status: fields.status, phone: fields.phone, startedAt, ...(fields.restaurant ? { restaurantExternalId: fields.restaurant } : {}), ...(fields.operator ? { operatorKey: fields.operator } : {}), ...(fields.talk ? { answeredAt: startedAt + 30_000, endedAt: startedAt + 30_000 + fields.talk * 60_000 } : {}) })
      }
      await call("c1", { direction: "inbound", status: "completed", phone: "+77011234567", time: "11:55:00", restaurant: "almaty", talk: 4, operator: "asel@sandyq.test" }) // o1 follows at 12:00
      await call("c2", { direction: "inbound", status: "missed", phone: "+77019998877", time: "12:30:00", restaurant: "almaty" })
      await call("c3", { direction: "outbound", status: "completed", phone: "+77019998877", time: "12:40:00", restaurant: "almaty", talk: 1 }) // called back
      await call("c4", { direction: "inbound", status: "missed", phone: "+77010001122", time: "13:00:00", restaurant: "shymkent" })
      await call("c5", { direction: "inbound", status: "completed", phone: "+77010000001", time: "16:00:00", talk: 2, operator: "asel@sandyq.test" }) // central line, no restaurant
    })
    const calls = cellsOf(await run("delivery-20"))["2026-09-10"]
    expect(calls).toMatchObject({ calls: 3, inbound: 2, outbound: 1, answered: 2, missed: 1, talkMinutes: 5, averageTalk: 2.5 })

    const missed = await run("delivery-21")
    expect(missed.rows.map((row) => [row.cells.time, row.cells.calledBack, row.cells.callbackMinutes])).toEqual([["12:30", "Да", 10]])
    expect(String(missed.rows[0].cells.phone)).not.toContain("9998877")

    const conversion = cellsOf(await run("delivery-22"))["2026-09-10"]
    expect(conversion).toMatchObject({ inbound: 2, answered: 1, withOrder: 1, conversion: 100, revenue: 3500 })

    expect(cellsOf(await run("delivery-23")).Асель).toMatchObject({ calls: 1, answered: 1, talkMinutes: 4, orders: 2, ordersPerCall: 2 })

    // A network-wide user also sees the central line and every restaurant's calls.
    const admin = t.withIdentity({ email: "asel@sandyq.test" })
    const network = await admin.query(api.domains.reports.queries.execute, { reportId: "delivery-20", config: DAY })
    expect(network.rows[0].cells).toMatchObject({ calls: 5, missed: 2 })
  })

  it("delivery-10 (corporate clients) is switched off by the owner, not an empty table", async () => {
    const { t } = await synthetic()
    expect(REPORT_REGISTRY["delivery-10"]).toBeUndefined()
    const { REPORT_CATALOG } = await import("../../convex/domains/reports/catalog")
    expect(REPORT_CATALOG.find((report) => report.id === "delivery-10")).toMatchObject({ mechanicDisabled: true })
    const admin = t.withIdentity({ email: "asel@sandyq.test" })
    await expect(admin.query(api.domains.reports.queries.execute, { reportId: "delivery-10", config: DAY })).rejects.toThrow(/в разработке/)
    const coverage = await admin.query(api.domains.reports.queries.coverage, {})
    expect(coverage.mechanicDisabled).toBe(1)
    expect(coverage.implementedIds).not.toContain("delivery-10")
  })
})

