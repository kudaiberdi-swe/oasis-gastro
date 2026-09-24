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
    else if (document.type === "supplier-return") totals.add("payables", account, amount)
    else if (document.type === "outgoing-invoice") totals.add("receivables", account, amount)
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
  return { totalAmount: Math.round(totalAmount) }
}

export async function reverseStockSource(ctx: MutationCtx, args: { sourceExternalId: string; occurredAt: number; reason: string; actorEmail: string }) {
  await reverseSourceMovements(ctx, { sourceExternalId: args.sourceExternalId, occurredAt: args.occurredAt, reversalKey: "reverse", actorEmail: args.actorEmail, reason: args.reason })
  await reverseJournalEntries(ctx, { sourceExternalId: args.sourceExternalId, occurredAt: args.occurredAt, reversalKey: "reverse", description: `Сторно: ${args.reason}` })
}
