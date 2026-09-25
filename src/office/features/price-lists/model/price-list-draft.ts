import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { DeviationPolicy, PriceList, PriceListKind, SavePriceListArgs } from "../data/use-price-lists"

// The price list card's form (W2-CAT-15). Figures are typed as text and parsed with a Russian comma;
// the per-unit price in the table is the server's (`unitPrice`) for saved lines only.

export const POLICY_OPTIONS: { value: DeviationPolicy; label: string }[] = [
  { value: "ignore", label: "Не проверять" },
  { value: "warn", label: "Предупреждать" },
  { value: "block", label: "Блокировать" },
  { value: "block-higher", label: "Блокировать выше" },
]

export const KIND_OPTIONS: { value: PriceListKind; label: string }[] = [
  { value: "supplier", label: "Поставщика" },
  { value: "internal", label: "Внутренний" },
]

export type PriceListLineDraft = {
  key: string
  inventoryItemExternalId: string
  itemName: string
  itemUnit: string
  supplierSku: string
  supplierName: string
  unitExternalId: string
  packageCoefficient: string
  price: string
  deviationPercent: string
  /** Server price per stock unit of the saved line; null once the line changes. */
  unitPrice: number | null
}

export type PriceListDraft = {
  name: string
  kind: PriceListKind
  supplierExternalId: string
  /** "2026-09-24", the Almaty day the list starts. */
  effectiveFrom: string
  deviationPolicy: DeviationPolicy
  deviationPercent: string
  lines: PriceListLineDraft[]
}

export type PriceListErrors = Partial<Record<"name" | "supplier" | "effectiveFrom" | "deviationPercent" | "lines", string>> & { rows: Record<string, string> }

let counter = 0
const nextKey = () => `pl-line-${++counter}`

const decimalText = (value: number) => String(value).replace(".", ",")

export function emptyPriceListDraft(now: number): PriceListDraft {
  return { name: "", kind: "supplier", supplierExternalId: "", effectiveFrom: almatyBusinessDate(now), deviationPolicy: "warn", deviationPercent: "5", lines: [] }
}

export function draftFromPriceList(list: PriceList): PriceListDraft {
  return {
    name: list.name,
    kind: list.kind,
    supplierExternalId: list.supplier?.externalId ?? "",
    effectiveFrom: almatyBusinessDate(list.effectiveFrom),
    deviationPolicy: list.deviationPolicy,
    deviationPercent: decimalText(list.deviationPercent),
    lines: list.lines.map((line) => ({
      key: nextKey(),
      inventoryItemExternalId: line.inventoryItemExternalId,
      itemName: line.itemName,
      itemUnit: line.itemUnit,
      supplierSku: line.supplierSku,
      supplierName: line.supplierName,
      unitExternalId: line.unitExternalId ?? "",
      packageCoefficient: decimalText(line.packageCoefficient),
      price: decimalText(line.price),
      deviationPercent: line.deviationPercent === undefined ? "" : decimalText(line.deviationPercent),
      unitPrice: line.unitPrice,
    })),
  }
}

export function newPriceListLine(item: { externalId: string; name: string; unit?: string; unitExternalId?: string }): PriceListLineDraft {
  return {
    key: nextKey(),
    inventoryItemExternalId: item.externalId,
    itemName: item.name,
    itemUnit: item.unit ?? "",
    supplierSku: "",
    supplierName: "",
    unitExternalId: item.unitExternalId ?? "",
    packageCoefficient: "1",
    price: "",
    deviationPercent: "",
    unitPrice: null,
  }
}

/** "2026-09-24" → the Almaty midnight of that day; invalid → null. */
export function effectiveFromTimestamp(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const value = Date.parse(`${date}T00:00:00+05:00`)
  return Number.isNaN(value) ? null : value
}

const percentOk = (value: number | null) => value !== null && value >= 0 && value <= 100

export function validatePriceList(draft: PriceListDraft): PriceListErrors {
  const errors: PriceListErrors = { rows: {} }
  if (draft.name.trim().length < 2) errors.name = "Укажите название"
  if (draft.kind === "supplier" && !draft.supplierExternalId) errors.supplier = "Выберите поставщика"
  if (effectiveFromTimestamp(draft.effectiveFrom) === null) errors.effectiveFrom = "Укажите дату начала"
  if (!percentOk(parseDecimal(draft.deviationPercent))) errors.deviationPercent = "Допуск — от 0 до 100 %"
  const seen = new Set<string>()
  for (const line of draft.lines) {
    const price = parseDecimal(line.price)
    const coefficient = parseDecimal(line.packageCoefficient)
    if (seen.has(line.inventoryItemExternalId)) errors.rows[line.key] = "Товар указан дважды"
    else if (price === null || price <= 0) errors.rows[line.key] = "Цена должна быть больше нуля"
    else if (coefficient === null || coefficient <= 0) errors.rows[line.key] = "Коэффициент упаковки должен быть больше нуля"
    else if (line.deviationPercent.trim() && !percentOk(parseDecimal(line.deviationPercent))) errors.rows[line.key] = "Допуск — от 0 до 100 %"
    seen.add(line.inventoryItemExternalId)
  }
  return errors
}

export function hasPriceListErrors(errors: PriceListErrors) {
  return Boolean(errors.name || errors.supplier || errors.effectiveFrom || errors.deviationPercent || errors.lines || Object.keys(errors.rows).length)
}

export function savePriceListArgs(draft: PriceListDraft, externalId?: string): SavePriceListArgs {
  return {
    ...(externalId ? { externalId } : {}),
    name: draft.name.trim(),
    kind: draft.kind,
    ...(draft.kind === "supplier" ? { supplierExternalId: draft.supplierExternalId } : {}),
    effectiveFrom: effectiveFromTimestamp(draft.effectiveFrom) ?? 0,
    deviationPolicy: draft.deviationPolicy,
    deviationPercent: parseDecimal(draft.deviationPercent) ?? 0,
    lines: draft.lines.map((line) => ({
      inventoryItemExternalId: line.inventoryItemExternalId,
      supplierSku: line.supplierSku.trim(),
      supplierName: line.supplierName.trim(),
      ...(line.unitExternalId ? { unitExternalId: line.unitExternalId } : {}),
      packageCoefficient: parseDecimal(line.packageCoefficient) ?? 0,
      price: parseDecimal(line.price) ?? 0,
      ...(line.deviationPercent.trim() ? { deviationPercent: parseDecimal(line.deviationPercent) ?? 0 } : {}),
    })),
  }
}

export function priceListSignature(draft: PriceListDraft) {
  return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, unitPrice: _unitPrice, ...line }) => line) })
}
