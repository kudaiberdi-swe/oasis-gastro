import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

// Modifier validation and pricing (W1-CAT-07): one function for POS lines, delivery and Cloud API.

export type ModifierSelection = { externalId: string; quantity: number }

export type GroupAssignment = {
  required: boolean
  minQuantity: number
  maxQuantity: number
  freeQuantity: number
  /** When false only the group limits apply, not each rule's min/max. */
  enforceItemLimits: boolean
  rules: {
    modifier: { externalId: string; name: string; price: number; available: boolean }
    minQuantity: number
    maxQuantity: number
    defaultQuantity: number
    freeQuantity: number
  }[]
}

export type PricedModifier = { externalId: string; name: string; quantity: number; unitPrice: number }
export type KitchenModifier = { externalId: string; label: string; quantity: number; defaultQuantity: number }

/**
 * Pure core: a modifier not supplied keeps its default quantity; quantity 0 removes a default
 * («БЕЗ ЛУКА»), more than the default adds («+СЫР ×2»). Free portions: the rule's own first, then
 * the group's pool. unitPrice spreads the paid part over the whole quantity so the line total is exact.
 */
export function priceModifiers(assignments: GroupAssignment[], selections: ModifierSelection[]): { priced: PricedModifier[]; kitchenModifiers: KitchenModifier[] } {
  const supplied = new Map<string, number>()
  for (const selection of selections) {
    if (!Number.isInteger(selection.quantity) || selection.quantity < 0 || selection.quantity > 99) throw new ConvexError("Некорректное количество модификатора")
    supplied.set(selection.externalId, (supplied.get(selection.externalId) ?? 0) + selection.quantity)
  }
  if (assignments.length === 0 && [...supplied.values()].some((quantity) => quantity > 0)) throw new ConvexError("Для этой позиции модификаторы недоступны")

  const recognized = new Set<string>()
  const priced: PricedModifier[] = []
  const kitchenModifiers: KitchenModifier[] = []
  for (const group of assignments) {
    let groupQuantity = 0
    const chosen: { rule: GroupAssignment["rules"][number]; quantity: number }[] = []
    for (const rule of group.rules) {
      const { modifier } = rule
      recognized.add(modifier.externalId)
      const quantity = supplied.get(modifier.externalId) ?? rule.defaultQuantity
      if (quantity > rule.defaultQuantity && !modifier.available) throw new ConvexError(`Модификатор «${modifier.name}» недоступен`)
      if (group.enforceItemLimits && (quantity < rule.minQuantity || quantity > rule.maxQuantity)) throw new ConvexError(`Проверьте количество «${modifier.name}»`)
      groupQuantity += quantity
      if (quantity > 0) chosen.push({ rule, quantity })
      if (quantity !== rule.defaultQuantity) {
        const name = modifier.name.toLocaleUpperCase("ru")
        const extra = quantity - rule.defaultQuantity
        const label = quantity === 0 ? `БЕЗ ${name}` : extra > 0 ? `+${name}${extra > 1 ? ` ×${extra}` : ""}` : `${name} ×${quantity}`
        kitchenModifiers.push({ externalId: modifier.externalId, label, quantity, defaultQuantity: rule.defaultQuantity })
      }
    }
    if ((group.required || group.minQuantity > 0) && groupQuantity < Math.max(group.minQuantity, group.required ? 1 : 0)) throw new ConvexError("Выберите обязательные модификаторы")
    if (groupQuantity > group.maxQuantity) throw new ConvexError("Выбрано слишком много модификаторов")

    let groupFree = group.freeQuantity
    for (const { rule, quantity } of chosen) {
      const ownFree = Math.min(quantity, rule.freeQuantity)
      const fromPool = Math.min(quantity - ownFree, groupFree)
      groupFree -= fromPool
      const paid = quantity - ownFree - fromPool
      priced.push({ externalId: rule.modifier.externalId, name: rule.modifier.name, quantity, unitPrice: paid ? (rule.modifier.price * paid) / quantity : 0 })
    }
  }
  for (const externalId of supplied.keys()) if (!recognized.has(externalId)) throw new ConvexError("Модификатор не разрешён для этой позиции")
  return { priced, kitchenModifiers }
}

/** Loads the product's groups and rules through their indexes. */
export async function loadModifierAssignments(ctx: QueryCtx, product: Doc<"products">): Promise<GroupAssignment[]> {
  const groups = await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)
  return Promise.all(
    groups.map(async (group) => {
      const rules = await ctx.db.query("productModifierRules").withIndex("by_assignment_sort", (q) => q.eq("productModifierGroupId", group._id)).take(50)
      const loaded = await Promise.all(rules.map(async (rule) => ({ rule, modifier: await ctx.db.get(rule.modifierId) })))
      return {
        required: group.required,
        minQuantity: group.minQuantity,
        maxQuantity: group.maxQuantity,
        freeQuantity: group.freeQuantity,
        enforceItemLimits: group.enforceItemLimits,
        rules: loaded
          .filter((row): row is typeof row & { modifier: Doc<"modifiers"> } => row.modifier !== null)
          .map(({ rule, modifier }) => ({
            modifier: { externalId: modifier.externalId, name: modifier.name, price: modifier.price, available: modifier.available },
            minQuantity: rule.minQuantity,
            maxQuantity: rule.maxQuantity,
            defaultQuantity: rule.defaultQuantity,
            freeQuantity: rule.freeQuantity,
          })),
      }
    }),
  )
}

export async function validateAndPriceModifiers(ctx: QueryCtx, product: Doc<"products">, selections: ModifierSelection[]) {
  return priceModifiers(await loadModifierAssignments(ctx, product), selections)
}
