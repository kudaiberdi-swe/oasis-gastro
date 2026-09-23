import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"

/**
 * The kitchen board runs on a terminal-bound device using a regular POS operator session —
 * there is no separate office auth in Phase 1 (see ARCHITECTURE.md risk #6).
 */
export const board = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, args.sessionToken)
    const tickets = await ctx.db
      .query("kitchenTickets")
      .withIndex("by_status_created")
      .filter((q) => q.neq(q.field("status"), "completed"))
      .order("asc")
      .take(200)
    return Promise.all(
      tickets.map(async (ticket) => ({
        ...ticket,
        lines: await ctx.db.query("kitchenTicketLines").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).collect(),
      })),
    )
  },
})
