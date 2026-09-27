import { useMutation, useQuery } from "convex/react"

import { api } from "@convex/_generated/api"
import type { Id } from "@convex/_generated/dataModel"

export function useOfficeCatalog() {
  const data = useQuery(api.domains.catalog.queries.listAllForOffice)
  return {
    categories: data?.categories ?? [],
    products: data?.products ?? [],
    restaurants: data?.restaurants ?? [],
    loading: data === undefined,
  }
}

export function useOfficeCatalogMutations() {
  const createCategory = useMutation(api.domains.catalog.mutations.createCategory)
  const updateCategory = useMutation(api.domains.catalog.mutations.updateCategory)
  const createProduct = useMutation(api.domains.catalog.mutations.createProduct)
  const updateProduct = useMutation(api.domains.catalog.mutations.updateProduct)
  const setProductPrice = useMutation(api.domains.catalog.mutations.setProductPrice)
  return { createCategory, updateCategory, createProduct, updateProduct, setProductPrice }
}

export type OfficeCategory = ReturnType<typeof useOfficeCatalog>["categories"][number]
export type OfficeProduct = ReturnType<typeof useOfficeCatalog>["products"][number]
export type OfficeRestaurant = ReturnType<typeof useOfficeCatalog>["restaurants"][number]
export type ProductId = Id<"products">
export type CategoryId = Id<"categories">
