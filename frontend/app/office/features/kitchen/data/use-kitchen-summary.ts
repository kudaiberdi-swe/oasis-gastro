import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

export type KitchenSummaryRow = FunctionReturnType<typeof api.domains.kitchen.queries.officeSummary>[number]

/** Restaurants in scope with their kitchen terminal and active tickets (`office.kitchen-board.view`). */
export function useKitchenSummary() {
  return useQuery(api.domains.kitchen.queries.officeSummary, {})
}
