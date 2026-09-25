import { v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation } from "../../_generated/server"
import { expireAccrual, releaseReservation } from "../../lib/loyaltyCore"

// Loyalty housekeeping (W2-LOY-09): points expire by date, holds of forgotten checks are released.

const DAY = 86_400_000
const RESERVATION_TTL = 2 * 3_600_000

/**
 * Daily at 03:00 Almaty: accruals whose expiresAt passed in the last 30 days lose their unspent rest.
 * Idempotent per accrual (expire:<id>), so a repeated or overlapping run changes nothing.
 */
export const expireLoyaltyPoints = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const page = await ctx.db
      .query("loyaltyTransactions")
      .withIndex("by_expires", (q) => q.gt("expiresAt", now - 30 * DAY).lte("expiresAt", now))
      .paginate({ numItems: Math.min(Math.max(1, args.batchSize ?? 100), 200), cursor: args.cursor ?? null })
    let expired = 0
    for (const row of page.page) expired += await expireAccrual(ctx, row, now)
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.domains.loyalty.expiry.expireLoyaltyPoints, { cursor: page.continueCursor, batchSize: args.batchSize, now })
    return { expired, isDone: page.isDone }
  },
})

/** Every 10 minutes: a check holding points for over 2 hours gives them back and drops the planned redemption. */
export const releaseStaleReservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const stale = await ctx.db.query("orders").withIndex("by_loyalty_reserved_at", (q) => q.gt("loyaltyReservedAt", 0).lte("loyaltyReservedAt", now - RESERVATION_TTL)).take(100)
    for (const order of stale) {
      await releaseReservation(ctx, order._id, now)
      if (order.status === "draft" || order.status === "held") await ctx.db.patch(order._id, { loyaltyRedemptionPlanned: undefined })
    }
    return { released: stale.length }
  },
})
