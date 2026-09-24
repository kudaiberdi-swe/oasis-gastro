import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOfficeCapability, requireRestaurantScope } from "../../lib/officeAccess"
import { findPeriodLocks, lockedThroughDate, periodLockMessage } from "../../lib/periods"

/** For the «Период закрыт» banner on office documents (OFFICE-DESIGN §7). */
export const periodLockFor = query({
  args: { restaurantExternalId: v.string(), businessDate: v.string(), moduleId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId ?? "document-locks"}.view`)
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) return null
    const [lock] = await findPeriodLocks(ctx, {
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      businessDate: args.businessDate,
      moduleId: args.moduleId,
    })
    return lock ? { kind: lock.kind, lockedThroughDate: lockedThroughDate(lock.lockedThrough), message: periodLockMessage(lock) } : null
  },
})
