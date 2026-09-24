import type { GenericQueryCtx } from "convex/server"
import type { DataModel, Doc, Id } from "../../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

// Interim until kitchenTickets.restaurantId + M-7 (W1-KDS-01): a ticket belongs to its order's
// restaurant, falling back to the order terminal's restaurant for orders saved without one.
export async function ticketRestaurantId(ctx: QueryCtx, ticket: Doc<"kitchenTickets">): Promise<Id<"restaurants"> | null> {
  const order = await ctx.db.get(ticket.orderId)
  if (!order) return null
  if (order.restaurantId) return order.restaurantId
  if (!order.terminalId) return null
  const terminal = await ctx.db.get(order.terminalId)
  return terminal?.restaurantId ?? null
}
