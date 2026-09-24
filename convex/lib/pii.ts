// Masking of guest personal data for users without the pii right (W1-LOY-01, port of B:loyalty.ts:170).

export function maskValue(value: string | undefined, visible = 2) {
  if (!value) return value
  return value.length <= visible ? "•".repeat(value.length) : `${"•".repeat(value.length - visible)}${value.slice(-visible)}`
}

/** +7 701 ••• •• 67 style: country and operator stay, the middle is hidden. */
export function maskPhone(phone: string | undefined) {
  if (!phone) return phone
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 6) return maskValue(digits, 1)
  return `${digits.slice(0, 4)}${"•".repeat(digits.length - 6)}${digits.slice(-2)}`
}

export function maskEmail(email: string | undefined) {
  if (!email) return email
  const [name, domain] = email.split("@")
  if (!domain) return maskValue(email, 1)
  return `${name.slice(0, 1)}${"•".repeat(Math.max(1, name.length - 1))}@${domain}`
}

export function redactGuest<T extends { phone: string; email?: string; birthDate?: string; notes?: string }>(guest: T, canSeePii: boolean): T {
  if (canSeePii) return guest
  return { ...guest, phone: maskPhone(guest.phone) ?? "", email: maskEmail(guest.email), birthDate: guest.birthDate ? "••.••.••••" : undefined, notes: undefined }
}
