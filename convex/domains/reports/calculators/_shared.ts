import type { ReportColumn, ReportResult } from "../../../lib/reportConfig"

export const SCAN_BUDGET = 20_000
export const ALMATY_OFFSET_MS = 5 * 3_600_000

export const col = (key: string, label: string, unit: ReportColumn["unit"]): ReportColumn => ({ key, label, unit, align: unit === "text" || unit === "date" ? "left" : "right" })

/** Start of a business date (Almaty midnight) and the end of `to` as epoch ms. */
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - ALMATY_OFFSET_MS
export const dayEnd = (date: string) => dayStart(date) + 86_400_000 - 1
export const localDate = (at: number) => new Date(at + ALMATY_OFFSET_MS).toISOString().slice(0, 10)

/** Groups rows by key and sums the numeric cells; totals over the numeric columns. */
export function aggregate(rows: { key: string; label: string; values: Record<string, number>; text?: Record<string, string> }[], columns: ReportColumn[], sort?: string): Pick<ReportResult, "rows" | "totals"> {
  const groups = new Map<string, { label: string; values: Record<string, number>; text: Record<string, string> }>()
  for (const row of rows) {
    const group = groups.get(row.key) ?? { label: row.label, values: {}, text: row.text ?? {} }
    for (const [key, value] of Object.entries(row.values)) group.values[key] = (group.values[key] ?? 0) + value
    groups.set(row.key, group)
  }
  const numeric = columns.filter((column) => column.unit !== "text" && column.unit !== "date").map((column) => column.key)
  const totals: Record<string, number> = {}
  const out = [...groups.entries()].map(([key, group]) => {
    const cells: Record<string, number | string> = { group: group.label, ...group.text }
    for (const column of numeric) {
      cells[column] = Math.round((group.values[column] ?? 0) * 1000) / 1000
      totals[column] = (totals[column] ?? 0) + (group.values[column] ?? 0)
    }
    return { key, cells }
  })
  if (sort) out.sort((a, b) => Number(b.cells[sort] ?? 0) - Number(a.cells[sort] ?? 0))
  return { rows: out, totals }
}
