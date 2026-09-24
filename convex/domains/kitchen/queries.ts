import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { ticketRestaurantId } from "./access"

/**
 * The kitchen board runs on a terminal-bound device using a regular POS operator session —
 * there is no separate office auth in Phase 1 (see ARCHITECTURE.md risk #6).
 */
export const board = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const recent = await ctx.db
      .query("kitchenTickets")
      .withIndex("by_status_created")
      .filter((q) => q.neq(q.field("status"), "completed"))
      .order("asc")
      .take(200)
    const owners = await Promise.all(recent.map((ticket) => ticketRestaurantId(ctx, ticket)))
    const tickets = recent.filter((_, index) => owners[index] === access.restaurant._id)
    return Promise.all(
      tickets.map(async (ticket) => ({
        ...ticket,
        lines: await ctx.db.query("kitchenTicketLines").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).collect(),
      })),
    )
  },
})
