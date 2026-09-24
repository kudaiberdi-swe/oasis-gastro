import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../../_generated/server"
import { auditSearchText } from "../../lib/audit"

/** migration-batch: fills auditEvents.searchText for events written before W1-PLT-07. Run page by page. */
export const backfillAuditSearchText = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("auditEvents").withIndex("by_occurred_at").paginate(args.paginationOpts)
    let updated = 0
    for (const event of page.page) {
      if (event.searchText) continue
      updated += 1
      if (!args.dryRun) await ctx.db.patch(event._id, { searchText: auditSearchText(event) })
    }
    return { updated, scanned: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
