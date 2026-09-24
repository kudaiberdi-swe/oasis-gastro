import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { expenseAccountFor } from "../domains/finance/mutations"
import { postJournalEntry } from "../lib/ledger"

// migration-batch M-4 (W1-FIN-07): flat ledgerEntries → double-entry journalEntries.
//   orders revenue   → one line per sale payment: Dr cash / in-transit by method, Cr revenue (a split
//                      stays split, S-11); no payments → Dr cash, Cr revenue + warning
//   orders «Возврат» → Dr sales returns, Cr cash / in-transit by the refund's method
//   stock purchase   → Dr raw materials, Cr payables (no obligation is created back-dated)
//   manual expense   → Dr expense by category, Cr cash
// Events already in the journal (sales and refunds since W1-POS-02) are only marked migrated. Lines are
// `m4-<ledgerId>-<n>`, marked migration "M-4", dated as the source; the period check is skipped. Paged,
// idempotent; dryRun reports counts and sums per account without writing. Needs the chart of accounts.

const moneyAccount = (method: Doc<"payments">["method"]) => (method === "cash" ? "cash" : "inTransit")

type Line = { debit: string; credit: string; amount: number; description: string; payment?: Doc<"payments"> }

async function linesFor(ctx: MutationCtx, entry: Doc<"ledgerEntries">): Promise<{ lines: Line[]; warning?: string; alreadyInJournal?: boolean }> {
  if (entry.sourceModuleId === "orders" && entry.kind === "revenue") {
    const orderPayments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", entry.sourceExternalId as Doc<"orders">["_id"])).take(50)
    const payments = orderPayments.filter((payment) => payment.type === "sale")
    if (payments.length && payments.every((payment) => payment.journalEntryId)) return { lines: [], alreadyInJournal: true }
    if (!payments.length) return { lines: [{ debit: "cash", credit: "revenue", amount: entry.amount, description: entry.description }], warning: "no-payments" }
    return { lines: payments.filter((payment) => !payment.journalEntryId).map((payment) => ({ debit: moneyAccount(payment.method), credit: "revenue", amount: payment.amount, description: `${entry.description}: ${payment.paymentTypeName ?? payment.method}`, payment })) }
  }
  if (entry.sourceModuleId === "orders") {
    const payment = await ctx.db.get(entry.sourceExternalId as Doc<"payments">["_id"])
    if (payment?.journalEntryId) return { lines: [], alreadyInJournal: true }
    return { lines: [{ debit: "salesReturns", credit: payment ? moneyAccount(payment.method) : "cash", amount: entry.amount, description: entry.description, ...(payment ? { payment } : {}) }], ...(payment ? {} : { warning: "no-refund-payment" }) }
  }
  if (entry.sourceModuleId === "stock") return { lines: [{ debit: "rawMaterials", credit: "payables", amount: entry.amount, description: entry.description }] }
  return { lines: [{ debit: expenseAccountFor(entry.category), credit: "cash", amount: entry.amount, description: [entry.category, entry.description].filter(Boolean).join(": ") }] }
}

export const migrateLedgerToJournal = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("ledgerEntries").withIndex("by_occurred_at").paginate(args.paginationOpts)
    const byAccount: Record<string, { debit: number; credit: number }> = {}
    const warnings: { ledgerId: string; warning: string }[] = []
    let migrated = 0
    let alreadyInJournal = 0
    let lines = 0
    for (const entry of page.page) {
      if (entry.migratedAt) continue
      const plan = await linesFor(ctx, entry)
      migrated += 1
      if (plan.alreadyInJournal) alreadyInJournal += 1
      if (plan.warning) warnings.push({ ledgerId: entry._id, warning: plan.warning })
      for (const [index, line] of plan.lines.entries()) {
        const amount = Math.round(line.amount)
        if (amount <= 0) continue
        lines += 1
        byAccount[line.debit] = { debit: (byAccount[line.debit]?.debit ?? 0) + amount, credit: byAccount[line.debit]?.credit ?? 0 }
        byAccount[line.credit] = { debit: byAccount[line.credit]?.debit ?? 0, credit: (byAccount[line.credit]?.credit ?? 0) + amount }
        if (args.dryRun) continue
        const journal = await postJournalEntry(ctx, {
          externalId: `m4-${entry._id}-${index}`,
          restaurantExternalId: entry.restaurantExternalId,
          sourceModuleId: entry.sourceModuleId === "manual" ? "manual-expense" : entry.sourceModuleId,
          sourceExternalId: entry.sourceModuleId === "orders" && entry.kind === "revenue" ? entry.sourceExternalId : line.payment ? String(line.payment.orderId) : entry.sourceExternalId,
          sourceNumber: "M-4",
          occurredAt: entry.occurredAt,
          businessDate: entry.businessDate,
          debitAccount: line.debit,
          creditAccount: line.credit,
          amount,
          description: line.description,
          migration: "M-4",
        })
        if (line.payment && !line.payment.journalEntryId) await ctx.db.patch(line.payment._id, { journalEntryId: journal.externalId })
      }
      if (!args.dryRun) await ctx.db.patch(entry._id, { migratedAt: Date.now(), legacy: true, ...(plan.warning ? { m4Warning: plan.warning } : {}) })
    }
    return { scanned: page.page.length, migrated, alreadyInJournal, lines, byAccount, warnings, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

/** Removes the M-4 journal lines and clears the migration marks, so readers see the legacy rows again. */
export const rollbackM4 = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("ledgerEntries").withIndex("by_occurred_at").paginate(args.paginationOpts)
    let reverted = 0
    for (const entry of page.page) {
      if (!entry.migratedAt) continue
      reverted += 1
      if (args.dryRun) continue
      for (let index = 0; index < 50; index += 1) {
        const line = await ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", `m4-${entry._id}-${index}`)).unique()
        if (!line) break
        if (line.migration !== "M-4") continue
        const payment = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", line.sourceExternalId as Doc<"orders">["_id"])).take(50)
        for (const row of payment) if (row.journalEntryId === line.externalId) await ctx.db.patch(row._id, { journalEntryId: undefined })
        await ctx.db.delete(line._id)
      }
      await ctx.db.patch(entry._id, { migratedAt: undefined, legacy: undefined, m4Warning: undefined })
    }
    return { scanned: page.page.length, reverted, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
