import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"
import { normalizePhone } from "../../lib/loyalty"
import { quoteLoyalty } from "../../lib/loyaltyCore"
import { maskPhone } from "../../lib/pii"
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

/** POS guest search by phone digits or name (≥ 2 characters); phones masked on the way out. */
export const searchForPos = query({
  args: { sessionToken: v.string(), query: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx, args.sessionToken)
    const text = args.query.trim()
    if (text.length < 2) return []
    const digits = text.replace(/\D/g, "")
    const found =
      digits.length >= 2 && digits.length === text.replace(/[\s()+-]/g, "").length
        ? await ctx.db.query("guests").withIndex("by_phone", (q) => q.gte("phone", digits).lt("phone", `${digits}\uffff`)).take(10)
        : await ctx.db.query("guests").withSearchIndex("search_guests", (q) => q.search("searchText", text.toLocaleLowerCase("ru")).eq("status", "active")).take(10)
    return found.filter((guest) => guest.status !== "inactive").map((guest) => ({ guestId: guest._id, name: guest.name ?? null, phone: maskPhone(guest.phone), points: guest.points }))
  },
})

/** «Гость и лояльность» on the POS: balance, what can be spent and what will be earned on this check. */
export const quoteForPos = query({
  args: { sessionToken: v.string(), orderId: v.id("orders"), guestId: v.optional(v.id("guests")) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await ctx.db.get(args.orderId)
    if (!order || order.terminalId !== access.terminal._id) return null
    const guestId = args.guestId ?? order.guestId
    if (!guestId) return null
    const quote = await quoteLoyalty(ctx, { guestId, restaurantExternalId: access.restaurant.externalId, payable: order.total, at: Date.now() })
    if (!quote) return { program: null, balance: (await ctx.db.get(guestId))?.points ?? 0, maxRedemption: 0, accrual: Math.floor(order.total / 100), planned: 0 }
    const planned = order.loyaltyRedemptionPlanned ?? 0
    return { program: { externalId: quote.program.externalId, name: quote.program.name }, balance: quote.balance, maxRedemption: quote.maxRedemption, accrual: quote.accrualFor(planned), accrualWithout: quote.accrualWithout, planned }
  },
})
