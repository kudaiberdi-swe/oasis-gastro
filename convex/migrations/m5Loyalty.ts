import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation } from "../_generated/server"
import { BASE_PROGRAM_EXTERNAL_ID } from "../lib/loyaltyCore"

// migration-batch M-5 (W1-LOY-02): guests' points → an account of the published «Базовая» program.
// 1 % accrual as before (LOYALTY_ACCRUAL_PER_TENGE = 100); redemption off (0 %) until the business decides.
// A guest whose transactions don't add up to their points is reported and gets no account. Paged,
// idempotent, dry run first.

export const ensureBaseProgram = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("loyaltyPrograms").withIndex("by_external_id", (q) => q.eq("externalId", BASE_PROGRAM_EXTERNAL_ID)).unique()
    if (existing) return { created: false }
    if (!args.dryRun) {
      const now = Date.now()
      await ctx.db.insert("loyaltyPrograms", { externalId: BASE_PROGRAM_EXTERNAL_ID, name: "Базовая", status: "published", programKind: "bonus", accrualPercent: 1, maxRedemptionPercent: 0, welcomeBonus: 0, startsAt: 0, restaurantExternalIds: ["*"], priority: 0, createdAt: now, updatedAt: now })
    }
    return { created: true, dryRun: args.dryRun ?? false }
  },
})

export const migrateGuests = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("guests").withIndex("by_phone").paginate(args.paginationOpts)
    let guests = 0
    let accountsToCreate = 0
    let transactionsToLink = 0
    const mismatches: { guestId: string; points: number; transactions: number }[] = []
    for (const guest of page.page) {
      const transactions = []
      for await (const row of ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", guest._id))) transactions.push(row)
      const sum = transactions.reduce((total, row) => total + row.points, 0)
      if (!guest.externalId) {
        guests += 1
        if (!args.dryRun) await ctx.db.patch(guest._id, { externalId: `guest-${guest._id}`, status: "active", consentState: "unknown", searchText: `${guest.phone} ${guest.name ?? ""}`.toLocaleLowerCase("ru"), updatedAt: Date.now() })
      }
      const account = await ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", guest._id).eq("programExternalId", BASE_PROGRAM_EXTERNAL_ID)).unique()
      if (account) continue
      if (sum !== guest.points) {
        mismatches.push({ guestId: guest._id, points: guest.points, transactions: sum })
        continue
      }
      accountsToCreate += 1
      const unlinked = transactions.filter((row) => !row.accountId)
      transactionsToLink += unlinked.length
      if (args.dryRun) continue
      const accountId = await ctx.db.insert("loyaltyAccounts", { externalId: `loyalty-account-${guest._id}`, guestId: guest._id, programExternalId: BASE_PROGRAM_EXTERNAL_ID, kind: "bonus", balance: guest.points, reserved: 0, updatedAt: Date.now(), migrationBatch: "M-5" })
      for (const row of unlinked) await ctx.db.patch(row._id, { accountId, programExternalId: BASE_PROGRAM_EXTERNAL_ID, idempotencyKey: row.idempotencyKey ?? `legacy:${row._id}`, description: row.description ?? row.reason ?? row.kind })
    }
    return { scanned: page.page.length, guests, accountsToCreate, transactionsToLink, mismatches, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
