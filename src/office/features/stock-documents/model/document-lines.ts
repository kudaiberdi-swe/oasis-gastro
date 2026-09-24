import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { DocumentTypeConfig } from "./document-types"

// Lines of a stock document draft. Quantities are edited as text (a comma is fine); the cost is the
// warehouse average the server writes on posting, the expected quantity of an inventory too.

export interface DocumentLineDraft {
  key: string
  itemExternalId: string
  itemName: string
  unit: string | null
  quantity: string
  actualQuantity: string
  vatRate: string
  /** From the saved line (server): 0 until posting. */
  unitCost: number
  expectedQuantity: number | null
}

export interface SavedDocumentLine {
  lineNo: number
  itemExternalId: string | null
  itemName: string | null
  unit: string | null
  quantity: number
  actualQuantity?: number
  expectedQuantity?: number
  unitCost: number
  vatRate: number
}

const text = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","))

export function linesFromSaved(lines: readonly SavedDocumentLine[]): DocumentLineDraft[] {
  return lines
    .filter((line) => line.itemExternalId)
    .map((line) => ({
      key: `line-${line.lineNo}`,
      itemExternalId: line.itemExternalId!,
      itemName: line.itemName ?? line.itemExternalId!,
      unit: line.unit,
      quantity: text(line.quantity),
      actualQuantity: text(line.actualQuantity),
      vatRate: String(line.vatRate ?? 0),
      unitCost: line.unitCost,
      expectedQuantity: line.expectedQuantity ?? null,
    }))
}

let nextKey = 0
export function newLine(item: { externalId: string; name: string; unit: string | null; defaultVatRate?: number }): DocumentLineDraft {
  nextKey += 1
  return { key: `new-${nextKey}`, itemExternalId: item.externalId, itemName: item.name, unit: item.unit, quantity: "", actualQuantity: "", vatRate: String(item.defaultVatRate ?? 0), unitCost: 0, expectedQuantity: null }
}

/** The counted quantity of a line: «Факт» for an inventory, «Количество» otherwise. */
export function lineQuantity(line: DocumentLineDraft, config: Pick<DocumentTypeConfig, "inventory">) {
  return parseDecimal(config.inventory ? line.actualQuantity : line.quantity)
}

/** Inventory difference «факт − учёт»; null until the server fills the expected quantity on posting. */
export function inventoryDelta(line: DocumentLineDraft) {
  const actual = parseDecimal(line.actualQuantity)
  if (actual === null || line.expectedQuantity === null) return null
  return Math.round((actual - line.expectedQuantity) * 1000) / 1000
}

export function lineAmount(line: DocumentLineDraft, config: Pick<DocumentTypeConfig, "inventory">) {
  const quantity = config.inventory ? inventoryDelta(line) : lineQuantity(line, config)
  if (quantity === null || !(line.unitCost > 0)) return null
  return Math.round(quantity * line.unitCost)
}

export function documentTotals(lines: readonly DocumentLineDraft[], config: Pick<DocumentTypeConfig, "inventory">) {
  let quantity = 0
  let amount = 0
  for (const line of lines) {
    quantity += lineQuantity(line, config) ?? 0
    amount += lineAmount(line, config) ?? 0
  }
  return { quantity: Math.round(quantity * 1000) / 1000, amount }
}

export type LineErrors = Record<string, string>

export function validateLines(lines: readonly DocumentLineDraft[], config: Pick<DocumentTypeConfig, "inventory">): LineErrors {
  const errors: LineErrors = {}
  for (const line of lines) {
    const value = lineQuantity(line, config)
    if (config.inventory ? value === null || value < 0 : value === null || value <= 0) errors[line.key] = config.inventory ? "Укажите факт (0 или больше)" : "Количество больше нуля"
  }
  return errors
}

export function saveLines(lines: readonly DocumentLineDraft[], config: Pick<DocumentTypeConfig, "inventory" | "vat">) {
  return lines.map((line) => {
    const actual = parseDecimal(line.actualQuantity) ?? 0
    return {
      itemExternalId: line.itemExternalId,
      quantity: config.inventory ? actual : (parseDecimal(line.quantity) ?? 0),
      ...(config.inventory ? { actualQuantity: actual } : {}),
      ...(config.vat ? { vatRate: Number(line.vatRate) || 0 } : {}),
    }
  })
}
