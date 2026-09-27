import { almatyBusinessDate, formatAlmatyDateTime, formatAlmatyTime } from "@/shared/lib/almaty-time"
import { formatHours, formatTenge } from "@/shared/lib/format"

import type { AttendanceRecord, AttendanceStatus, EmployeeCard, SaveAttendanceArgs, UpdateProfileArgs } from "../data/use-office-workforce"

// «Сотрудники» (W1-HR-01) and «Журнал явки» (W1-HR-05): labels, lifecycle tabs, units and the client-side
// checks that mirror convex/domains/workforce (so a typo never reaches the server).

// ── Employees ────────────────────────────────────────────────────────────────

export const ROLES = ["cashier", "manager", "administrator", "kitchen"] as const
export type Role = (typeof ROLES)[number]
export const ROLE_LABEL: Record<Role, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }
export const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))
export const roleLabel = (role: string) => ROLE_LABEL[role as Role] ?? role

export const PAY_TYPES = ["hourly", "salary", "piecework"] as const
export type PayType = (typeof PAY_TYPES)[number]
export const PAY_TYPE_LABEL: Record<PayType, string> = { hourly: "Почасовая", salary: "Оклад", piecework: "Сдельная" }
export const PAY_TYPE_OPTIONS = PAY_TYPES.map((payType) => ({ value: payType, label: PAY_TYPE_LABEL[payType] }))

const RATE_UNIT: Record<PayType, string> = { hourly: "/ч", salary: "/мес", piecework: "/ед." }

/** The rate always carries its unit: «2 000 ₸/ч», «250 000 ₸/мес» — never a bare «1 ₸» (L-10). */
export function formatRate(baseRate: number | undefined | null, payType: PayType | undefined | null): string | null {
  if (baseRate === undefined || baseRate === null) return null
  return `${formatTenge(baseRate)}${payType ? RATE_UNIT[payType] : ""}`
}

/** Unit suffix next to the rate input. */
export function rateUnitLabel(payType: PayType | "") {
  return payType === "hourly" ? "₸ в час" : payType === "salary" ? "₸ в месяц" : payType === "piecework" ? "₸ за единицу" : "₸"
}

/** Employee codes and PINs follow convex/lib/policy.ts: code 3–12 digits, PIN 4–6 digits. */
export const EMPLOYEE_CODE_PATTERN = /^\d{3,12}$/
export const PIN_PATTERN = /^\d{4,6}$/

/** Personal data without office.employees.pii comes back masked: «••••••••0123». */
export const isMasked = (value: string | undefined) => Boolean(value?.includes("•"))

export interface HrDraft {
  personnelNumber: string
  iin: string
  phone: string
  email: string
  employmentDate: string
  admitted: boolean
  positionExternalId: string
  payType: PayType | ""
  baseRate: number | null
  applyBasicDeduction: boolean
}

export interface ProfileDraft extends HrDraft {
  displayName: string
  role: Role
  restaurantExternalIds: string[]
}

export const EMPTY_HR: HrDraft = {
  personnelNumber: "",
  iin: "",
  phone: "",
  email: "",
  employmentDate: "",
  admitted: false,
  positionExternalId: "",
  payType: "",
  baseRate: null,
  applyBasicDeduction: false,
}

export function profileDraftOf(card: EmployeeCard): ProfileDraft {
  return {
    displayName: card.displayName,
    personnelNumber: card.personnelNumber ?? "",
    iin: card.iin ?? "",
    phone: card.phone ?? "",
    email: card.email ?? "",
    employmentDate: card.employmentDate ?? "",
    admitted: card.admitted ?? false,
    positionExternalId: card.positionExternalId ?? "",
    payType: card.payType ?? "",
    baseRate: card.baseRate ?? null,
    applyBasicDeduction: card.applyBasicDeduction ?? false,
    role: card.role,
    restaurantExternalIds: card.restaurants.map((restaurant) => restaurant.externalId),
  }
}

export type ProfileErrors = Partial<Record<"displayName" | "personnelNumber" | "iin" | "phone" | "email" | "employmentDate" | "baseRate" | "restaurants" | "employeeCode" | "pin", string>>

/** Same rules as checkHr in convex/domains/workforce/mutations.ts. A masked IIN or phone is left as is. */
export function validateHr(draft: HrDraft & { displayName: string }): ProfileErrors {
  const errors: ProfileErrors = {}
  if (draft.displayName.trim().length < 2) errors.displayName = "Укажите ФИО"
  const iin = draft.iin.trim()
  if (iin && !isMasked(iin) && !/^\d{12}$/.test(iin)) errors.iin = "ИИН — 12 цифр"
  const email = draft.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Некорректный email"
  const phone = draft.phone.trim()
  if (phone && !isMasked(phone) && !/^\+?[\d\s()-]{10,18}$/.test(phone)) errors.phone = "Некорректный телефон"
  if (draft.employmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.employmentDate)) errors.employmentDate = "Некорректная дата приёма"
  if (draft.baseRate !== null && !(Number.isInteger(draft.baseRate) && draft.baseRate >= 0)) errors.baseRate = "Ставка — целое число тенге"
  return errors
}

/**
 * HR fields for createPosEmployee / updateEmployeeProfile. Every field is always sent: the server
 * treats an omitted field as «cleared». Empty strings clear a field on purpose.
 */
export function hrArgs(draft: HrDraft) {
  return {
    personnelNumber: draft.personnelNumber.trim(),
    iin: draft.iin.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    employmentDate: draft.employmentDate,
    admitted: draft.admitted,
    positionExternalId: draft.positionExternalId.trim(),
    ...(draft.payType ? { payType: draft.payType } : {}),
    ...(draft.baseRate !== null ? { baseRate: draft.baseRate } : {}),
    applyBasicDeduction: draft.applyBasicDeduction,
  }
}

export function profileArgs(card: EmployeeCard, draft: ProfileDraft): UpdateProfileArgs {
  return { employeeId: card._id, displayName: draft.displayName.trim(), expectedUpdatedAt: card.updatedAt ?? 0, ...hrArgs(draft) }
}

/** HR fields of the draft (not access) differ from the card. */
export function profileChanged(card: EmployeeCard, draft: ProfileDraft) {
  const base = profileDraftOf(card)
  const keys: (keyof HrDraft | "displayName")[] = ["displayName", "personnelNumber", "iin", "phone", "email", "employmentDate", "admitted", "positionExternalId", "payType", "baseRate", "applyBasicDeduction"]
  return keys.some((key) => base[key] !== draft[key])
}

export function assignmentChanged(card: EmployeeCard, draft: ProfileDraft) {
  const before = [...card.restaurants.map((restaurant) => restaurant.externalId)].sort().join("|")
  return card.role !== draft.role || before !== [...draft.restaurantExternalIds].sort().join("|")
}

/** «2026-09-03» → «03.09.2026». */
export function formatBusinessDate(date: string | undefined) {
  return date ? date.split("-").reverse().join(".") : ""
}

// ── Attendance ───────────────────────────────────────────────────────────────

export const ATTENDANCE_TYPES = ["worked", "sick", "vacation", "absence"] as const
export type AttendanceType = (typeof ATTENDANCE_TYPES)[number]
export const ATTENDANCE_TYPE_LABEL: Record<AttendanceType, string> = { worked: "Работа", sick: "Больничный", vacation: "Отпуск", absence: "Неявка" }
export const ATTENDANCE_TYPE_OPTIONS = ATTENDANCE_TYPES.map((type) => ({ value: type, label: ATTENDANCE_TYPE_LABEL[type] }))

export const ATTENDANCE_SOURCE_LABEL: Record<AttendanceRecord["source"], string> = { pos: "Отметка на кассе", "pos-shift": "Смена на кассе", office: "Офис" }

/**
 * Lifecycle tabs of the attendance log. Approval tabs (§3.5) plus the POS states: «На смене» (open),
 * «Завершённые» (closed on the POS — they go to payroll like approved ones), «Отменённые».
 * There is no «Проведённые»: attendance is never posted.
 */
export const ATTENDANCE_TABS: { value: "all" | AttendanceStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "На смене" },
  { value: "completed", label: "Завершённые" },
  { value: "draft", label: "Черновики" },
  { value: "pending-approval", label: "На согласовании" },
  { value: "approved", label: "Согласованные" },
  { value: "cancelled", label: "Отменённые" },
]

/** Clock time; a clock-out on another Almaty day also shows the date. */
export function formatClock(value: number | undefined, sameDayAs?: number) {
  if (value === undefined) return null
  if (sameDayAs !== undefined && almatyBusinessDate(value) !== almatyBusinessDate(sameDayAs)) return formatAlmatyDateTime(value)
  return formatAlmatyTime(value)
}

/** Deviation from the schedule in minutes (W2-HR-04 fills it): «+15 мин», «−1 ч 10 мин»; empty until then. */
export function formatDeviation(minutes: number | undefined) {
  if (minutes === undefined) return null
  if (minutes === 0) return "0 мин"
  return `${minutes > 0 ? "+" : ""}${formatHours(minutes / 60)}`
}

/** Same formula as hoursBetween in convex/lib/attendance.ts. */
export function hoursBetween(clockIn: number, clockOut: number, breakMinutes: number) {
  return Math.max(0, Math.round(((clockOut - clockIn) / 3_600_000 - breakMinutes / 60) * 100) / 100)
}

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

/** timestamp → "2026-09-24T09:00" in Almaty time, for <input type="datetime-local">. */
export function toAlmatyInput(value: number) {
  return new Date(value + ALMATY_OFFSET_MS).toISOString().slice(0, 16)
}

/** "2026-09-24T09:00" (Almaty) → timestamp; empty or invalid → null. */
export function fromAlmatyInput(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null
  const value = Date.parse(`${text}:00Z`)
  return Number.isNaN(value) ? null : value - ALMATY_OFFSET_MS
}

export interface AttendanceDraft {
  restaurantExternalId: string
  employeeId: string
  clockIn: string
  clockOut: string
  breakMinutes: string
  attendanceType: AttendanceType
  correctionReason: string
}

export function attendanceDraftOf(record: AttendanceRecord | null, defaults: { restaurantExternalId?: string; now?: number } = {}): AttendanceDraft {
  if (!record) {
    return {
      restaurantExternalId: defaults.restaurantExternalId ?? "",
      employeeId: "",
      clockIn: toAlmatyInput(Math.floor((defaults.now ?? Date.now()) / 60_000) * 60_000),
      clockOut: "",
      breakMinutes: "0",
      attendanceType: "worked",
      correctionReason: "",
    }
  }
  return {
    restaurantExternalId: record.restaurantExternalId,
    employeeId: record.employeeId,
    clockIn: toAlmatyInput(record.clockIn),
    clockOut: record.clockOut === undefined ? "" : toAlmatyInput(record.clockOut),
    breakMinutes: String(record.breakMinutes),
    attendanceType: record.attendanceType,
    correctionReason: record.correctionReason ?? "",
  }
}

export type AttendanceErrors = Partial<Record<"restaurant" | "employee" | "clockIn" | "clockOut" | "breakMinutes" | "correctionReason", string>>

/** A POS record whose times change needs a reason (the server keeps the POS times in `original`). */
export function needsCorrectionReason(record: AttendanceRecord | null, draft: AttendanceDraft) {
  if (!record || record.source === "office") return false
  return fromAlmatyInput(draft.clockIn) !== record.clockIn || (draft.clockOut ? fromAlmatyInput(draft.clockOut) : undefined) !== record.clockOut
}

export function validateAttendance(record: AttendanceRecord | null, draft: AttendanceDraft): AttendanceErrors {
  const errors: AttendanceErrors = {}
  if (!draft.restaurantExternalId) errors.restaurant = "Выберите ресторан"
  if (!draft.employeeId) errors.employee = "Выберите сотрудника"
  const clockIn = fromAlmatyInput(draft.clockIn)
  if (clockIn === null) errors.clockIn = "Укажите дату и время прихода"
  if (draft.clockOut) {
    const clockOut = fromAlmatyInput(draft.clockOut)
    if (clockOut === null) errors.clockOut = "Некорректное время ухода"
    else if (clockIn !== null && clockOut <= clockIn) errors.clockOut = "Уход должен быть позже прихода"
  }
  const breakMinutes = Number(draft.breakMinutes)
  if (!/^\d+$/.test(draft.breakMinutes.trim()) || breakMinutes > 720) errors.breakMinutes = "От 0 до 720 минут"
  if (needsCorrectionReason(record, draft) && draft.correctionReason.trim().length < 3) errors.correctionReason = "Укажите причину корректировки"
  return errors
}

export function attendanceArgs(record: AttendanceRecord | null, draft: AttendanceDraft): SaveAttendanceArgs {
  const reason = draft.correctionReason.trim()
  return {
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    employeeId: draft.employeeId as SaveAttendanceArgs["employeeId"],
    restaurantExternalId: draft.restaurantExternalId,
    clockIn: fromAlmatyInput(draft.clockIn)!,
    ...(draft.clockOut ? { clockOut: fromAlmatyInput(draft.clockOut)! } : {}),
    breakMinutes: Number(draft.breakMinutes),
    attendanceType: draft.attendanceType,
    ...(reason ? { correctionReason: reason } : {}),
  }
}

/** Hours of the draft, or null while the times are incomplete. */
export function draftHours(draft: AttendanceDraft) {
  const clockIn = fromAlmatyInput(draft.clockIn)
  const clockOut = draft.clockOut ? fromAlmatyInput(draft.clockOut) : null
  if (clockIn === null || clockOut === null || !/^\d+$/.test(draft.breakMinutes.trim())) return null
  return hoursBetween(clockIn, clockOut, Number(draft.breakMinutes))
}

/** Records the office may still change (the server rejects approved, cancelled and open POS records). */
export const isEditableStatus = (status: AttendanceStatus) => status === "completed" || status === "draft" || status === "pending-approval"
