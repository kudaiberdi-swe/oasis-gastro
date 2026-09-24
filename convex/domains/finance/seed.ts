import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../../_generated/server"
import { SYSTEM_ACCOUNTS } from "../../lib/accounts"
import { nextNumber } from "../../lib/numbering"
import { businessDateFor } from "../../lib/time"

/**
 * Idempotent upsert of the system accounts by externalId. Called by office bootstrap and the seed
 * script; with dryRun it only reports what would change.
 */
export async function seedChartOfAccountsRows(ctx: MutationCtx, dryRun = false) {
  let created = 0
  let updated = 0
  for (const account of Object.values(SYSTEM_ACCOUNTS)) {
    const existing = await ctx.db.query("accounts").withIndex("by_external_id", (q) => q.eq("externalId", account.externalId)).unique()
    const value = { externalId: account.externalId, code: account.code, name: account.name, type: account.type, system: true }
    if (!existing) {
      created += 1
      if (!dryRun) await ctx.db.insert("accounts", { ...value, allowManualEntries: true, active: true })
    } else if (existing.code !== value.code || existing.name !== value.name || existing.type !== value.type || !existing.system || !existing.active) {
      updated += 1
      // A system account is always active and keeps its type; manual-entry permission stays as set.
      if (!dryRun) await ctx.db.patch(existing._id, { ...value, active: true })
    }
  }
  return { created, updated, total: Object.keys(SYSTEM_ACCOUNTS).length, dryRun }
}

export const seedChartOfAccounts = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => seedChartOfAccountsRows(ctx, args.dryRun ?? false),
})

// Base cashflow categories (W1-FIN-03), one set per organization on its first active restaurant.
const CASHFLOW_CATEGORIES = [
  { code: "sales", name: "Выручка от продаж", direction: "incoming", activity: "operating" },
  { code: "suppliers", name: "Оплата поставщикам", direction: "outgoing", activity: "operating" },
  { code: "payroll", name: "Зарплата", direction: "outgoing", activity: "operating" },
  { code: "taxes", name: "Налоги", direction: "outgoing", activity: "operating" },
  { code: "rent", name: "Аренда", direction: "outgoing", activity: "operating" },
  { code: "other", name: "Прочее", direction: "both", activity: "operating" },
] as const

export async function seedCashflowCategoryRows(ctx: MutationCtx, dryRun = false) {
  const organizations = await ctx.db.query("organizations").take(20)
  let created = 0
  for (const organization of organizations) {
    const restaurants = await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(200)
    const home = restaurants.find((restaurant) => restaurant.organizationExternalId === organization.externalId)
    if (!home) continue
    const existing = await ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "cashflow-categories").eq("restaurantExternalId", home.externalId)).take(200)
    const now = Date.now()
    const businessDate = businessDateFor(now, home.businessDayCutoffMinutes)
    for (const [index, category] of CASHFLOW_CATEGORIES.entries()) {
      if (existing.some((row) => row.data.code === category.code)) continue
      created += 1
      if (dryRun) continue
      const number = await nextNumber(ctx, { moduleId: "cashflow-categories", prefix: "ДДС", organizationExternalId: organization.externalId, businessDate })
      await ctx.db.insert("financeRecords", {
        externalId: `cashflow-categories-${organization.externalId}-${category.code}`,
        moduleId: "cashflow-categories",
        number,
        name: category.name,
        status: "active",
        organizationExternalId: organization.externalId,
        restaurantExternalId: home.externalId,
        businessDate,
        amount: 0,
        data: { code: category.code, direction: category.direction, activity: category.activity, sortOrder: index + 1 },
        searchText: `${number} ${category.name} ${category.code}`.toLocaleLowerCase("ru"),
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  return { created, dryRun }
}

export const seedCashflowCategories = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => seedCashflowCategoryRows(ctx, args.dryRun ?? false),
})
