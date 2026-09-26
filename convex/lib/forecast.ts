import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"
import { almatyBusinessDate, almatyDayStart, almatyWeekdayMinute, DAY_MS } from "./time"

type QueryCtx = GenericQueryCtx<DataModel>

// The kitchen forecast (W3-PRD-07, closes L-14): the one source of «План на кухню» and «Ведомость
// полуфабрикатов». A dish's demand is its average sales on the same weekday over the six weeks before
// the target date, read from dailySalesFacts (product facts of one restaurant and business date — never a
// global scan of orders, B-E5). The shape of the day comes from the quarter-hour facts, which
// lib/reportFacts.ts keys by Almaty time: an order paid at 23:30 in Almaty is interval 94 whatever the
// server's timezone (B:productionLogistics.ts:91 used Date.getHours()).

export const FORECAST_WEEKS = 6
export const INTERVALS_PER_DAY = 96

export type ForecastProduct = {
  productExternalId: string
  name: string
  /** Sold on the same weekday, averaged over the days that had sales. */
  averageQuantity: number
  /** The card's «Рекомендуется: N» — the average rounded up to whole portions. */
  recommendedQuantity: number
  /** Expected portions per 15-minute interval (Almaty time), 96 values. */
  intervals: number[]
}

export type KitchenForecast = {
  restaurantExternalId: string
  targetDate: string
  /** Monday = 1 … Sunday = 7. */
  weekday: number
  /** The same weekday of the six previous weeks, newest first. */
  sourceDates: string[]
  daysWithSales: number
  /** Average orders per 15-minute interval. */
  intervals: number[]
  products: ForecastProduct[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function assertBusinessDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || almatyBusinessDate(almatyDayStart(date)) !== date) throw new ConvexError("Некорректная дата")
}

export function shiftBusinessDate(date: string, days: number) {
  return almatyBusinessDate(almatyDayStart(date) + days * DAY_MS)
}

/** The same weekday of the `weeks` weeks before the date, newest first. */
export function sameWeekdayDates(targetDate: string, weeks = FORECAST_WEEKS) {
  return Array.from({ length: weeks }, (_, index) => shiftBusinessDate(targetDate, -7 * (index + 1)))
}

/** Interval of a moment: minute of the Almaty day / 15 (0 … 95). */
export function intervalOf(timestamp: number) {
  return Math.floor(almatyWeekdayMinute(timestamp).minute / 15)
}

/** Interval of a quarter-hour fact key "HH:MM", or null for anything else. */
export function intervalOfKey(key: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(key)
  if (!match) return null
  const index = Number(match[1]) * 4 + Math.floor(Number(match[2]) / 15)
  return index >= 0 && index < INTERVALS_PER_DAY ? index : null
}

export async function kitchenForecast(ctx: QueryCtx, args: { restaurantExternalId: string; targetDate: string }): Promise<KitchenForecast> {
  assertBusinessDate(args.targetDate)
  const sourceDates = sameWeekdayDates(args.targetDate)
  const totals = new Map<string, { name: string; quantity: number }>()
  const orders: number[] = Array(INTERVALS_PER_DAY).fill(0)
  let daysWithSales = 0
  // Newest first, so a renamed dish keeps its latest name.
  for (const date of sourceDates) {
    const products = await ctx.db
      .query("dailySalesFacts")
      .withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("factType", "product").eq("businessDate", date))
      .collect()
    if (!products.some((fact) => fact.quantity > 0)) continue
    daysWithSales += 1
    for (const fact of products) {
      const row = totals.get(fact.dimensionKey) ?? { name: fact.dimensionLabel, quantity: 0 }
      row.quantity += fact.quantity
      totals.set(fact.dimensionKey, row)
    }
    const quarters = await ctx.db
      .query("dailySalesFacts")
      .withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId).eq("factType", "quarter-hour").eq("businessDate", date))
      .collect()
    for (const fact of quarters) {
      const index = intervalOfKey(fact.dimensionKey)
      if (index !== null) orders[index] += fact.orderCount
    }
  }
  const orderTotal = orders.reduce((sum, value) => sum + value, 0)
  const products: ForecastProduct[] = []
  if (daysWithSales > 0) {
    for (const [productExternalId, row] of totals) {
      if (!(row.quantity > 0)) continue
      const average = row.quantity / daysWithSales
      products.push({
        productExternalId,
        name: row.name,
        averageQuantity: round2(average),
        recommendedQuantity: Math.ceil(average - 1e-9),
        intervals: orders.map((value) => (orderTotal > 0 ? round2((average * value) / orderTotal) : 0)),
      })
    }
  }
  products.sort((a, b) => b.recommendedQuantity - a.recommendedQuantity || a.name.localeCompare(b.name, "ru"))
  const [year, month, day] = args.targetDate.split("-").map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return {
    restaurantExternalId: args.restaurantExternalId,
    targetDate: args.targetDate,
    weekday: weekday === 0 ? 7 : weekday,
    sourceDates,
    daysWithSales,
    intervals: orders.map((value) => (daysWithSales > 0 ? round2(value / daysWithSales) : 0)),
    products,
  }
}
