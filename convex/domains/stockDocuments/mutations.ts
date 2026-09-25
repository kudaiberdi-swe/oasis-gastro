import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { nextNumber } from "../../lib/numbering"
import { allocateObligation, cancelObligations, createObligation, getObligation, obligationExternalId, supplierCounterparty } from "../../lib/obligations"
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
    counterpartyExternalId: v.optional(v.string()),
    receiptExternalId: v.optional(v.string()),
    reason: v.string(),
    comment: v.string(),
    lines: v.array(v.object({ itemExternalId: v.string(), quantity: v.number(), actualQuantity: v.optional(v.number()), unitCost: v.optional(v.number()), vatRate: v.optional(v.number()), salePrice: v.optional(v.number()) })),
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
    const counterparty = args.type === "outgoing-invoice" && args.counterpartyExternalId ? await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.counterpartyExternalId!)).unique() : null
    if (counterparty && (counterparty.moduleId !== "counterparties" || counterparty.status !== "active")) throw new ConvexError("Покупатель не найден среди активных контрагентов")
    if (args.type === "supplier-return" && args.receiptExternalId) {
      const receipt = await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", args.receiptExternalId!)).unique()
      if (!receipt || receipt.status !== "posted") throw new ConvexError("Приход не найден или не проведён")
      if (receipt.supplierId !== supplier!._id || receipt.warehouseId !== source!._id) throw new ConvexError("Приход другого поставщика или склада")
    }

    const next = { ...document, date: args.date, sourceWarehouseExternalId: source?.externalId, destinationWarehouseExternalId: destination?.externalId }
    await assertDocumentScope(ctx, user, role, next)
    await assertOpen(ctx, next, config.moduleId)

    const resolved: { itemId: Id<"inventoryItems">; line: (typeof args.lines)[number] }[] = []
    for (const line of args.lines) {
      const item = await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.itemExternalId)).unique()
      if (!item) throw new ConvexError(`Складская позиция ${line.itemExternalId} не найдена`)
      if (args.type === "inventory" ? !(line.actualQuantity !== undefined && line.actualQuantity >= 0) : !(line.quantity > 0)) throw new ConvexError(`Проверьте количество «${item.name}»`)
      if (line.salePrice !== undefined && (args.type !== "outgoing-invoice" || !(line.salePrice >= 0))) throw new ConvexError(`Проверьте цену продажи «${item.name}»`)
      resolved.push({ itemId: item._id, line })
    }
    for (const old of await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)) await ctx.db.delete(old._id)
    for (const [index, { itemId, line }] of resolved.entries()) {
      await ctx.db.insert("stockDocumentLines", { documentId: document._id, lineNo: index + 1, inventoryItemId: itemId, quantity: line.quantity, ...(line.actualQuantity !== undefined ? { actualQuantity: line.actualQuantity } : {}), unitCost: line.unitCost ?? 0, vatRate: line.vatRate ?? 0, ...(line.salePrice !== undefined ? { salePrice: line.salePrice } : {}) })
    }
    await ctx.db.patch(document._id, {
      date: args.date,
      sourceWarehouseId: source?._id,
      destinationWarehouseId: destination?._id,
      sourceWarehouseExternalId: source?.externalId,
      destinationWarehouseExternalId: destination?.externalId,
      supplierId: supplier?._id,
      counterpartyName: args.counterpartyName.trim() || counterparty?.name || supplier?.name || "",
      counterpartyExternalId: counterparty?.externalId,
      receiptExternalId: args.type === "supplier-return" ? args.receiptExternalId : undefined,
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
    if (document.type === "supplier-return" && document.receiptExternalId) await assertReturnable(ctx, document, lines)
    const { totalAmount, obligationAmount, saleTotal } = await postStockDocument(ctx, document, lines, email)
    const obligationAdjustment = await settleObligations(ctx, document, obligationAmount)
    await ctx.db.patch(document._id, { status: "posted", postedAt: Date.now(), totalAmount, saleTotal, obligationAdjustment, updatedAt: Date.now() })
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
    await cancelObligations(ctx, config.moduleId, document.externalId)
    if (document.obligationAdjustment) {
      const bill = await getObligation(ctx, document.obligationAdjustment.obligationExternalId)
      if (bill) await allocateObligation(ctx, bill, -document.obligationAdjustment.amount)
    }
    await reverseStockSource(ctx, { sourceExternalId: document.externalId, occurredAt: now, reason, actorEmail: email })
    await ctx.db.patch(document._id, { status: "reversed", reversedAt: now, reverseReason: reason, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "stock-document.reverse", summary: `Сторно: ${config.label} ${document.number} — ${reason}`, resourceType: config.moduleId, resourceExternalId: document.externalId, restaurantExternalId: document.restaurantExternalId, capability: `office.${config.moduleId}.reverse` })
    await appendOutboxEvent(ctx, { aggregateType: config.moduleId, aggregateExternalId: document.externalId, eventType: "stock-document.reversed", restaurantExternalId: document.restaurantExternalId, payload: { number: document.number, reason } })
  },
})

/** A return based on a receipt can't exceed what it brought in, less the returns already posted against it. */
async function assertReturnable(ctx: MutationCtx, document: Doc<"stockDocuments">, lines: Doc<"stockDocumentLines">[]) {
  const receipt = await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", document.receiptExternalId!)).unique()
  if (!receipt || receipt.status !== "posted") throw new ConvexError("Приход не найден или не проведён")
  const left = new Map<string, number>()
  for (const row of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) left.set(row.inventoryItemId, (left.get(row.inventoryItemId) ?? 0) + row.quantity)
  for (const other of await ctx.db.query("stockDocuments").withIndex("by_receipt", (q) => q.eq("receiptExternalId", receipt.externalId)).take(50)) {
    if (other._id === document._id || other.status !== "posted") continue
    for (const row of await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", other._id)).take(200)) left.set(row.inventoryItemId, (left.get(row.inventoryItemId) ?? 0) - row.quantity)
  }
  for (const line of lines) {
    const available = left.get(line.inventoryItemId) ?? 0
    if (line.quantity > available + 0.0005) {
      const item = await ctx.db.get(line.inventoryItemId)
      throw new ConvexError(`«${item?.name}»: возврат больше полученного по ${receipt.number} (доступно ${Math.max(0, available)})`)
    }
    left.set(line.inventoryItemId, available - line.quantity)
  }
}

/**
 * W2-STK-13: a return first reduces the open bill of its receipt, the rest the supplier owes us;
 * an outgoing invoice is the buyer's debt. Reversal cancels and releases exactly this.
 */
async function settleObligations(ctx: MutationCtx, document: Doc<"stockDocuments">, amount: number) {
  const config = DOCUMENT_MODULES[document.type]
  const common = { restaurantExternalId: document.restaurantExternalId, direction: "receivable" as const, sourceModuleId: config.moduleId, sourceExternalId: document.externalId, sourceNumber: document.number, occurredAt: document.date }
  if (document.type === "outgoing-invoice") {
    await createObligation(ctx, { ...common, amount, name: `Оплата от «${document.counterpartyName || "покупателя"}» по ${document.number}`, kind: "other", counterpartyExternalId: document.counterpartyExternalId })
    return undefined
  }
  if (document.type !== "supplier-return") return undefined
  const supplier = (await ctx.db.get(document.supplierId!))!
  let adjustment: { obligationExternalId: string; amount: number } | undefined
  let rest = amount
  if (document.receiptExternalId) {
    const bill = await getObligation(ctx, obligationExternalId("receipts", document.receiptExternalId))
    if (bill && bill.status === "posted" && bill.amount > 0) {
      const settled = Math.min(bill.amount, rest)
      await allocateObligation(ctx, bill, settled)
      adjustment = { obligationExternalId: bill.externalId, amount: settled }
      rest -= settled
    }
  }
  await createObligation(ctx, { ...common, amount: rest, name: `Возврат от «${supplier.name}» по ${document.number}`, kind: "supplier", counterpartyExternalId: await supplierCounterparty(ctx, supplier) })
  return adjustment
}
