import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { almatyWeekdayMinute } from "./time"

type QueryCtx = GenericQueryCtx<DataModel>

// The one price rule (W1-CAT-02, B-14): overlay price of an iiko product → active price-order line
// for the restaurant (and size) → branch price → base price × size coefficient. Products are never
// mutated when a price order starts or ends, so prices roll back on their own without a cron.

export type PriceSource = "overlay" | "price-order" | "branch" | "base"

export type PriceScheduleWindow = { weekdays: number[]; fromMinute: number; toMinute: number }

/** A price-order line as the resolver needs it (W1-CAT-10 stores them in priceOrders/priceOrderLines). */
export type PriceLine = {
  priceOrderId: string
  number: number
  productExternalId: string
  sizeOptionId?: string
  price: number
  effectiveFrom: number
  effectiveTo?: number
  /** Empty = every restaurant. */
  restaurantExternalIds: string[]
  /** Empty = all day, every day. */
  schedule: PriceScheduleWindow[]
}

function scheduleApplies(schedule: PriceScheduleWindow[], at: number) {
  if (schedule.length === 0) return true
  const { weekday, minute } = almatyWeekdayMinute(at)
  return schedule.some((window) => window.weekdays.includes(weekday) && minute >= window.fromMinute && minute < window.toMinute)
}

/**
 * The line in force: active window (effectiveFrom ≤ at < effectiveTo), restaurant and size match,
 * schedule applies. Later effectiveFrom wins; on a tie the higher order number wins.
 */
export function pickPriceLine(lines: PriceLine[], args: { productExternalId: string; restaurantExternalId: string; sizeOptionId?: string; at: number }) {
  const candidates = lines.filter(
    (line) =>
      line.productExternalId === args.productExternalId &&
      (line.sizeOptionId ?? null) === (args.sizeOptionId ?? null) &&
      line.effectiveFrom <= args.at &&
      (line.effectiveTo === undefined || args.at < line.effectiveTo) &&
      (line.restaurantExternalIds.length === 0 || line.restaurantExternalIds.includes(args.restaurantExternalId)) &&
      scheduleApplies(line.schedule, args.at),
  )
  candidates.sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.number - a.number)
  return candidates[0]
}

/** Active price-order lines for a restaurant at a moment. Empty until price orders exist (W1-CAT-10). */
export async function activePriceLines(_ctx: QueryCtx, _restaurantExternalId: string, _at: number): Promise<PriceLine[]> {
  return []
}

export type ResolvedPrice = { price: number; source: PriceSource; priceOrderId?: string }

async function overlayPrice(ctx: QueryCtx, product: Doc<"products">) {
  if (product.sourceSystem !== "iiko-server") return undefined
  const overlay = await ctx.db
    .query("iikoEntityOverlays")
    .withIndex("by_entity_type_and_source_external_id", (q) => q.eq("entityType", "product").eq("sourceExternalId", product.externalId))
    .unique()
  return overlay?.localSettings?.price
}

async function resolveWith(
  ctx: QueryCtx,
  lines: PriceLine[],
  args: { product: Doc<"products">; restaurantExternalId: string; at: number; sizeOptionId?: string; sizeCoefficient?: number },
): Promise<ResolvedPrice> {
  const overlay = await overlayPrice(ctx, args.product)
  if (overlay !== undefined) return { price: Math.round(overlay), source: "overlay" }
  const line = pickPriceLine(lines, { productExternalId: args.product.externalId, restaurantExternalId: args.restaurantExternalId, sizeOptionId: args.sizeOptionId, at: args.at })
  if (line) return { price: Math.round(line.price), source: "price-order", priceOrderId: line.priceOrderId }
  const branch = await ctx.db
    .query("productPrices")
    .withIndex("by_product_restaurant", (q) => q.eq("productId", args.product._id).eq("restaurantExternalId", args.restaurantExternalId))
    .unique()
  if (branch) return { price: Math.round(branch.priceKzt * (args.sizeCoefficient ?? 1)), source: "branch" }
  return { price: Math.round(args.product.basePrice * (args.sizeCoefficient ?? 1)), source: "base" }
}

export async function resolvePrice(ctx: QueryCtx, args: { product: Doc<"products">; restaurantExternalId: string; at: number; sizeOptionId?: string; sizeCoefficient?: number }) {
  return resolveWith(ctx, await activePriceLines(ctx, args.restaurantExternalId, args.at), args)
}

/** Batch version: one read of the price orders per request, then per-product lookups by index. */
export async function resolvePrices(ctx: QueryCtx, products: Doc<"products">[], restaurantExternalId: string, at: number) {
  const lines = await activePriceLines(ctx, restaurantExternalId, at)
  return Promise.all(products.map((product) => resolveWith(ctx, lines, { product, restaurantExternalId, at })))
}
