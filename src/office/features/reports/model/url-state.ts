import { almatyBusinessDate } from "@/shared/lib/almaty-time"

// Report filters live in the query string (W1-RPT-03): /office/reports/sales-01?from=…&to=…&restaurants=a,b&q=…
// so a deep link or F5 reopens the same report with the same filters. The period is business dates
// (YYYY-MM-DD, Asia/Almaty); the server accepts 366 days at most.

export type ReportFilters = {
  dateFrom: string
  dateTo: string
  restaurantExternalIds: string[]
  search: string
}

export type ReportsView = "catalog" | "summary" | "shifts"

export const MAX_PERIOD_DAYS = 366
/** «Последние 7 дней» including today. */
export const DEFAULT_PERIOD_DAYS = 7

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export function isBusinessDate(value: string | null | undefined): value is string {
  return !!value && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function shiftBusinessDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Inclusive number of days between two business dates. */
export function periodDays(dateFrom: string, dateTo: string) {
  return Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / DAY_MS) + 1
}

export function defaultPeriod(now = Date.now()) {
  const dateTo = almatyBusinessDate(now)
  return { dateFrom: shiftBusinessDate(dateTo, -(DEFAULT_PERIOD_DAYS - 1)), dateTo }
}

export function readFilters(params: URLSearchParams, now = Date.now()): ReportFilters {
  const fallback = defaultPeriod(now)
  const from = params.get("from")
  const to = params.get("to")
  return {
    dateFrom: isBusinessDate(from) ? from : fallback.dateFrom,
    dateTo: isBusinessDate(to) ? to : fallback.dateTo,
    restaurantExternalIds: (params.get("restaurants") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    search: params.get("q") ?? "",
  }
}

/** Writes the filters into a copy of `params`; the default period and empty values are left out of the URL. */
export function writeFilters(params: URLSearchParams, filters: ReportFilters, now = Date.now()) {
  const next = new URLSearchParams(params)
  const fallback = defaultPeriod(now)
  const period = filters.dateFrom === fallback.dateFrom && filters.dateTo === fallback.dateTo
  set(next, "from", period ? "" : filters.dateFrom)
  set(next, "to", period ? "" : filters.dateTo)
  set(next, "restaurants", filters.restaurantExternalIds.join(","))
  set(next, "q", filters.search.trim())
  return next
}

export function readView(params: URLSearchParams, reportId: string | undefined): ReportsView {
  if (reportId) return "catalog"
  const view = params.get("view")
  return view === "summary" || view === "shifts" ? view : "catalog"
}

export function writeView(params: URLSearchParams, view: ReportsView) {
  const next = new URLSearchParams(params)
  set(next, "view", view === "catalog" ? "" : view)
  return next
}

/** Client-side check of the period, so a wrong range never reaches the server. */
export function periodError(filters: Pick<ReportFilters, "dateFrom" | "dateTo">): string | null {
  if (!isBusinessDate(filters.dateFrom) || !isBusinessDate(filters.dateTo)) return "Укажите период: обе даты"
  if (filters.dateFrom > filters.dateTo) return "Дата «С» позже даты «По»"
  if (periodDays(filters.dateFrom, filters.dateTo) > MAX_PERIOD_DAYS) return "Период не больше года (366 дней)"
  return null
}

type ConfigLike = { dateFrom: string; dateTo: string; restaurantExternalIds: string[]; search?: string }

/** The report config sent to `execute` and stored in a saved view. */
export function configFromFilters(filters: ReportFilters): ConfigLike {
  const search = filters.search.trim()
  return { dateFrom: filters.dateFrom, dateTo: filters.dateTo, restaurantExternalIds: filters.restaurantExternalIds, ...(search ? { search } : {}) }
}

export function filtersFromConfig(config: ConfigLike): ReportFilters {
  return { dateFrom: config.dateFrom, dateTo: config.dateTo, restaurantExternalIds: config.restaurantExternalIds, search: config.search ?? "" }
}

/** "?from=…&to=…" for a link that opens a report or a saved view with its filters; "" for the defaults. */
export function filtersSearch(filters: ReportFilters, now = Date.now()) {
  const search = writeFilters(new URLSearchParams(), filters, now).toString()
  return search ? `?${search}` : ""
}

/** True when the URL carries no report filters at all (a bare deep link to a saved view). */
export function hasFilterParams(params: URLSearchParams) {
  return ["from", "to", "restaurants", "q"].some((key) => params.has(key))
}

function set(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value)
  else params.delete(key)
}
