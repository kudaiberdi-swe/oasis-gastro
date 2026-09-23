import { v } from "convex/values"

import { query } from "../../_generated/server"
import { almatyBusinessDate } from "../../lib/time"
import { requireOfficeCapability } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

export const restaurantsForFilter = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.reports.*")
    return listOperationalRestaurants(ctx)
  },
})

/**
 * Sales analytics from real POS data — orders that were ever paid (status paid, partially_refunded
 * or refunded all mean the sale happened), grouped by business date, product and payment method.
 * Distinct from Финансы's P&L: this goes to line-item detail (top dishes, average check) instead
 * of just the order-level revenue/expense totals the ledger tracks.
 */
export const salesSummary = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.reports.*")

    const restaurants = await ctx.db.query("restaurants").collect()
    const restaurantExternalById = new Map(restaurants.map((restaurant) => [restaurant._id, restaurant.externalId]))

    const allOrders = await ctx.db.query("orders").collect()
    const sold = allOrders.filter((order) => {
      if (order.paidAt === undefined) return false
      if (args.restaurantExternalId && (!order.restaurantId || restaurantExternalById.get(order.restaurantId) !== args.restaurantExternalId)) return false
      const date = almatyBusinessDate(order.paidAt)
      if (args.from && date < args.from) return false
      if (args.to && date > args.to) return false
      return true
    })

    const revenue = sold.reduce((sum, order) => sum + order.total, 0)
    const orderCount = sold.length
    const averageCheck = orderCount ? Math.round(revenue / orderCount) : 0

    const byDateMap = new Map<string, { revenue: number; orders: number }>()
    const productAgg = new Map<string, { name: string; quantity: number; revenue: number }>()
    const byPaymentMethod = new Map<string, number>()

    for (const order of sold) {
      const date = almatyBusinessDate(order.paidAt!)
      const dateEntry = byDateMap.get(date) ?? { revenue: 0, orders: 0 }
      dateEntry.revenue += order.total
      dateEntry.orders += 1
      byDateMap.set(date, dateEntry)

      const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).collect()
      for (const line of lines) {
        const key = line.productExternalId ?? String(line.productId)
        const productEntry = productAgg.get(key) ?? { name: line.productName, quantity: 0, revenue: 0 }
        productEntry.quantity += line.quantity
        productEntry.revenue += line.quantity * line.unitPrice
        productAgg.set(key, productEntry)
      }

      const payments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).collect()
      for (const payment of payments) {
        if (payment.type !== "sale") continue
        byPaymentMethod.set(payment.method, (byPaymentMethod.get(payment.method) ?? 0) + payment.amount)
      }
    }

    return {
      revenue,
      orderCount,
      averageCheck,
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
    await requireOfficeCapability(ctx, "office.reports.*")
    const restaurants = await ctx.db.query("restaurants").collect()
    const restaurantExternalById = new Map(restaurants.map((restaurant) => [restaurant._id, restaurant.externalId]))
    const reports = await ctx.db.query("xReports").order("desc").take(args.limit ?? 200)
    return reports.filter((report) => !args.restaurantExternalId || restaurantExternalById.get(report.restaurantId) === args.restaurantExternalId)
  },
})
