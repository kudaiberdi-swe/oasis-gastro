import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import type { QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { query } from "../../_generated/server"
import { requireOfficeCapability, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
import { listOperationalRestaurants } from "../../lib/restaurants"

async function loadEntries(ctx: QueryCtx, inScope: (restaurantExternalId: string | undefined) => boolean, args: { restaurantExternalId?: string; from?: string; to?: string }) {
  const all = args.restaurantExternalId
    ? await ctx.db.query("ledgerEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).collect()
    : await ctx.db.query("ledgerEntries").withIndex("by_occurred_at").collect()
  return all.filter((entry) => inScope(entry.restaurantExternalId) && (!args.from || entry.businessDate >= args.from) && (!args.to || entry.businessDate <= args.to))
}

export const summary = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const entries = await loadEntries(ctx, restaurantScopeFilter(user, args.restaurantExternalId), args)
    const revenue = entries.filter((entry) => entry.kind === "revenue").reduce((sum, entry) => sum + entry.amount, 0)
    const expense = entries.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + entry.amount, 0)
    const byCategory = new Map<string, { kind: "revenue" | "expense"; amount: number }>()
    for (const entry of entries) {
      const existing = byCategory.get(entry.category)
      byCategory.set(entry.category, { kind: entry.kind, amount: (existing?.amount ?? 0) + entry.amount })
    }
    return {
      revenue,
      expense,
      net: revenue - expense,
      byCategory: [...byCategory.entries()].map(([category, value]) => ({ category, ...value })).sort((left, right) => right.amount - left.amount),
    }
  },
})

export const listEntries = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const entries = await loadEntries(ctx, restaurantScopeFilter(user, args.restaurantExternalId), args)
    return entries.sort((left, right) => right.occurredAt - left.occurredAt).slice(0, args.limit ?? 200)
  },
})

export const restaurantsForFilter = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const inScope = restaurantScopeFilter(user)
    return (await listOperationalRestaurants(ctx)).filter((restaurant) => inScope(restaurant.externalId))
  },
})

// ── Journal (W1-FIN-05) ──────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/
const OVERVIEW_LIMIT = 20_000

function checkPeriod(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new ConvexError("Укажите период")
}

/** Every journal line in the period — system postings and posted manual operations alike. */
export const journal = query({
  args: {
    restaurantExternalId: v.optional(v.string()),
    from: v.string(),
    to: v.string(),
    accountExternalId: v.optional(v.string()),
    sourceModuleId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    checkPeriod(args.from, args.to)
    const base = args.restaurantExternalId
      ? ctx.db.query("journalEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!).gte("businessDate", args.from).lte("businessDate", args.to))
      : ctx.db.query("journalEntries").withIndex("by_date", (q) => q.gte("businessDate", args.from).lte("businessDate", args.to))
    const scopes = user.restaurantScopes.includes("*") ? null : user.restaurantScopes.slice(0, 50)
    const page = await base
      .order("desc")
      .filter((q) =>
        q.and(
          scopes && !args.restaurantExternalId ? q.or(...scopes.map((scope) => q.eq(q.field("restaurantExternalId"), scope))) : true,
          args.accountExternalId ? q.or(q.eq(q.field("debitAccountExternalId"), args.accountExternalId), q.eq(q.field("creditAccountExternalId"), args.accountExternalId)) : true,
          args.sourceModuleId ? q.eq(q.field("sourceModuleId"), args.sourceModuleId) : true,
        ),
      )
      .paginate(args.paginationOpts)
    const accounts = new Map((await ctx.db.query("accounts").withIndex("by_code").take(200)).map((account) => [account.externalId, { code: account.code, name: account.name }]))
    return {
      ...page,
      page: page.page.filter((entry) => inScope(entry.restaurantExternalId)).map((entry) => ({ ...entry, debitAccount: accounts.get(entry.debitAccountExternalId) ?? null, creditAccount: accounts.get(entry.creditAccountExternalId) ?? null })),
    }
  },
})

/**
 * Turnover for the period. With an account: its debit and credit turnover (different numbers); without:
 * one «Оборот за период» — in double entry the whole book's debit always equals its credit (L-11).
 */
export const overview = query({
  args: { restaurantExternalId: v.optional(v.string()), from: v.string(), to: v.string(), accountExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.view")
    const inScope = restaurantScopeFilter(user, args.restaurantExternalId)
    checkPeriod(args.from, args.to)
    const inRestaurant = (entry: Doc<"journalEntries">) => inScope(entry.restaurantExternalId) && (!args.restaurantExternalId || entry.restaurantExternalId === args.restaurantExternalId)
    let scanned = 0
    const sum = async (entries: AsyncIterable<Doc<"journalEntries">>) => {
      let amount = 0
      let count = 0
      for await (const entry of entries) {
        scanned += 1
        if (scanned > OVERVIEW_LIMIT) break
        if (!inRestaurant(entry)) continue
        amount += entry.amount
        count += 1
      }
      return { amount, count }
    }
    if (args.accountExternalId) {
      const debit = await sum(ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => q.eq("debitAccountExternalId", args.accountExternalId!).gte("businessDate", args.from).lte("businessDate", args.to)))
      const credit = await sum(ctx.db.query("journalEntries").withIndex("by_credit_date", (q) => q.eq("creditAccountExternalId", args.accountExternalId!).gte("businessDate", args.from).lte("businessDate", args.to)))
      return { mode: "account" as const, debitTurnover: debit.amount, creditTurnover: credit.amount, balance: debit.amount - credit.amount, entriesCount: debit.count + credit.count, truncated: scanned > OVERVIEW_LIMIT }
    }
    const restaurants = args.restaurantExternalId ? [args.restaurantExternalId] : (await scopedRestaurants(ctx, user)).map((row) => row.externalId)
    let turnover = 0
    let entriesCount = 0
    for (const restaurant of restaurants) {
      const part = await sum(ctx.db.query("journalEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", args.from).lte("businessDate", args.to)))
      turnover += part.amount
      entriesCount += part.count
    }
    return { mode: "book" as const, turnover, entriesCount, truncated: scanned > OVERVIEW_LIMIT }
  },
})

/** What we owe a counterparty: posted receipts of its suppliers minus its approved or posted payments (W1-FIN-04). */
export const counterpartyDebt = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.counterparties.view")
    const counterparty = await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!counterparty || counterparty.moduleId !== "counterparties") return null
    const suppliers = counterparty.bin ? await ctx.db.query("suppliers").withIndex("by_bin", (q) => q.eq("bin", counterparty.bin!)).take(20) : []
    let received = 0
    for (const supplier of suppliers) {
      for await (const receipt of ctx.db.query("receipts").withIndex("by_supplier_status", (q) => q.eq("supplierId", supplier._id).eq("status", "posted"))) received += receipt.totalGross
    }
    let paid = 0
    for await (const payment of ctx.db.query("financeRecords").withIndex("by_counterparty_module", (q) => q.eq("counterpartyExternalId", counterparty.externalId).eq("moduleId", "payments"))) {
      if (payment.status === "approved" || payment.status === "posted") paid += payment.amount
    }
    return { received, paid, debt: received - paid }
  },
})
