import { useMemo, useState } from "react"

import { fromAlmatyInput, toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { ProductionTypeConfig } from "./production"

// Draft of a production / logistics document (W2-PRD-03…06). Quantities and prices are edited as text
// (a comma is fine); the line cost is what the server writes on posting (`amount`), never computed here.

export interface ActLineDraft {
  key: string
  /** productExternalId (production) or inventoryItemExternalId; "" when a saved line could not be matched. */
  ref: string
  name: string
  unit: string | null
  quantity: string
  direction: "input" | "output"
  expectedUnitCost: string
  costShare: string
  /** From the posted line (server). */
  amount: number | null
}

export interface ActDraft {
  restaurantExternalId: string
  /** "2026-09-24T10:30", Almaty. */
  date: string
  sourceWarehouseExternalId: string
  destinationWarehouseExternalId: string
  supplierExternalId: string
  /** "2026-09-26", Almaty. */
  expectedDate: string
  concept: string
  comment: string
  lines: ActLineDraft[]
}

export type HeaderField = "restaurant" | "date" | "source" | "destination" | "supplier" | "expectedDate" | "lines"
export type HeaderErrors = Partial<Record<HeaderField, string>>
export type LineErrors = Record<string, string>

const text = (value: number | undefined | null) => (value === undefined || value === null ? "" : String(value).replace(".", ","))

let nextKey = 0
export function newActLine(item: { ref: string; name: string; unit: string | null }, direction: "input" | "output" = "input"): ActLineDraft {
  nextKey += 1
  return { key: `new-${nextKey}`, ref: item.ref, name: item.name, unit: item.unit, quantity: "", direction, expectedUnitCost: "", costShare: "", amount: null }
}

export function emptyActDraft(restaurantExternalId: string, now = Date.now()): ActDraft {
  return { restaurantExternalId, date: toAlmatyInput(now), sourceWarehouseExternalId: "", destinationWarehouseExternalId: "", supplierExternalId: "", expectedDate: "", concept: "", comment: "", lines: [] }
}

export interface SavedActLine {
  lineNo: number
  name: string
  quantity: number
  direction: "input" | "output"
  expectedUnitCost?: number
  costShare?: number
  amount?: number
}

export interface SavedActDocument {
  restaurantExternalId: string
  date: number
  expectedDate?: number
  concept?: string
  comment: string
  sourceWarehouse: { externalId: string } | null
  destinationWarehouse: { externalId: string } | null
  supplier: { externalId: string } | null
  lines: readonly SavedActLine[]
}

/** `refs` maps a saved line (lineNo) to its external id and unit — see useLineRefs. */
export function draftFromDocument(document: SavedActDocument, refs: ReadonlyMap<number, { ref: string; unit: string | null }>): ActDraft {
  return {
    restaurantExternalId: document.restaurantExternalId,
    date: toAlmatyInput(document.date),
    sourceWarehouseExternalId: document.sourceWarehouse?.externalId ?? "",
    destinationWarehouseExternalId: document.destinationWarehouse?.externalId ?? "",
    supplierExternalId: document.supplier?.externalId ?? "",
    expectedDate: document.expectedDate ? toAlmatyInput(document.expectedDate).slice(0, 10) : "",
    concept: document.concept ?? "",
    comment: document.comment,
    lines: document.lines.map((line) => ({
      key: `line-${line.lineNo}`,
      ref: refs.get(line.lineNo)?.ref ?? "",
      name: line.name,
      unit: refs.get(line.lineNo)?.unit ?? null,
      quantity: text(line.quantity),
      direction: line.direction,
      expectedUnitCost: text(line.expectedUnitCost),
      costShare: text(line.costShare),
      amount: line.amount ?? null,
    })),
  }
}

/** "2026-09-26" → Almaty midnight; empty or invalid → null. */
export function fromDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromAlmatyInput(`${value}T00:00`) : null
}

export function validateActDraft(config: ProductionTypeConfig, draft: ActDraft): { header: HeaderErrors; lines: LineErrors } {
  const header: HeaderErrors = {}
  const lines: LineErrors = {}
  if (!draft.restaurantExternalId) header.restaurant = "Выберите ресторан"
  if (fromAlmatyInput(draft.date) === null) header.date = "Укажите дату и время"
  if (config.sourceLabel && !draft.sourceWarehouseExternalId) header.source = "Выберите склад-источник"
  if (config.destinationLabel && !draft.destinationWarehouseExternalId) header.destination = "Выберите склад назначения"
  if (config.crossRestaurant && draft.sourceWarehouseExternalId && draft.sourceWarehouseExternalId === draft.destinationWarehouseExternalId) header.destination = "Склады источника и назначения совпадают"
  if (config.supplier && !draft.supplierExternalId) header.supplier = "Выберите поставщика"
  if (config.expectedDate && draft.expectedDate && fromDateInput(draft.expectedDate) === null) header.expectedDate = "Некорректная дата"
  if (!draft.lines.length) header.lines = config.lineMode === "preparation" ? "Добавьте хотя бы одну заготовку" : "Добавьте хотя бы одну позицию"
  else if (config.lineMode === "directional" && (!draft.lines.some((line) => line.direction === "input") || !draft.lines.some((line) => line.direction === "output"))) header.lines = "Нужны строки входа и выхода"
  for (const line of draft.lines) {
    const quantity = parseDecimal(line.quantity)
    if (!line.ref) lines[line.key] = "Позиция не распознана — удалите строку и добавьте заново"
    else if (quantity === null || quantity <= 0) lines[line.key] = "Количество больше нуля"
    else if (config.lineMode === "directional" && line.direction === "output" && line.costShare.trim() && !((parseDecimal(line.costShare) ?? 0) > 0)) lines[line.key] = "Доля себестоимости больше нуля"
    else if (config.lineMode === "purchase" && line.expectedUnitCost.trim() && !((parseDecimal(line.expectedUnitCost) ?? -1) >= 0)) lines[line.key] = "Проверьте ожидаемую цену"
  }
  return { header, lines }
}

export function isValid(errors: { header: HeaderErrors; lines: LineErrors }) {
  return Object.keys(errors.header).length === 0 && Object.keys(errors.lines).length === 0
}

/** saveDocument arguments; the server resolves lines, numbers the document and ignores client prices except the expected ones. */
export function toSaveArgs(config: ProductionTypeConfig, draft: ActDraft, externalId?: string) {
  const expectedDate = config.expectedDate ? fromDateInput(draft.expectedDate) : null
  return {
    ...(externalId ? { externalId } : {}),
    type: config.type,
    restaurantExternalId: draft.restaurantExternalId,
    date: fromAlmatyInput(draft.date) ?? Date.now(),
    ...(config.sourceLabel && draft.sourceWarehouseExternalId ? { sourceWarehouseExternalId: draft.sourceWarehouseExternalId } : {}),
    ...(config.destinationLabel && draft.destinationWarehouseExternalId ? { destinationWarehouseExternalId: draft.destinationWarehouseExternalId } : {}),
    ...(config.supplier && draft.supplierExternalId ? { supplierExternalId: draft.supplierExternalId } : {}),
    ...(expectedDate !== null ? { expectedDate } : {}),
    ...(config.concept && draft.concept.trim() ? { concept: draft.concept.trim() } : {}),
    comment: draft.comment.trim(),
    lines: draft.lines.map((line) => {
      const quantity = parseDecimal(line.quantity) ?? 0
      if (config.lineMode === "preparation") return { productExternalId: line.ref, quantity }
      const costShare = parseDecimal(line.costShare)
      const expectedUnitCost = parseDecimal(line.expectedUnitCost)
      return {
        inventoryItemExternalId: line.ref,
        quantity,
        ...(config.lineMode === "directional" ? { direction: line.direction } : {}),
        ...(config.lineMode === "directional" && line.direction === "output" && costShare !== null ? { costShare } : {}),
        ...(config.lineMode === "purchase" && expectedUnitCost !== null ? { expectedUnitCost } : {}),
      }
    }),
  }
}

/** Draft state with a baseline: dirty, reset, and «saved» that moves the baseline. */
export function useActDraft(initial: ActDraft) {
  const [baseline, setBaseline] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  return {
    draft,
    dirty,
    set: (patch: Partial<ActDraft>) => setDraft((current) => ({ ...current, ...patch })),
    setLines: (update: (lines: ActLineDraft[]) => ActLineDraft[]) => setDraft((current) => ({ ...current, lines: update(current.lines) })),
    reset: () => setDraft(baseline),
    markSaved: (saved: ActDraft = draft) => setBaseline(saved),
  }
}
