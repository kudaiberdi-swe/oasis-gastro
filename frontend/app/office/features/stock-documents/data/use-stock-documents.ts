import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useState } from "react"

import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { api } from "@convex/_generated/api"
import type { DocumentStatus, StockDocumentType } from "../model/document-types"

// Stock documents (W1-STK-09) over convex/domains/stockDocuments. The server checks the module
// rights (office.<section>.view|edit|post|reverse), restaurant and warehouse scopes and the period.

export const DOCUMENTS_PAGE_SIZE = 50

const queries = api.domains.stockDocuments.queries
const mutations = api.domains.stockDocuments.mutations

export type StockDocumentRow = FunctionReturnType<typeof queries.listDocuments>["page"][number]
export type StockDocument = NonNullable<FunctionReturnType<typeof queries.getDocument>>
export type SaveDocumentArgs = FunctionArgs<typeof mutations.saveDocument>

export const ALL_RESTAURANTS = "__all__"

/**
 * Registers are per restaurant: a network user may pick «Все рестораны»; anyone else works in one of
 * their restaurants (the server asks for one when the user has several).
 */
export function useRestaurantFilter() {
  const scope = usePlatformScope()
  const [picked, setPicked] = useState<string | null>(null)
  const fallback = scope.network ? ALL_RESTAURANTS : (scope.restaurants[0]?.externalId ?? ALL_RESTAURANTS)
  const value = picked ?? fallback
  const options = [...(scope.network ? [{ value: ALL_RESTAURANTS, label: "Все рестораны" }] : []), ...restaurantSelectOptions(scope.restaurants)]
  return {
    loading: scope.loading,
    value,
    setValue: setPicked,
    options,
    /** Only when there is a choice to make. */
    visible: options.length > 1,
    restaurantExternalId: value === ALL_RESTAURANTS ? undefined : value,
    restaurants: scope.restaurants,
    restaurantName: scope.restaurantName,
  }
}

export function useStockDocuments(args: { type: StockDocumentType; status?: DocumentStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    queries.listDocuments,
    args.enabled ? { type: args.type, status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: DOCUMENTS_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or of another type. */
export function useStockDocument(type: StockDocumentType, externalId: string) {
  return useQuery(queries.getDocument, { type, externalId })
}

export function useStockDocumentMutations() {
  const createDocument = useMutation(mutations.createDocument)
  const saveDocument = useMutation(mutations.saveDocument)
  const postDocument = useMutation(mutations.postDocument)
  const reverseDocument = useMutation(mutations.reverseDocument)
  return { createDocument, saveDocument, postDocument, reverseDocument }
}

/** «Покупатель / получатель» of an outgoing invoice: active FIN counterparties (office.counterparties.view). */
export function useCounterpartyOptions(enabled: boolean) {
  return useQuery(api.domains.finance.records.references, enabled ? { moduleId: "counterparties" } : "skip")?.counterparties
}

/** «На основании прихода» of a supplier return: posted receipts of the restaurant (office.receipts.view). */
export function usePostedReceipts(restaurantExternalId: string, enabled: boolean) {
  return useQuery(api.domains.purchasing.receipts.listReceipts, enabled ? { status: "posted", restaurantExternalId, paginationOpts: { numItems: 200, cursor: null } } : "skip")?.page
}

/** Warehouses with Convex ids (office.warehouses.view): a receipt keeps its warehouse id. */
export function useWarehouseIds(enabled: boolean) {
  return useQuery(api.domains.stock.master.listWarehouses, enabled ? {} : "skip")
}
