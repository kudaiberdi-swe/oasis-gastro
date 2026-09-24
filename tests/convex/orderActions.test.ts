import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

type T = TestConvex<typeof schema>
const orders = api.domains.orders.mutations
const order = (t: T, id: Id<"orders">) => t.run(async (ctx) => (await ctx.db.get(id))!)

describe("check actions (W1-POS-05/06/07)", () => {
  it("split keeps the sum, charges service on each check and carries sent lines with their ticket", async () => {
    const { t, productId } = await setup()
    const check = await draft(t, productId, 3) // 3000 + 450 = 3450
    const sent = await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: check._id })
    const [line] = sent.order.lines
    await expect(t.mutation(orders.split, { sessionToken: cashier, orderId: check._id, lines: [{ orderLineId: line._id, quantity: 3 }] })).rejects.toThrow(/хотя бы одна/)
    const result = await t.mutation(orders.split, { sessionToken: cashier, orderId: check._id, expectedVersion: sent.version, lines: [{ orderLineId: line._id, quantity: 1 }] })
    expect(result.original).toMatchObject({ subtotal: 2000, serviceChargeAmount: 300, total: 2300 })
    expect(result.created).toMatchObject({ subtotal: 1000, serviceChargeAmount: 150, total: 1150, status: "held", tableLabel: "Стол 1 /2", splitFromOrderId: check._id })
    expect(result.original.total + result.created.total).toBe(check.total)
    expect(result.created.lines[0]).toMatchObject({ quantity: 1, kitchenTicketId: line.kitchenTicketId })
    expect(result.created.lines[0].sentToKitchenAt).toBeDefined()
  })

  it("moves to a free table only and transfers to a terminal with an open shift", async () => {
    const { t, productId } = await setup()
    const one = await draft(t, productId)
    const two = await t.mutation(orders.saveDraft, { sessionToken: cashier, clientOrderId: "b", orderType: "dine-in", tableLabel: "Стол 2", discountPercent: 0, comment: "", lines: [{ productId, quantity: 1 }] })
    if ("outcome" in two) throw new Error()
    await expect(t.mutation(orders.moveToTable, { sessionToken: cashier, orderId: one._id, tableLabel: "Стол 2" })).rejects.toThrow(/уже открыт чек/)
    expect(await t.mutation(orders.moveToTable, { sessionToken: cashier, orderId: one._id, tableLabel: "Стол 7" })).toMatchObject({ tableLabel: "Стол 7" })

    expect(await t.query(api.domains.shifts.queries.availableTransferTargets, { sessionToken: cashier })).toEqual([])
    const target = await t.run(async (ctx) => {
      const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "t1")).unique())!
      return ctx.db.insert("posTerminals", { externalId: "t9", restaurantId: terminal.restaurantId, name: "Касса 9", terminalNumber: 9, nextOrderNumber: 1, active: true })
    })
    await t.mutation(orders.hold, { sessionToken: cashier, orderId: one._id })
    await expect(t.mutation(orders.transfer, { sessionToken: cashier, orderId: one._id, targetTerminalId: target, reason: "Смена стола", managerApprovalToken: "m1" })).rejects.toThrow(/откройте кассовую смену/)
  })

  it("cancels by a deletion reason: comment rule, write-off of what the kitchen got, tickets cancelled", async () => {
    const { t, productId } = await setup()
    const check = await draft(t, productId)
    await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: check._id })
    await expect(t.mutation(orders.cancel, { sessionToken: cashier, orderId: check._id, deletionReasonExternalId: "deletion-reason-cashier-error", managerApprovalToken: "m1" })).rejects.toThrow(/комментарий/)
    await t.mutation(orders.cancel, { sessionToken: cashier, orderId: check._id, deletionReasonExternalId: "deletion-reason-spoilage", comment: "Гость ушёл", managerApprovalToken: "m2" })
    expect((await order(t, check._id)).status).toBe("cancelled")
    const [event] = await t.run((ctx) => ctx.db.query("orderDeletionEvents").take(5))
    expect(event).toMatchObject({ deletionReasonName: "Порча", deletionReasonExternalId: "deletion-reason-spoilage", deletionReasonVersion: 1, writeOff: true })
    const [ticket] = await t.run((ctx) => ctx.db.query("kitchenTickets").take(5))
    expect(ticket.status).toBe("cancelled")
    // Legacy free-text reason still works.
    const other = await draft(t, productId)
    await t.mutation(orders.cancel, { sessionToken: cashier, orderId: other._id, reason: "Ошибка ввода", managerApprovalToken: "m3" })
    expect((await order(t, other._id)).status).toBe("cancelled")
  })

  it("refund by lines must match their share and announces order.refunded", async () => {
    const { t, productId } = await setup()
    const check = await draft(t, productId) // 2 × 1000 → 2300
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "p", payments: [{ method: "card", amount: 2300 }] })
    const lines = [{ orderLineId: check.lines[0]._id, quantity: 1 }]
    await expect(t.mutation(orders.refund, { sessionToken: cashier, orderId: check._id, idempotencyKey: "r0", amount: 1000, lines, method: "card", reason: "Не понравилось", managerApprovalToken: "m1" })).rejects.toThrow(/1150/)
    await t.mutation(orders.refund, { sessionToken: cashier, orderId: check._id, idempotencyKey: "r1", amount: 1150, lines, method: "card", reason: "Не понравилось", managerApprovalToken: "m2" })
    expect((await order(t, check._id)).status).toBe("partially_refunded")
    const events = await t.run((ctx) => ctx.db.query("outboxEvents").take(20))
    expect(events.find((event) => event.eventType === "order.refunded")?.payload).toMatchObject({ amount: 1150, full: false })
  })
})
