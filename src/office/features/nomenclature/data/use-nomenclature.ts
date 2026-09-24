import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

// «Номенклатура» (W1-CAT-04/05): the register and the product card over convex/domains/catalog/office;
// branch prices and product creation use the catalog mutations. The server checks every right again.

export const NOMENCLATURE_PAGE_SIZE = 25

const office = api.domains.catalog.office
const catalog = api.domains.catalog.mutations

export type NomenclatureRow = FunctionReturnType<typeof office.listNomenclature>["page"][number]
export type ProductCard = NonNullable<FunctionReturnType<typeof office.getProductCard>>
export type BranchPrice = ProductCard["branchPrices"][number]
export type SaveProductCardArgs = FunctionArgs<typeof office.saveProductCard>
export type CreateProductArgs = FunctionArgs<typeof catalog.createProduct>
export type ItemType = NomenclatureRow["itemType"]
export type ProductUnit = SaveProductCardArgs["baseUnit"]
export type WriteOffMethod = SaveProductCardArgs["writeOffMethod"]
export type ProductId = Id<"products">

/** Router state from the register to the card: the document id for branch prices. */
export type NomenclatureLocationState = { productId?: ProductId } | null

export type NomenclatureStatus = "all" | "active" | "hidden"
export type NomenclatureSort = "name" | "price" | "category"
export const ALL_GROUPS = "all"

export interface NomenclatureFilters {
  status: NomenclatureStatus
  search: string
  group: string
  sort: NomenclatureSort
}

export const DEFAULT_FILTERS: NomenclatureFilters = { status: "all", search: "", group: ALL_GROUPS, sort: "name" }

const STATUSES: readonly NomenclatureStatus[] = ["all", "active", "hidden"]
const SORTS: readonly NomenclatureSort[] = ["name", "price", "category"]

/** Filters live in the URL (?status=&q=&group=&sort=), so «← К списку» and F5 keep them. */
export function filtersFromParams(params: URLSearchParams): NomenclatureFilters {
  const status = params.get("status") as NomenclatureStatus | null
  const sort = params.get("sort") as NomenclatureSort | null
  return {
    status: status && STATUSES.includes(status) ? status : DEFAULT_FILTERS.status,
    search: params.get("q") ?? "",
    group: params.get("group") || ALL_GROUPS,
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
  }
}

export function filtersToParams(filters: NomenclatureFilters) {
  const params = new URLSearchParams()
  if (filters.status !== DEFAULT_FILTERS.status) params.set("status", filters.status)
  if (filters.search.trim()) params.set("q", filters.search)
  if (filters.group !== ALL_GROUPS) params.set("group", filters.group)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort)
  return params
}

export function useNomenclature(filters: NomenclatureFilters) {
  return usePaginatedQuery(
    office.listNomenclature,
    {
      status: filters.status,
      search: filters.search.trim() || undefined,
      categoryExternalId: filters.group === ALL_GROUPS ? undefined : filters.group,
      sort: filters.sort,
    },
    { initialNumItems: NOMENCLATURE_PAGE_SIZE },
  )
}

/** undefined while loading, null when there is no such product. */
export function useProductCard(externalId: string) {
  return useQuery(office.getProductCard, { externalId })
}

/**
 * The card query has no document id, but branch prices are saved by it. The register passes the id in
 * the router state; on a deep link it is found by searching the register for the product's name.
 */
/** The product's Convex id for branch-price edits — the card carries it. */
export function useProductId(card: ProductCard | null | undefined, fromState: ProductId | undefined): ProductId | undefined {
  return card?.productId ?? fromState
}

export function useNomenclatureMutations() {
  const saveProductCard = useMutation(office.saveProductCard)
  const attachProductImage = useMutation(office.attachProductImage)
  const setProductPrice = useMutation(catalog.setProductPrice)
  const createProduct = useMutation(catalog.createProduct)
  return { saveProductCard, attachProductImage, setProductPrice, createProduct }
}

export const ITEM_TYPE_LABELS: Record<ItemType, string> = { dish: "Блюдо", good: "Товар", preparation: "Заготовка" }

export const PREP_AREA_LABELS: Record<string, string> = { hot: "Горячий цех", cold: "Холодный цех", bar: "Бар", bakery: "Выпечка", pickup: "Выдача" }

export const WRITE_OFF_LABELS: Record<WriteOffMethod, string> = { ingredients: "По ингредиентам техкарты", "finished-product": "Готовым продуктом" }

export const UNITS: readonly ProductUnit[] = ["порц.", "шт", "кг", "л"]

/** Dish pickers (size scales, modifier rules, price orders): one large page of the register by name. */
export const PRODUCT_PICKER_SIZE = 200

export function useProductPicker(enabled = true) {
  const list = usePaginatedQuery(office.listNomenclature, enabled ? { status: "all", sort: "name" } : "skip", { initialNumItems: PRODUCT_PICKER_SIZE })
  const options = list.results.map((row) => ({ value: row.externalId, label: row.name, hint: row.sku || undefined }))
  return { loading: enabled && list.status === "LoadingFirstPage", rows: list.results, options }
}
