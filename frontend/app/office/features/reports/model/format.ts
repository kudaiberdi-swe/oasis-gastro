import type { ColumnUnit } from "@convex/lib/reportConfig"

import { formatAmount, formatPercent, formatQuantity, formatTenge } from "@/shared/lib/format"

// Report cells and KPIs by column unit (W1-RPT-03). Money always goes through formatTenge: no tiyn,
// thin-space groups, real minus U+2212 (L-22).

export type { ColumnUnit }

const NBSP = "\u00a0"

export function formatReportValue(value: number | string | null | undefined, unit: ColumnUnit): string {
  if (value === null || value === undefined || value === "") return "—"
  if (unit === "text") return String(value)
  if (unit === "date") return typeof value === "string" ? formatBusinessDay(value) : String(value)
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return String(value)
  switch (unit) {
    case "money":
      return formatTenge(number)
    case "count":
      return formatAmount(number)
    case "quantity":
      return formatQuantity(number)
    case "percent":
      return formatPercent(number)
    case "hours":
      return `${formatQuantity(Math.round(number * 10) / 10)}${NBSP}ч`
    case "minutes":
      return `${formatAmount(number)}${NBSP}мин`
    case "bonus":
      return `${formatQuantity(Math.round(number * 100) / 100)}${NBSP}Б`
  }
}

/** "2026-09-24" → "24.09.2026"; anything else is returned as is. */
export function formatBusinessDay(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : date
}

export function formatPeriod(dateFrom: string, dateTo: string) {
  return dateFrom === dateTo ? formatBusinessDay(dateFrom) : `${formatBusinessDay(dateFrom)} — ${formatBusinessDay(dateTo)}`
}

/** "24.09.2026, 12:17" in Almaty time. */
export function formatGeneratedAt(value: number) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** Change against the previous period: «+12,5 % к прошлому периоду» (`percent` alone: «+12,5 %»); null when there is nothing to compare with. */
export function formatDelta(current: number, previous: number) {
  if (!previous) return null
  const percent = ((current - previous) / Math.abs(previous)) * 100
  const short = formatPercent(percent, { explicitPlus: true })
  return { text: `${short} к прошлому периоду`, percent: short, tone: percent > 0 ? ("success" as const) : percent < 0 ? ("danger" as const) : ("neutral" as const) }
}
