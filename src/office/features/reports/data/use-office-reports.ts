import { useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export type ReportsFilter = { restaurantExternalId?: string; from?: string; to?: string }

export function useReportsRestaurants() {
  return useQuery(api.domains.reports.queries.restaurantsForFilter) ?? []
}

export function useSalesSummary(filter: ReportsFilter) {
  const summary = useQuery(api.domains.reports.queries.salesSummary, filter)
  return { summary, loading: summary === undefined }
}

export function useShiftReports(filter: { restaurantExternalId?: string; limit?: number }) {
  const reports = useQuery(api.domains.reports.queries.listShiftReports, filter)
  return { reports: reports ?? [], loading: reports === undefined }
}

export type ShiftReport = ReturnType<typeof useShiftReports>["reports"][number]
