import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"
import { unit } from "../../lib/validators"

function searchText(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(" ").toLocaleLowerCase("ru")
}

async function requireGroup(ctx: MutationCtx, externalId: string) {
  const group = await ctx.db.query("modifierGroups").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!group) throw new ConvexError("Группа модификаторов не найдена")
  return group
}

async function requireProduct(ctx: MutationCtx, externalId: string) {
  const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!product) throw new ConvexError("Блюдо не найдено")
  return product
}

export const saveGroup = mutation({
  args: { externalId: v.optional(v.string()), name: v.string(), nameKk: v.optional(v.string()), sortOrder: v.number(), active: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название группы")
    const value = { name, nameKk: args.nameKk?.trim() || undefined, nameSort: name.toLocaleLowerCase("ru"), searchText: searchText(name, args.nameKk), sortOrder: args.sortOrder, active: args.active ?? true }
    let externalId = args.externalId
    if (externalId) await ctx.db.patch((await requireGroup(ctx, externalId))._id, value)
    else {
      externalId = `modifier-group-${crypto.randomUUID()}`
      await ctx.db.insert("modifierGroups", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: "modifier-group.save", summary: `Группа модификаторов «${name}»`, resourceType: "modifier-group", resourceExternalId: externalId, capability: "office.modifiers.edit" })
    return externalId
  },
})

export const save = mutation({
  args: {
    externalId: v.optional(v.string()),
    groupExternalId: v.string(),
    name: v.string(),
    nameKk: v.optional(v.string()),
    price: v.number(),
    ingredientInventoryItemExternalId: v.optional(v.string()),
    ingredientQuantity: v.number(),
    unit,
    available: v.boolean(),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название модификатора")
    if (!Number.isInteger(args.price) || args.price < 0) throw new ConvexError("Цена — целое неотрицательное число тенге")
    if (!(args.ingredientQuantity >= 0)) throw new ConvexError("Количество ингредиента не может быть отрицательным")
    const group = await requireGroup(ctx, args.groupExternalId)
    const ingredient = args.ingredientInventoryItemExternalId
      ? await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", args.ingredientInventoryItemExternalId!)).unique()
      : null
    if (args.ingredientInventoryItemExternalId && !ingredient) throw new ConvexError("Складская позиция не найдена")
    const value = {
      groupId: group._id,
      name,
      nameKk: args.nameKk?.trim() || undefined,
      nameSort: name.toLocaleLowerCase("ru"),
      searchText: searchText(name, args.nameKk, ingredient?.name),
      price: args.price,
      ingredientInventoryItemId: ingredient?._id,
      ingredientName: ingredient?.name ?? name,
      ingredientQuantity: args.ingredientQuantity,
      unit: args.unit,
      available: args.available,
      sortOrder: args.sortOrder ?? 100,
    }
    let externalId = args.externalId
    if (externalId) {
      const existing = await ctx.db.query("modifiers").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing) throw new ConvexError("Модификатор не найден")
      await ctx.db.patch(existing._id, value)
    } else {
      externalId = `modifier-${crypto.randomUUID()}`
      await ctx.db.insert("modifiers", { externalId, ...value })
    }
    await writeOfficeAudit(ctx, email, { action: "modifier.save", summary: `Модификатор «${name}», ${args.price} ₸`, resourceType: "modifier", resourceExternalId: externalId, capability: "office.modifiers.edit" })
    return externalId
  },
})

export const assignGroup = mutation({
  args: { productExternalId: v.string(), groupExternalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const [product, group] = await Promise.all([requireProduct(ctx, args.productExternalId), requireGroup(ctx, args.groupExternalId)])
    const existing = await ctx.db.query("productModifierGroups").withIndex("by_product_group", (q) => q.eq("productId", product._id).eq("groupId", group._id)).unique()
    if (existing) return
    const count = (await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)).length
    if (count >= 20) throw new ConvexError("У блюда не больше 20 групп модификаторов")
    await ctx.db.insert("productModifierGroups", { productId: product._id, groupId: group._id, required: false, minQuantity: 0, maxQuantity: 10, freeQuantity: 0, enforceItemLimits: true, sortOrder: count })
    await ctx.db.patch(product._id, { customizable: true })
    await writeOfficeAudit(ctx, email, { action: "modifier.assign", summary: `«${group.name}» → «${product.name}»`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.modifiers.edit" })
  },
})

export const unassignGroup = mutation({
  args: { productExternalId: v.string(), groupExternalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const [product, group] = await Promise.all([requireProduct(ctx, args.productExternalId), requireGroup(ctx, args.groupExternalId)])
    const assignment = await ctx.db.query("productModifierGroups").withIndex("by_product_group", (q) => q.eq("productId", product._id).eq("groupId", group._id)).unique()
    if (!assignment) return
    for (const rule of await ctx.db.query("productModifierRules").withIndex("by_assignment_sort", (q) => q.eq("productModifierGroupId", assignment._id)).take(50)) await ctx.db.delete(rule._id)
    await ctx.db.delete(assignment._id)
    const remaining = await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).first()
    if (!remaining) await ctx.db.patch(product._id, { customizable: false })
    await writeOfficeAudit(ctx, email, { action: "modifier.unassign", summary: `«${group.name}» снята с «${product.name}»`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.modifiers.edit" })
  },
})

export const saveProductRules = mutation({
  args: {
    productExternalId: v.string(),
    groupExternalId: v.string(),
    required: v.boolean(),
    minQuantity: v.number(),
    maxQuantity: v.number(),
    freeQuantity: v.number(),
    enforceItemLimits: v.boolean(),
    rules: v.array(v.object({ modifierExternalId: v.string(), minQuantity: v.number(), maxQuantity: v.number(), defaultQuantity: v.number(), freeQuantity: v.number(), sortOrder: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.modifiers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const whole = (value: number) => Number.isInteger(value) && value >= 0 && value <= 99
    if (![args.minQuantity, args.maxQuantity, args.freeQuantity].every(whole) || args.minQuantity > args.maxQuantity) throw new ConvexError("Лимиты группы: 0 ≤ минимум ≤ максимум ≤ 99")
    if (args.freeQuantity > args.maxQuantity) throw new ConvexError("Бесплатных порций группы не больше максимума")
    const [product, group] = await Promise.all([requireProduct(ctx, args.productExternalId), requireGroup(ctx, args.groupExternalId)])
    const assignment = await ctx.db.query("productModifierGroups").withIndex("by_product_group", (q) => q.eq("productId", product._id).eq("groupId", group._id)).unique()
    if (!assignment) throw new ConvexError("Группа не назначена блюду")
    const seen = new Set<string>()
    const resolved = []
    for (const rule of args.rules) {
      if (seen.has(rule.modifierExternalId)) throw new ConvexError("Модификатор указан дважды")
      seen.add(rule.modifierExternalId)
      if (![rule.minQuantity, rule.maxQuantity, rule.defaultQuantity, rule.freeQuantity].every(whole)) throw new ConvexError("Лимиты — целые числа от 0 до 99")
      if (!(rule.minQuantity <= rule.defaultQuantity && rule.defaultQuantity <= rule.maxQuantity)) throw new ConvexError("Нужно: минимум ≤ по умолчанию ≤ максимум")
      if (rule.freeQuantity > rule.maxQuantity) throw new ConvexError("Бесплатных порций не больше максимума")
      const modifier = await ctx.db.query("modifiers").withIndex("by_external_id", (q) => q.eq("externalId", rule.modifierExternalId)).unique()
      if (!modifier || modifier.groupId !== group._id) throw new ConvexError("Модификатор не из этой группы")
      resolved.push({ ...rule, modifierId: modifier._id })
    }
    await ctx.db.patch(assignment._id, { required: args.required, minQuantity: args.minQuantity, maxQuantity: args.maxQuantity, freeQuantity: args.freeQuantity, enforceItemLimits: args.enforceItemLimits })
    for (const rule of await ctx.db.query("productModifierRules").withIndex("by_assignment_sort", (q) => q.eq("productModifierGroupId", assignment._id)).take(50)) await ctx.db.delete(rule._id)
    for (const rule of resolved) {
      await ctx.db.insert("productModifierRules", { productModifierGroupId: assignment._id, modifierId: rule.modifierId, minQuantity: rule.minQuantity, maxQuantity: rule.maxQuantity, defaultQuantity: rule.defaultQuantity, freeQuantity: rule.freeQuantity, sortOrder: rule.sortOrder })
    }
    await writeOfficeAudit(ctx, email, { action: "modifier.rules", summary: `Правила «${group.name}» для «${product.name}»: ${resolved.length}`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.modifiers.edit" })
  },
})
