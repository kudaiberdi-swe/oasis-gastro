import { ruT, type Translator } from "@/pos/i18n"
import { formatTenge } from "@/shared/lib/format"

// «Гость и лояльность» on the POS (W1-POS-16): pure rules of the dialog. The server re-checks the
// redemption (setOrderRedemption) and applies it at checkout: payments = total − planned redemption.

export type QuoteNumbers = {
  maxRedemption: number
  accrual: number
  accrualWithout?: number
  planned: number
}

export const phoneDigits = (value: string) => value.replace(/\D/g, "")

/** The search text is a phone (only digits and phone punctuation). */
export const isPhoneQuery = (value: string) => /^[\d\s()+-]+$/.test(value.trim()) && phoneDigits(value).length >= 2

/** A phone complete enough to attach or create a guest: 10 or 11 digits. */
export const isFullPhone = (value: string) => {
  const digits = phoneDigits(value)
  return digits.length === 10 || digits.length === 11
}

/** «+7 701 ••• •• 67» — the cashier sees the operator and the last digits only. */
export function maskPhoneForPos(phone: string | undefined) {
  if (!phone) return "—"
  if (phone.includes("•")) return phone.startsWith("7") ? `+${phone}` : phone
  const digits = phoneDigits(phone)
  if (digits.length < 6) return phone
  return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ••• •• ${digits.slice(-2)}`
}

/** A masked phone and a typed one belong to the same guest: same last two digits. */
export function phoneMatchesMask(masked: string | undefined, typed: string) {
  const tail = phoneDigits(masked ?? "").slice(-2)
  return isFullPhone(typed) && tail.length === 2 && phoneDigits(typed).endsWith(tail)
}

/**
 * Points earned on this check for a redemption. Exact where the server gave it (no redemption, or the
 * planned one); otherwise proportional to what is left to pay — `approximate` says so.
 */
export function accrualFor(quote: QuoteNumbers, redemption: number, total: number): { points: number; approximate: boolean } {
  const without = quote.accrualWithout ?? quote.accrual
  if (redemption === quote.planned) return { points: quote.accrual, approximate: false }
  if (redemption === 0) return { points: without, approximate: false }
  if (total <= 0) return { points: 0, approximate: false }
  return {
    points: Math.floor((without * Math.max(0, total - redemption)) / total),
    approximate: true,
  }
}

/**
 * Why this redemption cannot be planned, or null. Checkout needs at least one money payment of
 * a positive amount, so the whole check cannot go on points.
 */
export function redemptionProblem(redemption: number | null, maxRedemption: number, total: number, t: Translator = ruT): string | null {
  const value = redemption ?? 0
  if (!Number.isInteger(value) || value < 0) return t("guest.wholePoints")
  if (value > maxRedemption) return t("guest.overMax", { amount: formatTenge(maxRedemption) })
  if (value > 0 && value >= total) return t("guest.leaveOne")
  return null
}

/** The most that can be planned on this check. */
export const redemptionLimit = (maxRedemption: number, total: number) => Math.max(0, Math.min(maxRedemption, total - 1))
