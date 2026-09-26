import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { maskPhone } from "../../lib/pii"

// «Телефония» (W3-DLV-09): the call journal, newest first. The phone is masked without office.guests.pii;
// calls without a restaurant are network-level (network users only).

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

export const calls = query({
  args: { restaurantExternalId: v.optional(v.string()), direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.telephony.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    const base = args.restaurantExternalId
      ? ctx.db.query("telephonyCalls").withIndex("by_restaurant_started", (q) => q.eq("restaurantExternalId", args.restaurantExternalId))
      : ctx.db.query("telephonyCalls").withIndex("by_started")
    const page = await base
      .order("desc")
      .filter((q) => (args.direction ? q.eq(q.field("direction"), args.direction) : true))
      .paginate(args.paginationOpts)
    const pii = await canSeePii(ctx)
    const rows = page.page.filter((call) => inScope(call.restaurantExternalId))
    const deliveries = new Map<string, { number: string } | null>()
    for (const call of rows) {
      if (!call.deliveryExternalId || deliveries.has(call.deliveryExternalId)) continue
      const order = await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", call.deliveryExternalId!)).unique()
      deliveries.set(call.deliveryExternalId, order ? { number: order.number } : null)
    }
    return {
      ...page,
      page: rows.map((call) => ({
        externalId: call.externalId,
        provider: call.provider,
        direction: call.direction,
        status: call.status,
        phone: pii ? call.phone : (maskPhone(call.phone) ?? ""),
        restaurantExternalId: call.restaurantExternalId ?? null,
        hasGuest: Boolean(call.guestId),
        deliveryExternalId: call.deliveryExternalId ?? null,
        deliveryNumber: call.deliveryExternalId ? (deliveries.get(call.deliveryExternalId)?.number ?? null) : null,
        startedAt: call.startedAt,
        answeredAt: call.answeredAt ?? null,
        endedAt: call.endedAt ?? null,
        durationSeconds: call.durationSeconds ?? null,
        hasRecording: Boolean(call.recordingUrl),
      })),
    }
  },
})
