import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { kitchenForecast, type KitchenForecast } from "./forecast"
import { MAX_PREPARATION_DEPTH, recipeLinesOf, recipeVersionAt } from "./recipes"
import { roundQuantity } from "./stockAccounting"
import { almatyDayStart, DAY_MS } from "./time"

type QueryCtx = GenericQueryCtx<DataModel>

// Semi-finished sheet (W3-PRD-08): the kitchen forecast (lib/forecast.ts — the same numbers the plan's
// cards show) × the recipes in force that day (the restaurant's own line variant, recipeLinesOf) → the
// preparations the dishes need. Plan = need − the restaurant's stock, netted level by level, so a
// preparation inside another one is asked only for the batches still to be made. Fact = posted
// production acts of the business date.

export type RequirementLine = {
  productExternalId: string
  name: string
  unit: string | null
  inventoryItemExternalId: string | null
  /** Need from the forecast (dishes and the preparations to be made). */
  forecastQuantity: number
  onHand: number
  plannedQuantity: number
  actualQuantity: number
  /** A production act can make it: written off as a finished product, with a stock item and a recipe. */
  canProduce: boolean
  /** The dishes (or preparations) that need it, up to three names. */
  usedBy: string[]
}

export type SemiFinishedRequirement = { forecast: KitchenForecast; lines: RequirementLine[]; dishesWithoutRecipe: string[] }

/** Noon of the business date: the recipe version in force that day. */
export const recipeMomentOf = (targetDate: string) => almatyDayStart(targetDate) + DAY_MS / 2

type Node = { product: Doc<"products">; perUnit: Map<Id<"products">, number>; hasRecipe: boolean }

/** Preparations one portion (one unit of output) of a product needs, from its recipe version at `at`. */
async function nodeOf(ctx: QueryCtx, cache: Map<Id<"products">, Node>, product: Doc<"products">, at: number, restaurantExternalId: string) {
  const known = cache.get(product._id)
  if (known) return known
  const perUnit = new Map<Id<"products">, number>()
  const version = await recipeVersionAt(ctx, product._id, at)
  if (version) {
    const factor = 1 / (version.batchYield > 0 ? version.batchYield : 1)
    for (const line of await recipeLinesOf(ctx, version._id, restaurantExternalId)) {
      if (line.kind !== "preparation" || !line.componentProductId || line.componentProductId === product._id) continue
      perUnit.set(line.componentProductId, (perUnit.get(line.componentProductId) ?? 0) + line.quantity * factor)
    }
  }
  const node = { product, perUnit, hasRecipe: Boolean(version) }
  cache.set(product._id, node)
  return node
}

/** Output of posted production acts of the restaurant on the business date, by preparation externalId. */
export async function postedProductionOf(ctx: QueryCtx, restaurant: Doc<"restaurants">, businessDate: string) {
  const from = almatyDayStart(businessDate) + (restaurant.businessDayCutoffMinutes ?? 0) * 60_000
  const done = new Map<string, number>()
  const acts = await ctx.db
    .query("productionDocuments")
    .withIndex("by_type_restaurant_date", (q) => q.eq("type", "production").eq("restaurantExternalId", restaurant.externalId).gte("date", from).lt("date", from + DAY_MS))
    .collect()
  const externalIds = new Map<Id<"products">, string | null>()
  for (const act of acts) {
    if (act.status !== "posted") continue
    for (const line of act.lines) {
      if (!line.productId) continue
      if (!externalIds.has(line.productId)) externalIds.set(line.productId, (await ctx.db.get(line.productId))?.externalId ?? null)
      const externalId = externalIds.get(line.productId)
      if (externalId) done.set(externalId, (done.get(externalId) ?? 0) + line.quantity)
    }
  }
  return done
}

export async function semiFinishedRequirement(ctx: QueryCtx, restaurant: Doc<"restaurants">, targetDate: string): Promise<SemiFinishedRequirement> {
  const forecast = await kitchenForecast(ctx, { restaurantExternalId: restaurant.externalId, targetDate })
  const at = recipeMomentOf(targetDate)
  const cache = new Map<Id<"products">, Node>()
  const gross = new Map<Id<"products">, number>()
  const usedBy = new Map<Id<"products">, Set<string>>()
  const level = new Map<Id<"products">, number>()
  const dishesWithoutRecipe: string[] = []
  const need = (id: Id<"products">, quantity: number, by: string, depth: number) => {
    gross.set(id, (gross.get(id) ?? 0) + quantity)
    usedBy.set(id, (usedBy.get(id) ?? new Set()).add(by))
    level.set(id, Math.max(level.get(id) ?? 0, depth))
  }

  // Level 1: the preparations the forecast dishes need.
  for (const row of forecast.products) {
    if (row.recommendedQuantity <= 0) continue
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", row.productExternalId)).unique()
    if (!product) continue
    const node = await nodeOf(ctx, cache, product, at, restaurant.externalId)
    if (!node.hasRecipe && product.itemType !== "good") dishesWithoutRecipe.push(row.name)
    for (const [id, perUnit] of node.perUnit) need(id, perUnit * row.recommendedQuantity, row.name, 1)
  }

  // Levels below: a preparation inside another is made after it (the deepest level it appears on wins).
  for (let depth = 1; depth < MAX_PREPARATION_DEPTH; depth += 1) {
    for (const [id, found] of [...level]) {
      if (found !== depth) continue
      const product = await ctx.db.get(id)
      if (!product) continue
      const node = await nodeOf(ctx, cache, product, at, restaurant.externalId)
      for (const child of node.perUnit.keys()) level.set(child, Math.max(level.get(child) ?? 0, depth + 1))
    }
  }

  const done = await postedProductionOf(ctx, restaurant, targetDate)
  const lines: RequirementLine[] = []
  const ordered = [...level.keys()].sort((a, b) => level.get(a)! - level.get(b)!)
  for (const id of ordered) {
    const product = await ctx.db.get(id)
    if (!product) continue
    const node = await nodeOf(ctx, cache, product, at, restaurant.externalId)
    const item = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
    const balances = item ? await ctx.db.query("stockBalances").withIndex("by_restaurant_item", (q) => q.eq("restaurantExternalId", restaurant.externalId).eq("inventoryItemId", item._id)).take(50) : []
    const onHand = roundQuantity(balances.reduce((sum, balance) => sum + balance.quantity, 0))
    const forecastQuantity = roundQuantity(gross.get(id) ?? 0)
    const unit = item?.unit ?? null
    const net = Math.max(0, forecastQuantity - Math.max(0, onHand))
    const plannedQuantity = unit === "шт" ? Math.ceil(net - 1e-9) : roundQuantity(net)
    // What this preparation still has to be made from.
    for (const [child, perUnit] of node.perUnit) need(child, perUnit * plannedQuantity, product.name, level.get(child) ?? 0)
    lines.push({
      productExternalId: product.externalId,
      name: product.name,
      unit,
      inventoryItemExternalId: item?.externalId ?? null,
      forecastQuantity,
      onHand,
      plannedQuantity,
      actualQuantity: roundQuantity(done.get(product.externalId) ?? 0),
      canProduce: product.writeOffMethod === "finished-product" && Boolean(item) && node.hasRecipe,
      usedBy: [...(usedBy.get(id) ?? [])].slice(0, 3),
    })
  }
  lines.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  return { forecast, lines, dishesWithoutRecipe }
}
