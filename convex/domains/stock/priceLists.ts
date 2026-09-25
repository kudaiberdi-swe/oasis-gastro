import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

// Price lists (W2-CAT-15): internal and supplier purchase prices. A published version is never edited:
// saving it opens the next draft of the series, publishing that expires the previous one.

const policy = v.union(v.literal("ignore"), v.literal("warn"), v.literal("block"), v.literal("block-higher"))
const KIND_LABEL = { internal: "Внутренний", supplier: "Поставщика" } as const

async function requireList(ctx: QueryCtx, externalId: string) {
  const list = await ctx.db.query("priceLists").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!list) throw new ConvexError("Прайс-лист не найден")
  return list
}

async function summary(ctx: QueryCtx, list: Doc<"priceLists">) {
  const supplier = list.supplierId ? await ctx.db.get(list.supplierId) : null
  return { ...list, supplier: supplier ? { externalId: supplier.externalId, name: supplier.name } : null, kindLabel: KIND_LABEL[list.kind] }
}

export const listPriceLists = query({
  args: { kind: v.optional(v.union(v.literal("internal"), v.literal("supplier"))), supplierExternalId: v.optional(v.string()), status: v.optional(v.union(v.literal("draft"), v.literal("published"), v.literal("expired"))), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.price-lists.view")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const supplier = args.supplierExternalId ? await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId!)).unique() : null
    if (args.supplierExternalId && !supplier) return { page: [], isDone: true, continueCursor: "" }
    const page = needle
      ? await ctx.db.query("priceLists").withSearchIndex("search_price_lists", (q) => {
          let scoped = q.search("searchText", needle)
          if (args.kind) scoped = scoped.eq("kind", args.kind)
          if (args.status) scoped = scoped.eq("status", args.status)
          return scoped
        }).paginate(args.paginationOpts)
      : supplier
        ? await ctx.db.query("priceLists").withIndex("by_supplier_status_effective", (q) => (args.status ? q.eq("supplierId", supplier._id).eq("status", args.status) : q.eq("supplierId", supplier._id))).order("desc").paginate(args.paginationOpts)
        : args.kind
          ? await ctx.db.query("priceLists").withIndex("by_kind_status", (q) => (args.status ? q.eq("kind", args.kind!).eq("status", args.status) : q.eq("kind", args.kind!))).order("desc").paginate(args.paginationOpts)
          : await ctx.db.query("priceLists").order("desc").paginate(args.paginationOpts)
    const rows = page.page.filter((list) => (!supplier || list.supplierId === supplier._id) && (!args.status || list.status === args.status))
    return { ...page, page: await Promise.all(rows.map((list) => summary(ctx, list))) }
  },
})

export const getPriceList = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.price-lists.view")
    const list = await ctx.db.query("priceLists").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!list) return null
    const lines = await ctx.db.query("priceListLines").withIndex("by_list", (q) => q.eq("priceListId", list._id)).take(200)
    const versions = await ctx.db.query("priceLists").withIndex("by_series_version", (q) => q.eq("seriesExternalId", list.seriesExternalId)).order("desc").take(20)
    return {
      ...(await summary(ctx, list)),
      lines: await Promise.all(lines.map(async (line) => {
        const item = await ctx.db.get(line.inventoryItemId)
        return { ...line, inventoryItemExternalId: item?.externalId ?? "", itemName: item?.name ?? "", itemUnit: item?.unit ?? "", unitPrice: line.price / (line.packageCoefficient > 0 ? line.packageCoefficient : 1) }
      })),
      versions: versions.map((row) => ({ externalId: row.externalId, version: row.version, status: row.status, effectiveFrom: row.effectiveFrom })),
    }
  },
})

/** Saves a draft; saving a published or expired version opens (or reuses) the series' next draft. */
export const savePriceList = mutation({
  args: {
    externalId: v.optional(v.string()),
    name: v.string(),
    kind: v.union(v.literal("internal"), v.literal("supplier")),
    supplierExternalId: v.optional(v.string()),
    effectiveFrom: v.number(),
    deviationPolicy: policy,
    deviationPercent: v.number(),
    lines: v.array(v.object({ inventoryItemExternalId: v.string(), supplierSku: v.string(), supplierName: v.string(), unitExternalId: v.optional(v.string()), packageCoefficient: v.number(), price: v.number(), deviationPercent: v.optional(v.number()) })),
  },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.price-lists.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (name.length < 2) throw new ConvexError("Укажите название")
    if (!(args.deviationPercent >= 0 && args.deviationPercent <= 100)) throw new ConvexError("Допуск — от 0 до 100 %")
    const supplier = args.supplierExternalId ? await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId!)).unique() : null
    if (args.kind === "supplier" && !supplier?.active) throw new ConvexError("Выберите активного поставщика")
    if (args.lines.length > 200) throw new ConvexError("Не больше 200 строк в прайс-листе")
    const lines = []
    const seen = new Set<string>()
    for (const [index, line] of args.lines.entries()) {
      const item = await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.inventoryItemExternalId)).unique()
      if (!item) throw new ConvexError("Складская позиция не найдена")
      if (seen.has(item.externalId)) throw new ConvexError(`«${item.name}» указан дважды`)
      seen.add(item.externalId)
      if (!(line.price > 0)) throw new ConvexError(`Цена «${item.name}» должна быть больше нуля`)
      if (!(line.packageCoefficient > 0)) throw new ConvexError(`Коэффициент упаковки «${item.name}» должен быть больше нуля`)
      if (line.deviationPercent !== undefined && !(line.deviationPercent >= 0 && line.deviationPercent <= 100)) throw new ConvexError(`Допуск «${item.name}» — от 0 до 100 %`)
      lines.push({ lineNo: index + 1, inventoryItemId: item._id, supplierSku: line.supplierSku.trim(), supplierName: line.supplierName.trim(), ...(line.unitExternalId ? { unitExternalId: line.unitExternalId } : {}), packageCoefficient: line.packageCoefficient, price: Math.round(line.price * 100) / 100, ...(line.deviationPercent !== undefined ? { deviationPercent: line.deviationPercent } : {}) })
    }
    const now = Date.now()
    const value = { name, kind: args.kind, supplierId: args.kind === "supplier" ? supplier!._id : undefined, effectiveFrom: args.effectiveFrom, deviationPolicy: args.deviationPolicy, deviationPercent: args.deviationPercent, lineCount: lines.length, searchText: `${name} ${supplier?.name ?? ""}`.toLocaleLowerCase("ru"), updatedAt: now }

    let target = args.externalId ? await requireList(ctx, args.externalId) : null
    if (target && target.kind !== args.kind) throw new ConvexError("Вид прайс-листа изменить нельзя")
    if (target && target.status !== "draft") {
      const latest = await ctx.db.query("priceLists").withIndex("by_series_version", (q) => q.eq("seriesExternalId", target!.seriesExternalId)).order("desc").first()
      if (latest?.status === "draft") target = latest
      else {
        const externalId = `price-list-${crypto.randomUUID()}`
        const id = await ctx.db.insert("priceLists", { ...value, externalId, seriesExternalId: target.seriesExternalId, version: (latest?.version ?? target.version) + 1, status: "draft", createdBy: email, createdAt: now })
        target = (await ctx.db.get(id))!
      }
    }
    if (!target) {
      const externalId = `price-list-${crypto.randomUUID()}`
      const id = await ctx.db.insert("priceLists", { ...value, externalId, seriesExternalId: externalId, version: 1, status: "draft", createdBy: email, createdAt: now })
      target = (await ctx.db.get(id))!
    } else await ctx.db.patch(target._id, value)
    for (const old of await ctx.db.query("priceListLines").withIndex("by_list", (q) => q.eq("priceListId", target._id)).take(200)) await ctx.db.delete(old._id)
    for (const line of lines) await ctx.db.insert("priceListLines", { ...line, priceListId: target._id })
    await writeOfficeAudit(ctx, email, { action: "price-list.save", summary: `Прайс-лист «${name}» v${target.version}: ${lines.length} позиций`, resourceType: "price-lists", resourceExternalId: target.externalId, capability: "office.price-lists.edit" })
    return { externalId: target.externalId, version: target.version }
  },
})

/** Publishes a draft; the series' previous published version expires. */
export const publishPriceList = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.price-lists.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const list = await requireList(ctx, args.externalId)
    if (list.status === "published") return
    if (list.status !== "draft") throw new ConvexError("Опубликовать можно только черновик")
    if (!list.lineCount) throw new ConvexError("В прайс-листе нет позиций")
    const now = Date.now()
    for (const row of await ctx.db.query("priceLists").withIndex("by_series_version", (q) => q.eq("seriesExternalId", list.seriesExternalId)).take(50)) {
      if (row.status === "published") await ctx.db.patch(row._id, { status: "expired", updatedAt: now })
    }
    await ctx.db.patch(list._id, { status: "published", publishedAt: now, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "price-list.publish", summary: `Опубликован прайс-лист «${list.name}» v${list.version}`, resourceType: "price-lists", resourceExternalId: list.externalId, capability: "office.price-lists.post" })
  },
})
