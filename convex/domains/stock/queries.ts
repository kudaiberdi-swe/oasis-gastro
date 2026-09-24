import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

export const listInventoryForOffice = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.stock.*")
    const inScope = restaurantScopeFilter(user)
    const [items, allBalances, allRestaurants] = await Promise.all([
      ctx.db.query("inventoryItems").withIndex("by_active_and_name", (q) => q.eq("active", true)).collect(),
      ctx.db.query("stockBalances").collect(),
      listOperationalRestaurants(ctx),
    ])
    const restaurants = allRestaurants.filter((restaurant) => inScope(restaurant.externalId))
    const balances = allBalances.filter((balance) => inScope(balance.restaurantExternalId))
    const balancesByItem = new Map<Id<"inventoryItems">, { restaurantExternalId: string; quantity: number; averageUnitCost: number }[]>()
    for (const balance of balances) {
      const list = balancesByItem.get(balance.inventoryItemId) ?? []
      list.push({ restaurantExternalId: balance.restaurantExternalId, quantity: balance.quantity, averageUnitCost: balance.averageUnitCost })
      balancesByItem.set(balance.inventoryItemId, list)
    }
    return {
      restaurants,
      items: items.map((item) => ({ ...item, balances: balancesByItem.get(item._id) ?? [] })),
    }
  },
})

/** Recent movement log across every item/branch — the audit trail behind the balances above. */
export const listRecentMovements = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.stock.*")
    const inScope = restaurantScopeFilter(user)
    const recent = await ctx.db.query("stockMovements").withIndex("by_occurred_at").order("desc").take(args.limit ?? 100)
    const movements = recent.filter((movement) => inScope(movement.restaurantExternalId))
    const items = await Promise.all(movements.map((movement) => ctx.db.get(movement.inventoryItemId)))
    return movements.map((movement, index) => ({ ...movement, itemName: items[index]?.name ?? "—", itemUnit: items[index]?.unit ?? "" }))
  },
})
