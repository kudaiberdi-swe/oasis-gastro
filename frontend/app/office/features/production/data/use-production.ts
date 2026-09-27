import { useMutation, usePaginatedQuery, useQueries, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { useDebounced } from "@/office/features/stock/data/use-stock-master"

import { api } from "@convex/_generated/api"
import type { RecipeForDemand, ProductionDocType, ProductionStatus } from "../model/production"

// Production and logistics documents (W2-PRD-01…06) over convex/domains/production. The server checks
// office.<section>.<action>, the restaurant and warehouse scopes and the period on every call.

export const PRODUCTION_PAGE_SIZE = 50

const documents = api.domains.production.documents
const preparations = api.domains.production.preparations
const master = api.domains.stock.master

export type ProductionDocumentRow = FunctionReturnType<typeof documents.listDocuments>["page"][number]
export type ProductionDocument = NonNullable<FunctionReturnType<typeof documents.getDocument>>
export type SaveProductionArgs = FunctionArgs<typeof documents.saveDocument>
export type PostResult = FunctionReturnType<typeof documents.postDocument>
export type Shortage = Extract<PostResult, { kind: "shortage-confirmation" }>["shortages"][number]
export type PreparationRow = FunctionReturnType<typeof preparations.listPreparations>["page"][number]
export type WarehouseDoc = FunctionReturnType<typeof master.listWarehouses>[number]

export function useProductionDocuments(args: { type: ProductionDocType; status?: ProductionStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    documents.listDocuments,
    args.enabled ? { type: args.type, status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: PRODUCTION_PAGE_SIZE },
  )
}

/** undefined while loading, null when missing or outside the scope; null id skips (a new document). */
export function useProductionDocument(externalId: string | null) {
  return useQuery(documents.getDocument, externalId ? { externalId } : "skip")
}

export function useProductionMutations() {
  const saveDocument = useMutation(documents.saveDocument)
  const transitionDocument = useMutation(documents.transitionDocument)
  const postDocument = useMutation(documents.postDocument)
  const reverseDocument = useMutation(documents.reverseDocument)
  const createReceiptFromPurchaseOrder = useMutation(documents.createReceiptFromPurchaseOrder)
  return { saveDocument, transitionDocument, postDocument, reverseDocument, createReceiptFromPurchaseOrder }
}

// ── Preparations (W2-PRD-01) ──

export function usePreparations(search: string, enabled = true) {
  return usePaginatedQuery(preparations.listPreparations, enabled ? { search: search.trim() || undefined } : "skip", { initialNumItems: PRODUCTION_PAGE_SIZE })
}

/** Every preparation (the list is short): the act's picker, the card and the control panel's «Метод списания». */
export function usePreparationOptions(enabled = true) {
  return useQuery(preparations.listPreparations, enabled ? { paginationOpts: { numItems: 500, cursor: null } } : "skip")?.page
}

export function useSavePreparation() {
  return useMutation(preparations.savePreparation)
}

/** Products that may become a preparation (office.nomenclature.view): server search. */
export function useProductSearch(search: string, enabled: boolean) {
  const debounced = useDebounced(search)
  return useQuery(api.domains.catalog.office.listNomenclature, enabled ? { search: debounced.trim() || undefined, status: "all", paginationOpts: { numItems: 30, cursor: null } } : "skip")?.page
}

// ── Reference data with Convex ids (the documents keep warehouse, supplier and item ids) ──

/** Warehouses with ids (office.warehouses.view) to name «Со склада → На склад» in the registers. */
export function useWarehouseDocs(enabled: boolean) {
  return useQuery(master.listWarehouses, enabled ? {} : "skip")
}

/** Balances of the source warehouse (office.stock.view) for «Остатки ингредиентов». */
export function useWarehouseBalances(warehouseExternalId: string, enabled: boolean) {
  const page = useQuery(master.listBalances, enabled && warehouseExternalId ? { warehouseExternalId, paginationOpts: { numItems: 500, cursor: null } } : "skip")
  return useMemo(() => (page ? new Map(page.page.map((row) => [row.item.externalId, row.quantity])) : null), [page])
}

type RecipeCard = FunctionReturnType<typeof api.domains.recipes.queries.getRecipe>

/** Recipe cards in force (office.nomenclature.view, server calculation) keyed by productExternalId. */
function useRecipeCards(productExternalIds: readonly string[], enabled: boolean) {
  const key = [...new Set(productExternalIds)].sort().join("|")
  const request = useMemo(() => {
    const queries: Parameters<typeof useQueries>[0] = {}
    if (enabled && key) for (const productExternalId of key.split("|")) queries[productExternalId] = { query: api.domains.recipes.queries.getRecipe, args: { productExternalId } }
    return queries
  }, [key, enabled])
  return useQueries(request) as Record<string, RecipeCard | Error | undefined>
}

/** Recipes of the act's preparations for the «Ингредиенты к списанию» preview (quantities only). */
export function useRecipes(productExternalIds: readonly string[], enabled: boolean): Record<string, RecipeForDemand | null | undefined> {
  const results = useRecipeCards(productExternalIds, enabled)
  return useMemo(() => {
    const recipes: Record<string, RecipeForDemand | null | undefined> = {}
    for (const [productExternalId, value] of Object.entries(results)) {
      if (value === undefined) recipes[productExternalId] = undefined
      else if (value instanceof Error || value === null || !value.version || !("lines" in value)) recipes[productExternalId] = null
      else
        recipes[productExternalId] = {
          batchYield: value.version.batchYield,
          lines: value.lines.map((line) => ({ name: line.name, unit: line.unit, quantity: line.quantity, inventoryItemExternalId: line.inventoryItemExternalId, componentProductExternalId: line.componentProductExternalId })),
        }
    }
    return recipes
  }, [results])
}

export interface PreparationCost {
  costPerPortion: number
  costPerBatch: number
}

/** «Себестоимость единицы» and «Стоимость выпуска» of preparations — the server's recipe calculation. */
export function usePreparationCosts(productExternalIds: readonly string[], enabled: boolean) {
  const results = useRecipeCards(productExternalIds, enabled)
  return useMemo(() => {
    const costs: Record<string, PreparationCost | null | undefined> = {}
    for (const [productExternalId, value] of Object.entries(results)) {
      const summary = value && !(value instanceof Error) && "summary" in value ? value.summary : undefined
      costs[productExternalId] = value === undefined ? undefined : summary ? { costPerPortion: summary.costPerPortion, costPerBatch: summary.costPerBatch } : null
    }
    return costs
  }, [results])
}

/**
 * getDocument returns the lines' external ids and unit; a line without them (an older server, a deleted item)
 * is matched back: a preparation by name among the preparations, an item by its id among the items found by
 * its name. Returns undefined while matching.
 */
export function useLineRefs(document: ProductionDocument | null | undefined, preparationRows: readonly PreparationRow[] | undefined, canViewStock: boolean) {
  const lines = document?.lines ?? []
  const itemKey = JSON.stringify(lines.filter((line) => line.inventoryItemId && !serverRef(line)).map((line) => [line.lineNo, line.name]))
  const request = useMemo(() => {
    const queries: Parameters<typeof useQueries>[0] = {}
    if (canViewStock) {
      for (const [lineNo, name] of JSON.parse(itemKey) as [number, string][]) queries[String(lineNo)] = { query: master.listInventoryItems, args: { search: name, paginationOpts: { numItems: 20, cursor: null } } }
    }
    return queries
  }, [canViewStock, itemKey])
  const found = useQueries(request) as Record<string, FunctionReturnType<typeof master.listInventoryItems> | Error | undefined>
  return useMemo(() => {
    if (!document) return undefined
    const refs = new Map<number, { ref: string; unit: string | null }>()
    for (const line of document.lines) {
      const direct = serverRef(line)
      if (direct) {
        refs.set(line.lineNo, { ref: direct, unit: serverUnit(line) })
        continue
      }
      if (line.productId) {
        if (preparationRows === undefined) return undefined
        const matches = preparationRows.filter((row) => row.name === line.name)
        refs.set(line.lineNo, matches.length === 1 ? { ref: matches[0].productExternalId, unit: matches[0].unit } : { ref: "", unit: null })
        continue
      }
      if (!canViewStock) {
        refs.set(line.lineNo, { ref: "", unit: null })
        continue
      }
      const page = found[String(line.lineNo)]
      if (page === undefined) return undefined
      const item = page instanceof Error ? undefined : page.page.find((candidate) => candidate._id === line.inventoryItemId)
      refs.set(line.lineNo, item ? { ref: item.externalId, unit: item.unit } : { ref: "", unit: null })
    }
    return refs
  }, [document, preparationRows, canViewStock, found])
}

type ServerLine = { productExternalId?: string | null; inventoryItemExternalId?: string | null; unit?: string | null }

/** The external id getDocument resolved for the line (product first, then the stock item). */
export function serverRef(line: ServerLine): string | null {
  return line.productExternalId || line.inventoryItemExternalId || null
}

/** «Ед.» of a saved line: the item's unit, else the product's base unit — as getDocument resolved it. */
export function serverUnit(line: ServerLine): string | null {
  return line.unit || null
}
