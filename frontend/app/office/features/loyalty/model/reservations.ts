import { almatyBusinessDate, formatAlmatyTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"

import type { DraftErrors } from "./loyalty-model"
import { dateInputToMs, isMasked } from "./loyalty-model"

// Pure rules of «Банкеты и резервы» (W2-LOY-07): tabs of the approval lifecycle, the card draft, client
// checks that mirror convex/domains/loyalty/reservations.ts saveReservation, Almaty wall-clock times.
// The server checks everything again (overlaps of a table only there).

const MINUTE = 60_000
const DAY = 86_400_000

export type ReservationStatus = "draft" | "pending-approval" | "approved" | "completed" | "cancelled"
export type ReservationRecordType = "reservation" | "banquet"
export type ReservationAction = "submit" | "approve" | "complete" | "cancel"

/** OFFICE-DESIGN §3.5 approval: «Проведённые» — completed bookings (the banquet took place). */
export const RESERVATION_TABS = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "pending-approval", label: "На согласовании" },
  { value: "approved", label: "Согласованные" },
  { value: "completed", label: "Проведённые" },
] as const

export type ReservationTab = (typeof RESERVATION_TABS)[number]["value"]

export const RECORD_TYPE_LABELS: Record<ReservationRecordType, string> = { reservation: "Резерв", banquet: "Банкет" }

/** The one primary of the card by status and what it does. */
export const NEXT_ACTION: Partial<Record<ReservationStatus, { action: Exclude<ReservationAction, "cancel">; capability: string; idle: string; busy: string; done: string; failed: string }>> = {
  draft: { action: "submit", capability: "office.reservations.edit", idle: "Отправить на согласование", busy: "Отправка…", done: "Отправлено на согласование", failed: "Не удалось отправить на согласование" },
  "pending-approval": { action: "approve", capability: "office.reservations.approve", idle: "Согласовать", busy: "Согласование…", done: "Бронь согласована", failed: "Не удалось согласовать" },
  approved: { action: "complete", capability: "office.reservations.post", idle: "Провести", busy: "Проведение…", done: "Бронь проведена", failed: "Не удалось провести" },
}

export const CANCELLABLE: readonly ReservationStatus[] = ["draft", "pending-approval", "approved"]

// ── Almaty wall-clock time ────────────────────────────────────────────────────

/** Today in Almaty as YYYY-MM-DD (the floor plan's default day). */
export const almatyToday = (now = Date.now()) => almatyBusinessDate(now)

/** «2026-09-25», «19:30» → the moment in Almaty. null for an incomplete value. */
export function almatyMoment(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [hours, minutes] = time.split(":").map(Number)
  if (hours > 23 || minutes > 59) return null
  return dateInputToMs(date) + (hours * 60 + minutes) * MINUTE
}

/** A moment → the date and time inputs of the card, in Almaty. */
export function almatyParts(value: number) {
  return { date: almatyBusinessDate(value), time: formatAlmatyTime(value) }
}

/** Shifts a YYYY-MM-DD day by whole days (the «‹ ›» buttons of the plan). */
export function shiftDate(date: string, days: number) {
  return almatyBusinessDate(dateInputToMs(date) + days * DAY + 12 * 60 * MINUTE)
}

/** «19:00–23:00», or «19:00–02:00 (+1)» for a banquet past midnight. */
export function formatTimeRange(start: number, end: number) {
  const nextDay = almatyBusinessDate(end - 1) !== almatyBusinessDate(start)
  return `${formatAlmatyTime(start)}–${formatAlmatyTime(end)}${nextDay ? " (+1)" : ""}`
}

// ── The card draft ────────────────────────────────────────────────────────────

export interface ReservationDraft {
  recordType: ReservationRecordType
  hall: string
  tableExternalIds: string[]
  guestId: string
  guestName: string
  phone: string
  date: string
  startTime: string
  endTime: string
  guestCount: string
  occasion: string
  prepayment: number | null
  prepaymentTypeExternalId: string
  menu: string
}

export interface ReservationRecord {
  externalId: string
  number: string
  status: ReservationStatus
  version: number
  restaurantExternalId: string
  recordType: ReservationRecordType
  hall: string
  tableExternalIds: string[]
  guestId?: string
  guestName: string
  /** Masked (7701•••••67) without office.guests.pii; maskPhone types it as optional. */
  phone: string | undefined
  start: number
  end: number
  guestCount: number
  occasion: string
  prepayment: number
  prepaymentTypeExternalId?: string
  menu: string
}

/** What a new card starts with: the table and day picked on the plan, 19:00–22:00 by default. */
export interface ReservationPrefill {
  date: string
  hall?: string
  tableExternalIds?: string[]
  startTime?: string
}

export function reservationDraftOf(record: ReservationRecord | null, prefill?: ReservationPrefill): ReservationDraft {
  if (record) {
    const start = almatyParts(record.start)
    return {
      recordType: record.recordType,
      hall: record.hall,
      tableExternalIds: record.tableExternalIds,
      guestId: record.guestId ?? "",
      guestName: record.guestName,
      phone: record.phone ?? "",
      date: start.date,
      startTime: start.time,
      endTime: formatAlmatyTime(record.end),
      guestCount: String(record.guestCount),
      occasion: record.occasion,
      prepayment: record.prepayment || null,
      prepaymentTypeExternalId: record.prepaymentTypeExternalId ?? "",
      menu: record.menu,
    }
  }
  const startTime = prefill?.startTime ?? "19:00"
  const [hours, minutes] = startTime.split(":").map(Number)
  // Three hours by default; past midnight the end is the next day (draftPeriod).
  const endTime = `${String((hours + 3) % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  return {
    recordType: "reservation",
    hall: prefill?.hall ?? "",
    tableExternalIds: prefill?.tableExternalIds ?? [],
    guestId: "",
    guestName: "",
    phone: "",
    date: prefill?.date ?? almatyToday(),
    startTime,
    endTime,
    guestCount: "2",
    occasion: "",
    prepayment: null,
    prepaymentTypeExternalId: "",
    menu: "",
  }
}

/** Start and end of the draft; an end not after the start is the next day (a banquet past midnight). */
export function draftPeriod(draft: Pick<ReservationDraft, "date" | "startTime" | "endTime">): { start: number; end: number; nextDay: boolean } | null {
  const start = almatyMoment(draft.date, draft.startTime)
  const sameDayEnd = almatyMoment(draft.date, draft.endTime)
  if (start === null || sameDayEnd === null) return null
  const nextDay = sameDayEnd <= start
  return { start, end: nextDay ? sameDayEnd + DAY : sameDayEnd, nextDay }
}

const phoneDigits = (phone: string) => phone.replace(/\D/g, "")

/**
 * `phoneOnFile`: the server has a phone to keep for a masked one — the saved booking's or the chosen
 * guest's (saveReservation keeps it when the phone comes masked, without office.guests.pii).
 */
export function validateReservation(draft: ReservationDraft, capacityOf: (tableExternalId: string) => number | undefined, options: { phoneOnFile?: boolean } = {}): DraftErrors<keyof ReservationDraft> {
  const errors: DraftErrors<keyof ReservationDraft> = {}
  if (!draft.hall.trim()) errors.hall = "Выберите зал"
  if (!draft.tableExternalIds.length) errors.tableExternalIds = "Выберите стол"
  if (draft.guestName.trim().length < 2) errors.guestName = "Укажите имя гостя"
  if (isMasked(draft.phone)) {
    if (options.phoneOnFile === false) errors.phone = "Телефон скрыт — выберите гостя из базы или введите номер"
  } else {
    const digits = phoneDigits(draft.phone).length
    if (digits < 10 || digits > 15) errors.phone = "Телефон — 10–15 цифр"
  }
  if (!draftPeriod(draft)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Укажите дату"
    else if (!/^\d{2}:\d{2}$/.test(draft.startTime)) errors.startTime = "Укажите время начала"
    else errors.endTime = "Укажите время окончания"
  }
  const guests = Number(draft.guestCount)
  if (!(Number.isInteger(guests) && guests >= 1)) errors.guestCount = "Число гостей — целое, от 1"
  else if (draft.tableExternalIds.length) {
    const capacity = draft.tableExternalIds.reduce((sum, id) => sum + (capacityOf(id) ?? 0), 0)
    if (capacity > 0 && capacity < guests) errors.guestCount = `Вместимость выбранных столов — ${capacity}, гостей ${guests}`
  }
  if (draft.prepayment !== null && draft.prepayment > 0 && !draft.prepaymentTypeExternalId) errors.prepaymentTypeExternalId = "Укажите тип оплаты предоплаты"
  return errors
}

/** saveReservation arguments without `guestId` (an Id the data layer adds from `draft.guestId`). */
export function reservationSaveArgs(draft: ReservationDraft, restaurantExternalId: string, record: Pick<ReservationRecord, "externalId" | "version"> | null) {
  const period = draftPeriod(draft)!
  const prepayment = draft.prepayment ?? 0
  return {
    ...(record ? { externalId: record.externalId, expectedVersion: record.version } : {}),
    restaurantExternalId,
    recordType: draft.recordType,
    hall: draft.hall.trim(),
    tableExternalIds: [...new Set(draft.tableExternalIds)],
    guestName: draft.guestName.trim(),
    phone: draft.phone.trim(),
    start: period.start,
    end: period.end,
    guestCount: Number(draft.guestCount),
    occasion: draft.occasion.trim(),
    prepayment,
    ...(prepayment > 0 && draft.prepaymentTypeExternalId ? { prepaymentTypeExternalId: draft.prepaymentTypeExternalId } : {}),
    menu: draft.menu.trim(),
  }
}

/** The business day of a booking in Almaty — the paid checks of this day close a banquet. */
export const reservationDay = (start: number) => almatyBusinessDate(start)

/** «Чек 124 · 48 500 ₸ · Стол 4 · 21:40» for the «Провести» check picker. */
export function paidOrderLabel(order: { number: number; total: number; paidAt: number | null; tableLabel: string | null }) {
  return [`Чек ${order.number}`, formatTenge(order.total), order.tableLabel, order.paidAt ? formatAlmatyTime(order.paidAt) : null].filter(Boolean).join(" · ")
}
