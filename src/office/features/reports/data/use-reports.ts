import { useMutation, useQueries, useQuery } from "convex/react"
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server"
import { useEffect, useMemo, useState } from "react"

import { api } from "../../../../../convex/_generated/api"

// Reports 2.0 over convex/domains/reports/queries (W1-RPT-01/02/03). The server checks the right
// `office.reports.view`, the report's own capability and the restaurant scope again.

const reports = api.domains.reports.queries
const views = api.domains.reports.mutations

export type ReportConfig = FunctionArgs<typeof reports.execute>["config"]
export type ReportResult = FunctionReturnType<typeof reports.execute>
export type ReportCoverage = FunctionReturnType<typeof reports.coverage>
export type DashboardSummary = FunctionReturnType<typeof reports.dashboardSummary>

export type SafeQueryState<T> = { data: T | undefined; error: Error | undefined; loading: boolean; retry: () => void }

/**
 * A query whose server error is returned instead of thrown (useQueries), so the screen shows a banner with
 * «Повторить» next to the filters. `retry` drops the subscription for one render and subscribes again.
 */
function useSafeQuery<Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip"): SafeQueryState<FunctionReturnType<Query>> {
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    if (retrying) setRetrying(false)
  }, [retrying])
  const key = args === "skip" || retrying ? null : JSON.stringify(args)
  // `api.…` references are proxies: a new object on every access, so the memo keys on the function
  // name — keying on the reference re-created the request each render and looped useQueries.
  const name = getFunctionName(query)
  const queries = useMemo(() => {
    const request: Parameters<typeof useQueries>[0] = {}
    if (key !== null) request.value = { query: makeFunctionReference<"query">(name), args: JSON.parse(key) as FunctionArgs<Query> }
    return request
  }, [name, key])
  const value = useQueries(queries).value as FunctionReturnType<Query> | Error | undefined
  const error = value instanceof Error ? value : undefined
  return {
    data: value instanceof Error ? undefined : value,
    error,
    loading: retrying || (key !== null && value === undefined),
    retry: () => setRetrying(true),
  }
}

export function useReportsRestaurants() {
  return useQuery(reports.restaurantsForFilter, {})
}

export type ReportRestaurant = NonNullable<ReturnType<typeof useReportsRestaurants>>[number]

export function useReportCoverage() {
  return useQuery(reports.coverage, {})
}

/** Runs one implemented report; `config: null` (report in development, wrong period) never calls the server. */
export function useReportResult(reportId: string, config: ReportConfig | null) {
  return useSafeQuery(reports.execute, config ? { reportId, config } : "skip")
}

export function useDashboardSummary(args: FunctionArgs<typeof reports.dashboardSummary> | null) {
  return useSafeQuery(reports.dashboardSummary, args ?? "skip")
}

/** X/Z-reports generated at the кассы (stays here until «Кассовые смены» takes it over). */
export function useShiftReports(filter: { restaurantExternalId?: string; limit?: number }) {
  const list = useQuery(reports.listShiftReports, filter)
  return { reports: list ?? [], loading: list === undefined }
}

export type ShiftReport = ReturnType<typeof useShiftReports>["reports"][number]

// ── Saved views and favorites (W1-RPT-05): only the owner's own views; the server drops restaurants
// that went out of scope when a view is read.

export type ReportView = FunctionReturnType<typeof views.listViews>[number]

/** `enabled: false` (no `office.report-favorites.view`) never calls the server. */
export function useReportViews(args: FunctionArgs<typeof views.listViews>, enabled: boolean) {
  return useQuery(views.listViews, enabled ? args : "skip")
}

export function useReportViewActions() {
  return { save: useMutation(views.saveView), remove: useMutation(views.deleteView), toggleFavorite: useMutation(views.toggleFavorite) }
}
