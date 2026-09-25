import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { recipeVersionAt } from "../../lib/recipes"

// Preparations as products (W2-PRD-01): a product with itemType "preparation" and its own stock item.
// A preparation made by production acts is written off as a finished product — never by its recipe too.

export const listPreparations = query({
  args: { search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.production.view")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const page = await ctx.db.query("products").withIndex("by_enabled_and_name").filter((q) => q.eq(q.field("itemType"), "preparation")).paginate(args.paginationOpts)
    const rows = []
    for (const product of page.page) {
      if (needle && !product.searchText.includes(needle)) continue
      const item = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
      const balances = item ? await ctx.db.query("stockBalances").withIndex("by_item", (q) => q.eq("inventoryItemId", item._id)).take(50) : []
      const version = await recipeVersionAt(ctx, product._id, Date.now())
      rows.push({ productExternalId: product.externalId, name: product.name, writeOffMethod: product.writeOffMethod ?? "ingredients", inventoryItemExternalId: item?.externalId ?? null, unit: item?.unit ?? null, onHand: balances.reduce((sum, row) => sum + row.quantity, 0), recipeVersion: version ? { version: version.version, batchYield: version.batchYield, status: version.status } : null })
    }
    return { ...page, page: rows }
  },
})

/** Marks a product as a preparation and gives it a stock item (created once). */
export const savePreparation = mutation({
  args: { productExternalId: v.string(), unit: v.union(v.literal("кг"), v.literal("л"), v.literal("шт")), writeOffMethod: v.union(v.literal("finished-product"), v.literal("ingredients")) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.production.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.productExternalId)).unique()
    if (!product) throw new ConvexError("Позиция не найдена")
    await ctx.db.patch(product._id, { itemType: "preparation", writeOffMethod: args.writeOffMethod })
    let item = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
    if (!item) {
      const id = await ctx.db.insert("inventoryItems", { externalId: `prep-${product.externalId}`, name: product.name, nameSort: product.nameSort, searchText: product.searchText, unit: args.unit, kind: "preparation", active: true, productExternalId: product.externalId })
      item = (await ctx.db.get(id))!
    } else if (item.kind !== "preparation") await ctx.db.patch(item._id, { kind: "preparation" })
    await writeOfficeAudit(ctx, email, { action: "production.preparation", summary: `Заготовка «${product.name}»: ${args.writeOffMethod === "finished-product" ? "списывается готовым продуктом" : "списывается по составу"}`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.production.edit" })
    return item.externalId
  },
})
