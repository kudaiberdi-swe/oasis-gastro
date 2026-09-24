// Size and modifier choice for one dish (W1-POS-12). The rules mirror convex/lib/modifierPricing.ts
// (priceModifiers): a rule not touched keeps its default quantity, free portions come from the rule
// first and then from the group's pool. The price here is only a preview — the server prices the line.

export type ConfigurationOption = {
  externalId: string
  name: string
  price: number
  minQuantity: number
  maxQuantity: number
  defaultQuantity: number
  freeQuantity: number
  available: boolean
}

export type ConfigurationGroup = {
  groupExternalId: string
  name: string
  required: boolean
  minQuantity: number
  maxQuantity: number
  freeQuantity: number
  /** When false only the group limits apply, not each option's min/max. */
  enforceItemLimits: boolean
  options: ConfigurationOption[]
}

export type ConfigurationSize = { externalId: string; label: string; labelKk: string | null; price: number; isDefault: boolean; available: boolean }

export type ProductConfiguration = {
  product: { externalId: string; name: string; nameKk: string; imageUrl: string | null; price: number; available: boolean }
  sizes: ConfigurationSize[]
  groups: ConfigurationGroup[]
}

/** Quantity per modifier externalId, for every option of every group. */
export type ModifierQuantities = Record<string, number>

export type ModifierSelectionInput = { modifierExternalId: string; quantity: number }

export function defaultSize(sizes: ConfigurationSize[]): ConfigurationSize | undefined {
  return sizes.find((size) => size.isDefault && size.available) ?? sizes.find((size) => size.available)
}

export function defaultQuantities(groups: ConfigurationGroup[]): ModifierQuantities {
  const quantities: ModifierQuantities = {}
  for (const group of groups) for (const option of group.options) quantities[option.externalId] = option.defaultQuantity
  return quantities
}

/** A group with at most one portion in total is chosen like a radio button. */
export function isSingleChoice(group: ConfigurationGroup) {
  return group.maxQuantity === 1
}

export function groupQuantity(group: ConfigurationGroup, quantities: ModifierQuantities) {
  return group.options.reduce((sum, option) => sum + (quantities[option.externalId] ?? option.defaultQuantity), 0)
}

/** The least the group needs: its minimum, and at least one portion when it is required. */
export function groupMinimum(group: ConfigurationGroup) {
  return Math.max(group.minQuantity, group.required ? 1 : 0)
}

function optionMax(group: ConfigurationGroup, option: ConfigurationOption) {
  return group.enforceItemLimits ? option.maxQuantity : Number.POSITIVE_INFINITY
}

export function canIncrement(group: ConfigurationGroup, option: ConfigurationOption, quantities: ModifierQuantities) {
  const quantity = quantities[option.externalId] ?? option.defaultQuantity
  if (quantity >= option.defaultQuantity && !option.available) return false
  return quantity + 1 <= optionMax(group, option) && groupQuantity(group, quantities) + 1 <= group.maxQuantity
}

export function canDecrement(group: ConfigurationGroup, option: ConfigurationOption, quantities: ModifierQuantities) {
  const quantity = quantities[option.externalId] ?? option.defaultQuantity
  return quantity > (group.enforceItemLimits ? option.minQuantity : 0)
}

export function changeQuantity(group: ConfigurationGroup, option: ConfigurationOption, quantities: ModifierQuantities, delta: 1 | -1): ModifierQuantities {
  if (delta === 1 ? !canIncrement(group, option, quantities) : !canDecrement(group, option, quantities)) return quantities
  return { ...quantities, [option.externalId]: (quantities[option.externalId] ?? option.defaultQuantity) + delta }
}

/** Radio choice: the picked option gets one portion, the rest of the group none. Tapping it again clears an optional group. */
export function chooseSingle(group: ConfigurationGroup, option: ConfigurationOption, quantities: ModifierQuantities): ModifierQuantities {
  const alreadyChosen = (quantities[option.externalId] ?? option.defaultQuantity) > 0
  const next = { ...quantities }
  for (const other of group.options) next[other.externalId] = 0
  if (!(alreadyChosen && groupMinimum(group) === 0)) next[option.externalId] = 1
  return next
}

/** Money for the modifiers of one dish, with the free portions taken off (per dish, before × quantity). */
export function modifiersPrice(groups: ConfigurationGroup[], quantities: ModifierQuantities) {
  let total = 0
  for (const group of groups) {
    let pool = group.freeQuantity
    for (const option of group.options) {
      const quantity = quantities[option.externalId] ?? option.defaultQuantity
      if (quantity <= 0) continue
      const ownFree = Math.min(quantity, option.freeQuantity)
      const fromPool = Math.min(quantity - ownFree, pool)
      pool -= fromPool
      total += option.price * (quantity - ownFree - fromPool)
    }
  }
  return total
}

export function unitPrice(configuration: ProductConfiguration, sizeExternalId: string | undefined, quantities: ModifierQuantities) {
  const size = configuration.sizes.find((candidate) => candidate.externalId === sizeExternalId)
  return (size?.price ?? configuration.product.price) + modifiersPrice(configuration.groups, quantities)
}

/** What still blocks «Добавить в заказ»: one message per group, keyed by group externalId. */
export function selectionProblems(configuration: ProductConfiguration, sizeExternalId: string | undefined, quantities: ModifierQuantities): Record<string, string> {
  const problems: Record<string, string> = {}
  if (configuration.sizes.length > 0 && !configuration.sizes.some((size) => size.externalId === sizeExternalId && size.available)) problems.size = "Выберите размер"
  for (const group of configuration.groups) {
    const chosen = groupQuantity(group, quantities)
    const minimum = groupMinimum(group)
    if (chosen < minimum) problems[group.groupExternalId] = minimum - chosen === 1 && minimum === 1 ? "Выберите вариант" : `Выберите ещё ${minimum - chosen}`
    else if (chosen > group.maxQuantity) problems[group.groupExternalId] = `Не больше ${group.maxQuantity}`
    else if (group.enforceItemLimits) {
      const outOfRange = group.options.find((option) => {
        const quantity = quantities[option.externalId] ?? option.defaultQuantity
        return quantity < option.minQuantity || quantity > option.maxQuantity
      })
      if (outOfRange) problems[group.groupExternalId] = `Проверьте количество «${outOfRange.name}»`
    }
  }
  return problems
}

/**
 * The line's modifierSelections for saveDraft: every option that is chosen, plus a removed default
 * (quantity 0, «без лука»). Untouched zero options are left out; the server fills in defaults itself.
 */
export function toModifierSelections(groups: ConfigurationGroup[], quantities: ModifierQuantities): ModifierSelectionInput[] {
  const selections: ModifierSelectionInput[] = []
  for (const group of groups) {
    for (const option of group.options) {
      const quantity = quantities[option.externalId] ?? option.defaultQuantity
      if (quantity > 0 || option.defaultQuantity > 0) selections.push({ modifierExternalId: option.externalId, quantity })
    }
  }
  return selections
}

/** Cashier-facing change against the default: «без лука», «+сыр ×2», «соус ×1». */
export function modifierLabel(name: string, quantity: number, defaultQuantity: number) {
  const lower = name.toLocaleLowerCase("ru")
  if (quantity === 0) return `без ${lower}`
  const extra = quantity - defaultQuantity
  if (extra > 0) return defaultQuantity > 0 ? `+${lower}${extra > 1 ? ` ×${extra}` : ""}` : `${name}${quantity > 1 ? ` ×${quantity}` : ""}`
  return `${name} ×${quantity}`
}

/** Labels of everything that differs from the defaults, in group order. */
export function modifierLabels(groups: ConfigurationGroup[], quantities: ModifierQuantities) {
  const labels: string[] = []
  for (const group of groups) {
    for (const option of group.options) {
      const quantity = quantities[option.externalId] ?? option.defaultQuantity
      if (quantity !== option.defaultQuantity) labels.push(modifierLabel(option.name, quantity, option.defaultQuantity))
    }
  }
  return labels
}

/** A dish opens the dialog only when it has sizes or modifier groups; otherwise it is added at once. */
export function needsConfiguration(product: { customizable?: boolean; sizeScaleId?: unknown }) {
  return Boolean(product.customizable || product.sizeScaleId)
}
