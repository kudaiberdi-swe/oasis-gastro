import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { businessDateFor } from "../../lib/time"
import { applyCheckoutFacts, applyDeletionFacts, applyRefundFacts, orderCost } from "../../lib/reportFacts"

const SOLD = ["paid", "partially_refunded", "refunded"]

/** Every fact event of one order (checkout, refunds, cancel, voids); already-applied ones are skipped. */
async function replayOrder(ctx: MutationCtx, order: Doc<"orders">) {
  const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
  const deletions = await ctx.db.query("orderDeletionEvents").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100)
  for (const event of deletions) {
    const line = event.orderLineId ? lines.find((row) => row._id === event.orderLineId) : null
    const reason = { key: event.deletionReasonExternalId ?? (line ? "void" : "cancel"), label: event.deletionReasonName }
    if (line) await applyDeletionFacts(ctx, order, `line:${line._id}:void`, reason, line.lineTotal ?? line.unitPrice * line.quantity, line.quantity)
    else if (order.status === "cancelled") await applyDeletionFacts(ctx, order, `order:${order._id}:cancel`, reason, order.total, lines.reduce((sum, row) => sum + (row.voidedAt ? 0 : row.quantity), 0))
  }
  if (!SOLD.includes(order.status)) return
  const cost = await orderCost(ctx, order)
  await applyCheckoutFacts(ctx, order, cost)
  const payments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(50)
  const paid = payments.filter((payment) => payment.type === "sale").reduce((sum, payment) => sum + payment.amount, 0)
  for (const payment of payments) if (payment.type === "refund" && paid > 0) await applyRefundFacts(ctx, order, payment, Math.min(1, payment.amount / paid), cost)
}

/** Recomputes one restaurant day from its orders — fixes any drift of the incremental facts. */
export const rebuildDailySalesFacts = internalMutation({
  args: { restaurantExternalId: v.string(), businessDate: v.string() },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) return { orders: 0 }
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("businessDate", args.businessDate))) await ctx.db.delete(fact._id)
    for await (const event of ctx.db.query("reportFactEvents").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("businessDate", args.businessDate))) await ctx.db.delete(event._id)
    let orders = 0
    for await (const order of ctx.db.query("orders").withIndex("by_restaurant_business_date", (q) => q.eq("restaurantId", restaurant._id).eq("businessDate", args.businessDate))) {
      orders += 1
      await replayOrder(ctx, order)
    }
    return { orders }
  },
})

/**
 * M-8b (W2-RPT-03): rebuilds a date range for every active restaurant, one day per run (it schedules the
 * next day), so facts added later (station, terminal-product, channel…) appear for past dates too.
 */
export const rebuildDailySalesFactsRange = internalMutation({
  args: { dateFrom: v.string(), dateTo: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(args.dateTo) || args.dateFrom > args.dateTo) throw new ConvexError("Укажите период ГГГГ-ММ-ДД")
    const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
    const days = Math.round((Date.parse(`${args.dateTo}T00:00:00Z`) - Date.parse(`${args.dateFrom}T00:00:00Z`)) / 86_400_000) + 1
    if (args.dryRun) return { restaurants: restaurants.length, days, isDone: true, dryRun: true }
    for (const restaurant of restaurants) await ctx.scheduler.runAfter(0, internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: restaurant.externalId, businessDate: args.dateFrom })
    const next = new Date(Date.parse(`${args.dateFrom}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    if (next <= args.dateTo) await ctx.scheduler.runAfter(1_000, internal.domains.reports.internal.rebuildDailySalesFactsRange, { dateFrom: next, dateTo: args.dateTo })
    return { restaurants: restaurants.length, days, isDone: true, dryRun: false }
  },
})

/** Nightly after the business-day cutoff: rebuild yesterday for every active restaurant. */
export const rebuildYesterday = internalMutation({
  args: {},
  handler: async (ctx) => {
    const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
    for (const restaurant of restaurants) {
      const yesterday = businessDateFor(Date.now() - 86_400_000, restaurant.businessDayCutoffMinutes)
      await ctx.scheduler.runAfter(0, internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: restaurant.externalId, businessDate: yesterday })
    }
    return { scheduled: restaurants.length }
  },
})

/** migration-batch M-8: facts for orders sold before W1-RPT-02 (paged by status and time; dry run counts). */
export const backfillDailySalesFacts = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("orders").withIndex("by_status_created").paginate(args.paginationOpts)
    let pending = 0
    for (const order of page.page) {
      if (!order.businessDate) continue
      const done = await ctx.db.query("reportFactEvents").withIndex("by_source_key", (q) => q.eq("sourceKey", `order:${order._id}:checkout`)).unique()
      if (done || !(SOLD.includes(order.status) || order.status === "cancelled")) continue
      pending += 1
      if (!args.dryRun) await replayOrder(ctx, order)
    }
    return { scanned: page.page.length, pending, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
