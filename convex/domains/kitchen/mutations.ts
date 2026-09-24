import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { ticketRestaurantId } from "./access"
import { kitchenStatus } from "../../lib/validators"

const NEXT_STATUS: Record<string, string> = {
  queued: "preparing",
  preparing: "ready",
  ready: "completed",
}

export const setStatus = mutation({
  args: { sessionToken: v.string(), ticketId: v.id("kitchenTickets"), status: kitchenStatus },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const ticket = await ctx.db.get(args.ticketId)
    // Another restaurant's ticket is reported as missing, not as forbidden.
    if (!ticket || (await ticketRestaurantId(ctx, ticket)) !== access.restaurant._id) throw new ConvexError("Тикет не найден")
    if (NEXT_STATUS[ticket.status] !== args.status) throw new ConvexError("Недопустимый переход статуса")
    await ctx.db.patch(ticket._id, { status: args.status, updatedAt: Date.now() })
    await writeAudit(ctx, access, {
      action: "kitchen.status",
      summary: `Кухня: заказ №${ticket.orderNumber} — ${ticket.status} → ${args.status}`,
      orderId: ticket.orderId,
    })
  },
})
