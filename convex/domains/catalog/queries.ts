import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import type { QueryCtx } from "../../_generated/server"
import { query } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import type { PosProduct } from "./types"

export async function resolveProductPrice(ctx: QueryCtx, product: Doc<"products">, restaurantExternalId: string): Promise<number> {
  const override = await ctx.db
    .query("productPrices")
    .withIndex("by_product_restaurant", (q) => q.eq("productId", product._id).eq("restaurantExternalId", restaurantExternalId))
    .unique()
  return override?.priceKzt ?? product.basePrice
}

async function withResolvedPrice(ctx: QueryCtx, product: Doc<"products">, restaurantExternalId: string): Promise<PosProduct> {
  const { basePrice: _basePrice, ...rest } = product
  return { ...rest, price: await resolveProductPrice(ctx, product, restaurantExternalId) }
}

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db.query("categories").withIndex("by_sort_order").collect()
    return categories.filter((category) => category.active !== false)
  },
})

export const listProducts = query({
  args: {
    restaurantExternalId: v.string(),
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
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

    const items = await Promise.all(page.page.map((product) => withResolvedPrice(ctx, product, args.restaurantExternalId)))
    return { ...page, page: items }
  },
})

export const getProduct = query({
  args: { productId: v.id("products"), restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId)
    if (!product) return null
    return withResolvedPrice(ctx, product, args.restaurantExternalId)
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
