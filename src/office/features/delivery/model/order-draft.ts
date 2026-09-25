import { fromAlmatyInput, toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { DeliveryChannel, DeliveryOrder, SaveOrderArgs } from "../data/use-delivery"

// The delivery order card's form (W2-DLV-05). Unit prices shown in the lines come from the server
// (`products` for a new line, the saved order line otherwise); totals only from the saved order.

export type DeliveryLineDraft = {
  key: string
  productExternalId: string
  productName: string
  quantity: string
  /** Server price of one portion: `products` (resolvePrice) or the saved line; null until known. */
  unitPrice: number | null
  /** The saved line's total from the server; null for a new or changed line. */
  lineTotal: number | null
  sizeExternalId: string | null
  sizeLabel: string | null
  modifierSelections: { modifierExternalId: string; quantity: number }[]
  /** «Сыр ×2» of the saved line's modifiers, for display. */
  modifierLabels: string[]
}

export type DeliveryDraft = {
  restaurantExternalId: string
  customerName: string
  phone: string
  email: string
  address: string
  latitude: string
  longitude: string
  sourceExternalId: string
  /** "2026-09-24T10:30", Almaty time. */
  expectedAt: string
  courierExternalId: string
  comment: string
  lines: DeliveryLineDraft[]
}

export type DeliveryErrors = Partial<Record<"customerName" | "phone" | "address" | "restaurant" | "source" | "expectedAt" | "latitude" | "longitude" | "lines" | "email", string>> & { rows: Record<string, string> }

let lineCounter = 0
export const nextLineKey = () => `line-${++lineCounter}`

/** Default promise for a new order: in an hour, rounded up to 5 minutes. */
export function defaultExpectedAt(now: number) {
  const step = 5 * 60_000
  return Math.ceil((now + 60 * 60_000) / step) * step
}

export function emptyDraft(options: { restaurantExternalId?: string; sourceExternalId?: string; now: number }): DeliveryDraft {
  return {
    restaurantExternalId: options.restaurantExternalId ?? "",
    customerName: "",
    phone: "",
    email: "",
    address: "",
    latitude: "",
    longitude: "",
    sourceExternalId: options.sourceExternalId ?? "",
    expectedAt: toAlmatyInput(defaultExpectedAt(options.now)),
    courierExternalId: "",
    comment: "",
    lines: [],
  }
}

export function draftFromOrder(order: DeliveryOrder): DeliveryDraft {
  return {
    restaurantExternalId: order.restaurantExternalId,
    customerName: order.customerName,
    phone: order.phone ?? "",
    email: order.email ?? "",
    address: order.address,
    latitude: order.latitude === undefined ? "" : String(order.latitude),
    longitude: order.longitude === undefined ? "" : String(order.longitude),
    sourceExternalId: order.sourceExternalId,
    expectedAt: toAlmatyInput(order.expectedAt),
    courierExternalId: order.courierExternalId ?? "",
    comment: order.comment,
    lines: order.lines.map((line) => ({
      key: nextLineKey(),
      productExternalId: line.productExternalId,
      productName: line.productName,
      quantity: String(line.quantity),
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      sizeExternalId: line.sizeExternalId,
      sizeLabel: line.sizeLabel,
      modifierSelections: line.modifierSelections.map((modifier) => ({ modifierExternalId: modifier.externalId, quantity: modifier.quantity })),
      modifierLabels: line.modifierSelections.filter((modifier) => modifier.quantity > 0).map((modifier) => (modifier.quantity > 1 ? `${modifier.name} ×${modifier.quantity}` : modifier.name)),
    })),
  }
}

/** The server masks the phone without office.guests.pii («7701••••90»): such a card cannot be re-saved. */
export function isMaskedPhone(phone: string | undefined) {
  return /[•*]/.test(phone ?? "")
}

const phoneDigits = (phone: string) => phone.replace(/\D/g, "")

export function validateDraft(draft: DeliveryDraft): DeliveryErrors {
  const errors: DeliveryErrors = { rows: {} }
  if (!draft.restaurantExternalId) errors.restaurant = "Выберите ресторан"
  if (draft.customerName.trim().length < 2) errors.customerName = "Укажите имя гостя"
  const digits = phoneDigits(draft.phone)
  if (digits.length < 10 || digits.length > 15) errors.phone = "Телефон — от 10 до 15 цифр"
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = "Проверьте email"
  if (draft.address.trim().length < 3) errors.address = "Укажите адрес"
  if (!draft.sourceExternalId) errors.source = "Выберите источник"
  if (fromAlmatyInput(draft.expectedAt) === null) errors.expectedAt = "Укажите дату и время"
  const latitude = draft.latitude.trim() ? parseDecimal(draft.latitude) : null
  const longitude = draft.longitude.trim() ? parseDecimal(draft.longitude) : null
  if (draft.latitude.trim() && (latitude === null || Math.abs(latitude) > 90)) errors.latitude = "Широта — от −90 до 90"
  if (draft.longitude.trim() && (longitude === null || Math.abs(longitude) > 180)) errors.longitude = "Долгота — от −180 до 180"
  if (!errors.latitude && !errors.longitude && Boolean(draft.latitude.trim()) !== Boolean(draft.longitude.trim())) {
    errors[draft.latitude.trim() ? "longitude" : "latitude"] = "Укажите обе координаты — по ним выбирается зона доставки"
  }
  if (draft.lines.length === 0) errors.lines = "Добавьте хотя бы одну позицию"
  for (const line of draft.lines) {
    const quantity = parseDecimal(line.quantity)
    if (quantity === null || quantity <= 0) errors.rows[line.key] = "Количество должно быть больше нуля"
  }
  return errors
}

export function hasErrors(errors: DeliveryErrors) {
  return Object.entries(errors).some(([key, value]) => (key === "rows" ? Object.keys(value as Record<string, string>).length > 0 : Boolean(value)))
}

export function saveArgs(draft: DeliveryDraft, options: { externalId?: string; expectedVersion?: number; channel: DeliveryChannel }): SaveOrderArgs {
  const latitude = draft.latitude.trim() ? parseDecimal(draft.latitude) : null
  const longitude = draft.longitude.trim() ? parseDecimal(draft.longitude) : null
  return {
    ...(options.externalId ? { externalId: options.externalId, expectedVersion: options.expectedVersion } : {}),
    channel: options.channel,
    restaurantExternalId: draft.restaurantExternalId,
    customerName: draft.customerName.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim() || undefined,
    address: draft.address.trim(),
    ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
    sourceExternalId: draft.sourceExternalId,
    expectedAt: fromAlmatyInput(draft.expectedAt) ?? 0,
    courierExternalId: draft.courierExternalId || undefined,
    comment: draft.comment.trim(),
    lines: draft.lines.map((line) => ({
      productExternalId: line.productExternalId,
      quantity: parseDecimal(line.quantity) ?? 0,
      ...(line.sizeExternalId ? { sizeExternalId: line.sizeExternalId } : {}),
      ...(line.modifierSelections.length ? { modifierSelections: line.modifierSelections } : {}),
    })),
  }
}

/** Adds a dish: the same dish without size and modifiers gets +1 instead of a second line. */
export function addProduct(lines: readonly DeliveryLineDraft[], product: { productExternalId: string; name: string; price: number }): DeliveryLineDraft[] {
  const same = lines.find((line) => line.productExternalId === product.productExternalId && !line.sizeExternalId && line.modifierSelections.length === 0)
  if (same) {
    const quantity = (parseDecimal(same.quantity) ?? 0) + 1
    return lines.map((line) => (line.key === same.key ? { ...line, quantity: String(quantity), lineTotal: null } : line))
  }
  return [
    ...lines,
    { key: nextLineKey(), productExternalId: product.productExternalId, productName: product.name, quantity: "1", unitPrice: product.price, lineTotal: null, sizeExternalId: null, sizeLabel: null, modifierSelections: [], modifierLabels: [] },
  ]
}

/** A comparable snapshot for the unsaved-changes indicator (line keys are local). */
export function draftSignature(draft: DeliveryDraft) {
  return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, lineTotal: _total, unitPrice: _price, modifierLabels: _labels, ...line }) => line) })
}
