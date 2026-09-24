import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { ticketRestaurantId } from "../domains/kitchen/access"

// migration-batch M-7 (W1-KDS-01): kitchen tickets get their own restaurant, lines their prep area.
// The restaurant comes from the order (or its terminal); a ticket with neither is reported, never
// guessed (B-24). Paged, idempotent, dry run first.

export const backfill = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("kitchenTickets").withIndex("by_status_created").paginate(args.paginationOpts)
    let tickets = 0
    let lines = 0
    const unresolved: string[] = []
    for (const ticket of page.page) {
      if (!ticket.restaurantId) {
        const restaurantId = await ticketRestaurantId(ctx, ticket)
        if (!restaurantId) unresolved.push(String(ticket._id))
        else {
          tickets += 1
          if (!args.dryRun) await ctx.db.patch(ticket._id, { restaurantId })
        }
      }
      const ticketLines = await ctx.db.query("kitchenTicketLines").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).take(100)
      for (const line of ticketLines) {
        if (line.prepArea) continue
        lines += 1
        if (args.dryRun) continue
        const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
        const patch: Partial<Doc<"kitchenTicketLines">> = { prepArea: product?.prepArea ?? "hot" }
        await ctx.db.patch(line._id, patch)
      }
    }
    return { scanned: page.page.length, tickets, lines, unresolved, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
