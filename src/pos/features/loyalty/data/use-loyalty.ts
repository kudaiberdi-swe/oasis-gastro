import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export function useOrderGuest(sessionToken: string | null, orderId: Id<"orders"> | null) {
  return useQuery(api.domains.loyalty.queries.getOrderGuest, sessionToken && orderId ? { sessionToken, orderId } : "skip")
}

export function useFindGuestByPhone(sessionToken: string | null, phone: string) {
  return useQuery(api.domains.loyalty.queries.findGuestByPhone, sessionToken && phone.length >= 10 ? { sessionToken, phone } : "skip")
}

export function useLoyaltyMutations() {
  return {
    attachGuest: useMutation(api.domains.loyalty.mutations.attachGuestToOrder),
    detachGuest: useMutation(api.domains.loyalty.mutations.detachGuestFromOrder),
  }
}
