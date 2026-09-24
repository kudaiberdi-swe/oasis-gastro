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

/** Orders read per status for one price resolution; a restaurant has a handful in force at once. */
const ORDERS_PER_STATUS = 100

type OrderInForce = { order: Doc<"priceOrders">; number: number; schedule: PriceScheduleWindow[] }

/**
 * Price orders in force for a restaurant at a moment (W1-CAT-10). Uses the effective window, not the
 * status alone, so prices switch exactly at effectiveFrom/effectiveTo even before the status cron
 * has run; cancelled and draft orders never apply.
 */
export async function priceOrdersInForce(ctx: QueryCtx, restaurantExternalId: string, at: number): Promise<OrderInForce[]> {
  const orders = []
  for (const status of ["active", "scheduled", "expired"] as const) {
    const rows = await ctx.db
      .query("priceOrders")
      .withIndex("by_status_start", (q) => q.eq("status", status).lte("effectiveFrom", at))
      .order("desc")
      .take(ORDERS_PER_STATUS)
    orders.push(...rows)
  }
  const inForce = orders.filter(
    (order) => (order.effectiveTo === undefined || at < order.effectiveTo) && (order.restaurantExternalIds.length === 0 || order.restaurantExternalIds.includes(restaurantExternalId)),
  )
  return Promise.all(
    inForce.map(async (order) => {
      const schedules = await ctx.db.query("priceSchedules").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(20)
      return {
        order,
        number: Number(order.number.replace(/\D/g, "")) || 0,
        schedule: schedules.map((schedule) => ({ weekdays: schedule.weekdays, fromMinute: schedule.startMinute, toMinute: schedule.endMinute })),
      }
    }),
  )
}

/** The lines of one product in the orders in force (read through by_order_product). */
async function productPriceLines(ctx: QueryCtx, orders: OrderInForce[], productExternalId: string): Promise<PriceLine[]> {
  const lines: PriceLine[] = []
  for (const { order, number, schedule } of orders) {
    const rows = await ctx.db.query("priceOrderLines").withIndex("by_order_product", (q) => q.eq("orderId", order._id).eq("productExternalId", productExternalId)).take(50)
    for (const line of rows) {
      if (!line.included) continue
      lines.push({
        priceOrderId: order.externalId,
        number,
        productExternalId,
        sizeOptionId: line.sizeOptionId,
        price: line.newPrice,
        effectiveFrom: order.effectiveFrom,
        effectiveTo: order.effectiveTo,
        restaurantExternalIds: order.restaurantExternalIds,
        schedule,
      })
    }
  }
  return lines
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
  orders: OrderInForce[],
  args: { product: Doc<"products">; restaurantExternalId: string; at: number; sizeOptionId?: string; sizeCoefficient?: number },
): Promise<ResolvedPrice> {
  const overlay = await overlayPrice(ctx, args.product)
  if (overlay !== undefined) return { price: Math.round(overlay), source: "overlay" }
  const lines = orders.length ? await productPriceLines(ctx, orders, args.product.externalId) : []
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
  return resolveWith(ctx, await priceOrdersInForce(ctx, args.restaurantExternalId, args.at), args)
}

/** Price of one size of a product: a size line of a price order, else the branch/base price × the size coefficient. */
export async function resolveSizedPrice(ctx: QueryCtx, args: { product: Doc<"products">; restaurantExternalId: string; at: number; sizeOption: Doc<"sizeOptions"> }) {
  return resolvePrice(ctx, { product: args.product, restaurantExternalId: args.restaurantExternalId, at: args.at, sizeOptionId: args.sizeOption._id, sizeCoefficient: args.sizeOption.coefficient })
}

/** Batch version: one read of the price orders per request, then per-product lookups by index. */
export async function resolvePrices(ctx: QueryCtx, products: Doc<"products">[], restaurantExternalId: string, at: number) {
  const orders = await priceOrdersInForce(ctx, restaurantExternalId, at)
  return Promise.all(products.map((product) => resolveWith(ctx, orders, { product, restaurantExternalId, at })))
}
