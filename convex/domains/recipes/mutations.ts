import { ConvexError, v } from "convex/values"

import { mutation } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { assertPeriodOpen } from "../../lib/periods"
import { listOperationalRestaurants } from "../../lib/restaurants"
import { assertNoPreparationCycle } from "../../lib/recipes"
import { businessDateFor } from "../../lib/time"

const lineInput = v.object({
  kind: v.union(v.literal("item"), v.literal("preparation")),
  inventoryItemExternalId: v.optional(v.string()),
  componentProductExternalId: v.optional(v.string()),
  unit: v.union(v.literal("кг"), v.literal("л"), v.literal("шт")),
  quantity: v.number(),
  unitWeightKg: v.number(),
  coldLossPercent: v.number(),
  hotLossPercent: v.number(),
})

export const saveRecipeDraft = mutation({
  args: { productExternalId: v.string(), versionId: v.optional(v.id("recipeVersions")), batchYield: v.number(), effectiveFrom: v.number(), technology: v.string(), lines: v.array(lineInput) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", args.productExternalId)).unique()
    if (!product) throw new ConvexError("Блюдо не найдено")
    if (!(args.batchYield > 0)) throw new ConvexError("Норма закладки должна быть больше нуля")
    if (args.lines.length === 0) throw new ConvexError("Добавьте хотя бы один ингредиент")

    const resolved = []
    const components: Id<"products">[] = []
    for (const [index, line] of args.lines.entries()) {
      if (!(line.quantity > 0)) throw new ConvexError("Количество ингредиента должно быть больше нуля")
      if (line.coldLossPercent < 0 || line.coldLossPercent > 99 || line.hotLossPercent < 0 || line.hotLossPercent > 99) throw new ConvexError("Потери — от 0 до 99 %")
      if (line.unit !== "кг" && !(line.unitWeightKg > 0)) throw new ConvexError("Для л и шт укажите вес одной единицы")
      if (line.kind === "item") {
        if (!line.inventoryItemExternalId) throw new ConvexError("Выберите складскую позицию")
        const item = await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.inventoryItemExternalId!)).unique()
        if (!item) throw new ConvexError("Складская позиция не найдена")
        resolved.push({ kind: "item" as const, inventoryItemId: item._id, name: item.name, line, index })
      } else {
        if (!line.componentProductExternalId) throw new ConvexError("Выберите заготовку")
        const component = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.componentProductExternalId!)).unique()
        if (!component) throw new ConvexError("Заготовка не найдена")
        if (component._id === product._id) throw new ConvexError("Заготовка не может содержать само блюдо")
        components.push(component._id)
        resolved.push({ kind: "preparation" as const, componentProductId: component._id, name: component.name, line, index })
      }
    }
    await assertNoPreparationCycle(ctx, product._id, components, args.effectiveFrom)

    let recipe = await ctx.db.query("recipes").withIndex("by_product", (q) => q.eq("productId", product._id)).unique()
    if (!recipe) recipe = (await ctx.db.get(await ctx.db.insert("recipes", { productId: product._id, createdAt: Date.now() })))!
    let versionId = args.versionId
    if (versionId) {
      const version = await ctx.db.get(versionId)
      if (!version || version.productId !== product._id) throw new ConvexError("Версия не найдена")
      if (version.status !== "draft") throw new ConvexError("Изменить можно только черновик версии — создайте новую")
      await ctx.db.patch(versionId, { batchYield: args.batchYield, effectiveFrom: args.effectiveFrom, technology: args.technology.trim() })
      for (const line of await ctx.db.query("recipeLines").withIndex("by_version", (q) => q.eq("versionId", versionId!)).take(100)) await ctx.db.delete(line._id)
    } else {
      const last = await ctx.db.query("recipeVersions").withIndex("by_recipe_version", (q) => q.eq("recipeId", recipe!._id)).order("desc").first()
      versionId = await ctx.db.insert("recipeVersions", {
        recipeId: recipe._id,
        productId: product._id,
        version: (last?.version ?? 0) + 1,
        effectiveFrom: args.effectiveFrom,
        batchYield: args.batchYield,
        technology: args.technology.trim(),
        status: "draft",
        createdBy: email,
        createdAt: Date.now(),
      })
    }
    for (const row of resolved) {
      await ctx.db.insert("recipeLines", {
        versionId,
        kind: row.kind,
        ...(row.kind === "item" ? { inventoryItemId: row.inventoryItemId } : { componentProductId: row.componentProductId }),
        name: row.name,
        unit: row.line.unit,
        quantity: row.line.quantity,
        unitWeightKg: row.line.unit === "кг" ? 1 : row.line.unitWeightKg,
        coldLossPercent: row.line.coldLossPercent,
        hotLossPercent: row.line.hotLossPercent,
        sortOrder: row.index,
      })
    }
    await writeOfficeAudit(ctx, email, { action: "recipe.save", summary: `Техкарта «${product.name}»: ${resolved.length} ингредиентов`, resourceType: "recipe", resourceExternalId: product.externalId, capability: "office.nomenclature.edit" })
    return versionId
  },
})

/** Makes a draft version live; the one in force before it is superseded (history stays for past sales). */
export const activateRecipeVersion = mutation({
  args: { versionId: v.id("recipeVersions") },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const version = await ctx.db.get(args.versionId)
    if (!version) throw new ConvexError("Версия не найдена")
    if (version.status !== "draft") throw new ConvexError("Активировать можно только черновик версии")
    const product = (await ctx.db.get(version.productId))!
    const line = await ctx.db.query("recipeLines").withIndex("by_version", (q) => q.eq("versionId", version._id)).first()
    if (!line) throw new ConvexError("В версии нет ингредиентов")
    // Sales on and after effectiveFrom will use this version, so that date must still be open.
    const organizations = new Set((await listOperationalRestaurants(ctx)).map((restaurant) => restaurant.organizationExternalId))
    for (const organizationExternalId of organizations) await assertPeriodOpen(ctx, { organizationExternalId, businessDate: businessDateFor(version.effectiveFrom), moduleId: "nomenclature" })

    const recipe = (await ctx.db.get(version.recipeId))!
    const active = await ctx.db.query("recipeVersions").withIndex("by_product_status_effective", (q) => q.eq("productId", version.productId).eq("status", "active")).take(10)
    for (const previous of active) await ctx.db.patch(previous._id, { status: "superseded" })
    await ctx.db.patch(version._id, { status: "active" })
    await ctx.db.patch(recipe._id, { activeVersionId: version._id })
    await writeOfficeAudit(ctx, email, { action: "recipe.activate", summary: `Техкарта «${product.name}» v${version.version} с ${businessDateFor(version.effectiveFrom)}`, resourceType: "recipe", resourceExternalId: product.externalId, capability: "office.nomenclature.post" })
    return { warning: product.firstSaleAt !== undefined && version.effectiveFrom > product.firstSaleAt ? "Первая продажа была раньше начала действия техкарты — ранние продажи останутся без списания" : null }
  },
})
