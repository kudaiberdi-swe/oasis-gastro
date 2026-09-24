import type { GenericQueryCtx } from "convex/server"
import type { DataModel, Doc } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

/**
 * Restaurants with at least one posTerminals row — i.e. an actual operating branch, not just a
 * canonical record. Phase 3's iiko import writes a `restaurants` row per iiko department/branch
 * alongside the three Phase-1-seeded branches; those iiko rows have no terminal yet (Sandyq's POS
 * hasn't been rolled out there), so they'd otherwise clutter every office restaurant picker with
 * duplicates (e.g. "Sandyq Алматы" next to the seeded "Алматы"). Office UI should only ever offer
 * branches staff can actually take orders at.
 */
export async function listOperationalRestaurants(ctx: QueryCtx): Promise<Doc<"restaurants">[]> {
  const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
  const flags = await Promise.all(
    restaurants.map((restaurant) =>
      ctx.db
        .query("posTerminals")
        .withIndex("by_restaurant_active_and_number", (q) => q.eq("restaurantId", restaurant._id).eq("active", true))
        .first(),
    ),
  )
  return restaurants.filter((_, index) => flags[index] !== null)
}
