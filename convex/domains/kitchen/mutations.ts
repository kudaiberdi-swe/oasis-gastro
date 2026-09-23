import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { kitchenStatus } from "../../lib/validators"

const NEXT_STATUS: Record<string, string> = {
  queued: "preparing",
  preparing: "ready",
  ready: "completed",
}

export const setStatus = mutation({
  args: { sessionToken: v.string(), ticketId: v.id("kitchenTickets"), status: kitchenStatus },
  handler: async (ctx, args) => {
    await requireOperator(ctx, args.sessionToken)
    const ticket = await ctx.db.get(args.ticketId)
    if (!ticket) throw new Error("Тикет не найден")
    if (NEXT_STATUS[ticket.status] !== args.status) throw new Error("Недопустимый переход статуса")
    await ctx.db.patch(ticket._id, { status: args.status, updatedAt: Date.now() })
  },
})
