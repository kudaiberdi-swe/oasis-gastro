import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export function useGuests(search: string) {
  const guests = useQuery(api.domains.loyalty.queries.listGuests, { search: search || undefined })
  return { guests: guests ?? [], loading: guests === undefined }
}

export function useGuestHistory(guestId: Id<"guests"> | null) {
  const history = useQuery(api.domains.loyalty.queries.guestHistory, guestId ? { guestId } : "skip")
  return { history: history ?? [], loading: history === undefined }
}

export function useAdjustPoints() {
  return useMutation(api.domains.loyalty.mutations.adjustPoints)
}

export type Guest = ReturnType<typeof useGuests>["guests"][number]
