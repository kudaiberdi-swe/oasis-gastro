import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { normalizePhone } from "../../lib/loyalty"
import { requireNetworkScope, requireOfficeCapability } from "../../lib/officeAccess"

export const getOrderGuest = query({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await ctx.db.get(args.orderId)
    if (!order || order.restaurantId !== access.restaurant._id || !order.guestId) return null
    const guest = await ctx.db.get(order.guestId)
    return guest ? { guestId: guest._id, phone: guest.phone, name: guest.name, points: guest.points } : null
  },
})

export const findGuestByPhone = query({
  args: { sessionToken: v.string(), phone: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, args.sessionToken)
    const phone = normalizePhone(args.phone)
    if (!phone) return null
    const guest = await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", phone)).unique()
    return guest ? { guestId: guest._id, phone: guest.phone, name: guest.name, points: guest.points } : null
  },
})

export const listGuests = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.guests.view")
    requireNetworkScope(user, role) // guests are network-wide; branch-scoped guest access comes with W1-LOY-04
    const guests = await ctx.db.query("guests").order("desc").take(500)
    const search = args.search?.trim().toLocaleLowerCase("ru")
    if (!search) return guests
    return guests.filter((guest) => guest.phone.includes(search) || guest.name?.toLocaleLowerCase("ru").includes(search))
  },
})

export const guestHistory = query({
  args: { guestId: v.id("guests") },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.guests.view")
    requireNetworkScope(user, role)
    return ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", args.guestId)).order("desc").take(100)
  },
})
