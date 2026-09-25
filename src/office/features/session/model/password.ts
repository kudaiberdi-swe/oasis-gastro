// The office password rule, checked before sending (the server repeats it: assertOfficePassword in
// convex/auth.ts — at least 10 characters, an upper-case and a lower-case letter, a digit).

export const OFFICE_PASSWORD_HINT = "Минимум 10 символов, заглавная и строчная буквы, цифра"

/** What the password still lacks, or null when it passes. */
export function officePasswordProblem(password: string): string | null {
  const missing: string[] = []
  if (password.length < 10) missing.push("не меньше 10 символов")
  if (!/[A-ZА-Я]/.test(password)) missing.push("заглавная буква")
  if (!/[a-zа-я]/.test(password)) missing.push("строчная буква")
  if (!/\d/.test(password)) missing.push("цифра")
  return missing.length ? `Ещё нужно: ${missing.join(", ")}` : null
}

export const RESET_CODE_LENGTH = 8
