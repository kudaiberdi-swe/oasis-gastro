import { v } from "convex/values"

import { query } from "../../_generated/server"
import { requireOfficeCapability, restaurantScopeFilter } from "../../lib/officeAccess"
import { resolvePrice } from "../../lib/pricing"
import { foodCostPercent, recipeChecks } from "../../lib/recipeMath"
import { costRecipe, recipeVersionAt } from "../../lib/recipes"

async function productOf(ctx: Parameters<typeof recipeVersionAt>[0], externalId: string) {
  return ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
}

/** Recipe card (W1-RCP-01): the version in force at `at` (or a given version) with the full calculation. */
export const getRecipe = query({
  args: { productExternalId: v.string(), at: v.optional(v.number()), versionId: v.optional(v.id("recipeVersions")), restaurantExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.nomenclature.view")
    restaurantScopeFilter(user, args.restaurantExternalId)
    const product = await productOf(ctx, args.productExternalId)
    if (!product) return null
    const at = args.at ?? Date.now()
    const version = args.versionId ? await ctx.db.get(args.versionId) : await recipeVersionAt(ctx, product._id, at)
    if (!version || version.productId !== product._id) return { product: { externalId: product.externalId, name: product.name }, version: null }
    const costed = await costRecipe(ctx, version, at, args.restaurantExternalId)
    const price = args.restaurantExternalId ? (await resolvePrice(ctx, { product, restaurantExternalId: args.restaurantExternalId, at })).price : product.basePrice
    const checks = recipeChecks({
      lines: costed.lines.map((line) => ({ ...line, unitWeightKg: line.unit === "кг" ? 1 : line.unitWeightKg })),
      summary: costed.summary,
      batchYield: version.batchYield,
      effectiveFrom: version.effectiveFrom,
      firstSaleAt: product.firstSaleAt,
    })
    return {
      product: { externalId: product.externalId, name: product.name },
      version: { _id: version._id, version: version.version, status: version.status, effectiveFrom: version.effectiveFrom, batchYield: version.batchYield, technology: version.technology },
      lines: costed.lines.map((line, index) => ({ ...costed.summary.lines[index], name: line.name, kind: line.kind, inventoryItemId: line.inventoryItemId ?? null, componentProductId: line.componentProductId ?? null })),
      summary: { ...costed.summary, lines: undefined, price, foodCostPercent: foodCostPercent(costed.summary.costPerPortion, price) },
      checks,
    }
  },
})

export const listRecipeVersions = query({
  args: { productExternalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.view")
    const product = await productOf(ctx, args.productExternalId)
    if (!product) return []
    const versions = await ctx.db.query("recipeVersions").withIndex("by_product_effective", (q) => q.eq("productId", product._id)).order("desc").take(50)
    return versions.map((version) => ({ _id: version._id, version: version.version, status: version.status, effectiveFrom: version.effectiveFrom, batchYield: version.batchYield, createdBy: version.createdBy, createdAt: version.createdAt }))
  },
})
