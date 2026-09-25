// Phone numbers as the office shows them. The server stores digits only (convex/lib/loyalty normalizePhone)
// and normalizes whatever comes back, so a formatted number can be sent as is.

/**
 * «77000000001» → «+7 700 000 00 01»: a full 11-digit number in any punctuation (the domestic «8…»
 * prefix becomes +7). A masked phone («7701••••90»), a partial or a longer number is returned unchanged.
 */
export function formatPhoneNumber(phone: string) {
  if (phone.includes("•") || !/^[\d\s()+-]+$/.test(phone)) return phone
  const digits = phone.replace(/\D/g, "")
  if (digits.length !== 11) return phone
  const country = digits[0] === "8" ? "7" : digits[0]
  return `+${country} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`
}
