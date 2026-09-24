import { internalMutation } from "../../_generated/server"
import { publishedState } from "./mutations"

const BATCH = 100

/**
 * Every minute: scheduled → active → expired by the effective dates. Statuses only — products are
 * never touched (B-14); resolvePrice reads the effective window directly.
 */
export const reconcileStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = await ctx.db.query("priceOrders").withIndex("by_next_transition", (q) => q.gte("nextTransitionAt", 0).lte("nextTransitionAt", now)).take(BATCH)
    let changed = 0
    for (const order of due) {
      if (order.status !== "scheduled" && order.status !== "active") {
        await ctx.db.patch(order._id, { nextTransitionAt: undefined })
        continue
      }
      const next = publishedState(order, now)
      if (next.status !== order.status || next.nextTransitionAt !== order.nextTransitionAt) {
        changed += 1
        await ctx.db.patch(order._id, { ...next, updatedAt: now })
      }
    }
    return { checked: due.length, changed }
  },
})
