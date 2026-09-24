import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

const orders = api.domains.orders.mutations

const journal = (t: TestConvex<typeof schema>) => t.run((ctx) => ctx.db.query("journalEntries").take(100))
const account = (code: string) => `acc-${code}`

describe("settlement core (W1-POS-02)", () => {
  it("splits across three payment types and posts a balanced journal: payments to revenue, service charge apart", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    const types = (await t.query(api.domains.retail.queries.activeForPos, { sessionToken: cashier })).paymentTypes
    const id = (code: string) => types.find((type) => type.code === code)!.externalId
    await t.mutation(orders.checkout, {
      sessionToken: cashier,
      orderId: order._id,
      idempotencyKey: "pay-1",
      payments: [
        { paymentTypeExternalId: id("cash"), amount: 1000, tendered: 2000 },
        { paymentTypeExternalId: id("card"), amount: 800 },
        { paymentTypeExternalId: id("kaspi-qr"), amount: 500 },
      ],
    })
    const payments = await t.run((ctx) => ctx.db.query("payments").take(10))
    expect(payments.map((p) => [p.paymentTypeName, p.method, p.amount, p.change ?? null, Boolean(p.journalEntryId)])).toEqual([
      ["Наличные", "cash", 1000, 1000, true],
      ["Банковская карта", "card", 800, null, true],
      ["Kaspi QR", "qr", 500, null, true],
    ])
    const entries = await journal(t)
    const balance = new Map<string, number>()
    for (const entry of entries) {
      balance.set(entry.debitAccountExternalId, (balance.get(entry.debitAccountExternalId) ?? 0) + entry.amount)
      balance.set(entry.creditAccountExternalId, (balance.get(entry.creditAccountExternalId) ?? 0) - entry.amount)
    }
    expect([...balance.values()].reduce((sum, value) => sum + value, 0)).toBe(0)
    expect(balance.get(account("1010"))).toBe(1000) // cash
    expect(balance.get(account("1060"))).toBe(1300) // card + Kaspi in transit
    expect(balance.get(account("6010"))).toBe(-2000) // revenue net of the service charge
    expect(balance.get(account("6030"))).toBe(-300) // service charge
    const outbox = await t.run((ctx) => ctx.db.query("outboxEvents").take(20))
    expect(outbox.filter((event) => event.eventType === "order.paid")).toHaveLength(1)

    // Replay: nothing is paid or posted twice.
    const replay = await t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "pay-1", payments: [{ method: "cash", amount: 2300 }] })
    expect(replay.duplicate).toBe(true)
    expect(await t.run((ctx) => ctx.db.query("payments").take(10))).toHaveLength(3)
    expect(await journal(t)).toHaveLength(entries.length)
  })

  it("rejects change on a non-cash type and a non-combinable type in a split", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "k1", payments: [{ method: "card", amount: 2300, tendered: 3000 }] })).rejects.toThrow(/Сдача возможна только/)
    await t.run(async (ctx) => {
      const card = (await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", "payment-type-card")).unique())!
      if (card.data.kind === "payment-type") await ctx.db.patch(card._id, { data: { ...card.data, combinable: false } })
    })
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "k2", payments: [{ method: "card", amount: 1300 }, { method: "cash", amount: 1000 }] })).rejects.toThrow(/нельзя комбинировать/)
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "k3", payments: [{ paymentTypeExternalId: "payment-type-nope", amount: 2300 }] })).rejects.toThrow(/недоступен/)
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "k4", payments: [{ method: "cash", amount: 2000 }] })).rejects.toThrow(/не равна/)
  })

  it("refunds by the original payment type: Dr sales returns, Cr that type's account", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "pay", payments: [{ method: "cash", amount: 1300 }, { method: "qr", amount: 1000 }] })
    await expect(t.mutation(orders.refund, { sessionToken: cashier, orderId: order._id, idempotencyKey: "r0", amount: 1200, paymentTypeExternalId: "payment-type-kaspi-qr", reason: "Гость вернул", managerApprovalToken: "m1" })).rejects.toThrow(/исходный способ/)
    await t.mutation(orders.refund, { sessionToken: cashier, orderId: order._id, idempotencyKey: "r1", amount: 1000, paymentTypeExternalId: "payment-type-kaspi-qr", reason: "Гость вернул", managerApprovalToken: "m2" })
    const refund = (await t.run((ctx) => ctx.db.query("payments").take(10))).find((p) => p.type === "refund")!
    expect(refund).toMatchObject({ method: "qr", paymentTypeName: "Kaspi QR", journalEntryId: "refund:r1" })
    const entry = (await journal(t)).find((row) => row.externalId === "refund:r1")!
    expect(entry).toMatchObject({ debitAccountExternalId: account("6020"), creditAccountExternalId: account("1060"), amount: 1000 })
    // Payment entries are not reversed by the refund (only cost of goods is).
    expect((await journal(t)).filter((row) => row.reversalOf)).toHaveLength(0)
  })

  it("keeps selling before the chart of accounts and retail settings exist (legacy method, no journal)", async () => {
    const { t, productId } = await setup({ ledger: false })
    const order = await draft(t, productId)
    const result = await t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300, tendered: 5000 }] })
    expect(result.receipt).toMatchObject({ status: "paid" })
    const [payment] = await t.run((ctx) => ctx.db.query("payments").take(1))
    expect(payment).toMatchObject({ method: "cash", paymentTypeName: "Наличные", change: 2700 })
    expect(payment.paymentTypeExternalId).toBeUndefined()
    expect(await journal(t)).toHaveLength(0)
  })

  it("refuses payment in a closed period", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    await t.run((ctx) => ctx.db.insert("periodLocks", { externalId: "lock", organizationExternalId: "sandyq", kind: "final", lockedThrough: Date.now() + 86_400_000 * 3, active: true, reason: "Закрытие", createdBy: "admin", createdAt: 1 }))
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300 }] })).rejects.toThrow(/закрыт/i)
    expect(await t.run((ctx) => ctx.db.query("payments").take(1))).toHaveLength(0)
  })
})
