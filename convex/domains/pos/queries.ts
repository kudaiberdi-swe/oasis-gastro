import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireAnyOperator, requireOperator } from "../../lib/auth"
import { isAvailable } from "../../lib/availability"
import { resolvePrice } from "../../lib/pricing"
import { resolveSetting } from "../../lib/settings"
import { activePrintTemplate } from "../platform/printTemplates"

/** The terminal's notifications, newest first, with this employee's read flag (W1-POS-09). */
export const notifications = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const result = await ctx.db.query("posNotifications").withIndex("by_terminal_created", (q) => q.eq("terminalId", access.terminal._id)).order("desc").paginate(args.paginationOpts)
    return { ...result, page: result.page.map(({ readBy, ...item }) => ({ ...item, read: readBy.includes(access.employee._id) })) }
  },
})

/**
 * Upsell for an open check: a popular dish from a category the check doesn't have yet, available in
 * this restaurant, at its resolved price. Null when there is nothing to offer.
 */
export const suggestion = query({
  args: { sessionToken: v.string(), orderId: v.optional(v.id("orders")) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = args.orderId ? await ctx.db.get(args.orderId) : null
    if (order && order.terminalId !== access.terminal._id) return null
    const lines = order ? await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200) : []
    const inCheck = new Set<string>()
    for (const line of lines) {
      if (line.voidedAt) continue
      const product = await ctx.db.get(line.productId)
      if (product) inCheck.add(product.category)
    }
    const popular = await ctx.db.query("products").withIndex("by_enabled_and_popular_and_name", (q) => q.eq("enabled", true).eq("popular", true)).take(50)
    const now = Date.now()
    for (const product of popular) {
      if (inCheck.has(product.category) || product.sizeScaleId) continue
      if (!(await isAvailable(ctx, product._id, access.restaurant.externalId, now))) continue
      const { price, source } = await resolvePrice(ctx, { product, restaurantExternalId: access.restaurant.externalId, at: now })
      if (source === "base") continue // not on this branch's menu
      return { productId: product._id, externalId: product.externalId, name: product.name, nameKk: product.nameKk, category: product.category, price }
    }
    return null
  },
})

/** Unread notifications of this employee on the terminal (the bell badge), counted over the latest 200. */
export const unreadNotificationCount = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const latest = await ctx.db.query("posNotifications").withIndex("by_terminal_created", (q) => q.eq("terminalId", access.terminal._id)).order("desc").take(200)
    return latest.reduce((count, item) => count + (item.readBy.includes(access.employee._id) ? 0 : 1), 0)
  },
})

/**
 * What the terminal reads from the office (W3-ADM-10/12): the published print templates of the check,
 * pre-check, X and Z (null — the built-in form stays) and the idle-lock minutes of «Настройки системы».
 */
export const terminalSettings = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const restaurant = { externalId: access.restaurant.externalId, organizationExternalId: access.restaurant.organizationExternalId }
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", restaurant.organizationExternalId)).unique()
    const idleLock = await resolveSetting(ctx, "security.posIdleLockMinutes", { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, terminalExternalId: access.terminal.externalId })
    const [receipt, precheck, xReport, zReport] = await Promise.all((["receipt", "precheck", "x-report", "z-report"] as const).map((type) => activePrintTemplate(ctx, type, restaurant)))
    return {
      idleLockMinutes: idleLock.value,
      organizationName: organization?.legalName || organization?.name || "",
      restaurantAddress: access.restaurant.address,
      printTemplates: { receipt, precheck, "x-report": xReport, "z-report": zReport },
    }
  },
})
