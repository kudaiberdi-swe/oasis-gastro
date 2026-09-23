import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { unit } from "../../lib/validators"

function deriveNameSort(name: string, nameKk: string) {
  return { nameSort: name, searchText: `${name} ${nameKk}`.toLocaleLowerCase("ru") }
}

export const createCategory = mutation({
  args: { label: v.string(), shortLabel: v.string(), sortOrder: v.number() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.catalog.*")
    const email = await getOfficeAuthEmail(ctx)
    const externalId = crypto.randomUUID()
    const categoryId = await ctx.db.insert("categories", { externalId, label: args.label, shortLabel: args.shortLabel, sortOrder: args.sortOrder, active: true })
    await writeOfficeAudit(ctx, email!, { action: "catalog.category.create", summary: `Создана категория «${args.label}»`, resourceType: "category", resourceExternalId: externalId })
    return categoryId
  },
})

export const updateCategory = mutation({
  args: { categoryId: v.id("categories"), label: v.string(), shortLabel: v.string(), sortOrder: v.number(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.catalog.*")
    const email = await getOfficeAuthEmail(ctx)
    const category = await ctx.db.get(args.categoryId)
    if (!category) throw new Error("Категория не найдена")
    await ctx.db.patch(args.categoryId, { label: args.label, shortLabel: args.shortLabel, sortOrder: args.sortOrder, active: args.active })
    await writeOfficeAudit(ctx, email!, { action: "catalog.category.update", summary: `Изменена категория «${args.label}»`, resourceType: "category", resourceExternalId: category.externalId })
  },
})

export const createProduct = mutation({
  args: {
    name: v.string(),
    nameKk: v.string(),
    description: v.string(),
    category: v.string(),
    categorySort: v.number(),
    basePrice: v.number(),
    sku: v.string(),
    popular: v.boolean(),
    badge: v.optional(v.string()),
    baseUnit: unit,
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.catalog.*")
    const email = await getOfficeAuthEmail(ctx)
    const externalId = crypto.randomUUID()
    const productId = await ctx.db.insert("products", {
      externalId,
      ...args,
      ...deriveNameSort(args.name, args.nameKk),
      enabled: true,
    })
    await writeOfficeAudit(ctx, email!, { action: "catalog.product.create", summary: `Создано блюдо «${args.name}»`, resourceType: "product", resourceExternalId: externalId })
    return productId
  },
})

export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    name: v.string(),
    nameKk: v.string(),
    description: v.string(),
    category: v.string(),
    categorySort: v.number(),
    basePrice: v.number(),
    sku: v.string(),
    popular: v.boolean(),
    badge: v.optional(v.string()),
    baseUnit: unit,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.catalog.*")
    const email = await getOfficeAuthEmail(ctx)
    const { productId, ...rest } = args
    const product = await ctx.db.get(productId)
    if (!product) throw new Error("Блюдо не найдено")
    await ctx.db.patch(productId, { ...rest, ...deriveNameSort(rest.name, rest.nameKk) })
    await writeOfficeAudit(ctx, email!, { action: "catalog.product.update", summary: `Изменено блюдо «${rest.name}»`, resourceType: "product", resourceExternalId: product.externalId })
  },
})

export const setProductPrice = mutation({
  args: { productId: v.id("products"), restaurantExternalId: v.string(), priceKzt: v.number() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.catalog.*")
    const email = await getOfficeAuthEmail(ctx)
    const product = await ctx.db.get(args.productId)
    if (!product) throw new Error("Блюдо не найдено")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new Error("Ресторан не найден")
    if (!user.restaurantScopes.includes("*") && !user.restaurantScopes.includes(args.restaurantExternalId)) throw new Error("Нет доступа к ресторану")

    const existing = await ctx.db
      .query("productPrices")
      .withIndex("by_product_restaurant", (q) => q.eq("productId", args.productId).eq("restaurantExternalId", args.restaurantExternalId))
      .unique()
    if (existing) await ctx.db.patch(existing._id, { priceKzt: args.priceKzt })
    else await ctx.db.insert("productPrices", { productId: args.productId, restaurantExternalId: args.restaurantExternalId, priceKzt: args.priceKzt })

    await writeOfficeAudit(ctx, email!, {
      action: "catalog.price.set",
      summary: `Цена «${product.name}» в ${restaurant.name}: ${args.priceKzt} ₸`,
      resourceType: "product-price",
      resourceExternalId: `${product.externalId}:${args.restaurantExternalId}`,
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})
