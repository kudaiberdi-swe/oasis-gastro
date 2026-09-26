import { useCallback, useEffect, useReducer } from "react"

import type { ItemType, ProductCard, ProductUnit, SaveProductCardArgs, WriteOffMethod } from "../data/use-nomenclature"

// The product card's editable copy (W1-CAT-05): a reducer over { saved, current }, dirty when they differ.

export interface ProductDraft {
  name: string
  nameKk: string
  description: string
  categoryExternalId: string
  itemType: ItemType
  prepArea: string
  writeOffMethod: WriteOffMethod
  sku: string
  /** For the POS scanner (W3-POS-01); "" — none. */
  barcode: string
  basePrice: number | null
  baseUnit: ProductUnit
  /** Text as typed («0,25»), parsed on save. */
  unitWeightKg: string
  technology: string
  enabled: boolean
  /** Own price per branch; null = none (the base price applies). */
  branchPrices: Record<string, number | null>
}

export interface DraftState {
  saved: ProductDraft
  current: ProductDraft
}

export type DraftAction =
  | { type: "set"; patch: Partial<ProductDraft> }
  | { type: "setBranchPrice"; restaurantExternalId: string; price: number | null }
  /** Back to the last saved values («Отменить изменения»). */
  | { type: "reset" }
  /** New server values: both copies replaced. */
  | { type: "load"; draft: ProductDraft }
  /** The current values were saved. */
  | { type: "saved" }

export function draftFromCard(card: ProductCard): ProductDraft {
  return {
    name: card.name,
    nameKk: card.nameKk,
    description: card.description,
    categoryExternalId: card.categoryExternalId,
    itemType: card.itemType,
    prepArea: card.prepArea,
    writeOffMethod: card.writeOffMethod,
    sku: card.sku,
    barcode: card.barcode ?? "",
    basePrice: card.basePrice,
    baseUnit: card.baseUnit,
    unitWeightKg: card.unitWeightKg === null ? "" : String(card.unitWeightKg).replace(".", ","),
    technology: card.technology,
    enabled: card.enabled,
    branchPrices: Object.fromEntries(card.branchPrices.map((row) => [row.restaurantExternalId, row.priceKzt])),
  }
}

function sameBranchPrices(a: ProductDraft["branchPrices"], b: ProductDraft["branchPrices"]) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if ((a[key] ?? null) !== (b[key] ?? null)) return false
  return true
}

/** The card's own fields changed (saved with saveProductCard). */
export function areFieldsDirty(state: DraftState) {
  const { saved, current } = state
  const keys = (Object.keys(current) as (keyof ProductDraft)[]).filter((key) => key !== "branchPrices")
  return keys.some((key) => saved[key] !== current[key])
}

export function isDraftDirty(state: DraftState) {
  return areFieldsDirty(state) || !sameBranchPrices(state.saved.branchPrices, state.current.branchPrices)
}

/** Branches whose own price was set or changed (a cleared price is not sent: there is no delete). */
export function changedBranchPrices(state: DraftState) {
  return Object.entries(state.current.branchPrices)
    .filter(([key, price]) => price !== null && price !== (state.saved.branchPrices[key] ?? null))
    .map(([restaurantExternalId, priceKzt]) => ({ restaurantExternalId, priceKzt: priceKzt! }))
}

export function productDraftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "set":
      return { ...state, current: { ...state.current, ...action.patch } }
    case "setBranchPrice":
      return { ...state, current: { ...state.current, branchPrices: { ...state.current.branchPrices, [action.restaurantExternalId]: action.price } } }
    case "reset":
      return { ...state, current: state.saved }
    case "load":
      return { saved: action.draft, current: action.draft }
    case "saved":
      return { ...state, saved: state.current }
  }
}

/** «0,25» → 0.25; empty → undefined; not a number → NaN (the form shows the error). */
export function parseWeight(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".")
  if (!trimmed) return undefined
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

export type DraftErrors = Partial<Record<"name" | "basePrice" | "unitWeightKg" | "categoryExternalId", string>>

export function validateDraft(draft: ProductDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (draft.basePrice === null) errors.basePrice = "Укажите базовую цену"
  else if (draft.basePrice > 100_000_000) errors.basePrice = "Цена — не больше 100 000 000 ₸"
  if (!draft.categoryExternalId) errors.categoryExternalId = "Выберите группу"
  const weight = parseWeight(draft.unitWeightKg)
  if (weight !== undefined && (Number.isNaN(weight) || weight <= 0)) errors.unitWeightKg = "Вес одной единицы — число больше нуля, например 0,25"
  return errors
}

export function saveArgs(externalId: string, draft: ProductDraft): SaveProductCardArgs {
  const weight = parseWeight(draft.unitWeightKg)
  return {
    externalId,
    name: draft.name.trim(),
    nameKk: draft.nameKk.trim(),
    description: draft.description,
    categoryExternalId: draft.categoryExternalId,
    itemType: draft.itemType,
    prepArea: draft.prepArea,
    writeOffMethod: draft.writeOffMethod,
    sku: draft.sku.trim(),
    barcode: draft.barcode.replace(/\s+/g, ""),
    basePrice: draft.basePrice ?? 0,
    baseUnit: draft.baseUnit,
    unitWeightKg: weight === undefined || Number.isNaN(weight) ? undefined : weight,
    technology: draft.technology,
    enabled: draft.enabled,
  }
}

/**
 * Draft of the loaded card. Fresh server data (another tab, a save) replaces the draft only while
 * there are no unsaved edits, so a live update never wipes what the user is typing.
 */
export function useProductDraft(card: ProductCard | null | undefined) {
  const [state, dispatch] = useReducer(productDraftReducer, card, (initial): DraftState => {
    const draft = initial ? draftFromCard(initial) : EMPTY_DRAFT
    return { saved: draft, current: draft }
  })
  const dirty = isDraftDirty(state)

  useEffect(() => {
    if (card && !dirty) dispatch({ type: "load", draft: draftFromCard(card) })
    // Only a new card reloads the draft, not a change of `dirty`.
  }, [card])

  return {
    draft: state.current,
    state,
    dirty,
    set: useCallback((patch: Partial<ProductDraft>) => dispatch({ type: "set", patch }), []),
    setBranchPrice: useCallback((restaurantExternalId: string, price: number | null) => dispatch({ type: "setBranchPrice", restaurantExternalId, price }), []),
    reset: useCallback(() => dispatch({ type: "reset" }), []),
    markSaved: useCallback(() => dispatch({ type: "saved" }), []),
  }
}

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  nameKk: "",
  description: "",
  categoryExternalId: "",
  itemType: "dish",
  prepArea: "hot",
  writeOffMethod: "ingredients",
  sku: "",
  barcode: "",
  basePrice: 0,
  baseUnit: "порц.",
  unitWeightKg: "",
  technology: "",
  enabled: true,
  branchPrices: {},
}
