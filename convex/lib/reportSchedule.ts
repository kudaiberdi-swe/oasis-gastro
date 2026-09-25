import { ConvexError } from "convex/values"

// Report mailing calendar (W2-RPT-06), Asia/Almaty (UTC+5, no DST). The next run is the next calendar
// slot after the previous one — never «now + interval» (bahandi drifted, and «monthly» was 30 days).

const OFFSET = 5 * 3_600_000
const DAY = 86_400_000

export type Cadence = "daily" | "weekly" | "monthly"
export type PeriodPreset = "yesterday" | "last-7-days" | "last-month" | "month-to-date"
export type ScheduleTiming = { cadence: Cadence; timeOfDay: string; weekday?: number; dayOfMonth?: number }

const pad = (value: number) => String(value).padStart(2, "0")
const localParts = (at: number) => {
  const date = new Date(at + OFFSET)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: ((date.getUTCDay() + 6) % 7) + 1 }
}
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
/** Epoch ms of a local Almaty date and minute of day. */
const localToEpoch = (year: number, month: number, day: number, minute: number) => Date.UTC(year, month, day) + minute * 60_000 - OFFSET
export const isoDate = (at: number) => new Date(at + OFFSET).toISOString().slice(0, 10)

export function parseTimeOfDay(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** The first slot strictly after `after`. The day of month is clamped to the month's last day (31 → 28/29). */
export function nextRunAt(timing: ScheduleTiming, after: number) {
  const minute = parseTimeOfDay(timing.timeOfDay) ?? 8 * 60
  const { year, month, day } = localParts(after)
  if (timing.cadence === "monthly") {
    const wanted = timing.dayOfMonth ?? 1
    for (let offset = 0; offset < 3; offset++) {
      const y = year + Math.floor((month + offset) / 12)
      const m = (month + offset) % 12
      const candidate = localToEpoch(y, m, Math.min(wanted, daysIn(y, m)), minute)
      if (candidate > after) return candidate
    }
  }
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = localToEpoch(year, month, day + offset, minute)
    if (candidate <= after) continue
    if (timing.cadence === "weekly" && localParts(candidate).weekday !== (timing.weekday ?? 1)) continue
    return candidate
  }
  throw new ConvexError("Не удалось рассчитать следующий запуск рассылки")
}

/** The data period of a run: always whole past days (a run on day D never reports D itself). */
export function periodFor(preset: PeriodPreset, runAt: number) {
  const today = localParts(runAt)
  const yesterday = isoDate(localToEpoch(today.year, today.month, today.day, 0) - DAY)
  if (preset === "yesterday") return { dateFrom: yesterday, dateTo: yesterday }
  if (preset === "last-7-days") return { dateFrom: isoDate(localToEpoch(today.year, today.month, today.day, 0) - 7 * DAY), dateTo: yesterday }
  if (preset === "last-month") {
    const y = today.month === 0 ? today.year - 1 : today.year
    const m = today.month === 0 ? 11 : today.month - 1
    return { dateFrom: `${y}-${pad(m + 1)}-01`, dateTo: `${y}-${pad(m + 1)}-${pad(daysIn(y, m))}` }
  }
  // month-to-date: from the 1st of yesterday's month to yesterday.
  return { dateFrom: `${yesterday.slice(0, 8)}01`, dateTo: yesterday }
}
