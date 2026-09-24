import { useMemo, useState } from "react"

import type { PriceOrder, SavePriceOrderArgs } from "../data/use-price-orders"

// Draft of a price order (W1-CAT-11). Dates are edited as Almaty wall time (UTC+5, no DST);
// «Было» and the cost come from the server's saved lines, not from the draft.

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

export interface PriceLineDraft {
  key: string
  productExternalId: string
  productName: string
  sizeOptionExternalId?: string
  sizeLabel?: string
  included: boolean
  newPrice: number | null
}

export interface ScheduleDraft {
  enabled: boolean
  name: string
  start: string
  end: string
  weekdays: number[]
}

export interface PriceOrderDraft {
  name: string
  effectiveFrom: string
  effectiveTo: string
  comment: string
  posName: string
  replacesPreviousMenu: boolean
  restaurantExternalIds: string[]
  schedule: ScheduleDraft
  lines: PriceLineDraft[]
}

export interface PriceOrderErrors {
  name?: string
  effectiveFrom?: string
  effectiveTo?: string
  restaurants?: string
  schedule?: string
  lines?: string
  lineRows: Record<string, string>
}

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 7, label: "Вс" },
]

export function lineKey(productExternalId: string, sizeOptionExternalId?: string | null) {
  return `${productExternalId}:${sizeOptionExternalId ?? ""}`
}

/** Timestamp → "2026-09-24T10:30" in Almaty for <input type="datetime-local">. */
export function toAlmatyInput(value: number) {
  return new Date(value + ALMATY_OFFSET_MS).toISOString().slice(0, 16)
}

/** "2026-09-24T10:30" (Almaty) → timestamp; empty or invalid → null. */
export function fromAlmatyInput(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null
  const value = Date.parse(`${text}:00Z`)
  return Number.isNaN(value) ? null : value - ALMATY_OFFSET_MS
}

export function minutesToTime(minutes: number) {
  const clamped = Math.max(0, Math.min(1440, minutes))
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`
}

/** "07:30" → 450; "24:00" is the end of the day. */
export function timeToMinutes(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null
}

/** Markup over the portion cost, whole percent; no cost (no active recipe card) → null («—», L-19). */
export function markupPercent(newPrice: number | null, cost: number) {
  if (newPrice === null || !(cost > 0)) return null
  return Math.round(((newPrice - cost) / cost) * 100)
}

export function draftFromOrder(order: PriceOrder): PriceOrderDraft {
  return {
    name: order.name,
    effectiveFrom: toAlmatyInput(order.effectiveFrom),
    effectiveTo: order.effectiveTo === null ? "" : toAlmatyInput(order.effectiveTo),
    comment: order.comment,
    posName: order.posName,
    replacesPreviousMenu: order.replacesPreviousMenu,
    restaurantExternalIds: [...order.restaurantExternalIds],
    schedule: order.schedule
      ? { enabled: true, name: order.schedule.name, start: minutesToTime(order.schedule.startMinute), end: minutesToTime(order.schedule.endMinute), weekdays: [...order.schedule.weekdays].sort((a, b) => a - b) }
      : { enabled: false, name: "", start: "07:00", end: "11:00", weekdays: [1, 2, 3, 4, 5] },
    lines: order.lines.map((line) => ({
      key: lineKey(line.productExternalId, line.sizeOptionExternalId),
      productExternalId: line.productExternalId,
      productName: line.productName,
      ...(line.sizeOptionExternalId ? { sizeOptionExternalId: line.sizeOptionExternalId } : {}),
      ...(line.sizeLabel ? { sizeLabel: line.sizeLabel } : {}),
      included: line.included,
      newPrice: line.newPrice,
    })),
  }
}

export function validatePriceOrder(draft: PriceOrderDraft, options: { network: boolean }): PriceOrderErrors {
  const errors: PriceOrderErrors = { lineRows: {} }
  if (!draft.name.trim()) errors.name = "Укажите название приказа"
  const from = fromAlmatyInput(draft.effectiveFrom)
  if (from === null) errors.effectiveFrom = "Укажите дату и время начала"
  if (draft.effectiveTo.trim()) {
    const to = fromAlmatyInput(draft.effectiveTo)
    if (to === null) errors.effectiveTo = "Дата окончания заполнена не полностью"
    else if (from !== null && to <= from) errors.effectiveTo = "Окончание должно быть позже начала"
  }
  if (!options.network && draft.restaurantExternalIds.length === 0) errors.restaurants = "Выберите хотя бы один филиал"
  if (draft.schedule.enabled) {
    const start = timeToMinutes(draft.schedule.start)
    const end = timeToMinutes(draft.schedule.end)
    if (draft.schedule.weekdays.length === 0) errors.schedule = "Выберите дни недели"
    else if (start === null || end === null || start >= end) errors.schedule = "Время «с» должно быть раньше времени «по»"
  }
  for (const line of draft.lines) if (line.newPrice === null) errors.lineRows[line.key] = "Укажите новую цену"
  return errors
}

export function hasPriceOrderErrors(errors: PriceOrderErrors) {
  return Boolean(errors.name || errors.effectiveFrom || errors.effectiveTo || errors.restaurants || errors.schedule || errors.lines) || Object.keys(errors.lineRows).length > 0
}

export function savePriceOrderArgs(externalId: string, draft: PriceOrderDraft): SavePriceOrderArgs {
  const effectiveTo = draft.effectiveTo.trim() ? fromAlmatyInput(draft.effectiveTo) : null
  return {
    externalId,
    name: draft.name.trim(),
    effectiveFrom: fromAlmatyInput(draft.effectiveFrom) ?? Date.now(),
    ...(effectiveTo !== null ? { effectiveTo } : {}),
    comment: draft.comment.trim(),
    posName: draft.posName.trim(),
    replacesPreviousMenu: draft.replacesPreviousMenu,
    restaurantExternalIds: draft.restaurantExternalIds,
    schedule: draft.schedule.enabled
      ? {
          name: draft.schedule.name.trim(),
          startMinute: timeToMinutes(draft.schedule.start) ?? 0,
          endMinute: timeToMinutes(draft.schedule.end) ?? 1440,
          weekdays: [...draft.schedule.weekdays].sort((a, b) => a - b),
        }
      : null,
    lines: draft.lines.map((line) => ({
      productExternalId: line.productExternalId,
      ...(line.sizeOptionExternalId ? { sizeOptionExternalId: line.sizeOptionExternalId } : {}),
      included: line.included,
      newPrice: line.newPrice ?? 0,
    })),
  }
}

/** Lines for a dish being added: one per size of its scale, else one; new price starts at the base × coefficient. */
export function linesForProduct(
  product: { externalId: string; name: string; basePrice: number },
  sizes: readonly { externalId: string; label: string; coefficient: number; sortOrder: number }[] | undefined,
): PriceLineDraft[] {
  if (!sizes || sizes.length === 0) return [{ key: lineKey(product.externalId), productExternalId: product.externalId, productName: product.name, included: true, newPrice: product.basePrice }]
  return [...sizes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((size) => ({
      key: lineKey(product.externalId, size.externalId),
      productExternalId: product.externalId,
      productName: product.name,
      sizeOptionExternalId: size.externalId,
      sizeLabel: size.label,
      included: true,
      newPrice: Math.round(product.basePrice * size.coefficient),
    }))
}

export function usePriceOrderDraft(order: PriceOrder) {
  const [baseline, setBaseline] = useState(() => draftFromOrder(order))
  const [draft, setDraft] = useState(baseline)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline])
  return {
    draft,
    dirty,
    set: (patch: Partial<PriceOrderDraft>) => setDraft((current) => ({ ...current, ...patch })),
    setSchedule: (patch: Partial<ScheduleDraft>) => setDraft((current) => ({ ...current, schedule: { ...current.schedule, ...patch } })),
    setLine: (key: string, patch: Partial<PriceLineDraft>) => setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) })),
    removeLine: (key: string) => setDraft((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) })),
    /** Adds lines that are not in the order yet; returns how many were new. */
    addLines: (lines: PriceLineDraft[]) => {
      const existing = new Set(draft.lines.map((line) => line.key))
      const fresh = lines.filter((line) => !existing.has(line.key))
      if (fresh.length) setDraft((current) => ({ ...current, lines: [...current.lines, ...fresh] }))
      return fresh.length
    },
    reset: () => setDraft(baseline),
    markSaved: () => setBaseline(draft),
  }
}
