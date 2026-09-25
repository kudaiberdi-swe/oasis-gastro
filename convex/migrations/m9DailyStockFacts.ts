import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../_generated/server"
import { applyStockFact } from "../lib/stockFacts"

// migration-batch M-9 (W2-RPT-01): existing stock movements are added to dailyStockFacts. A movement
// already counted (dailyFactAt, set by the live hook too) is skipped, so a rerun or a movement written
// during the run is never counted twice. Paged, dry run first.

export const backfill = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("stockMovements").withIndex("by_occurred_at").paginate(args.paginationOpts)
    let applied = 0
    let withoutWarehouse = 0
    for (const movement of page.page) {
      if (movement.dailyFactAt) continue
      if (!movement.warehouseId) {
        withoutWarehouse += 1
        continue
      }
      applied += 1
      if (!args.dryRun) await applyStockFact(ctx, movement)
    }
    return { scanned: page.page.length, applied, withoutWarehouse, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
