import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { formatHours, formatTenge } from "@/shared/lib/format"

import { PAY_TYPES, type PayType, type Role } from "./modules"

// W2-HR-02/03/04/06: «Должности», «Типы смен», «Расписание», «Начисления и удержания» — labels, units, drafts
// and the client-side checks that mirror convex/domains/workforce/{references,schedule,payroll}.ts.

const DAY_MS = 86_400_000
const ALMATY_OFFSET_MS = 5 * 3_600_000
const pad = (value: number) => String(value).padStart(2, "0")
const round2 = (value: number) => Math.round(value * 100) / 100

export type DraftErrors<K extends string> = Partial<Record<K, string>>

// ── Time of day ──────────────────────────────────────────────────────────────

/** 1290 → "21:30". */
export function minuteToTime(minute: number) {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`
}

/** "21:30" → 1290; anything else → null. */
export function timeToMinute(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Length of a shift type in minutes; an end before the start goes over midnight (same as references.ts). */
export function shiftLengthMinutes(startMinute: number, endMinute: number) {
  return (endMinute - startMinute + 1440) % 1440 || 1440
}

/** Paid hours of a shift type: 22:00–06:00 with 30 min break → 7.5. */
export function shiftTypeHours(startMinute: number, endMinute: number, breakMinutes: number) {
  return round2((shiftLengthMinutes(startMinute, endMinute) - breakMinutes) / 60)
}

export const crossesMidnight = (startMinute: number, endMinute: number) => endMinute <= startMinute

/** Hours always carry «ч» (L-10): 8 → «8 ч», 7.5 → «7 ч 30 мин». */
export const formatShiftHours = (hours: number) => formatHours(hours)

// ── Colors of shift types: design tokens of the menu categories, never a hex ─────────────

export const SHIFT_COLORS = [
  { token: "cat-meat", label: "Бордо", swatch: "bg-cat-meat", block: "border-l-cat-meat bg-cat-meat/10" },
  { token: "cat-bread", label: "Янтарь", swatch: "bg-cat-bread", block: "border-l-cat-bread bg-cat-bread/10" },
  { token: "cat-dairy", label: "Золото", swatch: "bg-cat-dairy", block: "border-l-cat-dairy bg-cat-dairy/15" },
  { token: "cat-green", label: "Шалфей", swatch: "bg-cat-green", block: "border-l-cat-green bg-cat-green/10" },
  { token: "cat-tea", label: "Чай", swatch: "bg-cat-tea", block: "border-l-cat-tea bg-cat-tea/10" },
  { token: "cat-turkistan", label: "Бирюза", swatch: "bg-cat-turkistan", block: "border-l-cat-turkistan bg-cat-turkistan/10" },
] as const

export type ShiftColorToken = (typeof SHIFT_COLORS)[number]["token"]

const NEUTRAL_COLOR = { token: "", label: "Без цвета", swatch: "bg-muted-foreground", block: "border-l-muted-foreground bg-muted" }

export function shiftColor(token: string | null | undefined) {
  return SHIFT_COLORS.find((color) => color.token === token) ?? NEUTRAL_COLOR
}

// ── Positions (W2-HR-02) ─────────────────────────────────────────────────────

export const POS_ROLE_NONE = "none"

export interface PositionDraft {
  code: string
  name: string
  departmentExternalId: string
  payType: PayType
  defaultRate: number | null
  weeklyHours: string
  posRole: Role | ""
  description: string
}

export interface PositionLike {
  externalId: string
  version: number
  code: string
  name: string
  departmentExternalId?: string
  payType: PayType
  defaultRate: number
  weeklyHours: number
  posRole?: Role
  description?: string
}

export function positionDraftOf(position: PositionLike | null): PositionDraft {
  if (!position) return { code: "", name: "", departmentExternalId: "", payType: "hourly", defaultRate: null, weeklyHours: "40", posRole: "", description: "" }
  return {
    code: position.code,
    name: position.name,
    departmentExternalId: position.departmentExternalId ?? "",
    payType: position.payType,
    defaultRate: position.defaultRate,
    weeklyHours: String(position.weeklyHours).replace(".", ","),
    posRole: position.posRole ?? "",
    description: position.description ?? "",
  }
}

const parseDecimal = (text: string) => {
  const clean = text.trim().replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(clean)) return null
  return Number(clean)
}

/** Same rules as savePosition. */
export function validatePosition(draft: PositionDraft): DraftErrors<"code" | "name" | "defaultRate" | "weeklyHours" | "payType"> {
  const errors: DraftErrors<"code" | "name" | "defaultRate" | "weeklyHours" | "payType"> = {}
  if (!draft.code.trim()) errors.code = "Укажите код"
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (!PAY_TYPES.includes(draft.payType)) errors.payType = "Выберите тип оплаты"
  if (draft.defaultRate === null || !Number.isInteger(draft.defaultRate) || draft.defaultRate < 0) errors.defaultRate = "Ставка — целое число тенге"
  const hours = parseDecimal(draft.weeklyHours)
  if (hours === null || !(hours > 0 && hours <= 84)) errors.weeklyHours = "Норма часов в неделю — от 1 до 84"
  return errors
}

export function positionArgs(position: PositionLike | null, draft: PositionDraft) {
  return {
    ...(position ? { externalId: position.externalId, expectedVersion: position.version } : {}),
    code: draft.code.trim(),
    name: draft.name.trim(),
    ...(draft.departmentExternalId ? { departmentExternalId: draft.departmentExternalId } : {}),
    payType: draft.payType,
    defaultRate: draft.defaultRate ?? 0,
    weeklyHours: parseDecimal(draft.weeklyHours) ?? 0,
    ...(draft.posRole ? { posRole: draft.posRole } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
  }
}

// ── Shift types (W2-HR-03) ───────────────────────────────────────────────────

export interface ShiftTypeDraft {
  code: string
  name: string
  start: string
  end: string
  breakMinutes: string
  nightCoefficient: string
  holidayCoefficient: string
  colorToken: string
}

export interface ShiftTypeLike {
  externalId: string
  version: number
  code: string
  name: string
  startMinute: number
  endMinute: number
  breakMinutes: number
  nightCoefficient: number
  holidayCoefficient: number
  colorToken: string
}

const coefficientText = (value: number) => String(value).replace(".", ",")

/** «×1,5» — a coefficient of the base rate. */
export const formatCoefficient = (value: number) => `×${coefficientText(value)}`

export function shiftTypeDraftOf(row: ShiftTypeLike | null): ShiftTypeDraft {
  if (!row) return { code: "", name: "", start: "09:00", end: "21:00", breakMinutes: "60", nightCoefficient: "1", holidayCoefficient: "1", colorToken: SHIFT_COLORS[0].token }
  return {
    code: row.code,
    name: row.name,
    start: minuteToTime(row.startMinute),
    end: minuteToTime(row.endMinute),
    breakMinutes: String(row.breakMinutes),
    nightCoefficient: coefficientText(row.nightCoefficient),
    holidayCoefficient: coefficientText(row.holidayCoefficient),
    colorToken: row.colorToken,
  }
}

type ShiftTypeErrorKey = "code" | "name" | "start" | "end" | "breakMinutes" | "nightCoefficient" | "holidayCoefficient" | "colorToken"

/** Same rules as saveShiftType. */
export function validateShiftType(draft: ShiftTypeDraft): DraftErrors<ShiftTypeErrorKey> {
  const errors: DraftErrors<ShiftTypeErrorKey> = {}
  if (!draft.code.trim()) errors.code = "Укажите код"
  if (!draft.name.trim()) errors.name = "Укажите название"
  const start = timeToMinute(draft.start)
  const end = timeToMinute(draft.end)
  if (start === null) errors.start = "Время — ЧЧ:ММ"
  if (end === null) errors.end = "Время — ЧЧ:ММ"
  else if (start !== null && start === end) errors.end = "Начало и окончание смены совпадают"
  const breakMinutes = /^\d+$/.test(draft.breakMinutes.trim()) ? Number(draft.breakMinutes) : null
  if (breakMinutes === null) errors.breakMinutes = "Целое число минут"
  else if (start !== null && end !== null && start !== end && breakMinutes >= shiftLengthMinutes(start, end)) errors.breakMinutes = "Перерыв должен быть короче смены"
  const night = parseDecimal(draft.nightCoefficient)
  if (night === null || night < 1) errors.nightCoefficient = "Не меньше 1"
  const holiday = parseDecimal(draft.holidayCoefficient)
  if (holiday === null || holiday < 1) errors.holidayCoefficient = "Не меньше 1"
  if (!SHIFT_COLORS.some((color) => color.token === draft.colorToken)) errors.colorToken = "Выберите цвет"
  return errors
}

export function shiftTypeArgs(row: ShiftTypeLike | null, draft: ShiftTypeDraft) {
  return {
    ...(row ? { externalId: row.externalId, expectedVersion: row.version } : {}),
    code: draft.code.trim(),
    name: draft.name.trim(),
    startMinute: timeToMinute(draft.start) ?? 0,
    endMinute: timeToMinute(draft.end) ?? 0,
    breakMinutes: Number(draft.breakMinutes),
    nightCoefficient: parseDecimal(draft.nightCoefficient) ?? 1,
    holidayCoefficient: parseDecimal(draft.holidayCoefficient) ?? 1,
    colorToken: draft.colorToken,
  }
}

/** Hours of the draft, or null while the times are incomplete. */
export function shiftTypeDraftHours(draft: ShiftTypeDraft) {
  const start = timeToMinute(draft.start)
  const end = timeToMinute(draft.end)
  if (start === null || end === null || start === end || !/^\d+$/.test(draft.breakMinutes.trim())) return null
  return shiftTypeHours(start, end, Number(draft.breakMinutes))
}

// ── Calendar week (W2-HR-04) ─────────────────────────────────────────────────

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

/** "2026-09-28" + 3 → "2026-10-01". */
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Monday of the week that holds the date. */
export function mondayOf(date: string) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
}

export const currentWeekStart = (now = Date.now()) => mondayOf(almatyBusinessDate(now))

/** "2026-09-28" → { weekday: "Пн", day: "28.09" }. */
export function dayLabel(date: string) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const [, month, day] = date.split("-")
  return { weekday: WEEKDAYS[weekday], day: `${day}.${month}` }
}

/** «28.09 — 04.10.2026». */
export function weekRangeLabel(weekStart: string) {
  const end = addDays(weekStart, 6)
  const [year, month, day] = end.split("-")
  return `${dayLabel(weekStart).day} — ${day}.${month}.${year}`
}

/** A calendar date in Almaty + a minute of the day → timestamp. */
export function localTimestamp(date: string, minute: number) {
  return Date.parse(`${date}T00:00:00Z`) - ALMATY_OFFSET_MS + minute * 60_000
}

/** Timestamp → the Almaty calendar date and minute of the day. */
export function fromTimestamp(value: number) {
  const local = new Date(value + ALMATY_OFFSET_MS)
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() }
}

/**
 * How a shift block is drawn in its day cell: «22:00–06:00» with a «+1» mark when it ends on a later day.
 * The block stays in the day it starts (the server groups by business date).
 */
export function shiftBlockLayout(shift: { start: number; end: number }) {
  const from = fromTimestamp(shift.start)
  const to = fromTimestamp(shift.end)
  const dayShift = Math.round((Date.parse(`${to.date}T00:00:00Z`) - Date.parse(`${from.date}T00:00:00Z`)) / DAY_MS)
  return { timeLabel: `${minuteToTime(from.minute)}–${minuteToTime(to.minute)}`, nextDay: dayShift > 0 ? dayShift : 0 }
}

/** Planned hours, the same formula as hoursOf in schedule.ts. */
export function plannedHours(start: number, end: number, breakMinutes: number) {
  return Math.max(0, round2((end - start) / 3_600_000 - breakMinutes / 60))
}

/** «40 ч / норма 40 ч»; without a position norm just the hours. */
export function normLabel(planned: number, norm: number | null) {
  return norm === null ? formatHours(planned) : `${formatHours(planned)} / норма ${formatHours(norm)}`
}

export interface ScheduleDraft {
  employeeId: string
  shiftTypeExternalId: string
  positionExternalId: string
  date: string
  start: string
  end: string
  breakMinutes: string
  comment: string
}

export interface ScheduleEntryLike {
  externalId: string
  version: number
  employeeId: string
  shiftTypeExternalId?: string
  positionExternalId?: string
  start: number
  end: number
  breakMinutes: number
  comment?: string
}

export function scheduleDraftOf(entry: ScheduleEntryLike | null, defaults: { employeeId?: string; date?: string } = {}): ScheduleDraft {
  if (!entry) return { employeeId: defaults.employeeId ?? "", shiftTypeExternalId: "", positionExternalId: "", date: defaults.date ?? "", start: "09:00", end: "18:00", breakMinutes: "60", comment: "" }
  const from = fromTimestamp(entry.start)
  const to = fromTimestamp(entry.end)
  return {
    employeeId: entry.employeeId,
    shiftTypeExternalId: entry.shiftTypeExternalId ?? "",
    positionExternalId: entry.positionExternalId ?? "",
    date: from.date,
    start: minuteToTime(from.minute),
    end: minuteToTime(to.minute),
    breakMinutes: String(entry.breakMinutes),
    comment: entry.comment ?? "",
  }
}

/** Start and end timestamps of the draft; an end at or before the start is on the next day. */
export function scheduleTimes(draft: ScheduleDraft) {
  const start = timeToMinute(draft.start)
  const end = timeToMinute(draft.end)
  if (start === null || end === null || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null
  const startAt = localTimestamp(draft.date, start)
  const endAt = localTimestamp(draft.date, end) + (end <= start ? DAY_MS : 0)
  return { start: startAt, end: endAt, nextDay: end <= start }
}

type ScheduleErrorKey = "employeeId" | "date" | "start" | "end" | "breakMinutes"

/** Same checks as saveEntry (overlaps are the server's). */
export function validateSchedule(draft: ScheduleDraft): DraftErrors<ScheduleErrorKey> {
  const errors: DraftErrors<ScheduleErrorKey> = {}
  if (!draft.employeeId) errors.employeeId = "Выберите сотрудника"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Укажите дату"
  if (timeToMinute(draft.start) === null) errors.start = "Время — ЧЧ:ММ"
  if (timeToMinute(draft.end) === null) errors.end = "Время — ЧЧ:ММ"
  else if (draft.start === draft.end) errors.end = "Начало и окончание совпадают"
  const times = scheduleTimes(draft)
  if (!/^\d+$/.test(draft.breakMinutes.trim())) errors.breakMinutes = "Целое число минут"
  else if (times && Number(draft.breakMinutes) * 60_000 >= times.end - times.start) errors.breakMinutes = "Перерыв должен быть короче смены"
  return errors
}

export function scheduleArgs(restaurantExternalId: string, entry: ScheduleEntryLike | null, draft: ScheduleDraft) {
  const times = scheduleTimes(draft)!
  return {
    ...(entry ? { externalId: entry.externalId, expectedVersion: entry.version } : {}),
    restaurantExternalId,
    employeeId: draft.employeeId,
    ...(draft.shiftTypeExternalId ? { shiftTypeExternalId: draft.shiftTypeExternalId } : {}),
    ...(draft.positionExternalId ? { positionExternalId: draft.positionExternalId } : {}),
    start: times.start,
    end: times.end,
    breakMinutes: Number(draft.breakMinutes),
    ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
  }
}

// ── Payroll (W2-HR-06) ───────────────────────────────────────────────────────

/** 0.035 → "3,5" — rates are stored as fractions 0–1, shown as percents. */
export function fractionToPercentText(value: number) {
  return String(Math.round(value * 100 * 10_000) / 10_000).replace(".", ",")
}

/** "3,5" → 0.035; invalid → null. */
export function percentTextToFraction(text: string): number | null {
  const value = parseDecimal(text)
  return value === null ? null : Math.round(value * 10_000) / 1_000_000
}

export type RuleKey =
  | "mzp"
  | "mrp"
  | "opvRate"
  | "opvMaxMzp"
  | "vosmsRate"
  | "vosmsMaxMzp"
  | "oosmsRate"
  | "oosmsMaxMzp"
  | "opvrRate"
  | "socialContributionRate"
  | "socialTaxRate"
  | "basicDeductionMrp"
  | "ipnRate"
  | "ipnHighRate"
  | "ipnAnnualThresholdMrp"

export type RuleFieldKind = "money" | "percent" | "count"

/** The fields of a rules version in the card order: money in ₸, rates in %, limits in МЗП / МРП. */
export const RULE_FIELDS: { key: RuleKey; label: string; kind: RuleFieldKind; unit?: string; group: "base" | "employee" | "employer" | "ipn" }[] = [
  { key: "mzp", label: "МЗП", kind: "money", group: "base" },
  { key: "mrp", label: "МРП", kind: "money", group: "base" },
  { key: "opvRate", label: "ОПВ", kind: "percent", group: "employee" },
  { key: "opvMaxMzp", label: "ОПВ: предел базы", kind: "count", unit: "МЗП", group: "employee" },
  { key: "vosmsRate", label: "ВОСМС", kind: "percent", group: "employee" },
  { key: "vosmsMaxMzp", label: "ВОСМС: предел базы", kind: "count", unit: "МЗП", group: "employee" },
  { key: "opvrRate", label: "ОПВР", kind: "percent", group: "employer" },
  { key: "oosmsRate", label: "ООСМС работодателя", kind: "percent", group: "employer" },
  { key: "oosmsMaxMzp", label: "ООСМС: предел базы", kind: "count", unit: "МЗП", group: "employer" },
  { key: "socialContributionRate", label: "Социальные отчисления", kind: "percent", group: "employer" },
  { key: "socialTaxRate", label: "Социальный налог", kind: "percent", group: "employer" },
  { key: "ipnRate", label: "ИПН", kind: "percent", group: "ipn" },
  { key: "ipnHighRate", label: "ИПН по повышенной ставке", kind: "percent", group: "ipn" },
  { key: "ipnAnnualThresholdMrp", label: "Порог повышенной ставки за год", kind: "count", unit: "МРП", group: "ipn" },
  { key: "basicDeductionMrp", label: "Базовый вычет", kind: "count", unit: "МРП", group: "ipn" },
]

export const RULE_GROUP_LABEL = { base: "Базовые величины", employee: "Удержания с сотрудника", employer: "Налоги и взносы работодателя", ipn: "ИПН" } as const

export interface RulesDraft {
  version: string
  effectiveFrom: string
  money: Partial<Record<RuleKey, number | null>>
  text: Partial<Record<RuleKey, string>>
}

export type RulesLike = { externalId: string; version: string; effectiveFrom: string; status: "draft" | "active" | "inactive" } & Record<RuleKey, number>

export function rulesDraftOf(rules: RulesLike | null, fallback?: Partial<Record<RuleKey, number>>): RulesDraft {
  const source = rules ?? fallback ?? {}
  const draft: RulesDraft = { version: rules?.version ?? "", effectiveFrom: rules?.effectiveFrom ?? "", money: {}, text: {} }
  for (const field of RULE_FIELDS) {
    const value = (source as Partial<Record<RuleKey, number>>)[field.key]
    if (field.kind === "money") draft.money[field.key] = value ?? null
    else if (field.kind === "percent") draft.text[field.key] = value === undefined ? "" : fractionToPercentText(value)
    else draft.text[field.key] = value === undefined ? "" : String(value).replace(".", ",")
  }
  return draft
}

export function validateRules(draft: RulesDraft): DraftErrors<RuleKey | "version" | "effectiveFrom"> {
  const errors: DraftErrors<RuleKey | "version" | "effectiveFrom"> = {}
  if (!draft.version.trim()) errors.version = "Укажите версию"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) errors.effectiveFrom = "Укажите дату начала"
  for (const field of RULE_FIELDS) {
    if (field.kind === "money") {
      if (draft.money[field.key] === null || draft.money[field.key] === undefined) errors[field.key] = "Укажите сумму"
    } else if (field.kind === "percent") {
      const value = percentTextToFraction(draft.text[field.key] ?? "")
      if (value === null || value > 1) errors[field.key] = "Процент от 0 до 100"
    } else if (parseDecimal(draft.text[field.key] ?? "") === null) errors[field.key] = "Неотрицательное число"
  }
  return errors
}

export function rulesArgs(rules: RulesLike | null, draft: RulesDraft) {
  const values = {} as Record<RuleKey, number>
  for (const field of RULE_FIELDS) {
    values[field.key] = field.kind === "money" ? (draft.money[field.key] ?? 0) : field.kind === "percent" ? (percentTextToFraction(draft.text[field.key] ?? "") ?? 0) : (parseDecimal(draft.text[field.key] ?? "") ?? 0)
  }
  return { ...(rules ? { externalId: rules.externalId } : {}), version: draft.version.trim(), effectiveFrom: draft.effectiveFrom, ...values }
}

/** A rules value for the register: «85 000 ₸», «10 %», «50 МЗП». */
export function formatRuleValue(key: RuleKey, value: number) {
  const field = RULE_FIELDS.find((candidate) => candidate.key === key)!
  if (field.kind === "money") return formatTenge(value)
  if (field.kind === "percent") return `${fractionToPercentText(value)} %`
  return `${String(value).replace(".", ",")} ${field.unit}`
}

/** First and last day of the month that holds the date: the default payroll period. */
export function monthPeriod(date: string) {
  const [year, month] = date.split("-").map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/** «01.09.2026 — 30.09.2026». */
export function periodLabel(from: string, to: string) {
  const format = (date: string) => date.split("-").reverse().join(".")
  return `${format(from)} — ${format(to)}`
}

export const ADJUSTMENT_KINDS = ["bonus", "penalty", "advance"] as const
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number]
export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = { bonus: "Премия", penalty: "Штраф", advance: "Аванс" }

export const PAYOUT_METHOD_LABEL = { cash: "Касса", bank: "Банк" } as const

/** Still to pay per employee: net − advances − what payouts already gave (same as createPayout). */
export function remainingByEmployee(lines: { employeeCode: string; net: number; advances: number }[], payouts: { lines: { employeeCode: string; amount: number }[] }[]) {
  const paid = new Map<string, number>()
  for (const payout of payouts) for (const line of payout.lines) paid.set(line.employeeCode, (paid.get(line.employeeCode) ?? 0) + line.amount)
  return new Map(lines.map((line) => [line.employeeCode, Math.max(0, Math.max(0, line.net - line.advances) - (paid.get(line.employeeCode) ?? 0))]))
}

/** "acc-7212" → "7212": journal accounts are shown by their code. */
export const accountCode = (externalId: string) => externalId.replace(/^acc-/, "")
