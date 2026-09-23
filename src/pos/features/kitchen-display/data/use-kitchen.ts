import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export function useKitchenBoard(sessionToken: string | null) {
  return useQuery(api.domains.kitchen.queries.board, sessionToken ? { sessionToken } : "skip") ?? []
}

export function useKitchenMutations() {
  return { setStatus: useMutation(api.domains.kitchen.mutations.setStatus) }
}
