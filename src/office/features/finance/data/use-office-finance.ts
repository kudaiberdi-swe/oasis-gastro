import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export type FinanceFilter = { restaurantExternalId?: string; from?: string; to?: string }

export function useFinanceSummary(filter: FinanceFilter) {
  const summary = useQuery(api.domains.finance.queries.summary, filter)
  return { summary, loading: summary === undefined }
}

export function useFinanceEntries(filter: FinanceFilter & { limit?: number }) {
  const entries = useQuery(api.domains.finance.queries.listEntries, filter)
  return { entries: entries ?? [], loading: entries === undefined }
}

export function useFinanceRestaurants() {
  return useQuery(api.domains.finance.queries.restaurantsForFilter) ?? []
}

export function useRecordExpense() {
  return useMutation(api.domains.finance.mutations.recordExpense)
}
