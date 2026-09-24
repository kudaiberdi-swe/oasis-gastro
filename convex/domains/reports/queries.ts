import { ConvexError, v } from "convex/values"

import type { Id } from "../../_generated/dataModel"
import { query } from "../../_generated/server"
import { almatyBusinessDate, almatyDayStart, DAY_MS } from "../../lib/time"
import { requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
import { checkReportPeriod, reportConfig } from "../../lib/reportConfig"
import { findReport, REPORT_CATALOG } from "./catalog"
import { REPORT_REGISTRY } from "./registry"
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

// ── Reports 2.0 (W1-RPT-01/02) ───────────────────────────────────────────────

/** Runs one report of the catalog over the restaurants in the user's scope. */
export const execute = query({
  args: { reportId: v.string(), config: reportConfig },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reports.view")
    const report = findReport(args.reportId)
    if (!report) throw new ConvexError("Отчёт не найден")
    if (report.requiredCapability) await requireOfficeCapability(ctx, report.requiredCapability)
    const entry = REPORT_REGISTRY[report.id]
    if (!entry) throw new ConvexError("Отчёт в разработке")
    checkReportPeriod(args.config)
    for (const restaurant of args.config.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    const restaurants = args.config.restaurantExternalIds.length ? args.config.restaurantExternalIds : (await scopedRestaurants(ctx, user)).map((restaurant) => restaurant.externalId)
    const result = await entry.calculator(ctx, args.config, restaurants)
    return { reportId: report.id, generatedAt: Date.now(), ...result }
  },
})

/** Honest coverage: how many of the 190 reports have a calculator (bahandi always said 190/190 — B-23). */
export const coverage = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.reports.view")
    const byFamily: Record<string, { implemented: number; total: number }> = {}
    for (const report of REPORT_CATALOG) {
      const family = (byFamily[report.family] ??= { implemented: 0, total: 0 })
      family.total += 1
      if (REPORT_REGISTRY[report.id]) family.implemented += 1
    }
    return {
      total: REPORT_CATALOG.length,
      implemented: REPORT_CATALOG.filter((report) => REPORT_REGISTRY[report.id]).length,
      notApplicableKz: REPORT_CATALOG.filter((report) => report.kzApplicability === "not-applicable-kz").length,
      byFamily,
      implementedIds: REPORT_CATALOG.filter((report) => REPORT_REGISTRY[report.id]).map((report) => report.id),
    }
  },
})

/** Dashboard KPIs from the facts: net revenue minus refunds, orders, average check, a series by day with the previous period. */
export const dashboardSummary = query({
  args: { restaurantExternalIds: v.array(v.string()), dateFrom: v.string(), dateTo: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.reports.view")
    checkReportPeriod({ dateFrom: args.dateFrom, dateTo: args.dateTo, restaurantExternalIds: [] })
    for (const restaurant of args.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    const restaurants = args.restaurantExternalIds.length ? args.restaurantExternalIds : (await scopedRestaurants(ctx, user)).map((restaurant) => restaurant.externalId)
    const days = (Date.parse(`${args.dateTo}T00:00:00Z`) - Date.parse(`${args.dateFrom}T00:00:00Z`)) / 86_400_000 + 1
    const shift = (date: string, by: number) => new Date(Date.parse(`${date}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)
    const previousFrom = shift(args.dateFrom, -days)
    const byDate = new Map<string, number>()
    const byRestaurant = new Map<string, { name: string; net: number; orders: number }>()
    let net = 0
    let refunds = 0
    let orders = 0
    let previousNet = 0
    for (const restaurant of restaurants) {
      for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "branch").gte("businessDate", previousFrom).lte("businessDate", args.dateTo))) {
        const value = fact.netAmount - fact.refundAmount
        if (fact.businessDate < args.dateFrom) {
          previousNet += value
          continue
        }
        net += fact.netAmount
        refunds += fact.refundAmount
        orders += fact.orderCount
        byDate.set(fact.businessDate, (byDate.get(fact.businessDate) ?? 0) + value)
        const row = byRestaurant.get(restaurant) ?? { name: fact.dimensionLabel, net: 0, orders: 0 }
        row.net += value
        row.orders += fact.orderCount
        byRestaurant.set(restaurant, row)
      }
    }
    const series = Array.from({ length: days }, (_, index) => shift(args.dateFrom, index)).map((date) => ({ date, value: byDate.get(date) ?? 0 }))
    return {
      revenue: net - refunds,
      grossRevenue: net,
      refunds,
      orders,
      averageCheck: orders ? Math.round(net / orders) : 0,
      previousRevenue: previousNet,
      series,
      restaurants: [...byRestaurant.entries()].map(([externalId, row]) => ({ externalId, ...row })).sort((a, b) => b.net - a.net),
    }
  },
})
