import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"

// «Платёжный календарь» and «Бюджеты» (W3-FIN-12/13): typed hooks over convex/domains/finance/{cashflow,budgets}.

const cashflow = api.domains.finance.cashflow
const budgets = api.domains.finance.budgets

export type CashflowForecast = FunctionReturnType<typeof cashflow.cashflowForecast>
export type ForecastDay = CashflowForecast["days"][number]
export type BudgetExecution = FunctionReturnType<typeof budgets.budgetExecution>
export type BudgetPlanLine = FunctionReturnType<typeof budgets.budgetLines>[number]

/** No restaurant — every restaurant in scope. */
export function useCashflowForecast(month: string, restaurantExternalId: string | undefined, enabled = true) {
  return useQuery(cashflow.cashflowForecast, enabled ? { month, ...(restaurantExternalId ? { restaurantExternalId } : {}) } : "skip")
}

export function useBudgetLines(budgetExternalId: string | null) {
  return useQuery(budgets.budgetLines, budgetExternalId ? { budgetExternalId } : "skip")
}

export function useBudgetExecution(externalId: string | null) {
  return useQuery(budgets.budgetExecution, externalId ? { externalId } : "skip")
}

export function useBudgetMutations() {
  const setBudgetLines = useMutation(budgets.setBudgetLines)
  const copyBudgetVersion = useMutation(budgets.copyBudgetVersion)
  return { setBudgetLines, copyBudgetVersion }
}
