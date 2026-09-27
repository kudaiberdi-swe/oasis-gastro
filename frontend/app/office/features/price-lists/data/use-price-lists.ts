import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { useDebounced } from "@/office/features/stock/data/use-stock-master"

import { api } from "@convex/_generated/api"

// «Прайс-листы» (W2-CAT-15) over convex/domains/stock/priceLists. A published version is never edited:
// saving it opens the next draft of the series, publishing that one expires the previous version.

export const PRICE_LISTS_PAGE_SIZE = 50

const priceLists = api.domains.stock.priceLists

export type PriceListRow = FunctionReturnType<typeof priceLists.listPriceLists>["page"][number]
export type PriceList = NonNullable<FunctionReturnType<typeof priceLists.getPriceList>>
export type PriceListLine = PriceList["lines"][number]
export type PriceListKind = PriceListRow["kind"]
export type PriceListStatus = PriceListRow["status"]
export type DeviationPolicy = PriceListRow["deviationPolicy"]
export type SavePriceListArgs = FunctionArgs<typeof priceLists.savePriceList>

export function usePriceLists(args: { kind?: PriceListKind; status?: PriceListStatus; search: string }) {
  const search = useDebounced(args.search)
  return usePaginatedQuery(priceLists.listPriceLists, { kind: args.kind, status: args.status, search: search.trim() || undefined }, { initialNumItems: PRICE_LISTS_PAGE_SIZE })
}

/** undefined while loading, null when missing. */
export function usePriceList(externalId: string | null) {
  return useQuery(priceLists.getPriceList, externalId ? { externalId } : "skip")
}

export function usePriceListMutations() {
  return { savePriceList: useMutation(priceLists.savePriceList), publishPriceList: useMutation(priceLists.publishPriceList) }
}

/** Active units for «Ед.»; skipped without office.units.view (the stock unit of the item is used). */
export function useUnitOptions(enabled: boolean) {
  return useQuery(api.domains.stock.master.listUnits, enabled ? { activeOnly: true } : "skip")
}
