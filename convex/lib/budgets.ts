import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>
type FinanceRecord = Doc<"financeRecords">

// Budgets (W3-FIN-13): a budget record has lines in `budgetLines` (plan by account or cashflow category);
// budgets saved before them are one line — the record's own amount and account / category. Shared by the
// office card (domains/finance/budgets) and the plan-fact reports (finance-05/14).

export const MAX_BUDGET_LINES = 200

export type PlanLine = { lineNo: number; accountExternalId?: string; cashflowCategoryExternalId?: string; planAmount: number }

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Last day of a month (YYYY-MM). */
export function monthEnd(month: string) {
  const [year, value] = month.split("-").map(Number)
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10)
}

/** The budget's period: `data.periodStart…periodEnd`, else the month of the record. */
export function budgetPeriodOf(record: Pick<FinanceRecord, "businessDate" | "data">) {
  const month = record.businessDate.slice(0, 7)
  return { start: isDate(record.data.periodStart) ? record.data.periodStart : `${month}-01`, end: isDate(record.data.periodEnd) ? record.data.periodEnd : monthEnd(month) }
}

export async function budgetLinesOf(ctx: QueryCtx, record: FinanceRecord): Promise<PlanLine[]> {
  const rows = await ctx.db.query("budgetLines").withIndex("by_budget", (q) => q.eq("budgetExternalId", record.externalId)).take(MAX_BUDGET_LINES)
  if (rows.length) return rows.map((row) => ({ lineNo: row.lineNo, accountExternalId: row.accountExternalId, cashflowCategoryExternalId: row.cashflowCategoryExternalId, planAmount: row.planAmount }))
  const account = (typeof record.data.accountExternalId === "string" && record.data.accountExternalId) || record.debitAccountExternalId || record.creditAccountExternalId || undefined
  return [{ lineNo: 1, accountExternalId: account, cashflowCategoryExternalId: account ? undefined : record.cashflowCategoryExternalId, planAmount: record.amount }]
}

const DEBIT_NORMAL = new Set<Doc<"accounts">["type"]>(["asset", "expense", "contra-income"])

export type ScanBudget = { left: number; truncated: boolean }

/**
 * Fact of one budget line in a restaurant and period: the account's turnover in its normal direction
 * (debit for assets and expenses, credit otherwise), or the posted payments of the cashflow category
 * (its own direction counts plus, the other minus). Reads stop when the scan budget is spent.
 */
export async function budgetLineFact(ctx: QueryCtx, line: PlanLine, scope: { restaurantExternalId: string; from: string; to: string }, scan: ScanBudget) {
  let fact = 0
  const spend = () => {
    if (scan.left <= 0) {
      scan.truncated = true
      return false
    }
    scan.left -= 1
    return true
  }
  if (line.accountExternalId) {
    const account = line.accountExternalId
    const type = (await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", account)).unique())?.type ?? "expense"
    const debitNormal = DEBIT_NORMAL.has(type)
    for await (const entry of ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => q.eq("debitAccountExternalId", account).gte("businessDate", scope.from).lte("businessDate", scope.to))) {
      if (!spend()) break
      if (entry.restaurantExternalId === scope.restaurantExternalId) fact += debitNormal ? entry.amount : -entry.amount
    }
    for await (const entry of ctx.db.query("journalEntries").withIndex("by_credit_date", (q) => q.eq("creditAccountExternalId", account).gte("businessDate", scope.from).lte("businessDate", scope.to))) {
      if (!spend()) break
      if (entry.restaurantExternalId === scope.restaurantExternalId) fact += debitNormal ? -entry.amount : entry.amount
    }
    return fact
  }
  if (line.cashflowCategoryExternalId) {
    const categoryId = line.cashflowCategoryExternalId
    const category = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", categoryId)).unique()
    const outgoing = category?.data.direction === "outgoing"
    const payments = ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "payments").eq("restaurantExternalId", scope.restaurantExternalId).gte("businessDate", scope.from).lte("businessDate", scope.to))
    for await (const payment of payments) {
      if (!spend()) break
      if (payment.status !== "posted" || payment.cashflowCategoryExternalId !== categoryId) continue
      fact += (payment.data.direction === "outgoing") === outgoing ? payment.amount : -payment.amount
    }
  }
  return fact
}
