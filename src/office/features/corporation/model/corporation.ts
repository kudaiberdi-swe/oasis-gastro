import { isValidKzBin } from "../../../../../convex/lib/bin"
import { MAX_BUSINESS_DAY_CUTOFF_MINUTES } from "../../../../../convex/lib/time"

// «Корпорация» (W2-ADM-06…09): labels, conversions and rules shared by the four screens. Pure functions,
// so the forms and the tests use the same logic as the server.

export { isValidKzBin, MAX_BUSINESS_DAY_CUTOFF_MINUTES }

/** Russian plural: 1 запись, 2–4 записи, 5+ записей (11–14 → записей). */
export function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const RECORDS: [string, string, string] = ["запись", "записи", "записей"]

/** «1 запись», «3 записи», «12 записей» (the bahandi «1 записей» is fixed). */
export const recordCount = (count: number) => `${count} ${plural(count, RECORDS)}`

export type StatusTab = "all" | "active" | "inactive"

export const MASTER_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "inactive", label: "Неактивные" },
]

export function matchesStatus(active: boolean, tab: StatusTab) {
  return tab === "all" || active === (tab === "active")
}

/** Case-insensitive search over a few fields of a row. */
export function matchesSearch(needle: string, ...values: (string | null | undefined)[]) {
  const query = needle.trim().toLocaleLowerCase("ru")
  if (!query) return true
  return values.some((value) => value?.toLocaleLowerCase("ru").includes(query))
}

export type Currency = "KZT" | "RUB" | "USD"
export type Jurisdiction = "KZ" | "RU"

export const CURRENCY_LABELS: Record<Currency, string> = { KZT: "Тенге (KZT)", RUB: "Рубль (RUB)", USD: "Доллар (USD)" }
export const JURISDICTION_LABELS: Record<Jurisdiction, string> = { KZ: "Казахстан", RU: "Россия" }

export function isCurrency(value: string | undefined | null): value is Currency {
  return value === "KZT" || value === "RUB" || value === "USD"
}

/** Kazakhstan zones first (Almaty is the default), then Moscow for RU organizations. */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Almaty", label: "Asia/Almaty · Алматы, Астана (UTC+5)" },
  { value: "Asia/Qostanay", label: "Asia/Qostanay · Костанай (UTC+5)" },
  { value: "Asia/Qyzylorda", label: "Asia/Qyzylorda · Кызылорда (UTC+5)" },
  { value: "Asia/Aqtobe", label: "Asia/Aqtobe · Актобе (UTC+5)" },
  { value: "Asia/Aqtau", label: "Asia/Aqtau · Актау (UTC+5)" },
  { value: "Asia/Atyrau", label: "Asia/Atyrau · Атырау (UTC+5)" },
  { value: "Asia/Oral", label: "Asia/Oral · Уральск (UTC+5)" },
  { value: "Europe/Moscow", label: "Europe/Moscow · Москва (UTC+3)" },
]

/** The known zones plus the row's own value, so an imported zone is never lost. */
export function timezoneOptions(current: string | undefined) {
  return current && !TIMEZONES.some((zone) => zone.value === current) ? [{ value: current, label: current }, ...TIMEZONES] : TIMEZONES
}

export type ServiceMode = "fast-food" | "table-service" | "delivery"

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = { "fast-food": "Фастфуд", "table-service": "Ресторан с обслуживанием", delivery: "Доставка" }

export function isServiceMode(value: string | undefined | null): value is ServiceMode {
  return value === "fast-food" || value === "table-service" || value === "delivery"
}

/** 240 → «04:00». */
export function minutesToTime(minutes: number | undefined | null) {
  const value = Math.max(0, Math.round(minutes ?? 0))
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}

/** «04:30» → 270; anything that is not ЧЧ:ММ within 00:00–12:00 → null. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59) return null
  const total = hours * 60 + minutes
  return total >= 0 && total <= MAX_BUSINESS_DAY_CUTOFF_MINUTES ? total : null
}

export type DepartmentKind = "restaurant" | "production" | "warehouse" | "office" | "delivery"

export const DEPARTMENT_KIND_LABELS: Record<DepartmentKind, string> = {
  restaurant: "Ресторан",
  production: "Производство",
  warehouse: "Склад",
  office: "Офис",
  delivery: "Доставка",
}

/** The department and everything under it: none of them can become its parent. */
export function descendantsOf(rows: { externalId: string; parentExternalId?: string | null }[], rootExternalId: string) {
  const result = new Set([rootExternalId])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (row.parentExternalId && result.has(row.parentExternalId) && !result.has(row.externalId)) {
        result.add(row.externalId)
        grew = true
      }
    }
  }
  return result
}

/** A row from iiko keeps its source fields; the office edits only the local ones. */
export function isFromIiko(row: { sourceSystem?: string | null; sourceReadOnly?: boolean | null } | null | undefined) {
  return Boolean(row && (row.sourceReadOnly || row.sourceSystem === "iiko-server"))
}

// --- Очередь интеграций ---------------------------------------------------

export type JobStatus = "queued" | "processing" | "retrying" | "completed" | "failed" | "dead-letter" | "cancelled"
export type JobTab = "all" | Exclude<JobStatus, "cancelled">

export const JOB_TABS: { value: JobTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "queued", label: "В очереди" },
  { value: "processing", label: "Выполняется" },
  { value: "retrying", label: "Повтор" },
  { value: "failed", label: "Ошибки" },
  { value: "dead-letter", label: "Не доставлено" },
  { value: "completed", label: "Готово" },
]

/** «Повторить» — only a failed or dead-letter job (W2-ADM-09). */
export function canRetryJob(status: string) {
  return status === "failed" || status === "dead-letter"
}

/** «Отменить» — the server cancels only a job still waiting in the queue (queued / retrying). */
export function canCancelJob(status: string) {
  return status === "queued" || status === "retrying"
}

export const JOB_DIRECTION_LABELS: Record<"inbound" | "outbound", string> = { inbound: "Входящее", outbound: "Исходящее" }

const PROVIDER_LABELS: Record<string, string> = {
  "convex-event-bus": "Шина событий",
  "external-menu": "Внешнее меню",
  fiscal: "Фискализация",
  edi: "EDI",
  bank: "Банк",
  "1c": "1С",
  loyalty: "Лояльность",
  messaging: "Сообщения",
  maps: "Карты",
  "cloud-api": "Cloud API",
  egais: "ЕГАИС",
  iiko: "iiko",
}

/** Readable provider name instead of the bahandi caps («CONVEX-EVENT-BUS» → «Шина событий»). */
export function providerLabel(provider: string) {
  const known = PROVIDER_LABELS[provider.toLowerCase()]
  if (known) return known
  const words = provider.replace(/[-_]+/g, " ").trim()
  return words ? words.charAt(0).toLocaleUpperCase("ru") + words.slice(1).toLocaleLowerCase("ru") : provider
}

export const KNOWN_PROVIDERS = Object.keys(PROVIDER_LABELS)
