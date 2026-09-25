import type { Doc } from "../../../_generated/dataModel"
import type { ReportColumn, ReportConfig, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { col } from "./_shared"

// Reports over the daily sales pre-aggregate (W1-RPT-02): the fact reader and the generic
// «group one fact type by dimension or by day» calculator (moved out of registry.ts in W2-RPT-03).

export type FactType = Doc<"dailySalesFacts">["factType"]
export type Measure = "orderCount" | "guestCount" | "quantity" | "grossAmount" | "discountAmount" | "serviceChargeAmount" | "netAmount" | "costAmount" | "refundAmount" | "refundCount"
export type FactMeasure = Measure | "serviceMinutesTotal" | "zeroRevenueCount"

const SCAN_LIMIT = 50_000
export const MEASURES: Measure[] = ["orderCount", "guestCount", "quantity", "grossAmount", "discountAmount", "serviceChargeAmount", "netAmount", "costAmount", "refundAmount", "refundCount"]

/** Facts of one type for the restaurants and period, streamed over the index range (truncated beyond 50 000). */
export async function facts(ctx: Parameters<Calculator>[0], factType: FactType, config: ReportConfig, restaurants: string[]) {
  const rows: Doc<"dailySalesFacts">[] = []
  let truncated = false
  for (const restaurant of restaurants) {
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", factType).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (rows.length >= SCAN_LIMIT) {
        truncated = true
        break
      }
      rows.push(fact)
    }
  }
  return { rows, truncated }
}

/** Groups facts of one type by dimension (or by day) and sums the chosen measures. */
export function factReport(options: { factType: FactType; byDay?: boolean; dimensionLabel: string; measures: { key: Measure; label: string; unit: ReportColumn["unit"] }[]; average?: boolean; margin?: boolean; sortBy?: Measure }): Calculator {
  return async (ctx, config, restaurants) => {
    const { rows, truncated } = await facts(ctx, options.factType, config, restaurants)
    const needle = config.search?.trim().toLocaleLowerCase("ru")
    const groups = new Map<string, { label: string; values: Record<Measure, number> }>()
    for (const fact of rows) {
      const key = options.byDay ? fact.businessDate : fact.dimensionKey
      const label = options.byDay ? fact.businessDate : fact.dimensionLabel
      if (needle && !label.toLocaleLowerCase("ru").includes(needle)) continue
      const group = groups.get(key) ?? { label, values: Object.fromEntries(MEASURES.map((measure) => [measure, 0])) as Record<Measure, number> }
      for (const measure of MEASURES) group.values[measure] += fact[measure]
      groups.set(key, group)
    }
    const columns = [col("group", options.dimensionLabel, options.byDay ? "date" : "text"), ...options.measures.map((m) => col(m.key, m.label, m.unit))]
    if (options.average) columns.push(col("averageCheck", "Средний чек", "money"))
    if (options.margin) columns.push(col("margin", "Маржа", "money"), col("marginPercent", "Маржа, %", "percent"))
    const sortKey = options.sortBy ?? options.measures[0].key
    const ordered = [...groups.entries()].sort(([ka, a], [kb, b]) => (options.byDay ? ka.localeCompare(kb) : b.values[sortKey] - a.values[sortKey]))
    const totals: Record<string, number> = {}
    const out = ordered.map(([key, group]) => {
      const cells: Record<string, number | string> = { group: group.label }
      for (const measure of options.measures) {
        cells[measure.key] = group.values[measure.key]
        totals[measure.key] = (totals[measure.key] ?? 0) + group.values[measure.key]
      }
      if (options.average) cells.averageCheck = group.values.orderCount ? Math.round(group.values.netAmount / group.values.orderCount) : 0
      if (options.margin) {
        const margin = group.values.netAmount - group.values.costAmount
        cells.margin = margin
        cells.marginPercent = group.values.netAmount ? Math.round((margin / group.values.netAmount) * 1000) / 10 : 0
      }
      return { key, cells }
    })
    const net = totals.netAmount ?? 0
    const kpis: ReportResult["kpis"] = []
    if (totals.netAmount !== undefined) kpis.push({ key: "net", label: "Выручка", value: net, unit: "money" })
    if (totals.refundAmount !== undefined) kpis.push({ key: "netOfRefunds", label: "Выручка за вычетом возвратов", value: net - totals.refundAmount, unit: "money" })
    if (totals.orderCount !== undefined) kpis.push({ key: "orders", label: "Заказов", value: totals.orderCount, unit: "count" })
    return { sourceLabel: "Продажи кассы (предагрегат за день)", columns, rows: out, totals, kpis, truncated }
  }
}

export const money = (key: Measure, label: string) => ({ key, label, unit: "money" as const })
export const count = (key: Measure, label: string) => ({ key, label, unit: "count" as const })
export const quantity = (key: Measure, label: string) => ({ key, label, unit: "quantity" as const })

/** Sums the measures of the facts by a key (dimension by default). */
export function sumFacts(rows: Doc<"dailySalesFacts">[], keyOf: (fact: Doc<"dailySalesFacts">) => string = (fact) => fact.dimensionKey) {
  const groups = new Map<string, { label: string; values: Record<FactMeasure, number>; dates: Set<string> }>()
  for (const fact of rows) {
    const key = keyOf(fact)
    const group = groups.get(key) ?? { label: fact.dimensionLabel, values: { orderCount: 0, guestCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, netAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0 }, dates: new Set<string>() }
    for (const measure of Object.keys(group.values) as FactMeasure[]) group.values[measure] += fact[measure]
    group.dates.add(fact.businessDate)
    groups.set(key, group)
  }
  return groups
}

export const round1 = (value: number) => Math.round(value * 10) / 10
export const percentOf = (part: number, whole: number) => (whole ? round1((part / whole) * 100) : 0)

/** The restaurant rows of the report's restaurants (already checked against the user's scope). */
export async function restaurantDocs(ctx: Parameters<Calculator>[0], restaurants: string[]) {
  const docs: Doc<"restaurants">[] = []
  for (const externalId of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (row) docs.push(row)
  }
  return docs
}

/** A case-insensitive match of the report search box (empty search matches everything). */
export function matcher(config: ReportConfig) {
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  return (...labels: string[]) => !needle || labels.some((label) => label.toLocaleLowerCase("ru").includes(needle))
}
