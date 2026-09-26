import { ConvexError, v } from "convex/values"
import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc } from "../../_generated/dataModel"
import { mutation, query } from "../../_generated/server"
import { budgetLineFact, budgetLinesOf, budgetPeriodOf, MAX_BUDGET_LINES, type ScanBudget } from "../../lib/budgets"
import { saveDomainRecord } from "../../lib/domainRecords"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { FINANCE_MODULES } from "./validators"

type QueryCtx = GenericQueryCtx<DataModel>
type FinanceRecord = Doc<"financeRecords">

// «Бюджеты» (W3-FIN-13): lines of a budget, its plan-fact and new versions. The record itself goes through
// records.save / transition (approval lifecycle); its amount is the sum of the lines.

const MODULE = { moduleId: "budgets" as const, ...FINANCE_MODULES.budgets }
const SCAN = 20_000

async function budgetRecord(ctx: QueryCtx, user: { restaurantScopes: string[] }, externalId: string) {
  const record = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!record || record.moduleId !== "budgets") throw new ConvexError("Бюджет не найден")
  await requireRestaurantScope(ctx, user, record.restaurantExternalId)
  return record
}

export const budgetLines = query({
  args: { budgetExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.budgets.view")
    const record = await budgetRecord(ctx, user, args.budgetExternalId)
    return budgetLinesOf(ctx, record)
  },
})

/**
 * The lines of a draft budget (written after records.save, like a payment's allocation table). The budget's
 * amount becomes their sum — derived, like its search text, so the record's version stays and the card's
 * next transition still matches.
 */
export const setBudgetLines = mutation({
  args: { budgetExternalId: v.string(), lines: v.array(v.object({ accountExternalId: v.optional(v.string()), cashflowCategoryExternalId: v.optional(v.string()), planAmount: v.number() })) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.budgets.edit")
    const record = await budgetRecord(ctx, user, args.budgetExternalId)
    if (record.status !== "draft") throw new ConvexError("Строки меняются только у черновика бюджета")
    if (args.lines.length > MAX_BUDGET_LINES) throw new ConvexError(`Не больше ${MAX_BUDGET_LINES} строк в бюджете`)
    const seen = new Set<string>()
    for (const [index, line] of args.lines.entries()) {
      const where = `Строка ${index + 1}`
      if (!line.accountExternalId === !line.cashflowCategoryExternalId) throw new ConvexError(`${where}: выберите счёт или статью ДДС`)
      if (!(Number.isInteger(line.planAmount) && line.planAmount >= 0)) throw new ConvexError(`${where}: план — целое число тенге`)
      const key = line.accountExternalId ?? line.cashflowCategoryExternalId!
      if (seen.has(key)) throw new ConvexError(`${where}: статья уже есть в бюджете`)
      seen.add(key)
      if (line.accountExternalId) {
        const account = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", line.accountExternalId!)).unique()
        if (!account?.active) throw new ConvexError(`${where}: счёт не найден в плане счетов`)
      } else {
        const category = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", line.cashflowCategoryExternalId!)).unique()
        if (!category || category.moduleId !== "cashflow-categories") throw new ConvexError(`${where}: статья ДДС не найдена`)
      }
    }
    for (const row of await ctx.db.query("budgetLines").withIndex("by_budget", (q) => q.eq("budgetExternalId", record.externalId)).take(MAX_BUDGET_LINES)) await ctx.db.delete(row._id)
    let total = 0
    for (const [index, line] of args.lines.entries()) {
      await ctx.db.insert("budgetLines", { budgetExternalId: record.externalId, lineNo: index + 1, ...(line.accountExternalId ? { accountExternalId: line.accountExternalId } : { cashflowCategoryExternalId: line.cashflowCategoryExternalId }), planAmount: line.planAmount })
      total += line.planAmount
    }
    if (args.lines.length) await ctx.db.patch(record._id, { amount: total })
    const email = (await getOfficeAuthEmail(ctx))!
    await writeOfficeAudit(ctx, email, { action: "budgets.lines", summary: `Бюджет ${record.number}: ${args.lines.length} строк, план ${total} ₸`, resourceType: MODULE.moduleId, resourceExternalId: record.externalId, restaurantExternalId: record.restaurantExternalId, capability: "office.budgets.edit" })
    return { total, lines: args.lines.length }
  },
})

async function execution(ctx: QueryCtx, record: FinanceRecord, scan: ScanBudget) {
  const period = budgetPeriodOf(record)
  const lines = []
  for (const line of await budgetLinesOf(ctx, record)) {
    const fact = await budgetLineFact(ctx, line, { restaurantExternalId: record.restaurantExternalId, from: period.start, to: period.end }, scan)
    lines.push({ ...line, fact, deviation: fact - line.planAmount, percent: line.planAmount ? Math.round((fact / line.planAmount) * 1000) / 10 : null })
  }
  const plan = lines.reduce((sum, line) => sum + line.planAmount, 0)
  const fact = lines.reduce((sum, line) => sum + line.fact, 0)
  return { period, lines, plan, fact, percent: plan ? Math.round((fact / plan) * 1000) / 10 : null }
}

/**
 * Plan-fact of a budget over its whole period: by account — the journal turnover of the budget's
 * restaurant in the account's normal direction; by cashflow category — its posted payments.
 */
export const budgetExecution = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.budgets.view")
    const record = await budgetRecord(ctx, user, args.externalId)
    const scan = { left: SCAN, truncated: false }
    return { ...(await execution(ctx, record, scan)), truncated: scan.truncated }
  },
})

/**
 * «Новая версия»: a draft copy of the budget with the next version number and the same lines. The source
 * stays as it was (approved budgets are not edited); the plan-fact reports count only the latest agreed one.
 */
export const copyBudgetVersion = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.budgets.edit")
    const source = await budgetRecord(ctx, user, args.externalId)
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    const version = (typeof source.data.budgetVersion === "number" ? source.data.budgetVersion : 1) + 1
    const period = budgetPeriodOf(source)
    const copy = await saveDomainRecord(ctx, "financeRecords", email, MODULE, {
      name: source.name,
      restaurantExternalId: source.restaurantExternalId,
      businessDate: source.businessDate,
      amount: source.amount,
      debitAccountExternalId: source.debitAccountExternalId,
      creditAccountExternalId: source.creditAccountExternalId,
      cashflowCategoryExternalId: source.cashflowCategoryExternalId,
      data: { ...source.data, periodStart: period.start, periodEnd: period.end, budgetVersion: version, previousVersionExternalId: source.externalId },
    })
    // A budget saved before lines existed is copied with its own account / category on the record.
    for (const { _id, _creationTime, budgetExternalId: _source, ...line } of await ctx.db.query("budgetLines").withIndex("by_budget", (q) => q.eq("budgetExternalId", source.externalId)).take(MAX_BUDGET_LINES)) {
      await ctx.db.insert("budgetLines", { ...line, budgetExternalId: copy.externalId })
    }
    return { externalId: copy.externalId, number: copy.number, version: copy.version, budgetVersion: version }
  },
})
