import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import type { Id } from "@convex/_generated/dataModel"

export type OrderGuest = NonNullable<FunctionReturnType<typeof api.domains.loyalty.queries.getOrderGuest>>
export type PosGuestMatch = FunctionReturnType<typeof api.domains.loyalty.queries.searchForPos>[number]
export type LoyaltyQuote = NonNullable<FunctionReturnType<typeof api.domains.loyalty.queries.quoteForPos>>

export function useOrderGuest(sessionToken: string | null, orderId: Id<"orders"> | null) {
  return useQuery(api.domains.loyalty.queries.getOrderGuest, sessionToken && orderId ? { sessionToken, orderId } : "skip")
}

/** POS guest search (W1-LOY-03 searchForPos): name, phone digits or card, from 2 characters; phones come masked. */
export function useGuestSearch(sessionToken: string | null, query: string) {
  const text = query.trim()
  return useQuery(api.domains.loyalty.queries.searchForPos, sessionToken && text.length >= 2 ? { sessionToken, query: text } : "skip")
}

/**
 * Balance, what can be spent and what will be earned on this check. Without `guestId` it is the
 * guest attached to the order; with it — a guest found in the search, before attaching.
 */
export function useLoyaltyQuote(sessionToken: string | null, orderId: Id<"orders"> | null, options: { guestId?: Id<"guests">; enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true
  return useQuery(
    api.domains.loyalty.queries.quoteForPos,
    sessionToken && orderId && enabled
      ? {
          sessionToken,
          orderId,
          ...(options.guestId ? { guestId: options.guestId } : {}),
        }
      : "skip",
  )
}

export function useLoyaltyMutations() {
  return {
    attachGuest: useMutation(api.domains.loyalty.mutations.attachGuestToOrder),
    detachGuest: useMutation(api.domains.loyalty.mutations.detachGuestFromOrder),
    setRedemption: useMutation(api.domains.loyalty.mutations.setOrderRedemption),
  }
}
