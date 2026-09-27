import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import type { QueryCtx } from "../../_generated/server"
import { query } from "../../_generated/server"
import { isAvailable } from "../../lib/availability"
import type { Doc, Id } from "../../_generated/dataModel"
import { requireOperator } from "../../lib/auth"
import { resolvePrice, resolvePrices } from "../../lib/pricing"
import { requireOfficeCapability } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"
import type { PosProduct } from "./types"

export async function resolveProductPrice(ctx: QueryCtx, product: Doc<"products">, restaurantExternalId: string): Promise<number> {
  return (await resolvePrice(ctx, { product, restaurantExternalId, at: Date.now() })).price
}

async function withResolvedPrice(ctx: QueryCtx, product: Doc<"products">, restaurantExternalId: string): Promise<PosProduct> {
  const { basePrice: _basePrice, ...rest } = product
  const imageUrl = product.imageStorageId ? ((await ctx.storage.getUrl(product.imageStorageId)) ?? undefined) : product.imagePath
  return { ...rest, price: await resolveProductPrice(ctx, product, restaurantExternalId), available: await isAvailable(ctx, product._id, restaurantExternalId, Date.now()), ...(imageUrl ? { imageUrl } : {}) }
}

/**
 * The dish as the POS sells it at this branch, or null when the branch has no price of its own — then the dish
 * is not on the branch's menu (an iiko dish priced only elsewhere, a PDF dish of another city) and the POS
 * leaves it out instead of selling it at the base price.
 */
async function onBranchMenu(ctx: QueryCtx, product: Doc<"products">, restaurantExternalId: string): Promise<PosProduct | null> {
  const at = Date.now()
  const resolved = await resolvePrice(ctx, { product, restaurantExternalId, at })
  // A 0 ₸ branch price is an iiko service position (compliment, staff meal) — not a dish for guests.
  if (resolved.source === "base" || resolved.price <= 0) return null
  const { basePrice: _basePrice, ...rest } = product
  const imageUrl = product.imageStorageId ? ((await ctx.storage.getUrl(product.imageStorageId)) ?? undefined) : product.imagePath
  return { ...rest, price: resolved.price, available: await isAvailable(ctx, product._id, restaurantExternalId, at), ...(imageUrl ? { imageUrl } : {}) }
}

export const listCategories = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const restaurantExternalId = access.restaurant.externalId
    const at = Date.now()
    const categories = await ctx.db.query("categories").withIndex("by_sort_order").collect()
    // iiko brings every product group (dishware, semi-finished goods, other brands) as a category; the POS
    // shows only the ones with a dish on this branch's menu (enabled and priced here).
    const withDishes = await Promise.all(
      categories
        .filter((category) => category.active !== false)
        .map(async (category) => {
          const dishes = await ctx.db
            .query("products")
            .withIndex("by_enabled_and_category_and_name", (q) => q.eq("enabled", true).eq("category", category.externalId))
            .take(50)
          if (!dishes.length) return null
          const prices = await resolvePrices(ctx, dishes, restaurantExternalId, at)
          return prices.some((price) => price.source !== "base" && price.price > 0) ? category : null
        }),
    )
    return withDishes.filter((category) => category !== null)
  },
})

// POS catalog: the restaurant (and so the per-branch price) always comes from the operator's session.
export const listProducts = query({
  args: {
    sessionToken: v.string(),
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const restaurantExternalId = access.restaurant.externalId
    const page = args.search
      ? await ctx.db
          .query("products")
          .withSearchIndex("search_products", (q) => {
            let builder = q.search("searchText", args.search!).eq("enabled", true)
            if (args.category) builder = builder.eq("category", args.category)
            return builder
          })
          .paginate(args.paginationOpts)
      : args.category
        ? await ctx.db
            .query("products")
            .withIndex("by_enabled_and_category_and_name", (q) => q.eq("enabled", true).eq("category", args.category!))
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("products")
            .withIndex("by_enabled_and_name", (q) => q.eq("enabled", true))
            .paginate(args.paginationOpts)

    // Dishes off this branch's menu are left out (a page may come back shorter; the cursor goes on).
    const items = (await Promise.all(page.page.map((product) => onBranchMenu(ctx, product, restaurantExternalId)))).filter((item): item is PosProduct => item !== null)
    return { ...page, page: items }
  },
})

/** Scanner input → one code: spaces dropped, at most 64 characters (EAN-13, UPC, Code 128 in-house codes). */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\s+/g, "").slice(0, 64)
}

/**
 * The dish or good behind a scanned barcode (W3-POS-01), priced for the session's restaurant; null when
 * no product carries the code or it is not on sale. A stop-listed one comes back with `available: false`.
 */
export const findByBarcode = query({
  args: { sessionToken: v.string(), barcode: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const barcode = normalizeBarcode(args.barcode)
    if (!barcode) return null
    // A code is unique per product when saved in the office; `first` tolerates a duplicate from an import.
    const product = await ctx.db.query("products").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).first()
    if (!product?.enabled) return null
    return onBranchMenu(ctx, product, access.restaurant.externalId)
  },
})

export const getProduct = query({
  args: { sessionToken: v.string(), productId: v.id("products") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const product = await ctx.db.get(args.productId)
    if (!product) return null
    return withResolvedPrice(ctx, product, access.restaurant.externalId)
  },
})

/** Office catalog management — every category/product regardless of `active`/`enabled`, with per-branch prices attached. */
export const listAllForOffice = query({
  args: {},
  handler: async (ctx) => {
    await requireOfficeCapability(ctx, "office.nomenclature.view")
    const [categories, products, prices, restaurants] = await Promise.all([
      ctx.db.query("categories").withIndex("by_sort_order").collect(),
      ctx.db.query("products").collect(),
      ctx.db.query("productPrices").collect(),
      listOperationalRestaurants(ctx),
    ])
    const pricesByProduct = new Map<Id<"products">, { restaurantExternalId: string; priceKzt: number }[]>()
    for (const price of prices) {
      const list = pricesByProduct.get(price.productId) ?? []
      list.push({ restaurantExternalId: price.restaurantExternalId, priceKzt: price.priceKzt })
      pricesByProduct.set(price.productId, list)
    }
    return {
      categories,
      restaurants,
      products: products.map((product) => ({ ...product, prices: pricesByProduct.get(product._id) ?? [] })),
    }
  },
})

/** Batch price resolution for order lines — avoids N+1 lookups when hydrating a whole order. */
export async function resolveProductPrices(
  ctx: QueryCtx,
  productIds: Id<"products">[],
  restaurantExternalId: string,
): Promise<Map<Id<"products">, PosProduct>> {
  const result = new Map<Id<"products">, PosProduct>()
  for (const productId of new Set(productIds)) {
    const product = await ctx.db.get(productId)
    if (product) result.set(productId, await withResolvedPrice(ctx, product, restaurantExternalId))
  }
  return result
}
