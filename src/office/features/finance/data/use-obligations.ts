import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "../../../../../convex/_generated/api"

// «Задолженность» and payment allocation (W2-FIN-09/10): typed hooks over convex/domains/finance/obligations.
// The server checks rights, restaurant scope and the open remainders again.

const obligations = api.domains.finance.obligations

export type PayablesSummary = FunctionReturnType<typeof obligations.payablesSummary>
export type OpenObligation = FunctionReturnType<typeof obligations.openObligations>[number]
export type PaymentAllocationRow = FunctionReturnType<typeof obligations.paymentAllocationsOf>[number]

/** KPI «К оплате / Просрочено / Дебиторская»; no restaurant — every restaurant in scope. */
export function usePayablesSummary(restaurantExternalId: string | undefined, enabled = true) {
  return useQuery(obligations.payablesSummary, enabled ? (restaurantExternalId ? { restaurantExternalId } : {}) : "skip")
}

/** Open obligations of a counterparty in one restaurant; null skips (the card has no counterparty yet). */
export function useOpenObligations(args: { counterpartyExternalId: string; direction: "payable" | "receivable"; restaurantExternalId: string } | null) {
  return useQuery(obligations.openObligations, args && args.counterpartyExternalId && args.restaurantExternalId ? args : "skip")
}

export function usePaymentAllocations(paymentExternalId: string | null) {
  return useQuery(obligations.paymentAllocationsOf, paymentExternalId ? { paymentExternalId } : "skip")
}

export function useSetPaymentAllocations() {
  return useMutation(obligations.setPaymentAllocations)
}
