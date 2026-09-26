import { ConvexError } from "convex/values"

// Server and network errors in short, direct Russian (POS-DESIGN tone: «Нет связи. Повторите.»). A
// ConvexError's own Russian text is already written for people and passes through; the technical rest —
// masked «Server Error», validator dumps, request ids, English stack text — never reaches the screen.

export const DEFAULT_ERROR_MESSAGE = "Не получилось. Повторите."
export const NETWORK_ERROR_MESSAGE = "Нет связи. Повторите."

/** Structured ConvexError data ({ code }) → what the cashier or manager reads. */
const CODE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Сессия истекла. Войдите снова.",
  SESSION_EXPIRED: "Сессия истекла. Войдите снова.",
  FORBIDDEN: "Нет доступа.",
  NOT_FOUND: "Запись не найдена.",
  CONFLICT: "Данные изменились. Обновите и повторите.",
  RATE_LIMITED: "Слишком часто. Подождите минуту.",
  VALIDATION: "Проверьте введённые данные.",
}

const NETWORK = /failed to fetch|networkerror|network error|connection lost|websocket|timed? ?out|load failed|offline/i
const VALIDATION = /argumentvalidationerror|validator|does not match|is not a valid|value does not match/i
const TECHNICAL = /server error|uncaught|request id|internal error|\bat [\w$.]+ \(|undefined is not|cannot read prop/i
const CYRILLIC = /[а-яёәғқңөұүһі]/i

/** Removes the «[CONVEX M(domain:fn)] [Request ID: …]» prefixes Convex puts in front of a message. */
function stripPrefixes(message: string) {
  return message.replace(/^(\s*\[[^\]]*\]\s*)+/, "").trim()
}

/** The human part of a raw message, or null when there is none to show. */
function humanText(raw: string): string | null {
  const text = stripPrefixes(raw)
  if (!text || TECHNICAL.test(text) || !CYRILLIC.test(text)) return null
  return text
}

export function errorMessage(error: unknown, fallback = DEFAULT_ERROR_MESSAGE): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === "string") return humanText(data) ?? fallback
    if (data && typeof data === "object") {
      const { code, message } = data as { code?: unknown; message?: unknown }
      if (typeof message === "string" && humanText(message)) return humanText(message)!
      if (typeof code === "string" && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
    }
    return fallback
  }
  if (error instanceof Error) {
    const text = stripPrefixes(error.message)
    if (NETWORK.test(text)) return NETWORK_ERROR_MESSAGE
    if (VALIDATION.test(text)) return CODE_MESSAGES.VALIDATION
    return humanText(text) ?? fallback
  }
  return fallback
}
