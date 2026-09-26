import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useMemo } from "react"
import { useSearchParams } from "react-router"

import { usePlatformScope } from "@/office/features/platform/data/use-platform"

import { api } from "../../../../../convex/_generated/api"
import { todayAlmaty, type RecordModule, type RecordStatus } from "../config"

// Kitchen forecast, plans and sheets (W3-PRD-07/08). The server checks office.<module>.<action> and the
// restaurant scope on every call and builds every line from lib/forecast.ts.

export const LOGISTICS_PAGE_SIZE = 50

const queries = api.domains.productionLogistics.queries
const mutations = api.domains.productionLogistics.mutations

export type KitchenForecast = FunctionReturnType<typeof queries.forecast>
export type Requirement = FunctionReturnType<typeof queries.semiFinishedRequirement>
export type RecordRow = FunctionReturnType<typeof queries.listRecords>["page"][number]
export type ProductionRecordDoc = NonNullable<FunctionReturnType<typeof queries.getRecord>>

/**
 * The restaurant and date of the forecast, kept in the URL (?restaurant=&date=) so F5 and a shared link keep
 * them. The forecast is one restaurant's: no «Все рестораны» here — the first one in scope is the default.
 */
export function useForecastTarget() {
  const scope = usePlatformScope()
  const [params, setParams] = useSearchParams()
  const requested = params.get("restaurant")
  const restaurantExternalId = requested && scope.restaurants.some((restaurant) => restaurant.externalId === requested) ? requested : (scope.restaurants[0]?.externalId ?? "")
  const date = params.get("date")
  const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayAlmaty()
  return useMemo(
    () => ({
      loading: scope.loading,
      restaurants: scope.restaurants,
      restaurantName: scope.restaurantName,
      restaurantExternalId,
      targetDate,
      set: (patch: { restaurant?: string; date?: string }) =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current)
            if (patch.restaurant !== undefined) next.set("restaurant", patch.restaurant)
            if (patch.date !== undefined) next.set("date", patch.date)
            return next
          },
          { replace: true },
        ),
    }),
    [scope, restaurantExternalId, targetDate, setParams],
  )
}

export function useKitchenForecast(moduleId: RecordModule, restaurantExternalId: string, targetDate: string) {
  return useQuery(queries.forecast, restaurantExternalId ? { restaurantExternalId, targetDate, section: moduleId } : "skip")
}

export function useRequirement(restaurantExternalId: string, targetDate: string, enabled: boolean) {
  return useQuery(queries.semiFinishedRequirement, enabled && restaurantExternalId ? { restaurantExternalId, targetDate } : "skip")
}

export function useRecords(args: { moduleId: RecordModule; status?: RecordStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    queries.listRecords,
    args.enabled ? { moduleId: args.moduleId, status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: LOGISTICS_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or outside the scope. */
export function useRecord(externalId: string) {
  return useQuery(queries.getRecord, { externalId })
}

export function useLogisticsMutations() {
  const createFromForecast = useMutation(mutations.createFromForecast)
  const saveRecord = useMutation(mutations.saveRecord)
  const refreshRecord = useMutation(mutations.refreshRecord)
  const transitionRecord = useMutation(mutations.transitionRecord)
  const createProductionAct = useMutation(mutations.createProductionAct)
  return { createFromForecast, saveRecord, refreshRecord, transitionRecord, createProductionAct }
}
