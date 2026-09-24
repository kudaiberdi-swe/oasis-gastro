import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { getDomainRecord, listDomainRecords, saveDomainRecord, transitionCapability, transitionDomainRecord, type ModuleDefinition } from "../../lib/domainRecords"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, restaurantScopeFilter, scopedRestaurants } from "../../lib/officeAccess"
import { officeDomainStatus } from "../../lib/validators"
import { FINANCE_MODULES, financeModuleId, financeRecordData, type FinanceModuleId } from "./validators"
import { financeHooks, validateFinanceRecord } from "./modules"

// Finance records (W1-FIN-01) on the domain-record engine. Every handler checks office.<module>.<action>
// and the restaurant scope itself.

function moduleOf(moduleId: FinanceModuleId): ModuleDefinition {
  return { moduleId, ...FINANCE_MODULES[moduleId] }
}

const domainAction = v.union(
  v.literal("activate"),
  v.literal("deactivate"),
  v.literal("publish"),
  v.literal("expire"),
  v.literal("submit"),
  v.literal("approve"),
  v.literal("post"),
  v.literal("reverse"),
  v.literal("cancel"),
)

export const list = query({
  args: {
    moduleId: financeModuleId,
    status: v.optional(officeDomainStatus),
    restaurantExternalId: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    restaurantScopeFilter(user, args.restaurantExternalId) // throws for a restaurant outside the scope
    return listDomainRecords(ctx, "financeRecords", user, args)
  },
})

export const get = query({
  args: { moduleId: financeModuleId, externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    return getDomainRecord(ctx, "financeRecords", user, args.moduleId, args.externalId)
  },
})

/** Pick lists for finance forms: accounts, cashflow categories, counterparties, restaurants in scope. */
export const references = query({
  args: { moduleId: financeModuleId },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, `office.${args.moduleId}.view`)
    const LIMIT = 500
    const accounts = await ctx.db.query("accounts").withIndex("by_code").take(LIMIT)
    const records = async (moduleId: FinanceModuleId) =>
      ctx.db.query("financeRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", moduleId).eq("status", "active")).take(LIMIT + 1)
    const [categories, counterparties, restaurants] = await Promise.all([records("cashflow-categories"), records("counterparties"), scopedRestaurants(ctx, user)])
    return {
      accounts: accounts.filter((account) => account.active).map((account) => ({ externalId: account.externalId, code: account.code, name: account.name, type: account.type, allowManualEntries: account.allowManualEntries })),
      cashflowCategories: categories.slice(0, LIMIT).map((row) => ({ externalId: row.externalId, name: row.name })),
      counterparties: counterparties.slice(0, LIMIT).map((row) => ({ externalId: row.externalId, name: row.name })),
      restaurants: restaurants.map((restaurant) => ({ externalId: restaurant.externalId, name: restaurant.name })),
      truncated: categories.length > LIMIT || counterparties.length > LIMIT,
    }
  },
})

export const save = mutation({
  args: {
    moduleId: financeModuleId,
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    name: v.string(),
    restaurantExternalId: v.string(),
    businessDate: v.string(),
    amount: v.number(),
    debitAccountExternalId: v.optional(v.string()),
    creditAccountExternalId: v.optional(v.string()),
    cashflowCategoryExternalId: v.optional(v.string()),
    counterpartyExternalId: v.optional(v.string()),
    data: financeRecordData,
  },
  handler: async (ctx, { moduleId, ...args }) => {
    const { user } = await requireOfficeCapability(ctx, `office.${moduleId}.edit`)
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    const derived = await validateFinanceRecord(ctx, moduleId, args)
    const record = await saveDomainRecord(ctx, "financeRecords", email, moduleOf(moduleId), { ...args, ...derived })
    return { externalId: record.externalId, number: record.number, version: record.version }
  },
})

export const transition = mutation({
  args: { moduleId: financeModuleId, externalId: v.string(), action: domainAction, expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, { moduleId, ...args }) => {
    const module = moduleOf(moduleId)
    const { user } = await requireOfficeCapability(ctx, transitionCapability(module, args.action))
    const email = await getOfficeAuthEmail(ctx)
    if (!email) throw new ConvexError("Требуется вход в Office")
    const record = await transitionDomainRecord(ctx, "financeRecords", email, user, module, args, financeHooks(ctx, moduleId))
    return { status: record.status, version: record.version }
  },
})
