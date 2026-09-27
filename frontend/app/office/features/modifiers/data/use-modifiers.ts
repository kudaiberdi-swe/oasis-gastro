import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

// «Модификаторы» / конструктор блюд (W1-CAT-08) over convex/domains/modifiers; the server checks every
// right and every limit again.

export const MODIFIERS_PAGE_SIZE = 50
/** A group's modifiers in the dish designer: the server keeps at most 50 rules per group. */
export const GROUP_MODIFIERS_SIZE = 100

const queries = api.domains.modifiers.queries
const mutations = api.domains.modifiers.mutations

export type ModifierGroup = FunctionReturnType<typeof queries.listGroups>[number]
export type ModifierRow = FunctionReturnType<typeof queries.list>["page"][number]
export type ProductRules = NonNullable<FunctionReturnType<typeof queries.getProductRules>>
export type GroupAssignment = ProductRules[number]
export type SaveModifierArgs = FunctionArgs<typeof mutations.save>
export type SaveProductRulesArgs = FunctionArgs<typeof mutations.saveProductRules>
export type ModifierUnit = SaveModifierArgs["unit"]
export type ModifierSort = "name" | "price"

export const MODIFIER_UNITS: readonly ModifierUnit[] = ["порц.", "шт", "кг", "л"]

export function useModifierGroups() {
  return useQuery(queries.listGroups, {})
}

export function useModifiers(args: { groupExternalId?: string; search?: string; sort?: ModifierSort }, pageSize = MODIFIERS_PAGE_SIZE) {
  return usePaginatedQuery(queries.list, { groupExternalId: args.groupExternalId, search: args.search?.trim() || undefined, sort: args.sort }, { initialNumItems: pageSize })
}

/** undefined while loading, null for an unknown product. */
export function useProductRules(productExternalId: string | undefined) {
  return useQuery(queries.getProductRules, productExternalId ? { productExternalId } : "skip")
}

export function useModifierMutations() {
  const saveGroup = useMutation(mutations.saveGroup)
  const save = useMutation(mutations.save)
  const assignGroup = useMutation(mutations.assignGroup)
  const unassignGroup = useMutation(mutations.unassignGroup)
  const saveProductRules = useMutation(mutations.saveProductRules)
  return { saveGroup, save, assignGroup, unassignGroup, saveProductRules }
}

/** Ingredients for the modifier editor: active stock items (office.stock.view), first 200 by name. */
export function useIngredientOptions(enabled: boolean) {
  const inventory = useQuery(api.domains.stock.master.listInventoryItems, enabled ? { activeOnly: true, paginationOpts: { numItems: 200, cursor: null } } : "skip")
  return (inventory?.page ?? []).map((item) => ({ value: item.externalId, label: item.name, hint: item.unit, unit: item.unit }))
}
