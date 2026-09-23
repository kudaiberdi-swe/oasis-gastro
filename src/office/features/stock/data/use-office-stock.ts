import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

export function useOfficeStock() {
  const data = useQuery(api.domains.stock.queries.listInventoryForOffice)
  return {
    items: data?.items ?? [],
    restaurants: data?.restaurants ?? [],
    loading: data === undefined,
  }
}

export function useRecentMovements(limit = 100) {
  const movements = useQuery(api.domains.stock.queries.listRecentMovements, { limit })
  return { movements: movements ?? [], loading: movements === undefined }
}

export function useOfficeStockMutations() {
  const createInventoryItem = useMutation(api.domains.stock.mutations.createInventoryItem)
  const receiveStock = useMutation(api.domains.stock.mutations.receiveStock)
  const writeOffStock = useMutation(api.domains.stock.mutations.writeOffStock)
  const adjustStock = useMutation(api.domains.stock.mutations.adjustStock)
  return { createInventoryItem, receiveStock, writeOffStock, adjustStock }
}

export type OfficeInventoryItem = ReturnType<typeof useOfficeStock>["items"][number]
export type OfficeStockRestaurant = ReturnType<typeof useOfficeStock>["restaurants"][number]
export type InventoryItemId = Id<"inventoryItems">
