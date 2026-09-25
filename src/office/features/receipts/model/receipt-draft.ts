import { toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { Receipt } from "../data/use-receipts"

// Draft of a receipt (W1-STK-11). Totals are computed exactly as saveReceipt does: the line amount is
// quantity × price with VAT rounded to whole tenge, VAT is the included share, net = gross − VAT.

export interface ReceiptLineDraft {
  key: string
  /** The saved line number: price-check warnings refer to it. */
  lineNo: number | null
  itemExternalId: string
  itemName: string
  unit: string | null
  quantity: string
  unitCostGross: number | null
  vatRate: string
}

export interface ReceiptDraft {
  date: string
  supplierExternalId: string
  warehouseExternalId: string
  invoiceNumber: string
  lines: ReceiptLineDraft[]
}

export function draftFromReceipt(receipt: Receipt): ReceiptDraft {
  return {
    date: toAlmatyInput(receipt.date),
    supplierExternalId: receipt.supplier?.externalId ?? "",
    warehouseExternalId: receipt.warehouse?.externalId ?? "",
    invoiceNumber: receipt.invoiceNumber,
    lines: receipt.lines
      .filter((line) => line.itemExternalId)
      .map((line) => ({
        key: `line-${line.lineNo}`,
        lineNo: line.lineNo,
        itemExternalId: line.itemExternalId!,
        itemName: line.itemName ?? line.itemExternalId!,
        unit: line.unit,
        quantity: String(line.quantity).replace(".", ","),
        unitCostGross: line.unitCostGross,
        vatRate: String(line.vatRate),
      })),
  }
}

let nextKey = 0
export function newReceiptLine(item: { externalId: string; name: string; unit: string | null; defaultVatRate?: number }): ReceiptLineDraft {
  nextKey += 1
  return { key: `new-${nextKey}`, lineNo: null, itemExternalId: item.externalId, itemName: item.name, unit: item.unit, quantity: "", unitCostGross: null, vatRate: String(item.defaultVatRate ?? 0) }
}

const vatShare = (gross: number, rate: number) => (rate > 0 ? gross - gross / (1 + rate / 100) : 0)

export function lineGross(line: Pick<ReceiptLineDraft, "quantity" | "unitCostGross">) {
  const quantity = parseDecimal(line.quantity)
  if (quantity === null || line.unitCostGross === null) return null
  return Math.round(quantity * line.unitCostGross)
}

export function receiptTotals(lines: readonly Pick<ReceiptLineDraft, "quantity" | "unitCostGross" | "vatRate">[]) {
  let gross = 0
  let vat = 0
  for (const line of lines) {
    const amount = lineGross(line) ?? 0
    gross += amount
    vat += vatShare(amount, Number(line.vatRate) || 0)
  }
  const totalVat = Math.round(vat)
  return { gross, vat: totalVat, net: gross - totalVat }
}

export type ReceiptErrors = { supplier?: string; warehouse?: string; date?: string; lines?: string; rows: Record<string, string> }

export function validateReceipt(draft: ReceiptDraft, parseDate: (text: string) => number | null): ReceiptErrors {
  const errors: ReceiptErrors = { rows: {} }
  if (!draft.supplierExternalId) errors.supplier = "Выберите поставщика"
  if (!draft.warehouseExternalId) errors.warehouse = "Выберите склад"
  if (parseDate(draft.date) === null) errors.date = "Укажите дату и время"
  for (const line of draft.lines) {
    const quantity = parseDecimal(line.quantity)
    if (quantity === null || quantity <= 0) errors.rows[line.key] = "Количество больше нуля"
    else if (line.unitCostGross === null) errors.rows[line.key] = "Укажите цену"
  }
  return errors
}

export const hasReceiptErrors = (errors: ReceiptErrors) => Boolean(errors.supplier || errors.warehouse || errors.date || errors.lines) || Object.keys(errors.rows).length > 0

/**
 * «Оприходовать на склад» of a new receipt: the warehouses of the restaurant in the filter, and of the
 * supplier's restaurants when the supplier is bound to some (an empty list — it delivers everywhere).
 */
export function warehousesForSupplier<W extends { restaurantExternalId: string }>(warehouses: readonly W[], supplier: { restaurantExternalIds?: readonly string[] } | undefined, restaurantExternalId?: string): W[] {
  const bound = supplier?.restaurantExternalIds?.length ? new Set(supplier.restaurantExternalIds) : null
  return warehouses.filter((warehouse) => (!restaurantExternalId || warehouse.restaurantExternalId === restaurantExternalId) && (!bound || bound.has(warehouse.restaurantExternalId)))
}
