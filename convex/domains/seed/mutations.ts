import { v, ConvexError } from "convex/values"

import { internalMutation } from "../../_generated/server"
import { employeeRole } from "../../lib/validators"

async function upsertByExternalId<T extends { externalId: string }>(
  ctx: any,
  table: "organizations" | "restaurants" | "posTerminals" | "categories" | "products",
  value: T,
) {
  const existing = await ctx.db.query(table).withIndex("by_external_id", (q: any) => q.eq("externalId", value.externalId)).unique()
  if (existing) {
    await ctx.db.patch(existing._id, value)
    return existing._id
  }
  return ctx.db.insert(table, value)
}

/**
 * Idempotent — safe to re-run. Upserts org/restaurants/terminals/categories/products/prices by
 * externalId; employees are only created once per `code` (re-running never overwrites a live PIN).
 */
export const seedAll = internalMutation({
  args: {
    organization: v.object({ externalId: v.string(), name: v.string(), currency: v.string(), timezone: v.string() }),
    restaurants: v.array(v.object({ externalId: v.string(), organizationExternalId: v.string(), name: v.string(), address: v.string(), city: v.string(), timezone: v.string() })),
    terminals: v.array(v.object({ externalId: v.string(), restaurantExternalId: v.string(), name: v.string(), terminalNumber: v.number() })),
    categories: v.array(v.object({ externalId: v.string(), label: v.string(), shortLabel: v.string(), sortOrder: v.number() })),
    products: v.array(
      v.object({
        externalId: v.string(),
        name: v.string(),
        nameKk: v.string(),
        description: v.string(),
        category: v.string(),
        categorySort: v.number(),
        basePrice: v.number(),
        sku: v.string(),
        popular: v.boolean(),
      }),
    ),
    prices: v.array(v.object({ productExternalId: v.string(), restaurantExternalId: v.string(), priceKzt: v.number() })),
    employees: v.array(
      v.object({
        code: v.string(),
        displayName: v.string(),
        role: employeeRole,
        restaurantExternalIds: v.array(v.string()),
        pinSalt: v.string(),
        pinHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await upsertByExternalId(ctx, "organizations", { externalId: args.organization.externalId, name: args.organization.name, currency: args.organization.currency, timezone: args.organization.timezone, active: true })

    const restaurantIds = new Map<string, any>()
    for (const restaurant of args.restaurants) {
      const id = await upsertByExternalId(ctx, "restaurants", { ...restaurant, active: true })
      restaurantIds.set(restaurant.externalId, id)
    }

    for (const terminal of args.terminals) {
      const restaurantId = restaurantIds.get(terminal.restaurantExternalId)
      if (!restaurantId) throw new ConvexError(`Unknown restaurant for terminal ${terminal.externalId}`)
      const existing = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", terminal.externalId)).unique()
      const value = { externalId: terminal.externalId, restaurantId, name: terminal.name, terminalNumber: terminal.terminalNumber, nextOrderNumber: existing?.nextOrderNumber ?? 1, active: true }
      if (existing) await ctx.db.patch(existing._id, value)
      else await ctx.db.insert("posTerminals", value)
    }

    for (const category of args.categories) {
      await upsertByExternalId(ctx, "categories", { ...category, active: true })
    }

    const productIds = new Map<string, any>()
    for (const product of args.products) {
      const id = await upsertByExternalId(ctx, "products", {
        externalId: product.externalId,
        name: product.name,
        nameKk: product.nameKk,
        nameSort: product.name,
        searchText: `${product.name} ${product.nameKk}`.toLocaleLowerCase("ru"),
        description: product.description,
        category: product.category,
        categorySort: product.categorySort,
        basePrice: product.basePrice,
        popular: product.popular,
        sku: product.sku,
        baseUnit: "порц." as const,
        enabled: true,
      })
      productIds.set(product.externalId, id)
    }

    for (const price of args.prices) {
      const productId = productIds.get(price.productExternalId)
      if (!productId) continue
      const existing = await ctx.db
        .query("productPrices")
        .withIndex("by_product_restaurant", (q) => q.eq("productId", productId).eq("restaurantExternalId", price.restaurantExternalId))
        .unique()
      if (existing) await ctx.db.patch(existing._id, { priceKzt: price.priceKzt })
      else await ctx.db.insert("productPrices", { productId, restaurantExternalId: price.restaurantExternalId, priceKzt: price.priceKzt })
    }

    const createdEmployees: Array<{ code: string; created: boolean }> = []
    for (const employee of args.employees) {
      const existing = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", employee.code)).unique()
      if (existing) {
        createdEmployees.push({ code: employee.code, created: false })
        continue
      }
      const restaurantIdsForEmployee = employee.restaurantExternalIds.map((externalId) => restaurantIds.get(externalId)).filter((id): id is NonNullable<typeof id> => Boolean(id))
      await ctx.db.insert("employees", {
        code: employee.code,
        displayName: employee.displayName,
        role: employee.role,
        restaurantIds: restaurantIdsForEmployee,
        pinSalt: employee.pinSalt,
        pinHash: employee.pinHash,
        active: true,
        failedAttempts: 0,
      })
      createdEmployees.push({ code: employee.code, created: true })
    }

    return {
      organization: args.organization.externalId,
      restaurants: args.restaurants.length,
      terminals: args.terminals.length,
      categories: args.categories.length,
      products: args.products.length,
      prices: args.prices.length,
      employees: createdEmployees,
    }
  },
})
