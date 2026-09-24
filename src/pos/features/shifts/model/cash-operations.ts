import type { PosCashOperationType } from "@/pos/features/retail/data/use-retail-settings"
import { formatTenge } from "@/shared/lib/format"

// Cash in / cash out (W1-POS-08/19). With published cash operation types the direction, limit and
// manager rule come from the type; before they are seeded the legacy direction + reason form is used.
// Every cash-out needs a manager (shifts/mutations.ts recordCashMovement).

export type CashDirection = "cash-in" | "cash-out"

export type CashMovementInput = { cashOperationTypeExternalId?: string; direction?: CashDirection; amount: number; comment?: string; reason?: string }

export const typesFor = (types: PosCashOperationType[], direction: CashDirection) => types.filter((type) => type.data.direction === direction)

export function cashNeedsManager(direction: CashDirection, type: PosCashOperationType | undefined) {
  return direction === "cash-out" || Boolean(type?.data.requireManager)
}

/** Why the operation cannot be saved yet, or null. */
export function cashMovementProblem(input: { legacy: boolean; type: PosCashOperationType | undefined; amount: number | null; comment: string; expectedCash?: number; direction: CashDirection }) {
  if (!input.legacy && !input.type) return "Выберите тип операции"
  if (!input.amount || input.amount <= 0) return "Введите сумму больше нуля"
  if (input.type && input.amount > input.type.data.maximumAmount) return `Лимит операции — ${formatTenge(input.type.data.maximumAmount)}`
  if (input.direction === "cash-out" && input.expectedCash !== undefined && input.amount > input.expectedCash) return `В кассе учтено ${formatTenge(input.expectedCash)}`
  if (input.legacy && input.comment.trim().length < 3) return "Укажите причину операции"
  return null
}

export function toCashMovement(input: { legacy: boolean; type: PosCashOperationType | undefined; direction: CashDirection; amount: number; comment: string }): CashMovementInput {
  const comment = input.comment.trim()
  return input.legacy || !input.type
    ? { direction: input.direction, amount: input.amount, reason: comment }
    : { cashOperationTypeExternalId: input.type.externalId, amount: input.amount, ...(comment ? { comment } : {}) }
}
