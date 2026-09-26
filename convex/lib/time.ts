/** Almaty is UTC+5 year-round (no DST) — this is a fixed offset, not a timezone database lookup. */
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

export const DAY_MS = 24 * 60 * 60 * 1000

/** Start of an Almaty business date ("YYYY-MM-DD") as a UTC timestamp. */
export function almatyDayStart(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return Date.UTC(year, month - 1, day) - ALMATY_OFFSET_MS
}

export function almatyBusinessDate(value: number): string {
  return businessDateFor(value, 0)
}

/** restaurants.businessDayCutoffMinutes is 0–720 (up to 12:00); anything else counts as midnight. */
export const MAX_BUSINESS_DAY_CUTOFF_MINUTES = 720

/**
 * The Almaty business date of a moment when the restaurant's day ends `cutoffMinutes` after midnight:
 * with a 04:00 cutoff, 03:59 still belongs to the previous day (W1-PLT-08).
 */
export function businessDateFor(value: number, cutoffMinutes = 0): string {
  const cutoff = Number.isInteger(cutoffMinutes) && cutoffMinutes > 0 && cutoffMinutes <= MAX_BUSINESS_DAY_CUTOFF_MINUTES ? cutoffMinutes : 0
  const date = new Date(value + ALMATY_OFFSET_MS - cutoff * 60_000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

/** Almaty weekday (Monday = 1 … Sunday = 7) and minute of the day, for price-order schedules. */
export function almatyWeekdayMinute(value: number): { weekday: number; minute: number } {
  const date = new Date(value + ALMATY_OFFSET_MS)
  const day = date.getUTCDay()
  return { weekday: day === 0 ? 7 : day, minute: date.getUTCHours() * 60 + date.getUTCMinutes() }
}

const HOUR_MS = 60 * 60 * 1000

/** Whether a moment falls inside the Almaty daily window [startHour, endHour) — campaign quiet hours (W3-LOY-08). */
export function insideAlmatyWindow(value: number, startHour: number, endHour: number): boolean {
  const { minute } = almatyWeekdayMinute(value)
  return minute >= startHour * 60 && minute < endHour * 60
}

/**
 * The moment itself when it is inside the Almaty window [startHour, endHour), otherwise the next opening
 * of the window: 22:00 with a 9–20 window → 09:00 of the next Almaty day (port of B:loyalty.ts
 * nextCampaignTime, without the offset in the caller).
 */
export function nextAlmatyWindowTime(value: number, startHour: number, endHour: number): number {
  if (insideAlmatyWindow(value, startHour, endHour)) return value
  const { minute } = almatyWeekdayMinute(value)
  const dayStart = almatyDayStart(almatyBusinessDate(value))
  return dayStart + (minute < startHour * 60 ? 0 : DAY_MS) + startHour * HOUR_MS
}
