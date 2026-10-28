import type { StatusTone } from "@/shared/lib/status-dictionary"

import type { FinanceRecord } from "../data/use-finance-records"
import { presetById } from "./parse-statement"

// A bank statement line (W3-FIN-11) as the office shows it: the fields importStatement stores in `data`
// and the matching state that autoMatch / confirmMatch / posting move on.

export type MatchStatus = "unmatched" | "suggested" | "matched" | "posted"

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = { unmatched: "Не сопоставлено", suggested: "Предложено", matched: "Сопоставлено", posted: "Проведено" }
export const MATCH_STATUS_TONES: Record<MatchStatus, StatusTone> = { unmatched: "neutral", suggested: "warning", matched: "info", posted: "success" }

const text = (value: unknown) => (typeof value === "string" ? value : "")

export function bankLineOf(record: FinanceRecord) {
  const status = text(record.data.matchStatus)
  return {
    direction: record.data.direction === "incoming" ? ("incoming" as const) : ("outgoing" as const),
    bank: text(record.data.bank),
    accountIban: text(record.data.accountIban),
    counterparty: text(record.data.counterparty),
    bin: text(record.data.bin),
    purpose: text(record.data.purpose),
    documentNumber: text(record.data.documentNumber),
    statementExternalId: text(record.data.statementExternalId),
    matchStatus: (["suggested", "matched", "posted"].includes(status) ? status : "unmatched") as MatchStatus,
    matchedNumber: text(record.data.matchedNumber),
    matchedPaymentExternalId: text(record.data.matchedPaymentExternalId),
    matchedObligationExternalId: text(record.data.matchedObligationExternalId),
    suggestedExternalId: text(record.data.suggestedExternalId),
    suggestedKind: record.data.suggestedKind === "obligation" ? ("obligation" as const) : ("payment" as const),
    suggestedNumber: text(record.data.suggestedNumber),
    createdPayment: record.data.createdPayment === true,
    comment: text(record.data.comment),
  }
}

/** Short bank name for the register: «Kaspi Business», «Halyk», «CSV по умолчанию», «Другой банк». */
export function bankName(id: string) {
  if (id === "kaspi-business") return "Kaspi Business"
  if (id === "halyk") return "Halyk"
  if (id === "sandyq") return "CSV по умолчанию" // the default preset keeps its stored id
  return presetById(id) && id !== "manual" ? id : "Другой банк"
}

/** KZ12…567A — the account in a narrow column (the full IBAN is in the card). */
export const shortIban = (iban: string) => (iban.length > 8 ? `${iban.slice(0, 4)}…${iban.slice(-4)}` : iban)

/** KZ12 3456 7890 1234 567A. */
export const groupIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim()
