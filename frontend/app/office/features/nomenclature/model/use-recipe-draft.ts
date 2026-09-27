import { useCallback, useEffect, useMemo, useReducer, useState } from "react"

import { calculateRecipe, foodCostPercent, recipeChecks, type RecipeCheck, type RecipeMathLine, type RecipeSummary } from "@convex/lib/recipeMath"
import { almatyDayStart } from "@convex/lib/time"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import type { StatusTone } from "@/shared/lib/status-dictionary"

import type { ProductCard } from "../data/use-nomenclature"
import {
  optionValue,
  useIngredientCatalog,
  useRecipe,
  useRecipeMutations,
  useRecipeVersions,
  type IngredientOption,
  type LoadedRecipe,
  type RecipeLineKind,
  type RecipeResult,
  type RecipeUnit,
  type RecipeVersionId,
  type RecipeVersionRow,
  type RecipeVersionStatus,
  type SaveRecipeDraftArgs,
} from "../data/use-recipe"

// The recipe card's editable copy (W1-RCP-02). Numbers are recalculated on every keystroke with the same
// recipeMath the server uses (convex/lib/recipeMath.ts), so the office never shows other figures than
// the sale write-off will use.

/** Food cost colouring (POS-DESIGN §6.4, Б-7): success below 30 %, warning 30–35 %, destructive above 35 %. */
export const FOOD_COST_THRESHOLDS = { warningFrom: 30, dangerAbove: 35 } as const

export function foodCostTone(percent: number | null): StatusTone {
  if (percent === null) return "neutral"
  if (percent < FOOD_COST_THRESHOLDS.warningFrom) return "success"
  if (percent <= FOOD_COST_THRESHOLDS.dangerAbove) return "warning"
  return "danger"
}

export const RECIPE_STATUS: Record<RecipeVersionStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Черновик", tone: "neutral" },
  active: { label: "Активно", tone: "success" },
  superseded: { label: "Заменено", tone: "neutral" },
}

export const LINE_KIND_LABELS: Record<RecipeLineKind, string> = { item: "Товар", preparation: "Заготовка" }

export interface RecipeDraftLine {
  key: string
  kind: RecipeLineKind
  /** Convex id of the stock item or the preparation; null until one is chosen. */
  refId: string | null
  /** For saveRecipeDraft; null on loaded lines — resolved through the ingredient index on save. */
  refExternalId: string | null
  name: string
  unit: RecipeUnit
  /** Text as typed («0,35»). */
  quantity: string
  unitWeightKg: string
  coldLossPercent: string
  hotLossPercent: string
  /** ₸ per unit (average stock cost) from the server; null — known only after the draft is saved. */
  unitCost: number | null
}

export interface RecipeDraft {
  batchYield: string
  /** YYYY-MM-DD, Almaty business date. */
  effectiveFrom: string
  lines: RecipeDraftLine[]
}

export interface RecipeDraftState {
  saved: RecipeDraft
  current: RecipeDraft
  /** «Новая версия» was started and not saved yet: dirty even without edits. */
  fresh: boolean
}

export type RecipeDraftAction =
  | { type: "load"; draft: RecipeDraft }
  | { type: "set"; patch: Partial<Omit<RecipeDraft, "lines">> }
  | { type: "addLine"; line?: RecipeDraftLine }
  | { type: "updateLine"; key: string; patch: Partial<RecipeDraftLine> }
  | { type: "removeLine"; key: string }
  | { type: "startNew"; effectiveFrom: string }
  | { type: "reset" }
  | { type: "saved" }

let lineCounter = 0
const nextKey = () => `line-${++lineCounter}`

const numberText = (value: number) => String(value).replace(".", ",")

export function todayAlmaty(now = Date.now()) {
  return almatyBusinessDate(now)
}

export function emptyRecipeDraft(effectiveFrom: string): RecipeDraft {
  return { batchYield: "1", effectiveFrom, lines: [] }
}

export function emptyLine(): RecipeDraftLine {
  return { key: nextKey(), kind: "item", refId: null, refExternalId: null, name: "", unit: "кг", quantity: "", unitWeightKg: "1", coldLossPercent: "0", hotLossPercent: "0", unitCost: null }
}

export function draftFromRecipe(recipe: RecipeResult | null | undefined, today: string): RecipeDraft {
  if (!recipe || !isLoadedRecipe(recipe)) return emptyRecipeDraft(today)
  return {
    batchYield: numberText(recipe.version.batchYield),
    effectiveFrom: almatyBusinessDate(recipe.version.effectiveFrom),
    lines: recipe.lines.map((line) => {
      const kind = line.kind
      const refId = (kind === "item" ? line.inventoryItemId : line.componentProductId) ?? null
      return {
        key: nextKey(),
        kind,
        refId,
        refExternalId: null,
        name: line.name,
        unit: line.unit,
        quantity: numberText(line.quantity),
        unitWeightKg: numberText(line.unit === "кг" ? 1 : line.unitWeightKg),
        coldLossPercent: numberText(line.coldLossPercent),
        hotLossPercent: numberText(line.hotLossPercent),
        unitCost: line.unitCost,
      }
    }),
  }
}

export function isLoadedRecipe(recipe: RecipeResult): recipe is LoadedRecipe {
  return recipe.version !== null && "lines" in recipe
}

/** A picked ingredient replaces what the line pointed at; quantity and losses stay. */
export function linePatchForOption(option: IngredientOption, current: RecipeDraftLine, knownCosts: Map<string, number>): Partial<RecipeDraftLine> {
  const unitChanged = option.unit !== current.unit
  return {
    kind: option.kind,
    refId: option.refId,
    refExternalId: option.refExternalId,
    name: option.label,
    unit: option.unit,
    unitWeightKg: option.unit === "кг" || option.unit === "л" ? (unitChanged || option.unit === "кг" ? "1" : current.unitWeightKg) : unitChanged ? "" : current.unitWeightKg,
    unitCost: knownCosts.get(option.value) ?? null,
  }
}

export function recipeDraftReducer(state: RecipeDraftState, action: RecipeDraftAction): RecipeDraftState {
  const withCurrent = (current: RecipeDraft) => ({ ...state, current })
  switch (action.type) {
    case "load":
      return { saved: action.draft, current: action.draft, fresh: false }
    case "set":
      return withCurrent({ ...state.current, ...action.patch })
    case "addLine":
      return withCurrent({ ...state.current, lines: [...state.current.lines, action.line ?? emptyLine()] })
    case "updateLine":
      return withCurrent({ ...state.current, lines: state.current.lines.map((line) => (line.key === action.key ? { ...line, ...action.patch } : line)) })
    case "removeLine":
      return withCurrent({ ...state.current, lines: state.current.lines.filter((line) => line.key !== action.key) })
    case "startNew":
      return { saved: state.current, current: { ...state.current, effectiveFrom: action.effectiveFrom }, fresh: true }
    case "reset":
      return { ...state, current: state.saved, fresh: false }
    case "saved":
      return { saved: state.current, current: state.current, fresh: false }
  }
}

function withoutKeys(draft: RecipeDraft) {
  return { ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) }
}

export function isRecipeDirty(state: RecipeDraftState) {
  return state.fresh || JSON.stringify(withoutKeys(state.saved)) !== JSON.stringify(withoutKeys(state.current))
}

/** «0,35» → 0.35; empty → null; not a number → NaN. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".")
  if (!trimmed) return null
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

const numberOr = (text: string, fallback: number) => {
  const value = parseDecimal(text)
  return value === null || Number.isNaN(value) ? fallback : value
}

export function mathLine(line: RecipeDraftLine): RecipeMathLine {
  return {
    unit: line.unit,
    quantity: numberOr(line.quantity, 0),
    unitWeightKg: line.unit === "кг" ? 1 : numberOr(line.unitWeightKg, 0),
    coldLossPercent: numberOr(line.coldLossPercent, 0),
    hotLossPercent: numberOr(line.hotLossPercent, 0),
    unitCost: line.unitCost ?? 0,
  }
}

export interface RecipeComputation {
  summary: RecipeSummary
  batchYield: number
  checks: RecipeCheck[]
  price: number
  foodCost: number | null
  /** Some line has no server cost yet (a new ingredient): the cost figures are partial. */
  costsPending: boolean
}

/**
 * Live figures of the draft. `dateCheck` is the server's «начало действия» check for the saved date:
 * the first sale date is not sent to the office, so a changed date is checked on save.
 */
export function computeRecipe(draft: RecipeDraft, options: { price: number; dateCheck?: RecipeCheck | null; savedEffectiveFrom?: string }): RecipeComputation {
  const lines = draft.lines.map(mathLine)
  const batchYield = numberOr(draft.batchYield, 0)
  const summary = calculateRecipe(lines, batchYield)
  const costsPending = draft.lines.some((line) => line.unitCost === null)
  const checks = recipeChecks({ lines, summary, batchYield, effectiveFrom: draft.effectiveFrom ? almatyDayStart(draft.effectiveFrom) : 0 }).map((check): RecipeCheck => {
    if (check.code === "costs" && costsPending) return { ...check, ok: false, message: "Себестоимость новых ингредиентов появится после сохранения" }
    if (check.code === "date") {
      if (options.dateCheck && draft.effectiveFrom === options.savedEffectiveFrom) return options.dateCheck
      if (!draft.effectiveFrom) return { ...check, ok: false, message: "Укажите начало действия техкарты" }
    }
    return check
  })
  return { summary, batchYield, checks, price: options.price, foodCost: lines.length ? foodCostPercent(summary.costPerPortion, options.price) : null, costsPending }
}

export type RecipeLineField = "ref" | "quantity" | "unitWeightKg" | "coldLossPercent" | "hotLossPercent"

export interface RecipeErrors {
  batchYield?: string
  effectiveFrom?: string
  lines?: string
  byLine: Record<string, Partial<Record<RecipeLineField, string>>>
}

export const hasRecipeErrors = (errors: RecipeErrors) => Boolean(errors.batchYield || errors.effectiveFrom || errors.lines || Object.keys(errors.byLine).length)

const validPercent = (text: string) => {
  const value = parseDecimal(text)
  return value !== null && !Number.isNaN(value) && value >= 0 && value <= 99
}

/** The same rules saveRecipeDraft enforces, shown next to the fields before the round trip. */
export function validateRecipe(draft: RecipeDraft, resolve: (line: RecipeDraftLine) => string | null): RecipeErrors {
  const errors: RecipeErrors = { byLine: {} }
  const batch = parseDecimal(draft.batchYield)
  if (batch === null || Number.isNaN(batch) || batch <= 0) errors.batchYield = "Норма закладки должна быть больше нуля"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) errors.effectiveFrom = "Укажите дату начала действия"
  if (draft.lines.length === 0) errors.lines = "Добавьте хотя бы один ингредиент"
  for (const line of draft.lines) {
    const found: Partial<Record<RecipeLineField, string>> = {}
    if (!line.refId) found.ref = line.kind === "item" ? "Выберите складскую позицию" : "Выберите заготовку"
    else if (!resolve(line)) found.ref = "Позиция не найдена в справочнике — выберите её заново"
    const quantity = parseDecimal(line.quantity)
    if (quantity === null || Number.isNaN(quantity) || quantity <= 0) found.quantity = "Больше нуля"
    if (line.unit !== "кг") {
      const weight = parseDecimal(line.unitWeightKg)
      if (weight === null || Number.isNaN(weight) || weight <= 0) found.unitWeightKg = "Укажите вес единицы"
    }
    if (!validPercent(line.coldLossPercent)) found.coldLossPercent = "От 0 до 99 %"
    if (!validPercent(line.hotLossPercent)) found.hotLossPercent = "От 0 до 99 %"
    if (Object.keys(found).length) errors.byLine[line.key] = found
  }
  return errors
}

export function recipeSaveArgs(args: {
  productExternalId: string
  versionId: RecipeVersionId | undefined
  technology: string
  draft: RecipeDraft
  resolve: (line: RecipeDraftLine) => string | null
}): SaveRecipeDraftArgs {
  const { draft } = args
  return {
    productExternalId: args.productExternalId,
    versionId: args.versionId,
    batchYield: parseDecimal(draft.batchYield) ?? 0,
    effectiveFrom: almatyDayStart(draft.effectiveFrom),
    technology: args.technology,
    lines: draft.lines.map((line) => {
      const externalId = args.resolve(line) ?? undefined
      return {
        kind: line.kind,
        ...(line.kind === "item" ? { inventoryItemExternalId: externalId } : { componentProductExternalId: externalId }),
        unit: line.unit,
        quantity: parseDecimal(line.quantity) ?? 0,
        unitWeightKg: line.unit === "кг" ? 1 : (parseDecimal(line.unitWeightKg) ?? 0),
        coldLossPercent: parseDecimal(line.coldLossPercent) ?? 0,
        hotLossPercent: parseDecimal(line.hotLossPercent) ?? 0,
      }
    }),
  }
}

/** The version shown by default: the newest draft, else the active one, else the newest. */
export function defaultVersion(versions: readonly RecipeVersionRow[]): RecipeVersionRow | undefined {
  const byNumber = [...versions].sort((a, b) => b.version - a.version)
  return byNumber.find((version) => version.status === "draft") ?? byNumber.find((version) => version.status === "active") ?? byNumber[0]
}

/** Branch for the price and the average stock cost; NETWORK = base price, cost across all branches. */
export const NETWORK = "network"

/** «new»: an unsaved version started from `baseId` (whose data stays loaded for «Отменить изменения»). */
type Selection = { kind: "auto" } | { kind: "version"; id: RecipeVersionId } | { kind: "new"; baseId: RecipeVersionId | undefined }

/**
 * Everything the «Технологическая карта» tab needs, lifted into the product card so edits survive a tab
 * switch and count for «несохранённые изменения». Queries start once the tab was opened (`enabled`).
 */
export function useRecipeDraft({ card, enabled, basePrice }: { card: ProductCard; enabled: boolean; basePrice: number | null }) {
  const productExternalId = card.externalId
  const versions = useRecipeVersions(productExternalId, enabled)
  const [selection, setSelection] = useState<Selection>({ kind: "auto" })
  const [restaurant, setRestaurant] = useState<string>(card.branchPrices[0]?.restaurantExternalId ?? NETWORK)
  const [errors, setErrors] = useState<RecipeErrors>({ byLine: {} })
  const catalog = useIngredientCatalog(productExternalId, enabled)
  const { saveRecipeDraft, activateRecipeVersion } = useRecipeMutations()

  const selectedVersion: RecipeVersionRow | undefined =
    selection.kind === "version" ? versions?.find((version) => version._id === selection.id) : selection.kind === "auto" && versions ? defaultVersion(versions) : undefined
  const versionId = selection.kind === "version" ? selection.id : selection.kind === "new" ? selection.baseId : selectedVersion?._id
  const restaurantExternalId = restaurant === NETWORK ? undefined : restaurant
  // No versions yet: nothing to fetch, the card starts empty.
  const recipe = useRecipe(productExternalId, versionId, restaurantExternalId, enabled && versionId !== undefined)
  const source: RecipeResult | null | undefined = !enabled || versions === undefined ? undefined : versionId === undefined ? null : recipe

  const [state, dispatch] = useReducer(recipeDraftReducer, undefined, (): RecipeDraftState => {
    const draft = emptyRecipeDraft(todayAlmaty())
    return { saved: draft, current: draft, fresh: false }
  })
  const dirty = isRecipeDirty(state)
  const [loaded, setLoaded] = useState(false)

  // Fresh server data (a save, an activation, another tab, a branch switch) replaces the draft only
  // while there are no unsaved edits.
  useEffect(() => {
    if (source === undefined) return
    setLoaded(true)
    if (!dirty && selection.kind !== "new") dispatch({ type: "load", draft: draftFromRecipe(source, todayAlmaty()) })
    // Only new server data reloads the draft, not a change of `dirty`.
  }, [source])

  const knownCosts = useMemo(() => {
    const map = new Map<string, number>()
    if (source && isLoadedRecipe(source)) {
      for (const line of source.lines) {
        const refId = line.kind === "item" ? line.inventoryItemId : line.componentProductId
        if (refId && line.unitCost > 0) map.set(optionValue(line.kind, refId), line.unitCost)
      }
    }
    return map
  }, [source])

  const resolve = useCallback(
    (line: RecipeDraftLine) => line.refExternalId ?? (line.refId ? (catalog.externalIds.get(optionValue(line.kind, line.refId)) ?? null) : null),
    [catalog.externalIds],
  )

  const price = restaurantExternalId ? (card.branchPrices.find((row) => row.restaurantExternalId === restaurantExternalId)?.resolvedPriceNow.price ?? basePrice ?? 0) : (basePrice ?? 0)
  const serverRecipe = source && isLoadedRecipe(source) && selection.kind !== "new" ? source : null
  const computed = useMemo(
    () =>
      computeRecipe(state.current, {
        price,
        dateCheck: serverRecipe?.checks.find((check) => check.code === "date") ?? null,
        savedEffectiveFrom: serverRecipe ? almatyBusinessDate(serverRecipe.version.effectiveFrom) : undefined,
      }),
    [state.current, price, serverRecipe],
  )

  const status: RecipeVersionStatus | "new" | null = selection.kind === "new" ? "new" : (selectedVersion?.status ?? (serverRecipe ? serverRecipe.version.status : null))
  /** Saving edits of an active or replaced version creates a new draft version; a draft is saved in place. */
  const savesAsNewVersion = status !== "draft"

  function validate() {
    const found = validateRecipe(state.current, resolve)
    setErrors(found)
    return !hasRecipeErrors(found)
  }

  async function save(technology: string) {
    const id = await saveRecipeDraft(
      recipeSaveArgs({ productExternalId, versionId: savesAsNewVersion ? undefined : versionId, technology, draft: state.current, resolve }),
    )
    dispatch({ type: "saved" })
    setErrors({ byLine: {} })
    setSelection({ kind: "version", id })
    return id
  }

  async function activate() {
    if (!versionId || status !== "draft" || dirty) return null
    const result = await activateRecipeVersion({ versionId })
    return { version: selectedVersion?.version ?? null, warning: result.warning }
  }

  return {
    loaded,
    versions,
    selectedVersion: selection.kind === "new" ? undefined : selectedVersion,
    status,
    savesAsNewVersion,
    draft: state.current,
    dirty,
    computed,
    errors,
    catalog,
    knownCosts,
    restaurant,
    setRestaurant,
    /** A draft without edits can be activated from the card header. */
    canActivate: status === "draft" && !dirty && versionId !== undefined,
    set: useCallback((patch: Partial<Omit<RecipeDraft, "lines">>) => dispatch({ type: "set", patch }), []),
    addLine: useCallback(() => dispatch({ type: "addLine" }), []),
    updateLine: useCallback((key: string, patch: Partial<RecipeDraftLine>) => dispatch({ type: "updateLine", key, patch }), []),
    removeLine: useCallback((key: string) => dispatch({ type: "removeLine", key }), []),
    selectVersion: useCallback((id: RecipeVersionId) => setSelection({ kind: "version", id }), []),
    startNewVersion: useCallback(() => {
      setSelection({ kind: "new", baseId: versionId })
      dispatch({ type: "startNew", effectiveFrom: todayAlmaty() })
    }, [versionId]),
    reset: useCallback(() => {
      setErrors({ byLine: {} })
      if (selection.kind === "new") {
        setSelection(selection.baseId ? { kind: "version", id: selection.baseId } : { kind: "auto" })
        dispatch({ type: "load", draft: draftFromRecipe(source, todayAlmaty()) })
      } else dispatch({ type: "reset" })
    }, [selection, source]),
    validate,
    save,
    activate,
  }
}

export type RecipeDraftController = ReturnType<typeof useRecipeDraft>
