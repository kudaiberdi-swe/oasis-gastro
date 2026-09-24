import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { Component, createElement, useMemo, type ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"

import { api } from "../../../../../convex/_generated/api"

// «Терминалы», «Закрытие периода», «Журнал событий» (W1-ADM-02…04): paginated registers over
// convex/domains/platform; the server checks every right and scope again.

export const PLATFORM_PAGE_SIZE = 50

const queries = api.domains.platform.queries
const mutations = api.domains.platform.mutations

export type TerminalRow = FunctionReturnType<typeof queries.listTerminals>["page"][number]
export type PeriodLockRow = FunctionReturnType<typeof queries.listPeriodLocks>["page"][number]
export type AuditEventRow = FunctionReturnType<typeof queries.auditLog>["page"][number]
export type TerminalKind = TerminalRow["kind"]
export type SaveTerminalArgs = FunctionArgs<typeof mutations.saveTerminal>
export type CreatePeriodLockArgs = FunctionArgs<typeof mutations.createPeriodLock>

type PaginatedArgs<Args> = Omit<Args, "paginationOpts">

/** Restaurants in the user's scope (pickers) and whether the user sees the whole network. */
export function usePlatformScope() {
  const context = useQuery(api.domains.office.queries.context)
  return useMemo(() => {
    // All active restaurants in scope, including ones without a terminal yet.
    const restaurants = (context?.adminRestaurants ?? []).map((restaurant) => ({ externalId: restaurant.externalId, name: restaurant.name }))
    return {
      loading: context === undefined,
      restaurants,
      network: context?.user?.restaurantScopes.includes("*") ?? false,
      restaurantName: (externalId: string | undefined | null) => (externalId ? (restaurants.find((restaurant) => restaurant.externalId === externalId)?.name ?? externalId) : undefined),
    }
  }, [context])
}

export function useTerminals(args: PaginatedArgs<FunctionArgs<typeof queries.listTerminals>>) {
  return usePaginatedQuery(queries.listTerminals, args, { initialNumItems: PLATFORM_PAGE_SIZE })
}

export function usePeriodLocks(args: PaginatedArgs<FunctionArgs<typeof queries.listPeriodLocks>>) {
  return usePaginatedQuery(queries.listPeriodLocks, args, { initialNumItems: PLATFORM_PAGE_SIZE })
}

export function useAuditLog(args: PaginatedArgs<FunctionArgs<typeof queries.auditLog>>) {
  return usePaginatedQuery(queries.auditLog, args, { initialNumItems: PLATFORM_PAGE_SIZE })
}

export function usePlatformMutations() {
  const saveTerminal = useMutation(mutations.saveTerminal)
  const setTerminalActive = useMutation(mutations.setTerminalActive)
  const createPeriodLock = useMutation(mutations.createPeriodLock)
  const reopenPeriodLock = useMutation(mutations.reopenPeriodLock)
  return { saveTerminal, setTerminalActive, createPeriodLock, reopenPeriodLock }
}

/** Russian dates for YYYY-MM-DD business dates: 31.08.2026. */
export function formatBusinessDate(date: string) {
  return date.split("-").reverse().join(".")
}

/** A failed query (Convex hooks throw during render) becomes the error state with «Повторить» (OFFICE-DESIGN §7). */
export class PlatformErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return createElement("div", { className: "p-6 xl:p-8" }, createElement(OfficeStatePage, { state: { kind: "error", error: this.state.error, onRetry: this.props.onRetry } }))
    }
    return this.props.children
  }
}
