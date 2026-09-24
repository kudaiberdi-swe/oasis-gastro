/** Almaty is UTC+5 year-round (no DST) — this is a fixed offset, not a timezone database lookup. */
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

export const DAY_MS = 24 * 60 * 60 * 1000

/** Start of an Almaty business date ("YYYY-MM-DD") as a UTC timestamp. */
export function almatyDayStart(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return Date.UTC(year, month - 1, day) - ALMATY_OFFSET_MS
}

export function almatyBusinessDate(value: number): string {
  const date = new Date(value + ALMATY_OFFSET_MS)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}
