import { fromAlmatyInput, toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"

import type { DeliveryChannel, DeliveryOrder, SaveOrderArgs } from "../data/use-delivery"

// The delivery order card's form (W2-DLV-05). Unit prices shown in the lines come from the server
// (`products` / `productConfiguration` for a new line, the saved order line otherwise); totals only from
// the saved order. A configured line's price is a preview by the POS rules until the server prices it.

export type DeliveryLineDraft = {
  key: string
  productExternalId: string
  productName: string
  quantity: string
  /** Server price of one portion: `products` / `productConfiguration` or the saved line; null until known. */
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

/**
 * The server masks the phone without office.guests.pii («7701••••90»). saveOrder and saveCourier keep the
 * stored phone when the mask comes back, so a masked card is saved with the mask as is.
 */
export function isMaskedPhone(phone: string | undefined) {
  return (phone ?? "").includes("•")
}

const phoneDigits = (phone: string) => phone.replace(/\D/g, "")

/** `phoneOnFile`: a saved order whose phone the server keeps when it comes masked. */
export function validateDraft(draft: DeliveryDraft, options: { phoneOnFile?: boolean } = {}): DeliveryErrors {
  const errors: DeliveryErrors = { rows: {} }
  if (!draft.restaurantExternalId) errors.restaurant = "Выберите ресторан"
  if (draft.customerName.trim().length < 2) errors.customerName = "Укажите имя гостя"
  const digits = phoneDigits(draft.phone)
  if (isMaskedPhone(draft.phone)) {
    if (!options.phoneOnFile) errors.phone = "Телефон скрыт — введите номер гостя"
  } else if (digits.length < 10 || digits.length > 15) errors.phone = "Телефон — от 10 до 15 цифр"
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
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) errors.rows[line.key] = "Количество — целое число от 1 до 99"
  }
  return errors
}

export function hasErrors(errors: DeliveryErrors) {
  return Object.entries(errors).some(([key, value]) => (key === "rows" ? Object.keys(value as Record<string, string>).length > 0 : Boolean(value)))
}

/**
 * saveOrder.courierExternalId: absent keeps the order's courier, null unassigns, a new one must be free
 * (the server moves them to «Назначен»). `currentCourierExternalId` is the saved order's courier.
 */
export function courierArg(draftCourier: string, currentCourierExternalId: string | null | undefined, existing: boolean): { courierExternalId?: string | null } {
  if (!existing) return draftCourier ? { courierExternalId: draftCourier } : {}
  if (draftCourier === (currentCourierExternalId ?? "")) return {}
  return { courierExternalId: draftCourier || null }
}

export function saveArgs(draft: DeliveryDraft, options: { externalId?: string; expectedVersion?: number; channel: DeliveryChannel; currentCourierExternalId?: string | null }): SaveOrderArgs {
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
    ...courierArg(draft.courierExternalId, options.currentCourierExternalId, Boolean(options.externalId)),
    comment: draft.comment.trim(),
    lines: draft.lines.map((line) => ({
      productExternalId: line.productExternalId,
      quantity: parseDecimal(line.quantity) ?? 0,
      ...(line.sizeExternalId ? { sizeExternalId: line.sizeExternalId } : {}),
      ...(line.modifierSelections.length ? { modifierSelections: line.modifierSelections } : {}),
    })),
  }
}

/** A dish to add: `price` is the portion price (with the size and modifiers when configured). */
export type DishChoice = {
  productExternalId: string
  name: string
  price: number
  quantity?: number
  sizeExternalId?: string | null
  sizeLabel?: string | null
  modifierSelections?: { modifierExternalId: string; quantity: number }[]
  modifierLabels?: string[]
}

/** Same dish, same size, same modifiers — the lines that merge into one. */
export function lineIdentity(line: { productExternalId: string; sizeExternalId?: string | null; modifierSelections?: readonly { modifierExternalId: string; quantity: number }[] }) {
  const modifiers = [...(line.modifierSelections ?? [])].sort((a, b) => a.modifierExternalId.localeCompare(b.modifierExternalId)).map((row) => `${row.modifierExternalId}:${row.quantity}`)
  return `${line.productExternalId}|${line.sizeExternalId ?? ""}|${modifiers.join(",")}`
}

/** Adds a dish: the same dish with the same size and modifiers gets +quantity instead of a second line. */
export function addProduct(lines: readonly DeliveryLineDraft[], dish: DishChoice): DeliveryLineDraft[] {
  const added = dish.quantity ?? 1
  const candidate = { productExternalId: dish.productExternalId, sizeExternalId: dish.sizeExternalId ?? null, modifierSelections: dish.modifierSelections ?? [] }
  const same = lines.find((line) => lineIdentity(line) === lineIdentity(candidate))
  if (same) {
    const quantity = (parseDecimal(same.quantity) ?? 0) + added
    return lines.map((line) => (line.key === same.key ? { ...line, quantity: String(quantity), lineTotal: null } : line))
  }
  return [
    ...lines,
    {
      key: nextLineKey(),
      productExternalId: dish.productExternalId,
      productName: dish.name,
      quantity: String(added),
      unitPrice: dish.price,
      lineTotal: null,
      sizeExternalId: candidate.sizeExternalId,
      sizeLabel: dish.sizeLabel ?? null,
      modifierSelections: candidate.modifierSelections,
      modifierLabels: dish.modifierLabels ?? [],
    },
  ]
}

/** A line re-configured in the dialog: new size, modifiers and preview price; the total waits for the save. */
export function reconfigureLine(line: DeliveryLineDraft, dish: DishChoice): DeliveryLineDraft {
  return {
    ...line,
    quantity: dish.quantity === undefined ? line.quantity : String(dish.quantity),
    unitPrice: dish.price,
    lineTotal: null,
    sizeExternalId: dish.sizeExternalId ?? null,
    sizeLabel: dish.sizeLabel ?? null,
    modifierSelections: dish.modifierSelections ?? [],
    modifierLabels: dish.modifierLabels ?? [],
  }
}

/** A comparable snapshot for the unsaved-changes indicator (line keys are local). */
export function draftSignature(draft: DeliveryDraft) {
  return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, lineTotal: _total, unitPrice: _price, modifierLabels: _labels, ...line }) => line) })
}
