import { usePaginatedQuery, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export function useCategories(sessionToken: string) {
  return useQuery(api.domains.catalog.queries.listCategories, { sessionToken }) ?? []
}

export function useProducts(args: { sessionToken: string; category?: string; search?: string }) {
  const query = usePaginatedQuery(
    api.domains.catalog.queries.listProducts,
    { sessionToken: args.sessionToken, category: args.category, search: args.search || undefined },
    { initialNumItems: 30 },
  )
  return {
    items: query.results,
    loading: query.status === "LoadingFirstPage",
    loadingMore: query.status === "LoadingMore",
    canLoadMore: query.status === "CanLoadMore",
    loadMore: () => query.loadMore(30),
  }
}

/** Sizes and modifier groups of one dish, priced for the session's restaurant (W1-CAT-12). */
export function useProductConfiguration(sessionToken: string, productExternalId: string | null) {
  return useQuery(api.domains.catalog.pos.getProductConfiguration, productExternalId ? { sessionToken, productExternalId } : "skip")
}
