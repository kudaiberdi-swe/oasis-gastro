import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"

type MutationCtx = GenericMutationCtx<DataModel>

// Kitchen tickets (W1-KDS-01, W1-POS-04): one ticket per send — before payment by «На кухню», at
// checkout for whatever was not sent yet. Cancel, void and refund take tickets off the board (L-13).

const OPEN = ["queued", "preparing", "ready"] as const

/** A ticket for the given lines (already filtered to unsent, not voided); marks them sent. Null when empty. */
export async function createKitchenTicket(
  ctx: MutationCtx,
  args: { order: Doc<"orders">; lines: Doc<"orderLines">[]; restaurantId: Id<"restaurants">; source: Doc<"kitchenTickets">["source"]; now: number },
) {
  if (!args.lines.length) return null
  const ticketId = await ctx.db.insert("kitchenTickets", {
    orderId: args.order._id,
    orderNumber: args.order.number,
    status: "queued",
    fulfillment: args.order.orderType,
    source: args.source,
    restaurantId: args.restaurantId,
    ...(args.order.tableLabel ? { tableLabel: args.order.tableLabel } : {}),
    createdAt: args.now,
    updatedAt: args.now,
  })
  for (const line of args.lines) {
    const product = await ctx.db.get(line.productId)
    await ctx.db.insert("kitchenTicketLines", {
      ticketId,
      productExternalId: line.productExternalId ?? String(line.productId),
      productName: line.sizeLabel ? `${line.productName} · ${line.sizeLabel}` : line.productName,
      quantity: line.quantity,
      instructions: [...(line.kitchenModifiers ?? []).map((modifier) => modifier.label), ...line.modifiers],
      prepArea: product?.prepArea ?? "hot",
      orderLineId: line._id,
      status: "active",
    })
    await ctx.db.patch(line._id, { sentToKitchenAt: args.now, kitchenTicketId: ticketId })
  }
  return ticketId
}

/** Cancels the order's tickets that are still on the board. */
export async function cancelTicketsForOrder(ctx: MutationCtx, orderId: Id<"orders">, now: number) {
  const tickets = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(50)
  let cancelled = 0
  for (const ticket of tickets) {
    if (!(OPEN as readonly string[]).includes(ticket.status)) continue
    cancelled += 1
    await ctx.db.patch(ticket._id, { status: "cancelled", cancelledAt: now, updatedAt: now })
  }
  return cancelled
}

/** Cancels one order line on its ticket; a ticket with no active lines left is cancelled too. */
export async function cancelTicketLine(ctx: MutationCtx, line: Doc<"orderLines">, now: number) {
  if (!line.kitchenTicketId) return
  const ticket = await ctx.db.get(line.kitchenTicketId)
  if (!ticket) return
  const lines = await ctx.db.query("kitchenTicketLines").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).take(100)
  for (const row of lines) if (row.orderLineId === line._id) await ctx.db.patch(row._id, { status: "cancelled" })
  const active = lines.filter((row) => row.orderLineId !== line._id && row.status !== "cancelled")
  if (!active.length && (OPEN as readonly string[]).includes(ticket.status)) await ctx.db.patch(ticket._id, { status: "cancelled", cancelledAt: now, updatedAt: now })
  else await ctx.db.patch(ticket._id, { updatedAt: now })
}
