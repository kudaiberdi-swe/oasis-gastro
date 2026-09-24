import { v } from "convex/values"

import type { QueryCtx } from "../../_generated/server"
import { query } from "../../_generated/server"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

async function loadEntries(ctx: QueryCtx, inScope: (restaurantExternalId: string | undefined) => boolean, args: { restaurantExternalId?: string; from?: string; to?: string }) {
  const all = args.restaurantExternalId
    ? await ctx.db.query("ledgerEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).collect()
    : await ctx.db.query("ledgerEntries").withIndex("by_occurred_at").collect()
  return all.filter((entry) => inScope(entry.restaurantExternalId) && (!args.from || entry.businessDate >= args.from) && (!args.to || entry.businessDate <= args.to))
}

export const summary = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const entries = await loadEntries(ctx, restaurantScopeFilter(user, args.restaurantExternalId), args)
    const revenue = entries.filter((entry) => entry.kind === "revenue").reduce((sum, entry) => sum + entry.amount, 0)
    const expense = entries.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + entry.amount, 0)
    const byCategory = new Map<string, { kind: "revenue" | "expense"; amount: number }>()
    for (const entry of entries) {
      const existing = byCategory.get(entry.category)
      byCategory.set(entry.category, { kind: entry.kind, amount: (existing?.amount ?? 0) + entry.amount })
    }
    return {
      revenue,
      expense,
      net: revenue - expense,
      byCategory: [...byCategory.entries()].map(([category, value]) => ({ category, ...value })).sort((left, right) => right.amount - left.amount),
    }
  },
})

export const listEntries = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const entries = await loadEntries(ctx, restaurantScopeFilter(user, args.restaurantExternalId), args)
    return entries.sort((left, right) => right.occurredAt - left.occurredAt).slice(0, args.limit ?? 200)
  },
})

export const restaurantsForFilter = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const inScope = restaurantScopeFilter(user)
    return (await listOperationalRestaurants(ctx)).filter((restaurant) => inScope(restaurant.externalId))
  },
})
