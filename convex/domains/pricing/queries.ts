import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireOfficeCapability } from "../../lib/officeAccess"

/** A branch user sees orders that apply to at least one of their restaurants (empty list = all). */
export function orderVisibleTo(order: Pick<Doc<"priceOrders">, "restaurantExternalIds">, restaurantScopes: string[]) {
  if (restaurantScopes.includes("*")) return true
  return order.restaurantExternalIds.length === 0 || order.restaurantExternalIds.some((restaurant) => restaurantScopes.includes(restaurant))
}

async function summary(ctx: QueryCtx, order: Doc<"priceOrders">) {
  const lines = await ctx.db.query("priceOrderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
  return {
    externalId: order.externalId,
    number: order.number,
    name: order.name,
    status: order.status,
    effectiveFrom: order.effectiveFrom,
    effectiveTo: order.effectiveTo ?? null,
    restaurantExternalIds: order.restaurantExternalIds,
    posName: order.posName,
    lineCount: lines.filter((line) => line.included).length,
    updatedAt: order.updatedAt,
  }
}

const VIEW_STATUS = { active: "active", scheduled: "scheduled", expired: "expired", draft: "draft" } as const

/** «Приказы об изменении цен» register (W1-CAT-10/11). */
export const list = query({
  args: {
    view: v.optional(v.union(v.literal("all"), v.literal("active"), v.literal("scheduled"), v.literal("expired"), v.literal("draft"))),
    search: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("start-desc"), v.literal("start-asc"), v.literal("number"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.price-orders.view")
    const view = args.view ?? "all"
    const search = args.search?.trim().toLocaleLowerCase("ru")
    const page = search
      ? await ctx.db
          .query("priceOrders")
          .withSearchIndex("search_price_orders", (q) => (view === "all" ? q.search("searchText", search) : q.search("searchText", search).eq("status", VIEW_STATUS[view])))
          .paginate(args.paginationOpts)
      : view !== "all"
        ? await ctx.db.query("priceOrders").withIndex("by_status_start", (q) => q.eq("status", VIEW_STATUS[view])).order(args.sort === "start-asc" ? "asc" : "desc").paginate(args.paginationOpts)
        : args.sort === "number"
          ? await ctx.db.query("priceOrders").withIndex("by_number").order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("priceOrders").withIndex("by_status_start").order(args.sort === "start-asc" ? "asc" : "desc").paginate(args.paginationOpts)
    const visible = page.page.filter((order) => orderVisibleTo(order, user.restaurantScopes))
    return { ...page, page: await Promise.all(visible.map((order) => summary(ctx, order))) }
  },
})

export const get = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.price-orders.view")
    const order = await ctx.db.query("priceOrders").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!order || !orderVisibleTo(order, user.restaurantScopes)) return null
    const [lines, schedules] = await Promise.all([
      ctx.db.query("priceOrderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200),
      ctx.db.query("priceSchedules").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(5),
    ])
    const sizeLookups = await Promise.all(lines.map((line) => (line.sizeOptionId ? ctx.db.get(line.sizeOptionId) : null)))
    return {
      ...(await summary(ctx, order)),
      comment: order.comment,
      replacesPreviousMenu: order.replacesPreviousMenu,
      cancelReason: order.cancelReason ?? null,
      schedule: schedules[0] ? { name: schedules[0].name, startMinute: schedules[0].startMinute, endMinute: schedules[0].endMinute, weekdays: schedules[0].weekdays } : null,
      lines: lines.map((line, index) => ({
        productExternalId: line.productExternalId,
        productName: line.productName,
        sizeOptionExternalId: sizeLookups[index]?.externalId ?? null,
        sizeLabel: line.sizeLabel ?? null,
        included: line.included,
        previousPrice: line.previousPrice,
        newPrice: line.newPrice,
        costAtSave: line.costAtSave,
        // Markup over the portion cost (0 until recipe cards exist, W1-RCP-01).
        markupPercent: line.costAtSave > 0 ? Math.round(((line.newPrice - line.costAtSave) / line.costAtSave) * 1000) / 10 : null,
      })),
    }
  },
})
