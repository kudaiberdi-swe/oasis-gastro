import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../../_generated/server"
import { SYSTEM_ACCOUNTS } from "../../lib/accounts"

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
