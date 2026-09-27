import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

export type KitchenTicket = FunctionReturnType<typeof api.domains.kitchen.queries.board>[number]
export type KitchenTicketLine = KitchenTicket["lines"][number]

/** The journal «Выданные» shows the last 20 served tickets (the server caps it at 20). */
export const COMPLETED_JOURNAL_SIZE = 20

/**
 * The session restaurant's board, live. `undefined` while the first result loads.
 * `prepArea` filters lines on the server (a ticket without lines of that station drops out).
 */
export function useKitchenBoardQuery(sessionToken: string | null, options: { prepArea?: string; includeCompletedLast?: number } = {}) {
  return useQuery(
    api.domains.kitchen.queries.board,
    sessionToken ? { sessionToken, prepArea: options.prepArea, includeCompletedLast: options.includeCompletedLast } : "skip",
  )
}

/** Active tickets only (queued, preparing, ready) — for counters such as the POS «Экран кухни» button. */
export function useKitchenBoard(sessionToken: string | null) {
  return useKitchenBoardQuery(sessionToken) ?? []
}

export function useKitchenMutations() {
  return { setStatus: useMutation(api.domains.kitchen.mutations.setStatus) }
}
