import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo, useState } from "react"

import { usePlatformScope } from "@/office/features/platform/data/use-platform"

import { api } from "../../../../../convex/_generated/api"

// Finance sections on the domain-record engine (W1-FIN-03…06): typed hooks over
// convex/domains/finance/{records,queries,shiftAcceptance}. The server checks rights, restaurant scope
// and each module's rules again.

export const FINANCE_PAGE_SIZE = 50

const records = api.domains.finance.records
const queries = api.domains.finance.queries
const shifts = api.domains.finance.shiftAcceptance

export type FinanceModuleId = FunctionArgs<typeof records.list>["moduleId"]
export type FinanceStatus = NonNullable<FunctionArgs<typeof records.list>["status"]>
export type FinanceRecord = FunctionReturnType<typeof records.list>["page"][number]
export type FinanceReferences = FunctionReturnType<typeof records.references>
export type AccountReference = FinanceReferences["accounts"][number]
export type SaveFinanceRecordArgs = FunctionArgs<typeof records.save>
export type FinanceAction = FunctionArgs<typeof records.transition>["action"]
export type JournalRow = FunctionReturnType<typeof queries.journal>["page"][number]
export type JournalArgs = Omit<FunctionArgs<typeof queries.journal>, "paginationOpts">
export type FinanceOverview = FunctionReturnType<typeof queries.overview>
export type ShiftCandidate = FunctionReturnType<typeof shifts.candidates>["page"][number]
export type ShiftAcceptanceRow = FunctionReturnType<typeof shifts.acceptances>["page"][number]

/** Records of one module; status and search narrow on the server (index or search index). */
export function useFinanceRecords(moduleId: FinanceModuleId, args: { status?: FinanceStatus; search?: string; restaurantExternalId?: string }) {
  return usePaginatedQuery(
    records.list,
    {
      moduleId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.search?.trim() ? { search: args.search.trim() } : {}),
      ...(args.restaurantExternalId ? { restaurantExternalId: args.restaurantExternalId } : {}),
    },
    { initialNumItems: FINANCE_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing, of another module or outside the scope. */
export function useFinanceRecord(moduleId: FinanceModuleId, externalId: string | null) {
  return useQuery(records.get, externalId ? { moduleId, externalId } : "skip")
}

/** Pick lists: accounts, active cashflow categories and counterparties, restaurants in scope. */
export function useFinanceReferences(moduleId: FinanceModuleId) {
  return useQuery(records.references, { moduleId })
}

export function useFinanceMutations() {
  const save = useMutation(records.save)
  const transition = useMutation(records.transition)
  return { save, transition }
}

/** null skips the query (an incomplete period): journal and overview reject it on the server. */
export function useJournal(args: JournalArgs | null) {
  return usePaginatedQuery(queries.journal, args ?? "skip", { initialNumItems: FINANCE_PAGE_SIZE })
}

export function useFinanceOverview(args: FunctionArgs<typeof queries.overview> | null) {
  return useQuery(queries.overview, args ?? "skip")
}

export function useCounterpartyDebt(externalId: string | null) {
  return useQuery(queries.counterpartyDebt, externalId ? { externalId } : "skip")
}

/** Closed shifts waiting for acceptance; no restaurant — every restaurant in scope. */
export function useShiftCandidates(restaurantExternalId: string | undefined, enabled = true) {
  return usePaginatedQuery(shifts.candidates, !enabled ? "skip" : restaurantExternalId ? { restaurantExternalId } : {}, { initialNumItems: FINANCE_PAGE_SIZE })
}

export function useShiftAcceptances(restaurantExternalId: string | undefined) {
  return usePaginatedQuery(shifts.acceptances, restaurantExternalId ? { restaurantExternalId } : "skip", { initialNumItems: FINANCE_PAGE_SIZE })
}

export function useShiftAcceptanceMutations() {
  const accept = useMutation(shifts.acceptShift)
  const reverse = useMutation(shifts.reverseShiftAcceptance)
  return { accept, reverse }
}

export const ALL_RESTAURANTS = "all"

/**
 * Restaurant filter over the user's scope: a network user gets «Все рестораны», a branch user starts on
 * their restaurant. `allowAll: false` always picks one (queries that need a restaurant).
 */
export function useFinanceRestaurantFilter({ allowAll = true }: { allowAll?: boolean } = {}) {
  const scope = usePlatformScope()
  const [picked, setPicked] = useState<string | null>(null)
  return useMemo(() => {
    const withAll = allowAll && scope.network
    const fallback = withAll ? ALL_RESTAURANTS : (scope.restaurants[0]?.externalId ?? ALL_RESTAURANTS)
    const value = picked ?? fallback
    const options = [...(withAll ? [{ value: ALL_RESTAURANTS, label: "Все рестораны" }] : []), ...scope.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))]
    return {
      loading: scope.loading,
      value,
      setValue: setPicked,
      options,
      /** Only when there is a choice to make. */
      visible: options.length > 1,
      restaurantExternalId: value === ALL_RESTAURANTS ? undefined : value,
      restaurants: scope.restaurants,
      restaurantName: (externalId: string | undefined | null) => scope.restaurantName(externalId) ?? "—",
    }
  }, [scope, picked, allowAll])
}
