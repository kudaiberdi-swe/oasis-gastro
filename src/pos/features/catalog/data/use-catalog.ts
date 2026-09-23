import { usePaginatedQuery, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"

export function useCategories() {
  return useQuery(api.domains.catalog.queries.listCategories) ?? []
}

export function useProducts(args: { restaurantExternalId: string; category?: string; search?: string }) {
  const query = usePaginatedQuery(
    api.domains.catalog.queries.listProducts,
    { restaurantExternalId: args.restaurantExternalId, category: args.category, search: args.search || undefined },
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
