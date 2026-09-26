import { ConvexError, v, type Infer } from "convex/values"

// Report configuration (W1-RPT-01): business dates (Asia/Almaty, by the restaurant cutoff), restaurants,
// grouping and measure. The period is at most 366 days.

export const grouping = v.union(
  v.literal("day"), v.literal("week"), v.literal("month"), v.literal("hour"), v.literal("quarter-hour"), v.literal("restaurant"), v.literal("terminal"),
  v.literal("table"), v.literal("employee"), v.literal("category"), v.literal("product"), v.literal("payment-type"), v.literal("order-type"), v.literal("source"),
  v.literal("account"), v.literal("cashflow-category"), v.literal("warehouse"), v.literal("supplier"),
)

export const reportConfig = v.object({
  dateFrom: v.string(),
  dateTo: v.string(),
  restaurantExternalIds: v.array(v.string()),
  groupBy: v.optional(grouping),
  secondaryGroupBy: v.optional(grouping),
  measure: v.optional(v.union(v.literal("amount"), v.literal("count"), v.literal("average"))),
  search: v.optional(v.string()),
  extra: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
})

export type ReportConfig = Infer<typeof reportConfig>

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function checkReportPeriod(config: ReportConfig) {
  if (!DATE.test(config.dateFrom) || !DATE.test(config.dateTo) || config.dateFrom > config.dateTo) throw new ConvexError("Укажите период")
  const days = (Date.parse(`${config.dateTo}T00:00:00Z`) - Date.parse(`${config.dateFrom}T00:00:00Z`)) / 86_400_000 + 1
  if (days > 366) throw new ConvexError("Период не больше года")
}

export type ColumnUnit = "money" | "count" | "quantity" | "percent" | "hours" | "minutes" | "bonus" | "text" | "date"
export type ReportColumn = { key: string; label: string; unit: ColumnUnit; align: "left" | "right" }
export type ReportResult = {
  reportId: string
  generatedAt: number
  sourceLabel: string
  columns: ReportColumn[]
  rows: { key: string; cells: Record<string, number | string> }[]
  totals: Record<string, number>
  kpis: { key: string; label: string; value: number; unit: ColumnUnit }[]
  truncated: boolean
  /** The report cannot be computed yet (e.g. telephony not connected): the office shows this instead of an empty table. */
  unavailable?: { title: string; description: string }
}
