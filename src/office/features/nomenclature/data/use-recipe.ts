import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { useEffect, useMemo, useState } from "react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

// «Технологическая карта» (W1-RCP-02) over convex/domains/recipes (W1-RCP-01). Ingredients come from the
// stock master (складские позиции) and the nomenclature register (заготовки, itemType "preparation").

const recipes = api.domains.recipes

export type RecipeVersionId = Id<"recipeVersions">
export type RecipeResult = NonNullable<FunctionReturnType<typeof recipes.queries.getRecipe>>
/** getRecipe with a version: lines, summary and checks. */
export type LoadedRecipe = Extract<RecipeResult, { lines: unknown }>
export type RecipeServerLine = LoadedRecipe["lines"][number]
export type RecipeVersionRow = FunctionReturnType<typeof recipes.queries.listRecipeVersions>[number]
export type RecipeVersionStatus = RecipeVersionRow["status"]
export type SaveRecipeDraftArgs = FunctionArgs<typeof recipes.mutations.saveRecipeDraft>
export type RecipeLineInput = SaveRecipeDraftArgs["lines"][number]
export type RecipeUnit = RecipeLineInput["unit"]
export type RecipeLineKind = RecipeLineInput["kind"]

export const RECIPE_UNITS: readonly RecipeUnit[] = ["кг", "л", "шт"]

export function useRecipeVersions(productExternalId: string, enabled: boolean) {
  return useQuery(recipes.queries.listRecipeVersions, enabled ? { productExternalId } : "skip")
}

/** undefined while loading or skipped; `version: null` when the product has no recipe card yet. */
export function useRecipe(productExternalId: string, versionId: RecipeVersionId | undefined, restaurantExternalId: string | undefined, enabled: boolean) {
  return useQuery(recipes.queries.getRecipe, enabled ? { productExternalId, versionId, restaurantExternalId } : "skip")
}

export function useRecipeMutations() {
  const saveRecipeDraft = useMutation(recipes.mutations.saveRecipeDraft)
  const activateRecipeVersion = useMutation(recipes.mutations.activateRecipeVersion)
  return { saveRecipeDraft, activateRecipeVersion }
}

/** One choice of the «Наименование продукта» Combobox: a stock item or a preparation. */
export interface IngredientOption {
  /** `item:<id>` / `preparation:<id>` — the Combobox value. */
  value: string
  label: string
  hint?: string
  kind: RecipeLineKind
  refId: string
  refExternalId: string
  unit: RecipeUnit
}

export const optionValue = (kind: RecipeLineKind, refId: string) => `${kind}:${refId}`

/** Stock units that are not a recipe unit («порц.») are counted in pieces. */
export function recipeUnitOf(unit: string): RecipeUnit {
  return (RECIPE_UNITS as readonly string[]).includes(unit) ? (unit as RecipeUnit) : "шт"
}

const ITEM_PAGE = 30
const PREPARATION_PAGE = 200
const INDEX_PAGE = 200

/**
 * Options for the ingredient picker (server search over stock items, all preparations) and the
 * id → externalId index: getRecipe returns document ids, saveRecipeDraft takes external ids.
 */
export function useIngredientCatalog(productExternalId: string, enabled: boolean) {
  const [search, setSearch] = useState("")
  const items = usePaginatedQuery(api.domains.stock.master.listInventoryItems, enabled ? { search: search.trim() || undefined, activeOnly: true } : "skip", { initialNumItems: ITEM_PAGE })
  const preparations = usePaginatedQuery(api.domains.catalog.office.listNomenclature, enabled ? { itemType: "preparation", status: "all", sort: "name" } : "skip", {
    initialNumItems: PREPARATION_PAGE,
  })
  // Every stock item (active or not) so lines of old versions still resolve; bounded by the stock master.
  const index = usePaginatedQuery(api.domains.stock.master.listInventoryItems, enabled ? {} : "skip", { initialNumItems: INDEX_PAGE })
  const { status: indexStatus, loadMore: loadMoreIndex } = index
  useEffect(() => {
    if (indexStatus === "CanLoadMore") loadMoreIndex(INDEX_PAGE)
  }, [indexStatus, loadMoreIndex])

  const options = useMemo<IngredientOption[]>(() => {
    const preparationOptions = preparations.results
      .filter((row) => row.externalId !== productExternalId)
      .map((row) => ({ value: optionValue("preparation", row._id), label: row.name, hint: "Заготовка", kind: "preparation" as const, refId: row._id, refExternalId: row.externalId, unit: "кг" as const }))
    const itemOptions = items.results.map((item) => ({
      value: optionValue("item", item._id),
      label: item.name,
      hint: item.unit,
      kind: "item" as const,
      refId: item._id,
      refExternalId: item.externalId,
      unit: recipeUnitOf(item.unit),
    }))
    return [...itemOptions, ...preparationOptions]
  }, [items.results, preparations.results, productExternalId])

  const externalIds = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of index.results) map.set(optionValue("item", item._id), item.externalId)
    for (const item of items.results) map.set(optionValue("item", item._id), item.externalId)
    for (const row of preparations.results) map.set(optionValue("preparation", row._id), row.externalId)
    return map
  }, [index.results, items.results, preparations.results])

  const indexReady = index.status === "Exhausted" && preparations.status !== "LoadingFirstPage"
  return { options, externalIds, indexReady, search, setSearch, loading: items.status === "LoadingFirstPage" }
}
