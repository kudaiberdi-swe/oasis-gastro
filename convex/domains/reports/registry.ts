import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import type { ReportColumn, ReportConfig, ReportResult } from "../../lib/reportConfig"

type QueryCtx = GenericQueryCtx<DataModel>
type FactType = Doc<"dailySalesFacts">["factType"]
type Measure = "orderCount" | "guestCount" | "quantity" | "grossAmount" | "discountAmount" | "serviceChargeAmount" | "netAmount" | "costAmount" | "refundAmount" | "refundCount"

// Report registry (W1-RPT-01): only reports with a calculator and a test are "implemented"; the rest of
// the 190 are honestly "in development" (bahandi reported 190/190 — B-23).

export type Calculator = (ctx: QueryCtx, config: ReportConfig, restaurantExternalIds: string[]) => Promise<Omit<ReportResult, "reportId" | "generatedAt">>

const SCAN_LIMIT = 50_000
const MEASURES: Measure[] = ["orderCount", "guestCount", "quantity", "grossAmount", "discountAmount", "serviceChargeAmount", "netAmount", "costAmount", "refundAmount", "refundCount"]
const col = (key: string, label: string, unit: ReportColumn["unit"]): ReportColumn => ({ key, label, unit, align: unit === "text" || unit === "date" ? "left" : "right" })

async function facts(ctx: QueryCtx, factType: FactType, config: ReportConfig, restaurants: string[]) {
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
function factReport(options: { factType: FactType; byDay?: boolean; dimensionLabel: string; measures: { key: Measure; label: string; unit: ReportColumn["unit"] }[]; average?: boolean; margin?: boolean; sortBy?: Measure }): Calculator {
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

const money = (key: Measure, label: string) => ({ key, label, unit: "money" as const })
const count = (key: Measure, label: string) => ({ key, label, unit: "count" as const })

export const REPORT_REGISTRY: Record<string, { calculator: Calculator }> = {
  "sales-01": { calculator: factReport({ factType: "branch", byDay: true, dimensionLabel: "Дата", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("grossAmount", "По меню"), money("discountAmount", "Скидки"), money("serviceChargeAmount", "Сервисный сбор"), money("netAmount", "Выручка"), money("refundAmount", "Возвраты")], average: true }) },
  "sales-02": { calculator: factReport({ factType: "hour", dimensionLabel: "Час", measures: [count("orderCount", "Заказов"), money("netAmount", "Выручка")], average: true, sortBy: "netAmount" }) },
  "sales-04": { calculator: factReport({ factType: "employee", dimensionLabel: "Официант", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("netAmount", "Выручка")], average: true }) },
  "sales-06": { calculator: factReport({ factType: "payment-type", dimensionLabel: "Тип оплаты", measures: [count("orderCount", "Оплат"), money("netAmount", "Сумма"), money("refundAmount", "Возвраты"), count("refundCount", "Возвратов")], sortBy: "netAmount" }) },
  "sales-07": { calculator: factReport({ factType: "category", dimensionLabel: "Категория", measures: [{ key: "quantity", label: "Количество", unit: "quantity" }, money("netAmount", "Выручка"), money("costAmount", "Себестоимость")], margin: true, sortBy: "netAmount" }) },
  "sales-12": { calculator: factReport({ factType: "product", dimensionLabel: "Блюдо", measures: [{ key: "quantity", label: "Количество", unit: "quantity" }, money("grossAmount", "По меню"), money("netAmount", "Выручка"), money("costAmount", "Себестоимость")], margin: true, sortBy: "netAmount" }) },
  "sales-14": { calculator: factReport({ factType: "order-type", dimensionLabel: "Тип заказа", measures: [count("orderCount", "Заказов"), money("netAmount", "Выручка")], average: true }) },
  "sales-21": { calculator: factReport({ factType: "deletion-reason", dimensionLabel: "Причина", measures: [count("orderCount", "Случаев"), { key: "quantity", label: "Позиций", unit: "quantity" }, money("grossAmount", "Сумма")] }) },
  "sales-22": { calculator: factReport({ factType: "discount-type", dimensionLabel: "Скидка / надбавка", measures: [count("orderCount", "Заказов"), money("grossAmount", "По меню"), money("discountAmount", "Сумма скидки")], sortBy: "discountAmount" }) },
  "sales-23": { calculator: factReport({ factType: "service-charge", dimensionLabel: "Сбор", measures: [count("orderCount", "Заказов"), money("serviceChargeAmount", "Сервисный сбор"), money("netAmount", "Выручка")] }) },
}
