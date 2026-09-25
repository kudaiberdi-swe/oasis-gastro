import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { canTransitionDelivery, deliveryTransitions, pointInPolygon, polygonSelfIntersects } from "../../convex/lib/deliveryCore"
import { cashier, setup } from "./fixtures/pos"

const delivery = api.domains.delivery
const square = [
  { latitude: 43.2, longitude: 76.8 },
  { latitude: 43.2, longitude: 77.0 },
  { latitude: 43.3, longitude: 77.0 },
  { latitude: 43.3, longitude: 76.8 },
]
const inside = { latitude: 43.25, longitude: 76.9 }

describe("delivery core (W2-DLV-01)", () => {
  it("point in polygon: inside, outside, on the border; self-intersection", () => {
    expect(pointInPolygon(inside, square)).toBe(true)
    expect(pointInPolygon({ latitude: 43.35, longitude: 76.9 }, square)).toBe(false)
    expect(pointInPolygon({ latitude: 43.2, longitude: 76.9 }, square)).toBe(true)
    expect(pointInPolygon(inside, square.slice(0, 2))).toBe(false)
    expect(polygonSelfIntersects(square)).toBe(false)
    expect(polygonSelfIntersects([square[0], square[2], square[1], square[3]])).toBe(true)
  })

  it("transition table", () => {
    const all = Object.keys(deliveryTransitions) as (keyof typeof deliveryTransitions)[]
    for (const from of all) for (const to of all) expect(canTransitionDelivery(from, to)).toBe(deliveryTransitions[from].includes(to))
    expect(canTransitionDelivery("closed", "on-way")).toBe(false)
    expect(canTransitionDelivery("delivered", "on-way")).toBe(true)
  })
})

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Оператор", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "other", email: "other@sandyq.test", name: "Чужой", roleExternalId: "administrator", restaurantScopes: ["shymkent"], organizationScopes: ["*"], active: true })
  })
  await t.mutation(internal.domains.delivery.internal.seedSources, {})
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  await admin.mutation(delivery.mutations.saveZone, { restaurantExternalId: "almaty", name: "Центр", priority: 1, polygon: square, deliveryFee: 500, minimumOrder: 1500, cookingMinutes: 20, deliveryMinutes: 30, active: true })
  return { admin, other: t.withIdentity({ email: "other@sandyq.test" }) }
}

const body = (quantity: number, extra: Record<string, unknown> = {}) => ({ restaurantExternalId: "almaty", customerName: "Айгерим", phone: "+7 701 123 45 67", address: "Абая 10", ...inside, sourceExternalId: "source-phone", expectedAt: Date.now() + 3_600_000, comment: "", lines: [{ productExternalId: "dish", quantity }], ...extra })

async function openDeliveryShift(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "almaty-delivery")).unique())!
    const opener = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!
    await ctx.db.insert("shifts", { restaurantId: terminal.restaurantId, terminalId: terminal._id, number: 1, businessDate: "2026-09-25", status: "open", openedBy: opener._id, openedAt: Date.now(), openingCash: 0, openingNote: "" })
  })
}

describe("delivery orders (W2-DLV-02/03/07)", () => {
  it("prices by the catalog, checks the zone minimum, scope and versions", async () => {
    const { t, productId } = await setup()
    const { admin, other } = await office(t)
    await expect(admin.mutation(delivery.mutations.saveOrder, body(1))).rejects.toThrow(/Минимальная сумма/)
    await t.run((ctx) => ctx.db.insert("productPrices", { productId, restaurantExternalId: "almaty", priceKzt: 1200 }))
    const saved = await admin.mutation(delivery.mutations.saveOrder, body(2))
    expect(saved).toMatchObject({ number: "DEL-000001", total: 2400 + 500 })
    const card = (await admin.query(delivery.queries.order, { externalId: saved.externalId }))!
    expect(card).toMatchObject({ status: "unprocessed", subtotal: 2400, deliveryFee: 500, zone: { name: "Центр" } })
    expect(card.cookingStartAt).toBe(card.expectedAt - 50 * 60_000)
    expect(await other.query(delivery.queries.order, { externalId: saved.externalId })).toBeNull()
    await expect(other.mutation(delivery.mutations.saveOrder, body(2))).rejects.toThrow(/Нет доступа/)
    const page = await admin.query(delivery.queries.overview, { tab: "unprocessed", paginationOpts: { numItems: 20, cursor: null } })
    expect(page.page.map((row) => row.number)).toEqual(["DEL-000001"])
    await admin.mutation(delivery.mutations.saveOrder, { ...body(3), externalId: saved.externalId, expectedVersion: 1 })
    await expect(admin.mutation(delivery.mutations.saveOrder, { ...body(4), externalId: saved.externalId, expectedVersion: 1 })).rejects.toThrow(/изменён/)
  })

  it("runs to delivered once: kitchen ticket, cooked from the KDS, courier, payment, postings, stock facts", async () => {
    const { t } = await setup()
    const { admin } = await office(t)
    const saved = await admin.mutation(delivery.mutations.saveOrder, body(2))
    let version = 1
    const go = async (to: string, extra: Record<string, unknown> = {}) => (version = (await admin.mutation(delivery.mutations.transitionOrder, { externalId: saved.externalId, to: to as "waiting", expectedVersion: version, ...extra })).version)
    await go("waiting")
    await go("ready-to-cook")
    const ticket = await t.run(async (ctx) => (await ctx.db.query("kitchenTickets").take(10)).find((row) => row.source === "delivery")!)
    expect(ticket).toMatchObject({ fulfillment: "delivery", status: "queued" })
    await go("cooking")
    await t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: cashier, ticketId: ticket._id, status: "preparing" })
    await t.mutation(api.domains.kitchen.mutations.setStatus, { sessionToken: cashier, ticketId: ticket._id, status: "ready" })
    let card = (await admin.query(delivery.queries.order, { externalId: saved.externalId }))!
    expect(card.status).toBe("cooked")
    version = card.version

    await expect(go("on-way")).rejects.toThrow(/Назначьте курьера/)
    const courier = await admin.mutation(delivery.mutations.saveCourier, { employeeCode: "101", restaurantExternalId: "almaty", name: "", phone: "+77010000090", transport: "scooter", active: true })
    await expect(admin.mutation(delivery.mutations.assignCourier, { deliveryExternalId: saved.externalId, courierExternalId: courier, expectedVersion: version })).rejects.toThrow(/занят/)
    await admin.mutation(delivery.mutations.setCourierStatus, { externalId: courier, status: "available" })
    version = (await admin.mutation(delivery.mutations.assignCourier, { deliveryExternalId: saved.externalId, courierExternalId: courier, expectedVersion: version })).version
    await go("on-way")
    await expect(go("delivered", { payment: { paymentTypeExternalId: "payment-type-cash" } })).rejects.toThrow(/Откройте смену/)
    await openDeliveryShift(t)
    await go("delivered", { payment: { paymentTypeExternalId: "payment-type-cash", amount: 2500 } })
    await go("closed")
    card = (await admin.query(delivery.queries.order, { externalId: saved.externalId }))!
    expect(card).toMatchObject({ status: "closed", paymentStatus: "paid", courier: { status: "available" } })

    const facts = await t.run(async (ctx) => {
      const order = (await ctx.db.get(card.orderId!))!
      const payments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).collect()
      const entries = await ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", String(order._id))).collect()
      return { order, payments, entries }
    })
    expect(facts.order).toMatchObject({ status: "paid", total: 2500 })
    expect(facts.payments.map((row) => row.amount)).toEqual([2500])
    expect(facts.entries.map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount]).sort()).toEqual([["acc-1010", "acc-6010", 2500], ["acc-6010", "acc-6030", 500]].sort())
  })

  it("cancelling after cooking takes the ticket off the board; an aggregator's commission is posted", async () => {
    const { t } = await setup()
    const { admin } = await office(t)
    const first = await admin.mutation(delivery.mutations.saveOrder, body(2))
    let version = 1
    for (const to of ["waiting", "ready-to-cook", "cooking"] as const) version = (await admin.mutation(delivery.mutations.transitionOrder, { externalId: first.externalId, to, expectedVersion: version })).version
    await expect(admin.mutation(delivery.mutations.transitionOrder, { externalId: first.externalId, to: "cancelled", expectedVersion: version })).rejects.toThrow(/причину/)
    await admin.mutation(delivery.mutations.transitionOrder, { externalId: first.externalId, to: "cancelled", expectedVersion: version, reason: "Гость отказался" })
    expect(await t.run(async (ctx) => (await ctx.db.query("kitchenTickets").take(10)).map((row) => row.status))).toEqual(["cancelled"])

    const aggregator = await admin.mutation(delivery.mutations.saveSource, { name: "Агрегатор", kind: "aggregator", restaurantExternalIds: ["almaty"], commissionPercent: 20, confirmationRequired: false, settlementMode: "on-delivered", defaultPaymentTypeExternalId: "payment-type-card", active: true })
    await expect(admin.mutation(delivery.mutations.saveSource, { name: "Плохой", kind: "app", restaurantExternalIds: ["almaty"], commissionPercent: 120, confirmationRequired: false, settlementMode: "on-delivered", active: true })).rejects.toThrow(/от 0 до 100/)
    const second = await admin.mutation(delivery.mutations.saveOrder, body(2, { sourceExternalId: aggregator }))
    const courier = await admin.mutation(delivery.mutations.saveCourier, { employeeCode: "101", restaurantExternalId: "almaty", name: "Курьер", phone: "+77010000090", transport: "car", active: true })
    await admin.mutation(delivery.mutations.setCourierStatus, { externalId: courier, status: "available" })
    await openDeliveryShift(t)
    version = 1
    for (const to of ["waiting", "ready-to-cook", "cooking", "cooked", "on-way", "delivered"] as const) version = (await admin.mutation(delivery.mutations.transitionOrder, { externalId: second.externalId, to, expectedVersion: version, courierExternalId: courier })).version
    const card = (await admin.query(delivery.queries.order, { externalId: second.externalId }))!
    expect(card).toMatchObject({ paymentStatus: "paid", commissionAmount: 500 })
    const commission = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", second.externalId)).collect())
    expect(commission.map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount])).toEqual([["acc-7110", "acc-1250", 500]])
  })
})
