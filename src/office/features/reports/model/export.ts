import type { ReportResult } from "../../../../../convex/lib/reportConfig"

import { formatBusinessDay, formatGeneratedAt, formatPeriod, type ColumnUnit } from "./format"

// Client-side export of a report result (W1-RPT-04, CSV only for now). Pure functions without DOM:
// UTF-8 with BOM so Excel detects the encoding, «;» as the separator (the RU/KZ Excel list separator),
// numbers without group separators and with a dot, money rounded to whole tenge, the «Итого» row, and a
// header block with the report, period and restaurants.

export type ExportableResult = Pick<ReportResult, "columns" | "rows" | "totals" | "kpis" | "generatedAt" | "sourceLabel" | "truncated">

export type ExportMeta = {
  title: string
  dateFrom: string
  dateTo: string
  /** Names of the selected restaurants; empty means every restaurant in the user's scope. */
  restaurants: string[]
}

export const CSV_BOM = "\ufeff"
const SEPARATOR = ";"
const EOL = "\r\n"

/** Quotes a cell when it holds the separator, quotes or a line break; neutralises spreadsheet formulas. */
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** A cell value as a spreadsheet reads it: plain digits and a dot, whole tenge, ASCII minus. */
export function csvValue(value: number | string | null | undefined, unit: ColumnUnit) {
  if (value === null || value === undefined) return ""
  if (unit === "text") return csvCell(String(value))
  if (unit === "date") return typeof value === "string" ? formatBusinessDay(value) : String(value)
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return csvCell(String(value))
  if (unit === "money" || unit === "count") return String(Math.round(number))
  return String(Math.round(number * 1000) / 1000)
}

export function toCsv(result: ExportableResult, meta: ExportMeta) {
  const line = (cells: string[]) => cells.join(SEPARATOR)
  const lines = [
    line(["Отчёт", csvCell(meta.title)]),
    line(["Период", formatPeriod(meta.dateFrom, meta.dateTo)]),
    line(["Рестораны", csvCell(meta.restaurants.length ? meta.restaurants.join(", ") : "Все рестораны в доступе")]),
    line(["Сформировано", csvCell(formatGeneratedAt(result.generatedAt))]),
    line(["Источник", csvCell(result.sourceLabel)]),
  ]
  for (const kpi of result.kpis) lines.push(line([csvCell(kpi.label), csvValue(kpi.value, kpi.unit)]))
  if (result.truncated) lines.push(line(["Внимание", csvCell("Период слишком большой: выгружена только часть записей")]))
  lines.push("")
  lines.push(line(result.columns.map((column) => csvCell(column.label))))
  for (const row of result.rows) lines.push(line(result.columns.map((column) => csvValue(row.cells[column.key], column.unit))))
  if (hasTotals(result)) {
    lines.push(line(result.columns.map((column, index) => (index === 0 ? "Итого" : column.key in result.totals ? csvValue(result.totals[column.key], column.unit) : ""))))
  }
  return CSV_BOM + lines.join(EOL) + EOL
}

export function hasTotals(result: Pick<ReportResult, "columns" | "totals">) {
  return result.columns.some((column, index) => index > 0 && column.key in result.totals)
}

/** "Выручка по дням_2026-09-01_2026-09-07.csv"; characters Windows forbids in names are dropped. */
export function exportFileName(meta: Pick<ExportMeta, "title" | "dateFrom" | "dateTo">, extension: "csv") {
  const title = meta.title.replace(/[\\/:*?"<>|«»]/g, "").replace(/\s+/g, " ").trim() || "report"
  return `${title}_${meta.dateFrom}_${meta.dateTo}.${extension}`
}
