import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants, writeOfficeAudit } from "../../lib/officeAccess"
import { businessDateFor } from "../../lib/time"

// «Задолженность» (W2-FIN-09) and payment allocation (W2-FIN-10).

async function openObligationsOf(ctx: Parameters<typeof scopedRestaurants>[0], restaurants: string[]) {
  const rows: Doc<"financeRecords">[] = []
  for (const restaurant of restaurants) {
    for await (const row of ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "accounts-payable").eq("restaurantExternalId", restaurant))) {
      if (row.status === "posted" && row.amount > 0) rows.push(row)
      if (rows.length >= 5000) return rows
    }
  }
  return rows
}

/** KPI «К оплате», «Просрочено», «Дебиторская» and ageing of payables 0–30 / 31–60 / 60+ days. */
export const payablesSummary = query({
  args: { restaurantExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.accounts-payable.view")
    restaurantScopeFilter(user, args.restaurantExternalId)
    const restaurants = args.restaurantExternalId ? [args.restaurantExternalId] : (await scopedRestaurants(ctx, user)).map((row) => row.externalId)
    const today = businessDateFor(Date.now())
    const ageOf = (date: string) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000
    const summary = { payable: 0, overdue: 0, receivable: 0, ageing: { upTo30: 0, from31to60: 0, over60: 0 } }
    for (const row of await openObligationsOf(ctx, restaurants)) {
      if (row.data.direction === "receivable") {
        summary.receivable += row.amount
        continue
      }
      summary.payable += row.amount
      const due = typeof row.data.dueDate === "string" ? row.data.dueDate : null
      if (due && due < today) summary.overdue += row.amount
      const age = ageOf(row.businessDate)
      if (age <= 30) summary.ageing.upTo30 += row.amount
      else if (age <= 60) summary.ageing.from31to60 += row.amount
      else summary.ageing.over60 += row.amount
    }
    return summary
  },
})

/** Open obligations of a counterparty to pick in a payment's allocation table. */
export const openObligations = query({
  args: { counterpartyExternalId: v.string(), direction: v.union(v.literal("payable"), v.literal("receivable")), restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payments.view")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const rows = await openObligationsOf(ctx, [args.restaurantExternalId])
    return rows
      // Obligations without a counterparty (payroll taxes) can be paid to any recipient.
      .filter((row) => (!row.counterpartyExternalId || row.counterpartyExternalId === args.counterpartyExternalId) && row.data.direction === args.direction)
      .map((row) => ({ externalId: row.externalId, number: row.number, name: row.name, open: row.amount, original: Number(row.data.originalAmount ?? row.amount), dueDate: row.data.dueDate ?? null, sourceNumber: row.data.sourceNumber ?? null }))
  },
})

/** The allocation table of a draft payment; checked again against open remainders when it is posted. */
export const setPaymentAllocations = mutation({
  args: { paymentExternalId: v.string(), allocations: v.array(v.object({ obligationExternalId: v.string(), amount: v.number() })) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payments.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const payment = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.paymentExternalId)).unique()
    if (!payment || payment.moduleId !== "payments") throw new ConvexError("Платёж не найден")
    await requireRestaurantScope(ctx, user, payment.restaurantExternalId)
    if (payment.status !== "draft") throw new ConvexError("Распределение меняется только у черновика")
    let total = 0
    for (const row of args.allocations) {
      if (!(Number.isInteger(row.amount) && row.amount > 0)) throw new ConvexError("Сумма распределения — целое число тенге больше нуля")
      const obligation = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", row.obligationExternalId)).unique()
      if (!obligation || obligation.moduleId !== "accounts-payable" || obligation.restaurantExternalId !== payment.restaurantExternalId) throw new ConvexError("Обязательство не найдено")
      if (obligation.counterpartyExternalId && obligation.counterpartyExternalId !== payment.counterpartyExternalId) throw new ConvexError("Обязательство другого контрагента")
      if (row.amount > obligation.amount) throw new ConvexError("Сумма платежа превышает открытый остаток")
      total += row.amount
    }
    if (total > payment.amount) throw new ConvexError("Распределено больше суммы платежа")
    for (const row of await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentExternalId", payment.externalId)).take(100)) await ctx.db.delete(row._id)
    for (const row of args.allocations) await ctx.db.insert("paymentAllocations", { paymentExternalId: payment.externalId, obligationExternalId: row.obligationExternalId, amount: row.amount })
    await writeOfficeAudit(ctx, email, { action: "payments.allocate", summary: `Платёж ${payment.number}: распределено ${total} ₸ по ${args.allocations.length} обязательствам`, resourceType: "payments", resourceExternalId: payment.externalId, restaurantExternalId: payment.restaurantExternalId, capability: "office.payments.edit" })
    return { allocated: total, advance: payment.amount - total }
  },
})

export const paymentAllocationsOf = query({
  args: { paymentExternalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.payments.view")
    const payment = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.paymentExternalId)).unique()
    if (!payment) return []
    await requireRestaurantScope(ctx, user, payment.restaurantExternalId)
    return ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentExternalId", payment.externalId)).take(100)
  },
})
