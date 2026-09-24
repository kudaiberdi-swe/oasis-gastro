import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { nextNumber } from "../../lib/numbering"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { DOCUMENT_MODULES, postStockDocument, reverseStockSource } from "../../lib/stockPosting"
import { businessDateFor } from "../../lib/time"
import { assertDocumentScope } from "./access"
import { stockDocumentType } from "./validators"

type Type = keyof typeof DOCUMENT_MODULES

async function requireDocument(ctx: MutationCtx, externalId: string, type: Type) {
  const document = await ctx.db.query("stockDocuments").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!document || document.type !== type) throw new ConvexError("Документ не найден")
  return document
}

async function warehouseIn(ctx: MutationCtx, externalId: string | undefined, restaurantExternalId: string) {
  if (!externalId) return null
  const warehouse = await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!warehouse || !warehouse.active) throw new ConvexError("Склад не найден или отключён")
  if (warehouse.restaurantExternalId !== restaurantExternalId) throw new ConvexError("Склад другого ресторана")
  return warehouse
}

async function assertOpen(ctx: MutationCtx, document: Pick<Doc<"stockDocuments">, "organizationExternalId" | "restaurantExternalId" | "date">, moduleId: string) {
  await assertPeriodOpen(ctx, { organizationExternalId: document.organizationExternalId, restaurantExternalId: document.restaurantExternalId, businessDate: businessDateFor(document.date), moduleId })
}

export const createDocument = mutation({
  args: { type: stockDocumentType, restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const config = DOCUMENT_MODULES[args.type]
    const { user } = await requireOfficeCapability(ctx, `office.${config.moduleId}.edit`)
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    const now = Date.now()
    const number = await nextNumber(ctx, { moduleId: config.moduleId, prefix: config.prefix, organizationExternalId: restaurant.organizationExternalId, businessDate: businessDateFor(now) })
    const externalId = `${config.moduleId}-${crypto.randomUUID()}`
    await ctx.db.insert("stockDocuments", {
      externalId,
      type: args.type,
      number,
      date: now,
      status: "draft",
      organizationExternalId: restaurant.organizationExternalId,
      restaurantExternalId: restaurant.externalId,
      counterpartyName: "",
      reason: "",
      comment: "",
      totalQuantity: 0,
      totalAmount: 0,
      searchText: number.toLocaleLowerCase("ru"),
      createdAt: now,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "stock-document.create", summary: `${config.label} ${number}`, resourceType: config.moduleId, resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: `office.${config.moduleId}.edit` })
    return { externalId, number }
  },
})

export const saveDocument = mutation({
  args: {
    type: stockDocumentType,
    externalId: v.string(),
    date: v.number(),
    sourceWarehouseExternalId: v.optional(v.string()),
    destinationWarehouseExternalId: v.optional(v.string()),
    supplierExternalId: v.optional(v.string()),
    counterpartyName: v.string(),
    reason: v.string(),
    comment: v.string(),
    lines: v.array(v.object({ itemExternalId: v.string(), quantity: v.number(), actualQuantity: v.optional(v.number()), unitCost: v.optional(v.number()), vatRate: v.optional(v.number()) })),
  },
  handler: async (ctx, args) => {
    const config = DOCUMENT_MODULES[args.type]
    const { user, role } = await requireOfficeCapability(ctx, `office.${config.moduleId}.edit`)
    const email = (await getOfficeAuthEmail(ctx))!
    const document = await requireDocument(ctx, args.externalId, args.type)
    await requireRestaurantScope(ctx, user, document.restaurantExternalId)
    if (document.status !== "draft") throw new ConvexError("Проведённый документ изменить нельзя — только сторнировать")
    const source = await warehouseIn(ctx, args.sourceWarehouseExternalId, document.restaurantExternalId)
    const destination = await warehouseIn(ctx, args.destinationWarehouseExternalId, document.restaurantExternalId)
    if (args.type === "transfer") {
      if (!source || !destination) throw new ConvexError("Выберите склады отправителя и получателя")
      if (source._id === destination._id) throw new ConvexError("Склады перемещения должны различаться")
      if (!source.internalTransfers || !destination.internalTransfers) throw new ConvexError("Склад не участвует во внутренних перемещениях")
    } else if (!source) throw new ConvexError("Выберите склад")
    if (args.type === "writeoff" && args.reason.trim().length < 3) throw new ConvexError("Укажите причину списания")
    const supplier = args.supplierExternalId ? await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId!)).unique() : null
    if (args.type === "supplier-return" && !supplier) throw new ConvexError("Выберите поставщика")

    const next = { ...document, date: args.date, sourceWarehouseExternalId: source?.externalId, destinationWarehouseExternalId: destination?.externalId }
    await assertDocumentScope(ctx, user, role, next)
    await assertOpen(ctx, next, config.moduleId)

    const resolved: { itemId: Id<"inventoryItems">; line: (typeof args.lines)[number] }[] = []
    for (const line of args.lines) {
      const item = await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.itemExternalId)).unique()
      if (!item) throw new ConvexError(`Складская позиция ${line.itemExternalId} не найдена`)
      if (args.type === "inventory" ? !(line.actualQuantity !== undefined && line.actualQuantity >= 0) : !(line.quantity > 0)) throw new ConvexError(`Проверьте количество «${item.name}»`)
      resolved.push({ itemId: item._id, line })
    }
    for (const old of await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)) await ctx.db.delete(old._id)
    for (const [index, { itemId, line }] of resolved.entries()) {
      await ctx.db.insert("stockDocumentLines", { documentId: document._id, lineNo: index + 1, inventoryItemId: itemId, quantity: line.quantity, ...(line.actualQuantity !== undefined ? { actualQuantity: line.actualQuantity } : {}), unitCost: line.unitCost ?? 0, vatRate: line.vatRate ?? 0 })
    }
    await ctx.db.patch(document._id, {
      date: args.date,
      sourceWarehouseId: source?._id,
      destinationWarehouseId: destination?._id,
      sourceWarehouseExternalId: source?.externalId,
      destinationWarehouseExternalId: destination?.externalId,
      supplierId: supplier?._id,
      counterpartyName: args.counterpartyName.trim() || supplier?.name || "",
      reason: args.reason.trim(),
      comment: args.comment.trim(),
      totalQuantity: resolved.reduce((sum, { line }) => sum + (line.actualQuantity ?? line.quantity), 0),
      searchText: [document.number, args.counterpartyName, args.reason, args.comment, source?.name, destination?.name].filter(Boolean).join(" ").toLocaleLowerCase("ru"),
      updatedAt: Date.now(),
    })
    await writeOfficeAudit(ctx, email, { action: "stock-document.update", summary: `${config.label} ${document.number}: ${resolved.length} строк`, resourceType: config.moduleId, resourceExternalId: document.externalId, restaurantExternalId: document.restaurantExternalId, capability: `office.${config.moduleId}.edit` })
  },
})

export const postDocument = mutation({
  args: { type: stockDocumentType, externalId: v.string() },
  handler: async (ctx, args) => {
    const config = DOCUMENT_MODULES[args.type]
    const { user, role } = await requireOfficeCapability(ctx, `office.${config.moduleId}.post`)
    const email = (await getOfficeAuthEmail(ctx))!
    const document = await requireDocument(ctx, args.externalId, args.type)
    await requireRestaurantScope(ctx, user, document.restaurantExternalId)
    await assertDocumentScope(ctx, user, role, document)
    if (document.status === "posted") return { status: "posted" as const }
    if (document.status !== "draft") throw new ConvexError("Провести можно только черновик")
    await assertOpen(ctx, document, config.moduleId)
    const lines = await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)
    if (!lines.length) throw new ConvexError("В документе нет строк")
    const { totalAmount } = await postStockDocument(ctx, document, lines, email)
    await ctx.db.patch(document._id, { status: "posted", postedAt: Date.now(), totalAmount, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "stock-document.post", summary: `Проведён: ${config.label} ${document.number}, ${totalAmount} ₸`, resourceType: config.moduleId, resourceExternalId: document.externalId, restaurantExternalId: document.restaurantExternalId, capability: `office.${config.moduleId}.post` })
    await appendOutboxEvent(ctx, { aggregateType: config.moduleId, aggregateExternalId: document.externalId, eventType: "stock-document.posted", restaurantExternalId: document.restaurantExternalId, payload: { number: document.number, totalAmount } })
    return { status: "posted" as const, totalAmount }
  },
})

/** B-2: reversal needs the module's reverse right and the restaurant and warehouse scopes. */
export const reverseDocument = mutation({
  args: { type: stockDocumentType, externalId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const config = DOCUMENT_MODULES[args.type]
    const { user, role } = await requireOfficeCapability(ctx, `office.${config.moduleId}.reverse`)
    const email = (await getOfficeAuthEmail(ctx))!
    const document = await requireDocument(ctx, args.externalId, args.type)
    await requireRestaurantScope(ctx, user, document.restaurantExternalId)
    await assertDocumentScope(ctx, user, role, document)
    if (document.status !== "posted") throw new ConvexError("Сторнировать можно только проведённый документ")
    const reason = args.reason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину сторно")
    const now = Date.now()
    await assertPeriodOpen(ctx, { organizationExternalId: document.organizationExternalId, restaurantExternalId: document.restaurantExternalId, businessDate: businessDateFor(now), moduleId: config.moduleId })
    await reverseStockSource(ctx, { sourceExternalId: document.externalId, occurredAt: now, reason, actorEmail: email })
    await ctx.db.patch(document._id, { status: "reversed", reversedAt: now, reverseReason: reason, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "stock-document.reverse", summary: `Сторно: ${config.label} ${document.number} — ${reason}`, resourceType: config.moduleId, resourceExternalId: document.externalId, restaurantExternalId: document.restaurantExternalId, capability: `office.${config.moduleId}.reverse` })
    await appendOutboxEvent(ctx, { aggregateType: config.moduleId, aggregateExternalId: document.externalId, eventType: "stock-document.reversed", restaurantExternalId: document.restaurantExternalId, payload: { number: document.number, reason } })
  },
})
