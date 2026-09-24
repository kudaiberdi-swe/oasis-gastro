import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

const optionInput = v.object({
  externalId: v.optional(v.string()),
  label: v.string(),
  labelKk: v.optional(v.string()),
  kitchenLabel: v.string(),
  coefficient: v.number(),
  writeOffCoefficient: v.optional(v.number()),
  sortOrder: v.number(),
  isDefault: v.boolean(),
  available: v.boolean(),
})

/** A size still referenced by a price-order line or an unpaid order cannot be removed. */
async function assertOptionUnused(ctx: MutationCtx, option: Doc<"sizeOptions">) {
  const line = await ctx.db.query("priceOrderLines").withIndex("by_size_option", (q) => q.eq("sizeOptionId", option._id)).first()
  if (line) throw new ConvexError(`Размер «${option.label}» есть в приказе о ценах — его нельзя удалить, только отключить`)
}

async function productByExternalId(ctx: MutationCtx, externalId: string) {
  const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!product) throw new ConvexError("Блюдо не найдено")
  return product
}

export const save = mutation({
  args: { externalId: v.optional(v.string()), name: v.string(), options: v.array(optionInput), productExternalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.size-scales.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название шкалы")
    if (args.options.length === 0) throw new ConvexError("Добавьте хотя бы один размер")
    if (args.options.filter((option) => option.isDefault).length !== 1) throw new ConvexError("Отметьте ровно один размер по умолчанию")
    for (const option of args.options) {
      if (!option.label.trim() || !option.kitchenLabel.trim()) throw new ConvexError("У каждого размера нужны названия для кассы и кухни")
      if (!(option.coefficient > 0)) throw new ConvexError(`Коэффициент цены «${option.label}» должен быть больше нуля`)
      if (option.writeOffCoefficient !== undefined && !(option.writeOffCoefficient > 0)) throw new ConvexError(`Коэффициент списания «${option.label}» должен быть больше нуля`)
    }

    const existing = args.externalId ? await ctx.db.query("sizeScales").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Шкала не найдена")
    const scaleValue = { name, nameSort: name.toLocaleLowerCase("ru"), searchText: [name, ...args.options.map((option) => option.label)].join(" ").toLocaleLowerCase("ru"), sortOrder: existing?.sortOrder ?? 100 }
    let scaleId: Id<"sizeScales">
    let externalId: string
    if (existing) {
      await ctx.db.patch(existing._id, scaleValue)
      scaleId = existing._id
      externalId = existing.externalId
    } else {
      externalId = `scale-${crypto.randomUUID()}`
      scaleId = await ctx.db.insert("sizeScales", { externalId, ...scaleValue })
    }

    const current = await ctx.db.query("sizeOptions").withIndex("by_scale_sort", (q) => q.eq("scaleId", scaleId)).take(50)
    const kept = new Set(args.options.map((option) => option.externalId).filter(Boolean))
    for (const option of current) {
      if (kept.has(option.externalId)) continue
      await assertOptionUnused(ctx, option)
      await ctx.db.delete(option._id)
    }
    for (const option of args.options) {
      const value = {
        label: option.label.trim(),
        labelKk: option.labelKk?.trim() || undefined,
        kitchenLabel: option.kitchenLabel.trim(),
        coefficient: option.coefficient,
        writeOffCoefficient: option.writeOffCoefficient,
        sortOrder: option.sortOrder,
        isDefault: option.isDefault,
        available: option.available,
      }
      const row = option.externalId ? current.find((candidate) => candidate.externalId === option.externalId) : undefined
      if (option.externalId && !row) throw new ConvexError("Размер не найден")
      if (row) await ctx.db.patch(row._id, value)
      else await ctx.db.insert("sizeOptions", { externalId: `size-${crypto.randomUUID()}`, scaleId, ...value })
    }

    // Products of the scale: the given list, others released.
    const assigned = await ctx.db.query("products").withIndex("by_size_scale", (q) => q.eq("sizeScaleId", scaleId)).take(200)
    const wanted = new Set(args.productExternalIds)
    for (const product of assigned) if (!wanted.has(product.externalId)) await ctx.db.patch(product._id, { sizeScaleId: undefined })
    for (const productExternalId of wanted) {
      const product = await productByExternalId(ctx, productExternalId)
      if (product.sizeScaleId !== scaleId) await ctx.db.patch(product._id, { sizeScaleId: scaleId })
    }

    await writeOfficeAudit(ctx, email, {
      action: existing ? "size-scale.update" : "size-scale.create",
      summary: `Шкала «${name}»: ${args.options.map((option) => option.label).join(", ")}`,
      resourceType: "size-scale",
      resourceExternalId: externalId,
      capability: "office.size-scales.edit",
    })
    return externalId
  },
})

export const setAvailability = mutation({
  args: { optionExternalId: v.string(), available: v.boolean() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.size-scales.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const option = await ctx.db.query("sizeOptions").withIndex("by_external_id", (q) => q.eq("externalId", args.optionExternalId)).unique()
    if (!option) throw new ConvexError("Размер не найден")
    await ctx.db.patch(option._id, { available: args.available })
    await writeOfficeAudit(ctx, email, { action: "size-scale.update", summary: `Размер «${option.label}» ${args.available ? "доступен" : "недоступен"}`, resourceType: "size-option", resourceExternalId: option.externalId, capability: "office.size-scales.edit" })
  },
})

/** From the product card: attach a scale to a dish or release it. */
export const assignScale = mutation({
  args: { productExternalId: v.string(), scaleExternalId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.nomenclature.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const product = await productByExternalId(ctx, args.productExternalId)
    let scaleId: Id<"sizeScales"> | undefined
    if (args.scaleExternalId) {
      const scale = await ctx.db.query("sizeScales").withIndex("by_external_id", (q) => q.eq("externalId", args.scaleExternalId!)).unique()
      if (!scale) throw new ConvexError("Шкала не найдена")
      scaleId = scale._id
    }
    await ctx.db.patch(product._id, { sizeScaleId: scaleId })
    await writeOfficeAudit(ctx, email, { action: "catalog.product.update", summary: `Шкала размеров «${product.name}»: ${args.scaleExternalId ?? "снята"}`, resourceType: "product", resourceExternalId: product.externalId, capability: "office.nomenclature.edit" })
  },
})
