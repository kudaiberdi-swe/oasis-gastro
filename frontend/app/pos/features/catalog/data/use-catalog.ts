import { useCallback, useEffect, useState } from "react"
import { useMutation, usePaginatedQuery, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"
import { parseRecent, pushRecent, recentEntry, type CatalogProduct } from "@/pos/features/catalog/model/catalog-view"

const PAGE = 30

export function useCategories(sessionToken: string) {
  return useQuery(api.domains.catalog.queries.listCategories, { sessionToken }) ?? []
}

export function useProducts(args: { sessionToken: string; category?: string; search?: string; enabled?: boolean; pageSize?: number }) {
  const pageSize = args.pageSize ?? PAGE
  const query = usePaginatedQuery(
    api.domains.catalog.queries.listProducts,
    args.enabled === false ? "skip" : { sessionToken: args.sessionToken, category: args.category, search: args.search || undefined },
    { initialNumItems: pageSize },
  )
  return {
    items: query.results,
    loading: query.status === "LoadingFirstPage",
    loadingMore: query.status === "LoadingMore",
    canLoadMore: query.status === "CanLoadMore",
    loadMore: () => query.loadMore(pageSize),
  }
}

/** The cashier's favorites (W1-CAT-13): ids for the ☆ state and the priced list for the ☆ view. */
export function useFavoriteIds(sessionToken: string) {
  return useQuery(api.domains.catalog.pos.favoriteIds, { sessionToken })
}

export function useFavoriteProducts(sessionToken: string, enabled: boolean) {
  const query = usePaginatedQuery(api.domains.catalog.pos.favoriteProducts, enabled ? { sessionToken } : "skip", { initialNumItems: PAGE })
  return {
    items: query.results,
    loading: query.status === "LoadingFirstPage",
    canLoadMore: query.status === "CanLoadMore",
    loadMore: () => query.loadMore(PAGE),
  }
}

export function useToggleFavorite() {
  return useMutation(api.domains.catalog.pos.toggleFavorite)
}

/** Sizes and modifier groups of one dish, priced for the session's restaurant (W1-CAT-12). */
export function useProductConfiguration(sessionToken: string, productExternalId: string | null) {
  return useQuery(api.domains.catalog.pos.getProductConfiguration, productExternalId ? { sessionToken, productExternalId } : "skip")
}

function readStorage(key: string | undefined) {
  if (!key) return []
  try {
    return parseRecent(window.localStorage.getItem(key))
  } catch {
    return []
  }
}

/**
 * «Последние» (🕘): dishes this cashier added on this terminal, newest first. There is no server
 * list for it yet, so it lives in this browser only (per employee); prices are re-set by saveDraft.
 */
export function useRecentProducts(storageKey?: string) {
  const [items, setItems] = useState<CatalogProduct[]>(() => readStorage(storageKey))
  useEffect(() => setItems(readStorage(storageKey)), [storageKey])
  const remember = useCallback(
    (product: CatalogProduct) =>
      setItems((current) => {
        const next = pushRecent(current, recentEntry(product))
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next))
          } catch {
            // Storage blocked or full: the list still works for this session.
          }
        }
        return next
      }),
    [storageKey],
  )
  return { items, remember }
}
