import { errorMessage, type ErrorMessages } from "@/shared/lib/error-message"
import type { Translator } from "./core"

/** The client-side error texts in the interface language; a server's own Russian message passes as it is. */
function messagesFor(t: Translator): ErrorMessages | undefined {
  if (t.locale === "ru") return undefined
  return {
    network: t("error.network"),
    codes: {
      UNAUTHENTICATED: t("error.sessionExpired"),
      SESSION_EXPIRED: t("error.sessionExpired"),
      FORBIDDEN: t("error.forbidden"),
      NOT_FOUND: t("error.notFound"),
      CONFLICT: t("error.conflict"),
      RATE_LIMITED: t("error.rateLimited"),
      VALIDATION: t("error.validation"),
    },
  }
}

/** errorMessage (shared/lib/error-message) for the POS: `fallback` is already translated by the caller. */
export function posErrorMessage(t: Translator, error: unknown, fallback?: string) {
  return errorMessage(error, fallback ?? t("error.default"), messagesFor(t))
}
