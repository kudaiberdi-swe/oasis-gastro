import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireAnyOperator } from "../../lib/auth"
import { requireOfficeCapability, scopedRestaurants } from "../../lib/officeAccess"
import { ticketRestaurantId } from "./access"

const OPEN = ["queued", "preparing", "ready"] as const

/**
 * The kitchen board of the session's restaurant only (S-5): cashier, manager or the kitchen PIN role on
 * a terminal of that restaurant. Tickets saved before M-7 have no restaurantId and are found through
 * their order (bounded) until M-7 deploy 2.
 */
export const board = query({
  args: { sessionToken: v.string(), prepArea: v.optional(v.string()), includeCompletedLast: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const restaurantId = access.restaurant._id
    const tickets: Doc<"kitchenTickets">[] = []
    for (const status of OPEN) {
      tickets.push(...(await ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", restaurantId).eq("status", status)).take(100)))
      const legacy = await ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", undefined).eq("status", status)).take(50)
      for (const ticket of legacy) if ((await ticketRestaurantId(ctx, ticket)) === restaurantId) tickets.push(ticket)
    }
    const completedLast = Math.min(Math.max(0, Math.floor(args.includeCompletedLast ?? 0)), 20)
    if (completedLast) {
      tickets.push(...(await ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", restaurantId).eq("status", "completed")).order("desc").take(completedLast)))
    }
    tickets.sort((a, b) => a.createdAt - b.createdAt)
    const withLines = await Promise.all(
      tickets.map(async (ticket) => {
        const lines = await ctx.db.query("kitchenTicketLines").withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id)).take(100)
        return { ...ticket, lines: lines.filter((line) => line.status !== "cancelled" && (!args.prepArea || (line.prepArea ?? "hot") === args.prepArea)) }
      }),
    )
    return withLines.filter((ticket) => ticket.lines.length > 0)
  },
})

/**
 * Office «Экран кухни» (W1-KDS-03): per restaurant in scope, the active tickets and the kitchen terminal
 * to open /kitchen on. The kitchen screen itself only opens with a PIN, never with the office session.
 */
export const officeSummary = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.kitchen-board.view")
    const restaurants = await scopedRestaurants(ctx, user)
    const rows = []
    for (const restaurant of restaurants) {
      let active = 0
      for (const status of OPEN) active += (await ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", restaurant._id).eq("status", status)).take(100)).length
      const terminals = await ctx.db.query("posTerminals").withIndex("by_restaurant_active_and_number", (q) => q.eq("restaurantId", restaurant._id).eq("active", true)).take(50)
      const kitchen = terminals.find((terminal) => terminal.kind === "kds") ?? terminals.find((terminal) => terminal.kind === undefined || terminal.kind === "pos")
      if (!kitchen && !active) continue
      rows.push({ restaurantExternalId: restaurant.externalId, restaurantName: restaurant.name, activeTickets: active, terminalExternalId: kitchen?.externalId ?? null, terminalName: kitchen?.name ?? null })
    }
    return rows
  },
})
