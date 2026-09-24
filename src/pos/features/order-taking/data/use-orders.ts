import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export function useOpenChecks(sessionToken: string | null) {
  return useQuery(api.domains.orders.queries.listOpenChecks, sessionToken ? { sessionToken } : "skip") ?? []
}

export function useCheck(sessionToken: string | null, orderId: Id<"orders"> | null) {
  return useQuery(api.domains.orders.queries.getCheck, sessionToken && orderId ? { sessionToken, orderId } : "skip")
}

export function useOrderMutations() {
  return {
    saveDraft: useMutation(api.domains.orders.mutations.saveDraft),
    hold: useMutation(api.domains.orders.mutations.hold),
    resume: useMutation(api.domains.orders.mutations.resume),
    cancel: useMutation(api.domains.orders.mutations.cancel),
    checkout: useMutation(api.domains.orders.mutations.checkout),
    refund: useMutation(api.domains.orders.mutations.refund),
    sendToKitchen: useMutation(api.domains.orders.mutations.sendToKitchen),
    voidLine: useMutation(api.domains.orders.mutations.voidLine),
  }
}
