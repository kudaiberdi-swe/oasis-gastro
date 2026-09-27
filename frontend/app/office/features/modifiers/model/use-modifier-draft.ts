import type { GroupAssignment, ModifierRow, ModifierUnit, SaveModifierArgs, SaveProductRulesArgs } from "../data/use-modifiers"

// Drafts of the modifier editor and of one group's rules for a dish (W1-CAT-08). Validation mirrors
// convex/domains/modifiers/mutations so errors show under the field before any server call.

export const MAX_QUANTITY = 99

// ——— Modifier editor ———

export interface ModifierDraft {
  name: string
  nameKk: string
  groupExternalId: string
  price: number | null
  ingredientExternalId: string
  ingredientQuantity: string
  unit: ModifierUnit
  available: boolean
}

export type ModifierErrors = Partial<Record<"name" | "groupExternalId" | "price" | "ingredientQuantity", string>>

export function modifierDraftFrom(row: ModifierRow | null, defaults: { groupExternalId?: string; ingredientExternalId?: string }): ModifierDraft {
  return {
    name: row?.name ?? "",
    nameKk: row?.nameKk ?? "",
    groupExternalId: row?.groupExternalId ?? defaults.groupExternalId ?? "",
    price: row?.price ?? null,
    ingredientExternalId: defaults.ingredientExternalId ?? "",
    ingredientQuantity: row ? String(row.ingredientQuantity).replace(".", ",") : "0",
    unit: row?.unit ?? "порц.",
    available: row?.available ?? true,
  }
}

function parseQuantity(text: string) {
  const clean = text.trim().replace(",", ".")
  return clean && /^\d*\.?\d+$/.test(clean) ? Number(clean) : null
}

export function validateModifierDraft(draft: ModifierDraft): ModifierErrors {
  const errors: ModifierErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название модификатора"
  if (!draft.groupExternalId) errors.groupExternalId = "Выберите группу"
  if (draft.price === null) errors.price = "Укажите цену (0 — бесплатно)"
  if (parseQuantity(draft.ingredientQuantity) === null) errors.ingredientQuantity = "Количество — неотрицательное число"
  return errors
}

export function saveModifierArgs(externalId: string | undefined, draft: ModifierDraft): SaveModifierArgs {
  return {
    ...(externalId ? { externalId } : {}),
    groupExternalId: draft.groupExternalId,
    name: draft.name.trim(),
    ...(draft.nameKk.trim() ? { nameKk: draft.nameKk.trim() } : {}),
    price: draft.price ?? 0,
    ...(draft.ingredientExternalId ? { ingredientInventoryItemExternalId: draft.ingredientExternalId } : {}),
    ingredientQuantity: parseQuantity(draft.ingredientQuantity) ?? 0,
    unit: draft.unit,
    available: draft.available,
  }
}

// ——— Rules of one group for a dish ———

export interface RuleRowDraft {
  modifierExternalId: string
  name: string
  price: number
  /** Only included modifiers become rules — and only they are offered at the POS. */
  included: boolean
  minQuantity: number
  defaultQuantity: number
  maxQuantity: number
  freeQuantity: number
}

export interface GroupRulesDraft {
  required: boolean
  minQuantity: number
  maxQuantity: number
  freeQuantity: number
  enforceItemLimits: boolean
  rows: RuleRowDraft[]
}

export interface GroupRulesErrors {
  group?: string
  rows: Record<string, string>
}

/** The assignment's saved rules merged with every modifier of the group (new ones start excluded). */
export function rulesDraftFrom(assignment: GroupAssignment, modifiers: readonly Pick<ModifierRow, "externalId" | "name" | "price">[]): GroupRulesDraft {
  const rules = new Map(assignment.rules.filter((rule) => rule.modifierExternalId).map((rule) => [rule.modifierExternalId!, rule]))
  const rows: RuleRowDraft[] = [...assignment.rules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((rule) => rule.modifierExternalId)
    .map((rule) => ({
      modifierExternalId: rule.modifierExternalId!,
      name: rule.name ?? "—",
      price: rule.price,
      included: true,
      minQuantity: rule.minQuantity,
      defaultQuantity: rule.defaultQuantity,
      maxQuantity: rule.maxQuantity,
      freeQuantity: rule.freeQuantity,
    }))
  for (const modifier of modifiers) {
    if (rules.has(modifier.externalId)) continue
    rows.push({ modifierExternalId: modifier.externalId, name: modifier.name, price: modifier.price, included: false, minQuantity: 0, defaultQuantity: 0, maxQuantity: 1, freeQuantity: 0 })
  }
  return {
    required: assignment.required,
    minQuantity: assignment.minQuantity,
    maxQuantity: assignment.maxQuantity,
    freeQuantity: assignment.freeQuantity,
    enforceItemLimits: assignment.enforceItemLimits,
    rows,
  }
}

const whole = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_QUANTITY

export function validateGroupRules(draft: GroupRulesDraft): GroupRulesErrors {
  const errors: GroupRulesErrors = { rows: {} }
  if (![draft.minQuantity, draft.maxQuantity, draft.freeQuantity].every(whole)) errors.group = `Лимиты группы — целые числа от 0 до ${MAX_QUANTITY}`
  else if (draft.minQuantity > draft.maxQuantity) errors.group = "Минимум группы не больше максимума"
  else if (draft.freeQuantity > draft.maxQuantity) errors.group = "Бесплатных порций группы не больше максимума"
  for (const row of draft.rows) {
    if (!row.included) continue
    if (![row.minQuantity, row.defaultQuantity, row.maxQuantity, row.freeQuantity].every(whole)) errors.rows[row.modifierExternalId] = `Целые числа от 0 до ${MAX_QUANTITY}`
    else if (!(row.minQuantity <= row.defaultQuantity && row.defaultQuantity <= row.maxQuantity)) errors.rows[row.modifierExternalId] = "Нужно: минимум ≤ по умолчанию ≤ максимум"
    else if (row.freeQuantity > row.maxQuantity) errors.rows[row.modifierExternalId] = "Бесплатных не больше максимума"
  }
  return errors
}

export function hasRulesErrors(errors: GroupRulesErrors) {
  return Boolean(errors.group) || Object.keys(errors.rows).length > 0
}

export function saveRulesArgs(productExternalId: string, groupExternalId: string, draft: GroupRulesDraft): SaveProductRulesArgs {
  return {
    productExternalId,
    groupExternalId,
    required: draft.required,
    minQuantity: draft.minQuantity,
    maxQuantity: draft.maxQuantity,
    freeQuantity: draft.freeQuantity,
    enforceItemLimits: draft.enforceItemLimits,
    rules: draft.rows
      .filter((row) => row.included)
      .map((row, index) => ({
        modifierExternalId: row.modifierExternalId,
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
        defaultQuantity: row.defaultQuantity,
        freeQuantity: row.freeQuantity,
        sortOrder: (index + 1) * 10,
      })),
  }
}

/** «от 0 до 2 · 1 бесплатно» — the group's limits in one line. */
export function describeLimits(limits: { minQuantity: number; maxQuantity: number; freeQuantity: number }) {
  const free = limits.freeQuantity > 0 ? ` · ${limits.freeQuantity} бесплатно` : ""
  return `от ${limits.minQuantity} до ${limits.maxQuantity}${free}`
}
