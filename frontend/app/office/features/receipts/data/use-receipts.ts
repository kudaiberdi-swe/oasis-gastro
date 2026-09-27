import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

// «Приходные накладные» (W1-STK-11) over convex/domains/purchasing/receipts. Saving only works on a
// draft (B-E1), posting checks prices against the supplier policy and returns the warnings.

export const RECEIPTS_PAGE_SIZE = 50

const receipts = api.domains.purchasing.receipts

export type ReceiptRow = FunctionReturnType<typeof receipts.listReceipts>["page"][number]
export type Receipt = FunctionReturnType<typeof receipts.getReceipt>
export type ReceiptLine = Receipt["lines"][number]
export type PriceCheck = Receipt["priceChecks"][number]
export type ReceiptStatus = ReceiptRow["status"]
export type SaveReceiptArgs = FunctionArgs<typeof receipts.saveReceipt>

export function useReceipts(args: { status?: ReceiptStatus; search: string; restaurantExternalId?: string; enabled: boolean }) {
  return usePaginatedQuery(
    receipts.listReceipts,
    args.enabled ? { status: args.status, search: args.search.trim() || undefined, restaurantExternalId: args.restaurantExternalId } : "skip",
    { initialNumItems: RECEIPTS_PAGE_SIZE },
  )
}

/** getReceipt throws «не найдена» for a missing receipt; the workspace boundary shows it. */
export function useReceipt(externalId: string) {
  return useQuery(receipts.getReceipt, { externalId })
}

export function useReceiptMutations() {
  const createReceiptDraft = useMutation(receipts.createReceiptDraft)
  const saveReceipt = useMutation(receipts.saveReceipt)
  const postReceipt = useMutation(receipts.postReceipt)
  const reverseReceipt = useMutation(receipts.reverseReceipt)
  return { createReceiptDraft, saveReceipt, postReceipt, reverseReceipt }
}

/** Every supplier (active or not) for names in the register; the list is small. */
export function useAllSuppliers(enabled: boolean) {
  const page = useQuery(api.domains.stock.master.listSuppliers, enabled ? { paginationOpts: { numItems: 200, cursor: null } } : "skip")
  return page?.page
}

/** Warehouses with ids (office.warehouses.view) to name the register's «Склад» column. */
export function useWarehouseDocs(enabled: boolean) {
  return useQuery(api.domains.stock.master.listWarehouses, enabled ? {} : "skip")
}
