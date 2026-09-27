const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

// `locale` — the Intl locale of the interface: the office is always "ru-RU", the POS passes "kk-KZ" in Kazakh.

export function formatAlmatyDateTime(value: number, locale = "ru-RU") {
  return new Date(value).toLocaleString(locale, { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function formatAlmatyDate(value: number, locale = "ru-RU") {
  return new Date(value).toLocaleDateString(locale, { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric" })
}

export function formatAlmatyTime(value: number, locale = "ru-RU") {
  return new Date(value).toLocaleString(locale, { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" })
}

export function almatyBusinessDate(value: number): string {
  const date = new Date(value + ALMATY_OFFSET_MS)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}
