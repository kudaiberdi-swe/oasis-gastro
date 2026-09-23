import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export function useCurrentShift(sessionToken: string | null) {
  return useQuery(api.domains.shifts.queries.current, sessionToken ? { sessionToken } : "skip")
}

export function useClosePreview(sessionToken: string | null, enabled: boolean) {
  return useQuery(api.domains.shifts.queries.closePreview, sessionToken && enabled ? { sessionToken } : "skip")
}

export function useShiftMutations() {
  return {
    open: useMutation(api.domains.shifts.mutations.open),
    close: useMutation(api.domains.shifts.mutations.close),
    recordCashMovement: useMutation(api.domains.shifts.mutations.recordCashMovement),
    createXReport: useMutation(api.domains.shifts.mutations.createXReport),
  }
}
