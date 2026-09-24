import { usePaginatedQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

export type HistoryStatus = "draft" | "held" | "paid" | "partially_refunded" | "refunded" | "cancelled"

type HistoryPage = FunctionReturnType<typeof api.domains.orders.queries.list>
export type HistoryOrder = HistoryPage["page"][number]

export const HISTORY_PAGE_SIZE = 20

/** Orders of this terminal, newest first; search and status filter run on the server (W1-POS-18). */
export function useOrderHistory(sessionToken: string | null, search: string, status: HistoryStatus | undefined) {
  const trimmed = search.trim()
  const result = usePaginatedQuery(
    api.domains.orders.queries.list,
    sessionToken ? { sessionToken, direction: "desc" as const, ...(trimmed ? { search: trimmed } : {}), ...(status ? { status } : {}) } : "skip",
    { initialNumItems: HISTORY_PAGE_SIZE },
  )
  return {
    orders: result.results as HistoryOrder[],
    status: result.status,
    loadMore: () => result.loadMore(HISTORY_PAGE_SIZE),
  }
}
