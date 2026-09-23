const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

export function formatAlmatyDateTime(value: number) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function formatAlmatyTime(value: number) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" })
}

export function almatyBusinessDate(value: number): string {
  const date = new Date(value + ALMATY_OFFSET_MS)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}
