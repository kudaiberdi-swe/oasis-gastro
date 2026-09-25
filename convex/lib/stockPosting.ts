import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import type { SystemAccountKey } from "./accounts"
import { postJournalEntry, reverseJournalEntries } from "./ledger"
import { applyStockMovement, reverseSourceMovements, roundQuantity } from "./stockAccounting"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>

// Posting and reversal shared by stock documents, receipts and production acts (W1-STK-08).

/** The balance-sheet account of an inventory item by its kind. */
export function stockAccountOf(item: Pick<Doc<"inventoryItems">, "kind">): SystemAccountKey {
  if (item.kind === "preparation") return "finishedGoods"
  if (item.kind === "good" || item.kind === "modifier") return "goods"
  return "rawMaterials"
}

export const DOCUMENT_MODULES = {
  "outgoing-invoice": { moduleId: "outgoing-invoices", prefix: "РН", label: "Расходная накладная" },
  "supplier-return": { moduleId: "supplier-returns", prefix: "ВП", label: "Возврат поставщику" },
  inventory: { moduleId: "inventories", prefix: "ИНВ", label: "Инвентаризация" },
  transfer: { moduleId: "transfers", prefix: "ПРМ", label: "Внутреннее перемещение" },
  writeoff: { moduleId: "writeoffs", prefix: "СП", label: "Акт списания" },
} as const

export type StockDocumentType = keyof typeof DOCUMENT_MODULES

/** Money by account pair, posted once per pair per document. */
class PostingTotals {
  private totals = new Map<string, { debit: string; credit: string; amount: number }>()
  add(debit: string, credit: string, amount: number) {
    if (amount <= 0) return
    const key = `${debit}>${credit}`
    const current = this.totals.get(key) ?? { debit, credit, amount: 0 }
    current.amount += amount
    this.totals.set(key, current)
  }
  entries() {
    return [...this.totals.values()].map((entry) => ({ ...entry, amount: Math.round(entry.amount) })).filter((entry) => entry.amount > 0)
  }
}

export async function postStockDocument(ctx: MutationCtx, document: Doc<"stockDocuments">, lines: Doc<"stockDocumentLines">[], actorEmail: string) {
  const config = DOCUMENT_MODULES[document.type]
  const source = document.sourceWarehouseId ? await ctx.db.get(document.sourceWarehouseId) : null
  const destination = document.destinationWarehouseId ? await ctx.db.get(document.destinationWarehouseId) : null
  const totals = new PostingTotals()
  let totalAmount = 0
  // W2-STK-13: VAT only when the organization (and for a return, the supplier) pays it.
  const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", document.organizationExternalId)).unique()
  const supplier = document.supplierId ? await ctx.db.get(document.supplierId) : null
  const vatApplies = Boolean(organization?.vatPayer) && (document.type !== "supplier-return" || Boolean(supplier?.vatPayer))
  const receiptVat = new Map<string, number>()
  if (document.type === "supplier-return" && document.receiptExternalId) {
    const receipt = await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", document.receiptExternalId!)).unique()
    if (receipt) for (const row of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) receiptVat.set(row.inventoryItemId, row.vatRate)
  }
  const selling = document.type === "outgoing-invoice" && lines.some((line) => line.salePrice !== undefined)
  let obligationAmount = 0
  const base = { sourceModuleId: config.moduleId, sourceExternalId: document.externalId, sourceNumber: document.number, occurredAt: document.date, actorEmail }

  for (const line of lines) {
    const item = await ctx.db.get(line.inventoryItemId)
    if (!item) throw new ConvexError("Складская позиция не найдена")
    const account = stockAccountOf(item)
    const key = `${document.externalId}:${line.lineNo}`

    if (document.type === "inventory") {
      // B-16: book quantity is taken at the document date at posting time, not when the draft was saved.
      if (!source) throw new ConvexError("Выберите склад")
      const booked = await ctx.db
        .query("stockMovements")
        .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", source._id).eq("inventoryItemId", item._id).lte("occurredAt", document.date))
        .order("desc")
        .first()
      const expected = booked?.balanceAfter ?? 0
      const delta = roundQuantity((line.actualQuantity ?? 0) - expected)
      await ctx.db.patch(line._id, { expectedQuantity: expected })
      if (delta === 0) continue
      const movement = await applyStockMovement(ctx, { ...base, externalId: key, kind: "document", warehouseId: source._id, inventoryItemId: item._id, quantityDelta: delta, allowNegative: true })
      if (delta > 0) totals.add(account, "otherIncome", movement.amount ?? 0)
      else totals.add("inventoryVariance", account, movement.amount ?? 0)
      totalAmount += movement.amount ?? 0
      continue
    }

    if (!(line.quantity > 0)) throw new ConvexError("Количество в строке должно быть больше нуля")
    if (!source) throw new ConvexError("Выберите склад-источник")
    const out = await applyStockMovement(ctx, { ...base, externalId: `${key}:out`, kind: "document", warehouseId: source._id, inventoryItemId: item._id, quantityDelta: -line.quantity, reason: document.reason || undefined })
    const amount = out.amount ?? 0
    totalAmount += amount

    if (document.type === "transfer") {
      if (!destination) throw new ConvexError("Выберите склад назначения")
      // The destination receives at the source's cost — the amount is not doubled.
      await applyStockMovement(ctx, { ...base, externalId: `${key}:in`, kind: "document", warehouseId: destination._id, inventoryItemId: item._id, quantityDelta: line.quantity, unitCost: out.unitCost })
    } else if (document.type === "writeoff") totals.add("cashShortage", account, amount)
    else if (document.type === "supplier-return") {
      // Stock leaves at its average (net) cost; the bill shrinks by that plus the VAT taken back.
      const rate = receiptVat.get(item._id) ?? line.vatRate
      const vat = vatApplies ? (amount * rate) / 100 : 0
      totals.add("payables", account, amount)
      totals.add("payables", "vatRecoverable", vat)
      obligationAmount += amount + vat
    } else if (document.type === "outgoing-invoice") {
      if (!selling) {
        // A hand-over at cost (W1): the buyer owes the cost.
        totals.add("receivables", account, amount)
        obligationAmount += amount
        continue
      }
      const sale = Math.round(line.quantity * (line.salePrice ?? 0))
      const vat = vatApplies ? (sale * line.vatRate) / (100 + line.vatRate) : 0
      totals.add("cogs", account, amount)
      totals.add("receivables", "revenue", sale - vat)
      totals.add("receivables", "vatPayable", vat)
      obligationAmount += sale
    }
  }

  const restaurantExternalId = document.restaurantExternalId
  for (const [index, entry] of totals.entries().entries()) {
    await postJournalEntry(ctx, {
      externalId: `${document.externalId}:je:${index}:${entry.debit}:${entry.credit}`,
      restaurantExternalId,
      sourceModuleId: config.moduleId,
      sourceExternalId: document.externalId,
      sourceNumber: document.number,
      occurredAt: document.date,
      businessDate: businessDateFor(document.date),
      debitAccount: entry.debit,
      creditAccount: entry.credit,
      amount: entry.amount,
      description: `${config.label} ${document.number}`,
      warehouseExternalId: document.sourceWarehouseExternalId,
    })
  }
  return { totalAmount: Math.round(totalAmount), obligationAmount: Math.round(obligationAmount), saleTotal: selling ? Math.round(obligationAmount) : undefined }
}

export async function reverseStockSource(ctx: MutationCtx, args: { sourceExternalId: string; occurredAt: number; reason: string; actorEmail: string }) {
  await reverseSourceMovements(ctx, { sourceExternalId: args.sourceExternalId, occurredAt: args.occurredAt, reversalKey: "reverse", actorEmail: args.actorEmail, reason: args.reason })
  await reverseJournalEntries(ctx, { sourceExternalId: args.sourceExternalId, occurredAt: args.occurredAt, reversalKey: "reverse", description: `Сторно: ${args.reason}` })
}
