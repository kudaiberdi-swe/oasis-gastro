// One status dictionary for the whole app (OFFICE-DESIGN §6, closes L-9): raw values from the backend
// never reach the screen; every status is shown through StatusPill with a Russian label and a tone.

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"

export type StatusEntry = { label: string; tone: StatusTone }

export type StatusDomain = "document" | "order" | "kitchen" | "shift" | "courier" | "call" | "job" | "delivery" | "transport" | "price-list"

const DOCUMENT: Record<string, StatusEntry> = {
  draft: { label: "Черновик", tone: "neutral" },
  "pending-approval": { label: "На согласовании", tone: "warning" },
  approved: { label: "Согласовано", tone: "info" },
  posted: { label: "Проведён", tone: "success" },
  reversed: { label: "Сторнирован", tone: "danger" },
  cancelled: { label: "Отменён", tone: "neutral" },
  published: { label: "Опубликовано", tone: "success" },
  scheduled: { label: "Запланировано", tone: "info" },
  active: { label: "Активно", tone: "success" },
  inactive: { label: "Неактивно", tone: "neutral" },
  expired: { label: "Истекло", tone: "neutral" },
  completed: { label: "Завершено", tone: "success" },
  // Recipe versions (recipeVersions.status): a version replaced by a newer one.
  superseded: { label: "Заменено", tone: "neutral" },
}

const ORDER: Record<string, StatusEntry> = {
  draft: { label: "Открыт", tone: "info" },
  open: { label: "Открыт", tone: "info" },
  held: { label: "Отложен", tone: "warning" },
  paid: { label: "Оплачен", tone: "success" },
  partially_refunded: { label: "Частичный возврат", tone: "warning" },
  refunded: { label: "Возвращён", tone: "danger" },
  cancelled: { label: "Отменён", tone: "neutral" },
}

// Values of convex/lib/validators.ts kitchenStatus.
const KITCHEN: Record<string, StatusEntry> = {
  queued: { label: "В очереди", tone: "info" },
  preparing: { label: "Готовится", tone: "warning" },
  ready: { label: "Готов", tone: "success" },
  completed: { label: "Выдан", tone: "neutral" },
}

const SHIFT: Record<string, StatusEntry> = {
  open: { label: "Открыта", tone: "success" },
  closed: { label: "Закрыта", tone: "neutral" },
  // A closed shift the office accepted (retail/office.listShifts, W1-RTL-06).
  accepted: { label: "Принята", tone: "info" },
}

const COURIER: Record<string, StatusEntry> = {
  offline: { label: "Не на смене", tone: "neutral" },
  available: { label: "Свободен", tone: "success" },
  assigned: { label: "Назначен", tone: "info" },
  "on-delivery": { label: "На доставке", tone: "info" },
  returning: { label: "Возвращается", tone: "neutral" },
}

// deliveryOrders.status (W2-DLV-01); tones as in bahandi delivery-workspace: done — success, in work — info.
const DELIVERY: Record<string, StatusEntry> = {
  unprocessed: { label: "Не обработан", tone: "warning" },
  unconfirmed: { label: "Не подтверждён", tone: "warning" },
  waiting: { label: "Ожидает", tone: "info" },
  "ready-to-cook": { label: "Пора готовить", tone: "info" },
  cooking: { label: "Готовится", tone: "info" },
  cooked: { label: "Приготовлен", tone: "info" },
  "awaiting-dispatch": { label: "Ждёт отправки", tone: "info" },
  "on-way": { label: "В пути", tone: "info" },
  delivered: { label: "Доставлен", tone: "success" },
  closed: { label: "Закрыт", tone: "success" },
  cancelled: { label: "Отменён", tone: "neutral" },
}

// couriers.transport: not a status, but shown the same way (L-9: «scooter» → «Самокат»).
const TRANSPORT: Record<string, StatusEntry> = {
  foot: { label: "Пешком", tone: "neutral" },
  bicycle: { label: "Велосипед", tone: "neutral" },
  scooter: { label: "Самокат", tone: "neutral" },
  car: { label: "Автомобиль", tone: "neutral" },
}

// priceLists.status (W2-CAT-15): a published version expires when the next one is published.
const PRICE_LIST: Record<string, StatusEntry> = {
  draft: { label: "Черновик", tone: "neutral" },
  published: { label: "Опубликован", tone: "success" },
  expired: { label: "Истёк", tone: "neutral" },
}

const CALL: Record<string, StatusEntry> = {
  completed: { label: "Завершён", tone: "success" },
  missed: { label: "Пропущен", tone: "warning" },
  failed: { label: "Ошибка", tone: "danger" },
}

// iikoImportRuns and other background runs use running/completed/failed.
const JOB: Record<string, StatusEntry> = {
  queued: { label: "В очереди", tone: "neutral" },
  processing: { label: "Выполняется", tone: "info" },
  running: { label: "Выполняется", tone: "info" },
  retrying: { label: "Повтор", tone: "warning" },
  completed: { label: "Готово", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
  "dead-letter": { label: "Не доставлено", tone: "danger" },
  // integrationJobs.status also has cancelled (W2-ADM-09).
  cancelled: { label: "Отменено", tone: "neutral" },
}

export const STATUS_DICTIONARY: Record<StatusDomain, Record<string, StatusEntry>> = {
  document: DOCUMENT,
  order: ORDER,
  kitchen: KITCHEN,
  shift: SHIFT,
  courier: COURIER,
  call: CALL,
  job: JOB,
  delivery: DELIVERY,
  transport: TRANSPORT,
  "price-list": PRICE_LIST,
}

/** Normalizes iiko-style values: "PUBLISHED" → "published", "PENDING_APPROVAL" → "pending-approval". */
function normalize(domain: StatusDomain, value: string) {
  const lower = value.trim().toLowerCase()
  if (STATUS_DICTIONARY[domain][lower]) return lower
  const dashed = lower.replace(/_/g, "-")
  if (STATUS_DICTIONARY[domain][dashed]) return dashed
  return lower.replace(/-/g, "_")
}

/** Unknown values fall back to neutral with the raw value, so a missing entry is visible but not broken. */
export function describeStatus(domain: StatusDomain, value: string): StatusEntry & { known: boolean } {
  const entry = STATUS_DICTIONARY[domain][normalize(domain, value)]
  if (entry) return { ...entry, known: true }
  if (import.meta.env?.DEV) console.warn(`[status-dictionary] no label for ${domain}:${value}`)
  return { label: value, tone: "neutral", known: false }
}
