import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useCallback } from "react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export type CurrentShift = NonNullable<FunctionReturnType<typeof api.domains.shifts.queries.current>>
export type ShiftHistoryRow = FunctionReturnType<typeof api.domains.shifts.queries.history>["page"][number]

export const SHIFT_HISTORY_PAGE_SIZE = 20

export function useCurrentShift(sessionToken: string | null) {
  return useQuery(api.domains.shifts.queries.current, sessionToken ? { sessionToken } : "skip")
}

export function useClosePreview(sessionToken: string | null, enabled: boolean) {
  return useQuery(api.domains.shifts.queries.closePreview, sessionToken && enabled ? { sessionToken } : "skip")
}

/** Shifts of this terminal with their Z-report (W1-POS-19), newest first. */
export function useShiftHistory(sessionToken: string | null) {
  const result = usePaginatedQuery(api.domains.shifts.queries.history, sessionToken ? { sessionToken } : "skip", { initialNumItems: SHIFT_HISTORY_PAGE_SIZE })
  return { shifts: result.results as ShiftHistoryRow[], status: result.status, loadMore: () => result.loadMore(SHIFT_HISTORY_PAGE_SIZE) }
}

/** Reads a saved Z-report on demand (printing from the history or right after closing). */
export function useZReportLoader(sessionToken: string) {
  const convex = useConvex()
  return useCallback((shiftId: string) => convex.query(api.domains.shifts.queries.getZReport, { sessionToken, shiftId: shiftId as Id<"shifts"> }), [convex, sessionToken])
}

export function useShiftMutations() {
  return {
    open: useMutation(api.domains.shifts.mutations.open),
    close: useMutation(api.domains.shifts.mutations.close),
    reconcileCount: useMutation(api.domains.shifts.mutations.reconcileCount),
    recordCashMovement: useMutation(api.domains.shifts.mutations.recordCashMovement),
    createXReport: useMutation(api.domains.shifts.mutations.createXReport),
  }
}
