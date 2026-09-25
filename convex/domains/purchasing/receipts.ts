import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { postJournalEntry } from "../../lib/ledger"
import { cancelObligations, createObligation, dueAfter, supplierCounterparty } from "../../lib/obligations"
import { syncPurchaseOrder } from "../production/documents"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, writeOfficeAudit } from "../../lib/officeAccess"
import { nextNumber } from "../../lib/numbering"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { checkReceiptLinePrice, supplierPriceListAt } from "../../lib/priceListCheck"
import { checkPrice, type PriceCheck } from "../../lib/priceChecks"
import { applyStockMovement, roundQuantity } from "../../lib/stockAccounting"
import { reverseStockSource, stockAccountOf } from "../../lib/stockPosting"
import { businessDateFor } from "../../lib/time"

// Receipts (W1-STK-10): supplier deliveries into a warehouse with lots, average cost, VAT and payables.

const MODULE = "receipts"

async function requireReceipt(ctx: QueryCtx, externalId: string) {
  const receipt = await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!receipt) throw new ConvexError("Приходная накладная не найдена")
  return receipt
}

async function assertReceiptScope(ctx: QueryCtx, user: Doc<"officeUsers">, role: Doc<"officeRoles">, receipt: Doc<"receipts">) {
  if (!hasScope(user.restaurantScopes, receipt.restaurantExternalId)) throw new ConvexError("Приходная накладная не найдена")
  const warehouse = await ctx.db.get(receipt.warehouseId)
  const scopes = await effectiveScopes(ctx, user, role)
  if (warehouse && !hasScope(scopes.warehouseScopes, warehouse.externalId)) throw new ConvexError("Нет доступа к складу")
  return warehouse
}

const vatShare = (gross: number, rate: number) => (rate > 0 ? gross - gross / (1 + rate / 100) : 0)

async function priceChecksFor(ctx: QueryCtx, receipt: Doc<"receipts">, lines: Doc<"receiptLines">[]): Promise<PriceCheck[]> {
  const supplier = await ctx.db.get(receipt.supplierId)
  if (!supplier) return []
  const list = await supplierPriceListAt(ctx, supplier._id, receipt.date)
  return Promise.all(
    lines.map(async (line) => {
      const item = await ctx.db.get(line.inventoryItemId)
      // The supplier's published price list first (W2-CAT-15), else the warehouse average.
      const listed = await checkReceiptLinePrice(ctx, { supplierId: supplier._id, inventoryItemId: line.inventoryItemId, price: line.unitCostGross, at: receipt.date, list })
      if (listed) return { lineNo: line.lineNo, itemName: item?.name ?? "", unitCost: line.unitCostGross, reference: Math.round(listed.expected * 100) / 100, deviationPercent: listed.deviationPercent, outcome: listed.verdict }
      const balance = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", receipt.warehouseId).eq("inventoryItemId", line.inventoryItemId)).unique()
      return checkPrice(supplier, { lineNo: line.lineNo, itemName: item?.name ?? "", unitCost: line.unitCostGross }, balance?.averageUnitCost ?? 0)
    }),
  )
}

export const listReceipts = query({
  args: { status: v.optional(v.union(v.literal("draft"), v.literal("posted"), v.literal("reversed"))), search: v.optional(v.string()), restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.receipts.view")
    restaurantScopeFilter(user, args.restaurantExternalId)
    const network = user.restaurantScopes.includes("*")
    const restaurant = args.restaurantExternalId ?? (!network && user.restaurantScopes.length === 1 ? user.restaurantScopes[0] : undefined)
    if (!network && !restaurant) throw new ConvexError("Выберите ресторан")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    if (needle) {
      return ctx.db
        .query("receipts")
        .withSearchIndex("search_receipts", (q) => {
          let scoped = q.search("searchText", needle)
          if (args.status) scoped = scoped.eq("status", args.status)
          if (restaurant) scoped = scoped.eq("restaurantExternalId", restaurant)
          return scoped
        })
        .paginate(args.paginationOpts)
    }
    if (restaurant) {
      return args.status
        ? ctx.db.query("receipts").withIndex("by_restaurant_status_date", (q) => q.eq("restaurantExternalId", restaurant).eq("status", args.status!)).order("desc").paginate(args.paginationOpts)
        : ctx.db.query("receipts").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant)).order("desc").paginate(args.paginationOpts)
    }
    return ctx.db
      .query("receipts")
      .withIndex("by_restaurant_date")
      .order("desc")
      .filter((q) => (args.status ? q.eq(q.field("status"), args.status) : true))
      .paginate(args.paginationOpts)
  },
})

export const getReceipt = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.view")
    const receipt = await requireReceipt(ctx, args.externalId)
    const warehouse = await assertReceiptScope(ctx, user, role, receipt)
    const lines = await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)
    const items = await Promise.all(lines.map((line) => ctx.db.get(line.inventoryItemId)))
    const supplier = await ctx.db.get(receipt.supplierId)
    return {
      ...receipt,
      warehouse: warehouse ? { externalId: warehouse.externalId, name: warehouse.name } : null,
      supplier: supplier ? { externalId: supplier.externalId, name: supplier.name, vatPayer: supplier.vatPayer ?? false } : null,
      lines: lines.map((line, index) => ({ ...line, itemExternalId: items[index]?.externalId ?? null, itemName: items[index]?.name ?? null, unit: items[index]?.unit ?? null })),
      priceChecks: receipt.status === "draft" ? await priceChecksFor(ctx, receipt, lines) : [],
    }
  },
})

export const createReceiptDraft = mutation({
  args: { supplierExternalId: v.string(), warehouseExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const warehouse = await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", args.warehouseExternalId)).unique()
    if (!warehouse || !warehouse.active) throw new ConvexError("Склад не найден или отключён")
    await requireRestaurantScope(ctx, user, warehouse.restaurantExternalId)
    if (!hasScope((await effectiveScopes(ctx, user, role)).warehouseScopes, warehouse.externalId)) throw new ConvexError("Нет доступа к складу")
    const supplier = await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId)).unique()
    if (!supplier || !supplier.active) throw new ConvexError("Поставщик не найден или отключён")
    const now = Date.now()
    const number = await nextNumber(ctx, { moduleId: MODULE, prefix: "ПН", organizationExternalId: warehouse.organizationExternalId, businessDate: businessDateFor(now) })
    const externalId = `receipt-${crypto.randomUUID()}`
    await ctx.db.insert("receipts", {
      externalId,
      number,
      date: now,
      supplierId: supplier._id,
      warehouseId: warehouse._id,
      restaurantExternalId: warehouse.restaurantExternalId,
      organizationExternalId: warehouse.organizationExternalId,
      invoiceNumber: "",
      status: "draft",
      totalGross: 0,
      totalVat: 0,
      totalNet: 0,
      searchText: `${number} ${supplier.name}`.toLocaleLowerCase("ru"),
      createdAt: now,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "receipt.create", summary: `Приходная накладная ${number} от «${supplier.name}»`, resourceType: MODULE, resourceExternalId: externalId, restaurantExternalId: warehouse.restaurantExternalId, capability: "office.receipts.edit" })
    return { externalId, number }
  },
})

export const saveReceipt = mutation({
  args: {
    externalId: v.string(),
    date: v.number(),
    supplierExternalId: v.string(),
    warehouseExternalId: v.string(),
    invoiceNumber: v.string(),
    lines: v.array(v.object({ itemExternalId: v.string(), quantity: v.number(), unitCostGross: v.number(), vatRate: v.number() })),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const receipt = await requireReceipt(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, receipt.restaurantExternalId)
    // B-E1: a posted receipt never goes back to draft through a save.
    if (receipt.status !== "draft") throw new ConvexError("Проведённую накладную изменить нельзя — только сторнировать")
    const warehouse = await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", args.warehouseExternalId)).unique()
    if (!warehouse || warehouse.restaurantExternalId !== receipt.restaurantExternalId) throw new ConvexError("Склад не найден в ресторане накладной")
    if (!hasScope((await effectiveScopes(ctx, user, role)).warehouseScopes, warehouse.externalId)) throw new ConvexError("Нет доступа к складу")
    const supplier = await ctx.db.query("suppliers").withIndex("by_external_id", (q) => q.eq("externalId", args.supplierExternalId)).unique()
    if (!supplier) throw new ConvexError("Поставщик не найден")
    await assertPeriodOpen(ctx, { organizationExternalId: receipt.organizationExternalId, restaurantExternalId: receipt.restaurantExternalId, businessDate: businessDateFor(args.date), moduleId: MODULE })

    let totalGross = 0
    let totalVat = 0
    const resolved = []
    for (const line of args.lines) {
      const item = await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", line.itemExternalId)).unique()
      if (!item) throw new ConvexError(`Складская позиция ${line.itemExternalId} не найдена`)
      if (!(line.quantity > 0)) throw new ConvexError(`Количество «${item.name}» должно быть больше нуля`)
      if (!(line.unitCostGross >= 0)) throw new ConvexError(`Цена «${item.name}» не может быть отрицательной`)
      if (line.vatRate < 0 || line.vatRate > 100) throw new ConvexError("Ставка НДС — от 0 до 100 %")
      const amountGross = Math.round(line.quantity * line.unitCostGross)
      totalGross += amountGross
      totalVat += vatShare(amountGross, line.vatRate)
      resolved.push({ item, line, amountGross })
    }
    for (const old of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) await ctx.db.delete(old._id)
    for (const [index, { item, line, amountGross }] of resolved.entries()) {
      await ctx.db.insert("receiptLines", { receiptId: receipt._id, lineNo: index + 1, inventoryItemId: item._id, quantity: roundQuantity(line.quantity), unitCostGross: line.unitCostGross, vatRate: line.vatRate, amountGross })
    }
    totalVat = Math.round(totalVat)
    await ctx.db.patch(receipt._id, {
      date: args.date,
      supplierId: supplier._id,
      warehouseId: warehouse._id,
      invoiceNumber: args.invoiceNumber.trim(),
      totalGross,
      totalVat,
      totalNet: totalGross - totalVat,
      searchText: [receipt.number, supplier.name, args.invoiceNumber].filter(Boolean).join(" ").toLocaleLowerCase("ru"),
      updatedAt: Date.now(),
    })
    await writeOfficeAudit(ctx, email, { action: "receipt.update", summary: `Приходная накладная ${receipt.number}: ${resolved.length} строк, ${totalGross} ₸`, resourceType: MODULE, resourceExternalId: receipt.externalId, restaurantExternalId: receipt.restaurantExternalId, capability: "office.receipts.edit" })
    return { totalGross, totalVat, totalNet: totalGross - totalVat }
  },
})

async function vatApplies(ctx: MutationCtx, receipt: Doc<"receipts">, supplier: Doc<"suppliers">) {
  const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", receipt.organizationExternalId)).unique()
  return Boolean(organization?.vatPayer && supplier.vatPayer)
}

export const postReceipt = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const receipt = await requireReceipt(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, receipt.restaurantExternalId)
    await assertReceiptScope(ctx, user, role, receipt)
    if (receipt.status === "posted") return { status: "posted" as const, warnings: [] }
    if (receipt.status !== "draft") throw new ConvexError("Провести можно только черновик")
    const supplier = (await ctx.db.get(receipt.supplierId))!
    const lines = await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)
    if (!lines.length) throw new ConvexError("В накладной нет строк")
    const checks = await priceChecksFor(ctx, receipt, lines)
    const blocked = checks.find((check) => check.outcome === "block")
    if (blocked) throw new ConvexError(`Цена «${blocked.itemName}» отклоняется на ${blocked.deviationPercent} % — больше допустимого поставщиком`)

    const netCost = await vatApplies(ctx, receipt, supplier)
    const byAccount = new Map<string, number>()
    let vatTotal = 0
    for (const line of lines) {
      const item = (await ctx.db.get(line.inventoryItemId))!
      const vat = netCost ? Math.round(vatShare(line.amountGross, line.vatRate)) : 0
      const cost = line.amountGross - vat
      vatTotal += vat
      const lotExternalId = `${receipt.externalId}:${line.lineNo}`
      await applyStockMovement(ctx, {
        externalId: lotExternalId,
        kind: "receipt",
        sourceModuleId: MODULE,
        sourceExternalId: receipt.externalId,
        sourceNumber: receipt.number,
        warehouseId: receipt.warehouseId,
        inventoryItemId: line.inventoryItemId,
        quantityDelta: line.quantity,
        unitCost: cost / line.quantity,
        occurredAt: receipt.date,
        actorEmail: email,
      })
      const lot = await ctx.db.query("stockLots").withIndex("by_external_id", (q) => q.eq("externalId", lotExternalId)).unique()
      if (!lot) {
        await ctx.db.insert("stockLots", { externalId: lotExternalId, inventoryItemId: line.inventoryItemId, warehouseId: receipt.warehouseId, quantity: line.quantity, remainingQuantity: line.quantity, unitCost: cost / line.quantity, sourceModuleId: MODULE, sourceExternalId: receipt.externalId, sourceNumber: receipt.number, receivedAt: receipt.date })
      }
      const account = stockAccountOf(item)
      byAccount.set(account, (byAccount.get(account) ?? 0) + cost)
    }
    const warehouse = await ctx.db.get(receipt.warehouseId)
    const common = { restaurantExternalId: receipt.restaurantExternalId, sourceModuleId: MODULE, sourceExternalId: receipt.externalId, sourceNumber: receipt.number, occurredAt: receipt.date, warehouseExternalId: warehouse?.externalId }
    for (const [account, amount] of byAccount) {
      const rounded = Math.round(amount)
      if (rounded > 0) await postJournalEntry(ctx, { ...common, externalId: `${receipt.externalId}:je:${account}`, debitAccount: account, creditAccount: "payables", amount: rounded, description: `Приход ${receipt.number} от «${supplier.name}»` })
    }
    if (Math.round(vatTotal) > 0) await postJournalEntry(ctx, { ...common, externalId: `${receipt.externalId}:je:vat`, debitAccount: "vatRecoverable", creditAccount: "payables", amount: Math.round(vatTotal), description: `НДС по приходу ${receipt.number}` })

    // The supplier's bill to pay (W2-FIN-09): its counterparty is the one linked or with the same BIN.
    const counterparty = await supplierCounterparty(ctx, supplier)
    const businessDate = businessDateFor(receipt.date)
    await createObligation(ctx, { restaurantExternalId: receipt.restaurantExternalId, direction: "payable", amount: receipt.totalGross, name: `Оплата поставщику «${supplier.name}» по ${receipt.number}`, kind: "supplier", sourceModuleId: MODULE, sourceExternalId: receipt.externalId, sourceNumber: receipt.number, dueDate: supplier.paymentDelayDays ? dueAfter(businessDate, supplier.paymentDelayDays) : undefined, counterpartyExternalId: counterparty, occurredAt: receipt.date })
    await ctx.db.patch(receipt._id, { status: "posted", postedAt: Date.now(), updatedAt: Date.now() })
    await syncPurchaseOrder(ctx, receipt.purchaseOrderExternalId, true)
    await writeOfficeAudit(ctx, email, { action: "receipt.post", summary: `Проведена приходная накладная ${receipt.number}, ${receipt.totalGross} ₸`, resourceType: MODULE, resourceExternalId: receipt.externalId, restaurantExternalId: receipt.restaurantExternalId, capability: "office.receipts.post" })
    await appendOutboxEvent(ctx, { aggregateType: MODULE, aggregateExternalId: receipt.externalId, eventType: "receipt.posted", restaurantExternalId: receipt.restaurantExternalId, payload: { number: receipt.number, totalGross: receipt.totalGross, supplier: supplier.externalId } })
    return { status: "posted" as const, warnings: checks.filter((check) => check.outcome === "warn") }
  },
})

/** A receipt whose goods were already used can't be reversed into a negative balance. */
export const reverseReceipt = mutation({
  args: { externalId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.receipts.reverse")
    const email = (await getOfficeAuthEmail(ctx))!
    const receipt = await requireReceipt(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, receipt.restaurantExternalId)
    const warehouse = await assertReceiptScope(ctx, user, role, receipt)
    if (receipt.status !== "posted") throw new ConvexError("Сторнировать можно только проведённую накладную")
    const reason = args.reason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину сторно")
    const now = Date.now()
    await assertPeriodOpen(ctx, { organizationExternalId: receipt.organizationExternalId, restaurantExternalId: receipt.restaurantExternalId, businessDate: businessDateFor(now), moduleId: MODULE })
    const lines = await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)
    if (!warehouse?.allowNegativeStock) {
      for (const line of lines) {
        const balance = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", receipt.warehouseId).eq("inventoryItemId", line.inventoryItemId)).unique()
        if ((balance?.quantity ?? 0) - line.quantity < -0.0005) {
          const item = await ctx.db.get(line.inventoryItemId)
          throw new ConvexError(`«${item?.name}» уже частично израсходован — сторно уведёт остаток в минус`)
        }
      }
    }
    await cancelObligations(ctx, MODULE, receipt.externalId)
    await reverseStockSource(ctx, { sourceExternalId: receipt.externalId, occurredAt: now, reason, actorEmail: email })
    for (const lot of await ctx.db.query("stockLots").withIndex("by_source", (q) => q.eq("sourceExternalId", receipt.externalId)).take(200)) await ctx.db.patch(lot._id, { remainingQuantity: 0 })
    await ctx.db.patch(receipt._id, { status: "reversed", reversedAt: now, reverseReason: reason, updatedAt: now })
    await syncPurchaseOrder(ctx, receipt.purchaseOrderExternalId, false)
    await writeOfficeAudit(ctx, email, { action: "receipt.reverse", summary: `Сторно приходной накладной ${receipt.number}: ${reason}`, resourceType: MODULE, resourceExternalId: receipt.externalId, restaurantExternalId: receipt.restaurantExternalId, capability: "office.receipts.reverse" })
    await appendOutboxEvent(ctx, { aggregateType: MODULE, aggregateExternalId: receipt.externalId, eventType: "receipt.reversed", restaurantExternalId: receipt.restaurantExternalId, payload: { number: receipt.number, reason } })
  },
})
