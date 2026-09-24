import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

type T = TestConvex<typeof schema>
const orders = api.domains.orders.mutations
const kitchen = api.domains.kitchen

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** A kitchen PIN session on the fixture terminal and a cashier of a second restaurant. */
async function extraSessions(t: T) {
  await t.run(async (ctx) => {
    const almaty = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
    const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "t1")).unique())!
    const session = { createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000, purpose: "operator" as const }
    const cook = await ctx.db.insert("employees", { code: "300", displayName: "Повар", role: "kitchen", restaurantIds: [almaty._id], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest("cook"), employeeId: cook, terminalId: terminal._id })
    const shymkent = await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    const otherTerminal = await ctx.db.insert("posTerminals", { externalId: "t2", restaurantId: shymkent, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
    const other = await ctx.db.insert("employees", { code: "201", displayName: "Кассир Б", role: "cashier", restaurantIds: [shymkent], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    await ctx.db.insert("posSessions", { ...session, tokenHash: await digest("other"), employeeId: other, terminalId: otherTerminal })
  })
}

const tickets = (t: T, orderId: Id<"orders">) => t.run((ctx) => ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(10))

async function addLine(t: T, order: Awaited<ReturnType<typeof draft>>, productId: Id<"products">) {
  const lines = order.lines.map((line) => ({ clientLineId: line.clientLineId ?? undefined, productId: line.productId, quantity: line.quantity }))
  const result = await t.mutation(orders.saveDraft, { sessionToken: cashier, clientOrderId: order.clientOrderId!, orderId: order._id, orderType: "dine-in", discountPercent: 0, comment: "", lines: [...lines, { clientLineId: crypto.randomUUID(), productId, quantity: 1 }] })
  if ("outcome" in result) throw new Error(result.outcome)
  return result
}

describe("kitchen before payment (W1-POS-04, W1-KDS-01)", () => {
  it("each send makes its own ticket; checkout only tickets what was not sent", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    const first = await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id, expectedVersion: order.version })
    await expect(t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id })).rejects.toThrow(/Нет новых позиций/)
    const more = await addLine(t, first.order, productId)
    await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id, expectedVersion: more.version })
    expect((await tickets(t, order._id)).map((ticket) => ticket.status)).toEqual(["queued", "queued"])
    const lines = await t.run((ctx) => ctx.db.query("kitchenTicketLines").take(20))
    expect(lines.map((line) => [line.quantity, line.prepArea, line.status])).toEqual([[2, "hot", "active"], [1, "hot", "active"]])

    const final = await t.run(async (ctx) => (await ctx.db.get(order._id))!)
    expect(final.kitchenSentAt).toBeDefined()
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "pay", payments: [{ method: "card", amount: final.total }] })
    expect(await tickets(t, order._id)).toHaveLength(2)
  })

  it("voiding a sent line needs a manager, cancels it on the ticket and recalculates the order", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    const sent = await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id })
    const [line] = sent.order.lines
    const reason = "deletion-reason-guest-refused"
    await expect(t.mutation(orders.voidLine, { sessionToken: cashier, orderId: order._id, orderLineId: line._id, deletionReasonExternalId: reason })).rejects.toThrow(/менеджер/i)
    const voided = await t.mutation(orders.voidLine, { sessionToken: cashier, orderId: order._id, orderLineId: line._id, deletionReasonExternalId: reason, managerApprovalToken: "m1" })
    expect(voided.order).toMatchObject({ subtotal: 0, serviceChargeAmount: 0, total: 0 })
    expect((await tickets(t, order._id))[0]).toMatchObject({ status: "cancelled" })
    expect(await t.query(kitchen.queries.board, { sessionToken: cashier })).toEqual([])
    const [event] = await t.run((ctx) => ctx.db.query("orderDeletionEvents").take(5))
    expect(event).toMatchObject({ orderLineId: line._id, deletionReasonName: "Отказ гостя", writeOff: false })

    // The cashier's client still holds the voided line: re-saving it does not bring it back.
    const again = await t.mutation(orders.saveDraft, { sessionToken: cashier, clientOrderId: order.clientOrderId!, orderId: order._id, orderType: "dine-in", discountPercent: 0, comment: "", lines: [{ clientLineId: line.clientLineId!, productId, quantity: 2 }] })
    expect("outcome" in again ? null : again.subtotal).toBe(0)
  })

  it("a write-off reason takes the recipe's stock to the reason's expense account, apart from sales", async () => {
    const { t, productId } = await setup()
    const meat = await t.run(async (ctx) => {
      const warehouse = await ctx.db.insert("warehouses", { externalId: "main", name: "Склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
      const item = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Мясо", nameSort: "мясо", searchText: "мясо", unit: "кг", kind: "ingredient", active: true })
      await applyStockMovement(ctx, { externalId: "open", kind: "document", sourceModuleId: "receipts", sourceExternalId: "open", sourceNumber: "0", warehouseId: warehouse, inventoryItemId: item, quantityDelta: 10, unitCost: 4000, occurredAt: Date.now() - 86_400_000 })
      const recipeId = await ctx.db.insert("recipes", { productId, createdAt: 1 })
      const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId, version: 1, effectiveFrom: 0, batchYield: 1, technology: "", status: "active", createdBy: "t", createdAt: 1 })
      await ctx.db.insert("recipeLines", { versionId, kind: "item", inventoryItemId: item, name: "Мясо", unit: "кг", quantity: 0.25, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 0 })
      await ctx.db.patch(productId, { writeOffMethod: "ingredients" })
      return item
    })
    const order = await draft(t, productId)
    await t.mutation(orders.voidLine, { sessionToken: cashier, orderId: order._id, orderLineId: order.lines[0]._id, deletionReasonExternalId: "deletion-reason-spoilage", comment: "Уронили", managerApprovalToken: "m1" })
    const movements = await t.run((ctx) => ctx.db.query("stockMovements").withIndex("by_source", (q) => q.eq("sourceExternalId", `${order._id}:void:${order.lines[0]._id}`)).take(5))
    expect(movements.map((row) => [row.inventoryItemId, row.kind, row.quantityDelta])).toEqual([[meat, "writeoff", -0.5]])
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").take(10))
    expect(entries.map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount])).toEqual([["acc-7480", "acc-1310", 2000]])
  })

  it("isolates boards by restaurant, supports bump-back and keeps the kitchen role off the till", async () => {
    const { t, productId } = await setup()
    await extraSessions(t)
    const order = await draft(t, productId)
    await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id })
    const [ticket] = await t.query(kitchen.queries.board, { sessionToken: "cook" })
    expect(ticket).toMatchObject({ orderNumber: order.number, tableLabel: "Стол 1" })
    expect(await t.query(kitchen.queries.board, { sessionToken: "other" })).toEqual([])
    await expect(t.mutation(kitchen.mutations.setStatus, { sessionToken: "other", ticketId: ticket._id, status: "preparing" })).rejects.toThrow(/не найден/)

    await t.mutation(kitchen.mutations.setStatus, { sessionToken: "cook", ticketId: ticket._id, status: "preparing" })
    expect((await tickets(t, order._id))[0].startedAt).toBeDefined()
    await t.mutation(kitchen.mutations.setStatus, { sessionToken: "cook", ticketId: ticket._id, status: "queued" })
    const [back] = await tickets(t, order._id)
    expect(back.status).toBe("queued")
    expect(back.startedAt).toBeUndefined()
    await expect(t.mutation(kitchen.mutations.setStatus, { sessionToken: "cook", ticketId: ticket._id, status: "ready" })).rejects.toThrow(/Недопустимый/)
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").take(50))
    expect(audit.map((row) => row.action)).toContain("kitchen.bump-back")

    await t.mutation(kitchen.mutations.setStatus, { sessionToken: "cook", ticketId: ticket._id, status: "preparing" })
    await t.mutation(kitchen.mutations.setStatus, { sessionToken: "cook", ticketId: ticket._id, status: "ready" })
    const outbox = await t.run((ctx) => ctx.db.query("outboxEvents").take(20))
    expect(outbox.map((row) => row.eventType)).toContain("kitchen.ready")

    await expect(t.mutation(orders.checkout, { sessionToken: "cook", orderId: order._id, idempotencyKey: "x", payments: [{ method: "cash", amount: order.total }] })).rejects.toThrow(/Кухня/)
    await expect(t.mutation(orders.sendToKitchen, { sessionToken: "cook", orderId: order._id })).rejects.toThrow(/Кухня/)
  })

  it("cancel and full refund take the order's tickets off the board", async () => {
    const { t, productId } = await setup()
    const toCancel = await draft(t, productId)
    await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: toCancel._id })
    await t.mutation(orders.cancel, { sessionToken: cashier, orderId: toCancel._id, reason: "Гость ушёл", managerApprovalToken: "m1" })
    expect((await tickets(t, toCancel._id))[0].status).toBe("cancelled")

    const paid = await draft(t, productId)
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: paid._id, idempotencyKey: "p", payments: [{ method: "cash", amount: paid.total }] })
    await t.mutation(orders.refund, { sessionToken: cashier, orderId: paid._id, idempotencyKey: "r", amount: paid.total, method: "cash", reason: "Возврат гостю", managerApprovalToken: "m2" })
    expect((await tickets(t, paid._id))[0].status).toBe("cancelled")
    expect(await t.query(kitchen.queries.board, { sessionToken: cashier })).toEqual([])
  })

  it("the kitchen picker offers kds terminals, and a kds terminal refuses till functions", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    expect((await t.query(api.domains.auth.queries.posTerminalOptions, { purpose: "kitchen" }))[0].terminals.map((row) => row.externalId)).toEqual(["t1"])
    await t.run(async (ctx) => {
      const terminal = (await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "t1")).unique())!
      const kds = await ctx.db.insert("posTerminals", { externalId: "kds-1", restaurantId: terminal.restaurantId, name: "Кухня", terminalNumber: 90, nextOrderNumber: 1, active: true, kind: "kds" })
      const cashierId = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!._id
      await ctx.db.insert("posSessions", { tokenHash: await digest("on-kds"), purpose: "operator", employeeId: cashierId, terminalId: kds, createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000 })
    })
    expect((await t.query(api.domains.auth.queries.posTerminalOptions, { purpose: "kitchen" }))[0].terminals.map((row) => row.externalId)).toEqual(["kds-1"])
    expect((await t.query(api.domains.auth.queries.posTerminalOptions, {}))[0].terminals.map((row) => row.externalId)).toEqual(["t1"])
    await t.mutation(orders.sendToKitchen, { sessionToken: cashier, orderId: order._id })
    expect(await t.query(kitchen.queries.board, { sessionToken: "on-kds" })).toHaveLength(1)
    await expect(t.mutation(orders.saveDraft, { sessionToken: "on-kds", clientOrderId: "x", orderType: "dine-in", discountPercent: 0, comment: "", lines: [] })).rejects.toThrow(/терминал кухни/)
  })
})
