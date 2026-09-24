import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

/** A stop-list row is in force while it says unavailable and its `until` (if any) is still ahead. */
export function stopListActive(row: Pick<Doc<"productAvailability">, "available" | "until"> | null | undefined, at: number) {
  return Boolean(row && !row.available && (row.until === undefined || at < row.until))
}

/** Whether a dish can be sold at a branch now: enabled and not on the branch's stop list (W1-CAT-14). */
export async function isAvailable(ctx: QueryCtx, productId: Id<"products">, restaurantExternalId: string, at: number) {
  const product = await ctx.db.get(productId)
  if (!product?.enabled) return false
  const row = await ctx.db.query("productAvailability").withIndex("by_restaurant_product", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("productId", productId)).unique()
  return !stopListActive(row, at)
}

export async function stopListRow(ctx: QueryCtx, productId: Id<"products">, restaurantExternalId: string) {
  return ctx.db.query("productAvailability").withIndex("by_restaurant_product", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("productId", productId)).unique()
}
