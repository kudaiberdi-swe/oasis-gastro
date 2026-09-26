import type { FunctionArgs } from "convex/server"

import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import { api } from "../../../../convex/_generated/api"

// «План на кухню» and «Ведомость полуфабрикатов» (W3-PRD-07/08) over convex/domains/productionLogistics.
// Both pages show the same «Прогноз кухни» panel (L-14); the server builds every line from the forecast.

export type RecordModule = FunctionArgs<typeof api.domains.productionLogistics.queries.listRecords>["moduleId"]
export type RecordStatus = NonNullable<FunctionArgs<typeof api.domains.productionLogistics.queries.listRecords>["status"]>
export type RecordAction = FunctionArgs<typeof api.domains.productionLogistics.mutations.transitionRecord>["action"]

export interface LogisticsConfig {
  moduleId: RecordModule
  title: string
  entityLabel: string
  searchPlaceholder: string
  /** «Создать по прогнозу» — the one button that makes the record from the forecast. */
  createLabel: string
  tabs: { value: "all" | RecordStatus; label: string }[]
  /** Transitions shown on a record: [action, label, tone, capability action]. */
  actions: { action: RecordAction; label: string; from: RecordStatus[]; right: "edit" | "post" | "reverse" | "cancel"; kind: "primary" | "danger" | "secondary" }[]
  linesTitle: string
  itemLabel: string
}

export const LOGISTICS: Record<RecordModule, LogisticsConfig> = {
  "kitchen-plan": {
    moduleId: "kitchen-plan",
    title: "План на кухню",
    entityLabel: "План на кухню",
    searchPlaceholder: "Поиск: план на кухню",
    createLabel: "Новая запись",
    tabs: [
      { value: "all", label: "Все" },
      { value: "draft", label: "Черновики" },
      { value: "active", label: "Активные" },
      { value: "cancelled", label: "Отменённые" },
    ],
    actions: [
      { action: "approve", label: "Утвердить", from: ["draft"], right: "edit", kind: "primary" },
      { action: "cancel", label: "Отменить", from: ["draft", "active"], right: "edit", kind: "danger" },
    ],
    linesTitle: "Блюда",
    itemLabel: "Блюдо",
  },
  "semi-finished-sheet": {
    moduleId: "semi-finished-sheet",
    title: "Ведомость полуфабрикатов",
    entityLabel: "Ведомость полуфабрикатов",
    searchPlaceholder: "Поиск: ведомость полуфабрикатов",
    createLabel: "Новая запись",
    tabs: [
      { value: "all", label: "Все" },
      { value: "draft", label: "Черновики" },
      { value: "posted", label: "Проведённые" },
      { value: "reversed", label: "Сторно" },
    ],
    actions: [
      { action: "post", label: "Провести", from: ["draft"], right: "post", kind: "primary" },
      { action: "reverse", label: "Сторно", from: ["posted"], right: "reverse", kind: "danger" },
      { action: "cancel", label: "Отменить", from: ["draft"], right: "cancel", kind: "danger" },
    ],
    linesTitle: "Заготовки",
    itemLabel: "Заготовка",
  },
}

export const todayAlmaty = () => almatyBusinessDate(Date.now())

/** "2026-09-28" → "28.09.2026". */
export function formatBusinessDate(date: string) {
  const [year, month, day] = date.split("-")
  return `${day}.${month}.${year}`
}

const WEEKDAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
export const weekdayName = (weekday: number) => WEEKDAYS[weekday] ?? ""

/** "HH:MM–HH:MM" of a 15-minute interval (0 … 95). */
export function intervalLabel(index: number) {
  const time = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  return `${time(index * 15)}–${time(index * 15 + 15)}`
}

/** The busiest interval of a forecast row, or null when it has none. */
export function peakInterval(intervals: readonly number[]) {
  let best = -1
  for (const [index, value] of intervals.entries()) if (value > 0 && (best < 0 || value > intervals[best])) best = index
  return best < 0 ? null : best
}

/** A planned quantity typed into a cell: "", "1,5" or "2" → a number, or null when it is not one. */
export function parsePlanned(text: string) {
  const normalized = text.trim().replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : null
}
