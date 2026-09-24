import { v } from "convex/values"

import type { Id } from "../../_generated/dataModel"
import { query } from "../../_generated/server"
import { almatyBusinessDate, almatyDayStart, DAY_MS } from "../../lib/time"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

export const restaurantsForFilter = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.reports.view")
    const inScope = restaurantScopeFilter(user)
    return (await listOperationalRestaurants(ctx)).filter((restaurant) => inScope(restaurant.externalId))
  },
})

/**
 * Sales analytics from real POS data. Reads payments in the requested Almaty date range through the
 * `by_created_at` index (no full orders scan) and nets refunds out: `revenue` = sales − refunds,
 * attributed to the business date each payment happened. Orders and their lines are loaded only for
 * orders with a payment in range. Interim until the `dailySalesFacts` pre-aggregate (W1-RPT-02).
 */
export const salesSummary = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reports.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)

    const rangeStart = args.from ? almatyDayStart(args.from) : 0
    const rangeEnd = args.to ? almatyDayStart(args.to) + DAY_MS : Number.MAX_SAFE_INTEGER
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_created_at", (q) => q.gte("createdAt", rangeStart).lt("createdAt", rangeEnd))
      .collect()

    const restaurantExternalById = new Map((await ctx.db.query("restaurants").collect()).map((restaurant) => [restaurant._id, restaurant.externalId]))
    const orderIds = [...new Set(payments.map((payment) => payment.orderId))]
    const orders = new Map((await Promise.all(orderIds.map((id) => ctx.db.get(id)))).filter((order) => order !== null).map((order) => [order._id, order]))
    const visible = payments.filter((payment) => {
      const order = orders.get(payment.orderId)
      return order !== undefined && inScope(order.restaurantId ? restaurantExternalById.get(order.restaurantId) : undefined)
    })

    let grossSales = 0
    let refunds = 0
    const soldOrderIds = new Set<string>()
    const byDateMap = new Map<string, { revenue: number; orders: number }>()
    const byPaymentMethod = new Map<string, number>()
    for (const payment of visible) {
      const date = almatyBusinessDate(payment.createdAt)
      const dateEntry = byDateMap.get(date) ?? { revenue: 0, orders: 0 }
      const signed = payment.type === "sale" ? payment.amount : -payment.amount
      if (payment.type === "sale") {
        grossSales += payment.amount
        if (!soldOrderIds.has(String(payment.orderId))) {
          soldOrderIds.add(String(payment.orderId))
          dateEntry.orders += 1
        }
      } else {
        refunds += payment.amount
      }
      dateEntry.revenue += signed
      byDateMap.set(date, dateEntry)
      byPaymentMethod.set(payment.method, (byPaymentMethod.get(payment.method) ?? 0) + signed)
    }

    const productAgg = new Map<string, { name: string; quantity: number; revenue: number }>()
    for (const orderId of soldOrderIds) {
      const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", orderId as Id<"orders">)).collect()
      for (const line of lines) {
        const key = line.productExternalId ?? String(line.productId)
        const productEntry = productAgg.get(key) ?? { name: line.productName, quantity: 0, revenue: 0 }
        productEntry.quantity += line.quantity
        productEntry.revenue += line.quantity * line.unitPrice
        productAgg.set(key, productEntry)
      }
    }

    const orderCount = soldOrderIds.size
    return {
      revenue: grossSales - refunds,
      grossSales,
      refunds,
      orderCount,
      averageCheck: orderCount ? Math.round(grossSales / orderCount) : 0,
      byDate: [...byDateMap.entries()].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
      topProducts: [...productAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15),
      byPaymentMethod: [...byPaymentMethod.entries()].map(([method, amount]) => ({ method, amount })),
    }
  },
})

/** History of every X/Z-report generated at the кассы — currently only ever seen on the receipt printer. */
export const listShiftReports = query({
  args: { restaurantExternalId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reports.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    const restaurants = await ctx.db.query("restaurants").collect()
    const restaurantExternalById = new Map(restaurants.map((restaurant) => [restaurant._id, restaurant.externalId]))
    const reports = await ctx.db.query("xReports").order("desc").take(args.limit ?? 200)
    return reports.filter((report) => inScope(restaurantExternalById.get(report.restaurantId)))
  },
})
