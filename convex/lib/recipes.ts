import { ConvexError } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { calculateRecipe, type RecipeMathLine, type RecipeSummary } from "./recipeMath"

type QueryCtx = GenericQueryCtx<DataModel>

export const MAX_PREPARATION_DEPTH = 3

/** The version in force for a product at a moment: the latest non-draft version with effectiveFrom ≤ at. */
export async function recipeVersionAt(ctx: QueryCtx, productId: Id<"products">, at: number) {
  const versions = await ctx.db
    .query("recipeVersions")
    .withIndex("by_product_effective", (q) => q.eq("productId", productId).lte("effectiveFrom", at))
    .order("desc")
    .take(20)
  return versions.find((version) => version.status !== "draft") ?? null
}

/**
 * The lines of a version for a restaurant. An iiko chart can hold a variant of a line per department
 * (W2-IIKO-08): the restaurant gets the lines of its linked department. Without a restaurant, or for one
 * with no iiko link, the lines of one reference department — never the sum of every branch's variant.
 */
export async function recipeLinesOf(ctx: QueryCtx, versionId: Id<"recipeVersions">, restaurantExternalId?: string) {
  const lines = await ctx.db.query("recipeLines").withIndex("by_version", (q) => q.eq("versionId", versionId)).take(200)
  const reference = lines.find((line) => line.iikoDepartmentExternalIds?.length)?.iikoDepartmentExternalIds?.[0]
  if (!reference) return lines
  const link = restaurantExternalId ? await ctx.db.query("restaurantSourceLinks").withIndex("by_restaurant", (q) => q.eq("restaurantExternalId", restaurantExternalId)).first() : null
  const department = link?.iikoDepartmentExternalId ?? reference
  return lines.filter((line) => !line.iikoDepartmentExternalIds?.length || line.iikoDepartmentExternalIds.includes(department))
}

/** Weighted average stock cost of an item (per its unit) — for one restaurant, or across all branches. */
export async function averageItemCost(ctx: QueryCtx, inventoryItemId: Id<"inventoryItems">, restaurantExternalId?: string) {
  const balances = await ctx.db.query("stockBalances").withIndex("by_item", (q) => q.eq("inventoryItemId", inventoryItemId)).take(100)
  if (restaurantExternalId) {
    // A restaurant can hold the item in several warehouses (M-3): weigh them by quantity.
    const own = balances.filter((balance) => balance.restaurantExternalId === restaurantExternalId && balance.averageUnitCost > 0)
    const ownQuantity = own.reduce((sum, balance) => sum + Math.max(0, balance.quantity), 0)
    if (ownQuantity > 0) return own.reduce((sum, balance) => sum + Math.max(0, balance.quantity) * balance.averageUnitCost, 0) / ownQuantity
    if (own.length) return own.reduce((sum, balance) => sum + balance.averageUnitCost, 0) / own.length
  }
  const quantity = balances.reduce((sum, balance) => sum + Math.max(0, balance.quantity), 0)
  if (quantity > 0) return balances.reduce((sum, balance) => sum + Math.max(0, balance.quantity) * balance.averageUnitCost, 0) / quantity
  const priced = balances.filter((balance) => balance.averageUnitCost > 0)
  return priced.length ? priced.reduce((sum, balance) => sum + balance.averageUnitCost, 0) / priced.length : 0
}

export type CostedRecipe = { version: Doc<"recipeVersions">; lines: (Doc<"recipeLines"> & { unitCost: number })[]; summary: RecipeSummary }

/**
 * A version with each line's unit cost: items at average stock cost; a preparation at its own
 * recipe's cost per kg of output (recursively, depth ≤ 3).
 */
export async function costRecipe(ctx: QueryCtx, version: Doc<"recipeVersions">, at: number, restaurantExternalId?: string, depth = 0): Promise<CostedRecipe> {
  const lines = await recipeLinesOf(ctx, version._id, restaurantExternalId)
  const costed = await Promise.all(
    lines.map(async (line) => {
      let unitCost = 0
      if (line.kind === "item" && line.inventoryItemId) unitCost = await averageItemCost(ctx, line.inventoryItemId, restaurantExternalId)
      if (line.kind === "preparation" && line.componentProductId && depth < MAX_PREPARATION_DEPTH) {
        const component = await recipeVersionAt(ctx, line.componentProductId, at)
        if (component) {
          const nested = await costRecipe(ctx, component, at, restaurantExternalId, depth + 1)
          const costPerKg = nested.summary.outputKg > 0 ? nested.summary.costPerBatch / nested.summary.outputKg : 0
          unitCost = costPerKg * (line.unit === "кг" ? 1 : line.unitWeightKg)
        }
      }
      return { ...line, unitCost }
    }),
  )
  const mathLines: RecipeMathLine[] = costed.map((line) => ({ unit: line.unit, quantity: line.quantity, unitWeightKg: line.unit === "кг" ? 1 : line.unitWeightKg, coldLossPercent: line.coldLossPercent, hotLossPercent: line.hotLossPercent, unitCost: line.unitCost }))
  return { version, lines: costed, summary: calculateRecipe(mathLines, version.batchYield) }
}

/** Preparations may nest up to 3 levels and never contain the dish itself. */
export async function assertNoPreparationCycle(ctx: QueryCtx, productId: Id<"products">, componentIds: Id<"products">[], at: number) {
  const visit = async (id: Id<"products">, depth: number): Promise<void> => {
    if (id === productId) throw new ConvexError("Заготовка не может содержать само блюдо")
    if (depth > MAX_PREPARATION_DEPTH) throw new ConvexError(`Вложенность заготовок — не больше ${MAX_PREPARATION_DEPTH} уровней`)
    const version = await recipeVersionAt(ctx, id, at)
    if (!version) return
    for (const line of await recipeLinesOf(ctx, version._id)) {
      if (line.componentProductId) await visit(line.componentProductId, depth + 1)
    }
  }
  for (const id of componentIds) await visit(id, 1)
}
