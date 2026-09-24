import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { listOperationalRestaurants } from "../lib/restaurants"

// migration-batch M-3 (W1-STK-02): stock keyed by restaurant → by warehouse. Every step is paged,
// idempotent and has a dry run. Order: ensureMainWarehouses → backfillBalances → backfillMovements → verify.

export const mainWarehouseExternalId = (restaurantExternalId: string) => `${restaurantExternalId}-main`

async function warehouseFor(ctx: MutationCtx, restaurantExternalId: string): Promise<Id<"warehouses"> | null> {
  const warehouse = await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", mainWarehouseExternalId(restaurantExternalId))).unique()
  return warehouse?._id ?? null
}

/** One main warehouse per operational restaurant and per restaurant that already has stock rows. */
export const ensureMainWarehouses = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const restaurants = new Map((await listOperationalRestaurants(ctx)).map((restaurant) => [restaurant.externalId, restaurant]))
    for (const balance of await ctx.db.query("stockBalances").withIndex("by_restaurant").take(200)) {
      if (!restaurants.has(balance.restaurantExternalId)) {
        const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", balance.restaurantExternalId)).unique()
        if (restaurant) restaurants.set(restaurant.externalId, restaurant)
      }
    }
    const created: string[] = []
    for (const restaurant of restaurants.values()) {
      const externalId = mainWarehouseExternalId(restaurant.externalId)
      if (await warehouseFor(ctx, restaurant.externalId)) continue
      created.push(externalId)
      if (!args.dryRun) {
        await ctx.db.insert("warehouses", {
          externalId,
          name: `${restaurant.name} · основной склад`,
          shortName: "Склад",
          restaurantExternalId: restaurant.externalId,
          organizationExternalId: restaurant.organizationExternalId,
          kind: "storage",
          allowNegativeStock: false,
          internalTransfers: true,
          isSalesDefault: true,
          active: true,
          searchText: `${restaurant.name} основной склад`.toLocaleLowerCase("ru"),
        })
      }
    }
    return { created, dryRun: args.dryRun ?? false }
  },
})

export const backfillBalances = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("stockBalances").withIndex("by_restaurant").paginate(args.paginationOpts)
    let patched = 0
    const missing = new Set<string>()
    for (const balance of page.page) {
      if (balance.warehouseId) continue
      const warehouseId = await warehouseFor(ctx, balance.restaurantExternalId)
      if (!warehouseId) {
        missing.add(balance.restaurantExternalId)
        continue
      }
      patched += 1
      if (!args.dryRun) await ctx.db.patch(balance._id, { warehouseId })
    }
    return { scanned: page.page.length, patched, missingWarehouses: [...missing], isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

export const backfillMovements = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("stockMovements").withIndex("by_occurred_at").paginate(args.paginationOpts)
    let patched = 0
    const missing = new Set<string>()
    for (const movement of page.page) {
      if (movement.warehouseId && movement.externalId) continue
      const warehouseId = movement.warehouseId ?? (await warehouseFor(ctx, movement.restaurantExternalId))
      if (!warehouseId) {
        missing.add(movement.restaurantExternalId)
        continue
      }
      patched += 1
      if (!args.dryRun) {
        await ctx.db.patch(movement._id, {
          warehouseId,
          externalId: movement.externalId ?? `legacy-${movement._id}`,
          sourceModuleId: movement.sourceModuleId ?? "legacy-stock",
          sourceExternalId: movement.sourceExternalId ?? String(movement._id),
          amount: movement.amount ?? Math.round(Math.abs(movement.quantityDelta) * movement.unitCost),
        })
      }
    }
    return { scanned: page.page.length, patched, missingWarehouses: [...missing], isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

/** Sum of movements per warehouse and item equals the balance; every row has a warehouse. */
export const verify = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("stockBalances").withIndex("by_restaurant").paginate(args.paginationOpts)
    const mismatches = []
    for (const balance of page.page) {
      if (!balance.warehouseId) {
        mismatches.push({ balanceId: balance._id, problem: "no-warehouse" as const })
        continue
      }
      // migration-batch: one balance's full history, read once to verify M-3.
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_restaurant_item_occurred", (q) => q.eq("restaurantExternalId", balance.restaurantExternalId).eq("inventoryItemId", balance.inventoryItemId))
        .take(5000)
      const sum = movements.reduce((total, movement) => total + movement.quantityDelta, 0)
      const unassigned = movements.filter((movement) => !movement.warehouseId).length
      if (Math.abs(sum - balance.quantity) > 0.0005 || unassigned) mismatches.push({ balanceId: balance._id, problem: "quantity" as const, expected: balance.quantity, movements: sum, unassigned })
    }
    return { scanned: page.page.length, mismatches, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})
