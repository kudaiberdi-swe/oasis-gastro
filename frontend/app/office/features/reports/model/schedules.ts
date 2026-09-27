import type { StatusTone } from "@/shared/lib/status-dictionary"

import { nextRunAt, parseTimeOfDay, periodFor, type Cadence, type PeriodPreset, type ScheduleTiming } from "@convex/lib/reportSchedule"

// Report mailings (W2-RPT-06): labels, recipient checks and the calendar preview. The calendar is the
// server's own module (convex/lib/reportSchedule.ts, Asia/Almaty), so the dialog shows exactly the slot
// the server will store.

export { nextRunAt, parseTimeOfDay, periodFor, type Cadence, type PeriodPreset, type ScheduleTiming }

export type ScheduleFormat = "xlsx" | "csv" | "pdf"

export const MAX_RECIPIENTS = 20
export const DEFAULT_TIME = "08:00"

/** The same rule as saveSchedule (convex/domains/reports/schedules.ts). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US")
}

export function isValidEmail(value: string) {
  return EMAIL.test(normalizeEmail(value))
}

/** Splits pasted text («a@x.kz, b@x.kz; c@x.kz») into candidate addresses. */
export function splitEmails(value: string) {
  return value
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean)
}

export const FORMAT_LABELS: Record<ScheduleFormat, string> = { xlsx: "XLSX", csv: "CSV", pdf: "PDF" }

export const CADENCE_LABELS: Record<Cadence, string> = { daily: "Ежедневно", weekly: "Еженедельно", monthly: "Ежемесячно" }

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  yesterday: "Вчера",
  "last-7-days": "Последние 7 дней",
  "last-month": "Прошлый месяц",
  "month-to-date": "С начала месяца",
}

/** A sensible data period for a new cadence (the user can still pick another one). */
export const DEFAULT_PERIOD: Record<Cadence, PeriodPreset> = { daily: "yesterday", weekly: "last-7-days", monthly: "last-month" }

/** ISO weekday, Monday = 1 (as the server stores it). */
export const WEEKDAYS = [
  { value: 1, label: "Понедельник", short: "пн" },
  { value: 2, label: "Вторник", short: "вт" },
  { value: 3, label: "Среда", short: "ср" },
  { value: 4, label: "Четверг", short: "чт" },
  { value: 5, label: "Пятница", short: "пт" },
  { value: 6, label: "Суббота", short: "сб" },
  { value: 7, label: "Воскресенье", short: "вс" },
] as const

/** «Ежедневно в 08:00», «Еженедельно, пн в 09:30», «Ежемесячно, 31-го в 08:00». */
export function describeCadence(timing: ScheduleTiming) {
  if (timing.cadence === "weekly") {
    const day = WEEKDAYS.find((item) => item.value === timing.weekday)?.short ?? "пн"
    return `Еженедельно, ${day} в ${timing.timeOfDay}`
  }
  if (timing.cadence === "monthly") return `Ежемесячно, ${timing.dayOfMonth ?? 1}-го в ${timing.timeOfDay}`
  return `Ежедневно в ${timing.timeOfDay}`
}

/**
 * lastStatus is written by the server as Russian text («Формируется», «Готово · ожидает провайдера
 * отправки», «Нет доступа», «Ошибка: …»). Here it gets a tone and, where the raw text is technical,
 * a plainer label; the full text stays in the title.
 */
export function describeLastStatus(status: string | undefined): { label: string; tone: StatusTone } | null {
  if (!status) return null
  if (status === "Формируется") return { label: "Формируется", tone: "info" }
  if (status.startsWith("Готово")) return { label: status.includes("ожидает") ? "Файл готов · ждёт отправки" : "Готово", tone: status.includes("ожидает") ? "warning" : "success" }
  if (status === "Нет доступа") return { label: "Нет доступа к отчёту", tone: "danger" }
  if (status.startsWith("Ошибка")) return { label: "Ошибка формирования", tone: "danger" }
  return { label: status, tone: "neutral" }
}

export function scheduleStatus(active: boolean): { label: string; tone: StatusTone } {
  return active ? { label: "Активна", tone: "success" } : { label: "Отключена", tone: "neutral" }
}
