import { useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export type TerminalOption = NonNullable<ReturnType<typeof useTerminalOptions>>[number]

/** Active branches with their active terminals — readable before sign-in. */
export function useTerminalOptions(purpose: "pos" | "kitchen" = "pos") {
  return useQuery(api.domains.auth.queries.posTerminalOptions, purpose === "pos" ? {} : { purpose })
}
