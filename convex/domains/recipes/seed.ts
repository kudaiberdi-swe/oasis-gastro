import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"

// Recipe import from the technologist's CSV (W1-RCP-04): scripts/import-recipes.mjs parses the file and
// calls this. Every product gets a new *draft* version — the technologist checks and activates it in the
// office, so an import never changes what sales write off by itself. Unmatched names are reported.

const row = v.object({
  product: v.string(), // product externalId, SKU or exact name
  ingredient: v.string(), // inventory item externalId or exact name; a preparation by product externalId / name
  unit: v.union(v.literal("кг"), v.literal("л"), v.literal("шт")),
  quantity: v.number(),
  unitWeightKg: v.optional(v.number()),
  coldLossPercent: v.optional(v.number()),
  hotLossPercent: v.optional(v.number()),
  batchYield: v.optional(v.number()),
})

const norm = (value: string) => value.trim().toLocaleLowerCase("ru")

async function findProduct(ctx: MutationCtx, key: string, byName: Map<string, Doc<"products">>) {
  const byId = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", key.trim())).unique()
  return byId ?? byName.get(norm(key)) ?? null
}

export const importRecipesFromCsv = internalMutation({
  args: { rows: v.array(row), effectiveFrom: v.number(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const products = new Map<string, Doc<"products">>()
    for await (const product of ctx.db.query("products").withIndex("by_enabled_and_name")) {
      products.set(norm(product.name), product)
      if (product.sku) products.set(norm(product.sku), product)
    }
    const items = new Map<string, Doc<"inventoryItems">>()
    for await (const item of ctx.db.query("inventoryItems").withIndex("by_active_and_name")) {
      items.set(norm(item.name), item)
      items.set(norm(item.externalId), item)
    }
    const groups = new Map<string, { product: Doc<"products">; rows: typeof args.rows }>()
    const unmatchedProducts = new Set<string>()
    const unmatchedIngredients = new Set<string>()
    const invalid: string[] = []
    for (const [index, input] of args.rows.entries()) {
      if (!(input.quantity > 0) || (input.unit !== "кг" && !(input.unitWeightKg && input.unitWeightKg > 0))) {
        invalid.push(`строка ${index + 1}: количество или вес единицы`)
        continue
      }
      const product = await findProduct(ctx, input.product, products)
      if (!product) {
        unmatchedProducts.add(input.product)
        continue
      }
      const group = groups.get(product.externalId) ?? { product, rows: [] }
      group.rows.push(input)
      groups.set(product.externalId, group)
    }
    let draftsCreated = 0
    let linesCreated = 0
    for (const { product, rows } of groups.values()) {
      const lines = []
      for (const [index, input] of rows.entries()) {
        const item = items.get(norm(input.ingredient))
        const component = item ? null : await findProduct(ctx, input.ingredient, products)
        if (!item && (!component || component.itemType !== "preparation" || component._id === product._id)) {
          unmatchedIngredients.add(`${product.name}: ${input.ingredient}`)
          continue
        }
        lines.push({ index, input, item, component })
      }
      if (!lines.length) continue
      draftsCreated += 1
      linesCreated += lines.length
      if (args.dryRun) continue
      let recipe = await ctx.db.query("recipes").withIndex("by_product", (q) => q.eq("productId", product._id)).unique()
      if (!recipe) recipe = (await ctx.db.get(await ctx.db.insert("recipes", { productId: product._id, createdAt: Date.now() })))!
      const last = await ctx.db.query("recipeVersions").withIndex("by_recipe_version", (q) => q.eq("recipeId", recipe._id)).order("desc").first()
      const versionId = await ctx.db.insert("recipeVersions", { recipeId: recipe._id, productId: product._id, version: (last?.version ?? 0) + 1, effectiveFrom: args.effectiveFrom, batchYield: rows[0].batchYield ?? 1, technology: "Импорт из CSV технолога", status: "draft", createdBy: "import", createdAt: Date.now() })
      for (const { index, input, item, component } of lines) {
        await ctx.db.insert("recipeLines", {
          versionId,
          kind: item ? "item" : "preparation",
          ...(item ? { inventoryItemId: item._id } : { componentProductId: component!._id }),
          name: item?.name ?? component!.name,
          unit: input.unit,
          quantity: input.quantity,
          unitWeightKg: input.unit === "кг" ? 1 : input.unitWeightKg!,
          coldLossPercent: Math.min(99, Math.max(0, input.coldLossPercent ?? 0)),
          hotLossPercent: Math.min(99, Math.max(0, input.hotLossPercent ?? 0)),
          sortOrder: index,
        })
      }
    }
    return { rows: args.rows.length, products: groups.size, draftsCreated, linesCreated, unmatchedProducts: [...unmatchedProducts], unmatchedIngredients: [...unmatchedIngredients], invalid, dryRun: args.dryRun ?? false }
  },
})
