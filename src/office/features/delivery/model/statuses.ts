import { deliveryTransitions, type DeliveryStatus } from "../../../../../convex/lib/deliveryCore"

// Delivery lifecycle on screen (W2-DLV-02/03). The transition table is the server's own
// (convex/lib/deliveryCore.ts), so a button never offers a move the server refuses.

export type { DeliveryStatus }

export type DeliveryTab = "active" | "unprocessed" | "waiting" | "on-way" | "closed" | "all"

/** Same six tabs and statuses as convex/domains/delivery/shared.ts TAB_STATUSES. */
export const DELIVERY_TABS: { value: DeliveryTab; label: string }[] = [
  { value: "active", label: "В работе" },
  { value: "unprocessed", label: "Не обработаны" },
  { value: "waiting", label: "Ожидают" },
  { value: "on-way", label: "В пути" },
  { value: "closed", label: "Закрыты" },
  { value: "all", label: "Все" },
]

/** Statuses in which saveOrder still accepts edits (convex/domains/delivery/mutations.ts EDITABLE). */
export const EDITABLE_STATUSES: readonly DeliveryStatus[] = ["unprocessed", "unconfirmed", "waiting"]

/** Before dispatch a courier is assigned with assignCourier; after that only transitions change it. */
export const COURIER_ASSIGNABLE_STATUSES: readonly DeliveryStatus[] = ["ready-to-cook", "cooking", "cooked", "awaiting-dispatch"]

/** The button label of a move to `to` (the verb, not the status name). */
export function transitionLabel(from: DeliveryStatus, to: DeliveryStatus): string {
  if (from === "delivered" && to === "on-way") return "Вернуть в путь"
  switch (to) {
    case "unconfirmed":
      return "Ждёт подтверждения"
    case "waiting":
      return "Подтвердить"
    case "ready-to-cook":
      return "Пора готовить"
    case "cooking":
      return "Начать готовить"
    case "cooked":
      return "Приготовлен"
    case "awaiting-dispatch":
      return "Ждёт отправки"
    case "on-way":
      return "Отправить"
    case "delivered":
      return "Доставлен"
    case "closed":
      return "Закрыть"
    case "cancelled":
      return "Отменить"
    default:
      return to
  }
}

export type TransitionAction = { to: DeliveryStatus; label: string; kind: "primary" | "secondary" | "danger" }

/**
 * Buttons for the order's next statuses: the first forward move is the main one, the rest secondary,
 * «Отменить» last and danger. `canCancel` hides it without office.delivery-orders.cancel.
 */
export function transitionActions(status: DeliveryStatus, options: { canEdit: boolean; canCancel: boolean }): TransitionAction[] {
  const next = deliveryTransitions[status] ?? []
  const forward = options.canEdit ? next.filter((to) => to !== "cancelled") : []
  const actions: TransitionAction[] = forward.map((to, index) => ({ to, label: transitionLabel(status, to), kind: index === 0 && !(status === "delivered" && to === "on-way") ? "primary" : "secondary" }))
  if (options.canCancel && next.includes("cancelled")) actions.push({ to: "cancelled", label: "Отменить", kind: "danger" })
  return actions
}

/** The one forward move a register row offers as a quick action, if it needs no extra input. */
export function quickTransition(status: DeliveryStatus): DeliveryStatus | null {
  const to = (deliveryTransitions[status] ?? []).find((candidate) => candidate !== "cancelled")
  if (!to) return null
  // A courier, a payment or a return to the road are decided in the card.
  if (to === "on-way" || to === "delivered" || to === "closed") return null
  return to
}

export type SettlementMode = "on-delivered" | "on-closed"

/**
 * Whether the move pays the commercial order (checkoutCore) and so needs «Оплата при доставке».
 * Mirrors `settles` in transitionOrder: the source decides the moment, an unpaid order is paid at close.
 */
export function needsPayment(to: DeliveryStatus, settlementMode: SettlementMode | undefined, paymentStatus: "unpaid" | "paid" | "refunded") {
  if (paymentStatus === "paid") return false
  if (to === "delivered") return (settlementMode ?? "on-delivered") === "on-delivered"
  if (to === "closed") return true
  return false
}

/** The server's refusal when the restaurant's delivery till has no open shift. */
export function isClosedShiftError(message: string) {
  return /Откройте смену/.test(message)
}

export const SOURCE_KIND_LABELS: Record<"phone" | "website" | "app" | "aggregator" | "office", string> = {
  phone: "Телефон",
  website: "Сайт",
  app: "Приложение",
  aggregator: "Агрегатор",
  office: "Офис",
}

export const SETTLEMENT_LABELS: Record<SettlementMode, string> = {
  "on-delivered": "При доставке",
  "on-closed": "При закрытии",
}

export const TRANSPORT_OPTIONS: { value: "foot" | "bicycle" | "scooter" | "car"; label: string }[] = [
  { value: "foot", label: "Пешком" },
  { value: "bicycle", label: "Велосипед" },
  { value: "scooter", label: "Самокат" },
  { value: "car", label: "Автомобиль" },
]

/** Seeded default source of the call center (scripts/seed-sandyq.mjs). */
export const PHONE_SOURCE_EXTERNAL_ID = "source-phone"

/** The call center pre-fills «Телефон»: the seeded source, else any active phone source of the restaurant. */
export function defaultSourceFor(channel: "delivery" | "call-center", sources: readonly { externalId: string; kind: string }[]) {
  if (channel !== "call-center") return undefined
  return sources.find((source) => source.externalId === PHONE_SOURCE_EXTERNAL_ID)?.externalId ?? sources.find((source) => source.kind === "phone")?.externalId
}
