import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"
import type { Id } from "@convex/_generated/dataModel"

export function useOpenChecks(sessionToken: string | null) {
  return useQuery(api.domains.orders.queries.listOpenChecks, sessionToken ? { sessionToken } : "skip") ?? []
}

/** «Зал»: the restaurant's tables by hall with the open checks at them (orders.floor); only while the grid is open. */
export function useFloor(sessionToken: string | null, enabled: boolean) {
  return useQuery(api.domains.orders.floor.floor, sessionToken && enabled ? { sessionToken } : "skip")
}

export function useCheck(sessionToken: string | null, orderId: Id<"orders"> | null) {
  return useQuery(api.domains.orders.queries.getCheck, sessionToken && orderId ? { sessionToken, orderId } : "skip")
}

/** «Добавить к заказу» (W1-POS-09/13): a popular dish from a category the check does not have yet. */
export function useSuggestion(sessionToken: string | null, orderId: Id<"orders"> | null) {
  return useQuery(api.domains.pos.queries.suggestion, sessionToken ? { sessionToken, orderId: orderId ?? undefined } : "skip") ?? null
}

/** Terminals of the restaurant with an open shift — where a held check can go (W1-POS-05). */
export function useTransferTargets(sessionToken: string | null, enabled: boolean) {
  return useQuery(api.domains.shifts.queries.availableTransferTargets, sessionToken && enabled ? { sessionToken } : "skip")
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
    split: useMutation(api.domains.orders.mutations.split),
    moveToTable: useMutation(api.domains.orders.mutations.moveToTable),
    transfer: useMutation(api.domains.orders.mutations.transfer),
  }
}
