import { useMutation, usePaginatedQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { api } from "../../../../../convex/_generated/api"

// «Шкалы размеров» (W1-CAT-09) over convex/domains/sizeScales; the server checks every right again.

export const SIZE_SCALES_PAGE_SIZE = 50
/** Pickers (product card, price orders) load one big page: the network has a handful of scales. */
export const SIZE_SCALE_PICKER_SIZE = 200

const queries = api.domains.sizeScales.queries
const mutations = api.domains.sizeScales.mutations

export type SizeScale = FunctionReturnType<typeof queries.list>["page"][number]
export type SizeOption = SizeScale["options"][number]
export type SaveSizeScaleArgs = FunctionArgs<typeof mutations.save>

export function useSizeScales(search: string, pageSize = SIZE_SCALES_PAGE_SIZE, enabled = true) {
  return usePaginatedQuery(queries.list, enabled ? { search: search.trim() || undefined } : "skip", { initialNumItems: pageSize })
}

/** Scale of each product: product externalId → its scale (from the scale's own product list). */
export function useScaleByProduct(enabled = true) {
  const list = useSizeScales("", SIZE_SCALE_PICKER_SIZE, enabled)
  const byProduct = useMemo(() => {
    const map = new Map<string, SizeScale>()
    for (const scale of list.results) for (const product of scale.products) map.set(product.externalId, scale)
    return map
  }, [list.results])
  return { loading: enabled && list.status === "LoadingFirstPage", scales: list.results, byProduct }
}

export function useSizeScaleMutations() {
  const save = useMutation(mutations.save)
  const setAvailability = useMutation(mutations.setAvailability)
  const assignScale = useMutation(mutations.assignScale)
  return { save, setAvailability, assignScale }
}

/** 1.5 → "1,5" — coefficients read the Russian way. */
export function formatCoefficient(value: number) {
  return String(Math.round(value * 1000) / 1000).replace(".", ",")
}
