// All user-visible number formatting (L-22). Components never call toLocaleString/Intl directly.

const THIN_SPACE = " " // between digit groups
const NO_BREAK_SPACE = " " // before the unit, so "₸" never wraps onto its own line
const MINUS = "−"

function groupDigits(value: number, fractionDigits = 0) {
  const fixed = Math.abs(value).toFixed(fractionDigits)
  const [whole, fraction] = fixed.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
  return fraction && Number(fraction) !== 0 ? `${grouped},${fraction.replace(/0+$/, "")}` : grouped
}

function sign(value: number, { explicitPlus = false } = {}) {
  if (value < 0 && Math.round(Math.abs(value)) !== 0) return MINUS
  if (explicitPlus && value > 0) return "+"
  return ""
}

/** 1279652.3 → "1 279 652 ₸" (thin-space groups, no tiyn, real minus sign). */
export function formatTenge(value: number, options: { explicitPlus?: boolean } = {}) {
  const rounded = Math.round(value)
  return `${sign(rounded, options)}${groupDigits(rounded)}${NO_BREAK_SPACE}₸`
}

/** Amount without the currency sign, for table cells where the header already says "₸". */
export function formatAmount(value: number) {
  const rounded = Math.round(value)
  return `${sign(rounded)}${groupDigits(rounded)}`
}

const UNIT_LABELS: Record<string, string> = { kg: "кг", g: "г", l: "л", ml: "мл", pcs: "шт", pc: "шт", portion: "порц." }

/** 2.5, "kg" → "2,5 кг"; up to 3 decimals, trailing zeros dropped. */
export function formatQuantity(value: number, unit?: string) {
  const text = `${sign(value)}${groupDigits(value, 3)}`
  return unit ? `${text}${NO_BREAK_SPACE}${UNIT_LABELS[unit] ?? unit}` : text
}

/** 7.5 → "7 ч 30 мин"; 0.25 → "15 мин"; 0 → "0 ч" (hours carry «ч», L-10). */
export function formatHours(hours: number) {
  const totalMinutes = Math.round(Math.abs(hours) * 60)
  if (totalMinutes === 0) return `0${NO_BREAK_SPACE}ч`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const parts = [h ? `${h}${NO_BREAK_SPACE}ч` : "", m ? `${m}${NO_BREAK_SPACE}мин` : ""].filter(Boolean)
  return `${hours < 0 ? MINUS : ""}${parts.join(" ")}`
}

/** 12.5 → "12,5 %"; one decimal at most. */
export function formatPercent(value: number, options: { explicitPlus?: boolean } = {}) {
  const rounded = Math.round(value * 10) / 10
  return `${sign(rounded, options)}${groupDigits(rounded, 1)}${NO_BREAK_SPACE}%`
}
