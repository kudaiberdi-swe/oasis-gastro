import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import { journalReady } from "../../lib/checkoutCore"
import { postJournalEntry } from "../../lib/ledger"
import { postLedgerEntry } from "../../lib/finance"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

export const recordExpense = mutation({
  args: { restaurantExternalId: v.string(), amount: v.number(), category: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.transactions.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (args.amount <= 0) throw new ConvexError("Сумма должна быть больше нуля")
    if (!args.category.trim()) throw new ConvexError("Укажите статью расхода")
    const email = await getOfficeAuthEmail(ctx)
    const now = Date.now()
    const sourceExternalId = crypto.randomUUID()
    const description = [args.category.trim(), args.description.trim()].filter(Boolean).join(": ")
    // With the chart of accounts the expense is a journal line (Dr expense by category, Cr cash); before it,
    // the flat ledger row that M-4 moves later.
    if (await journalReady(ctx)) {
      await postJournalEntry(ctx, { externalId: `expense-${sourceExternalId}`, restaurantExternalId: args.restaurantExternalId, sourceModuleId: "manual-expense", sourceExternalId, sourceNumber: "Расход", occurredAt: now, debitAccount: expenseAccountFor(args.category), creditAccount: "cash", amount: Math.round(args.amount), description })
    } else {
      await postLedgerEntry(ctx, { restaurantExternalId: args.restaurantExternalId, occurredAt: now, kind: "expense", category: args.category.trim(), amount: args.amount, sourceModuleId: "manual", sourceExternalId, description: args.description.trim(), createdByEmail: email! })
    }
    await writeOfficeAudit(ctx, email!, {
      action: "finance.expense.record",
      summary: `Расход «${args.category.trim()}»: ${args.amount} ₸${args.description.trim() ? ` — ${args.description.trim()}` : ""}`,
      resourceType: "ledger-entry",
      resourceExternalId: args.category.trim(),
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})

/** The expense account of a free-text expense category (also used by M-4 for legacy manual rows). */
export function expenseAccountFor(category: string) {
  return /зарплат|фот|персонал|оплата труда/i.test(category) ? "staffExpense" : "serviceExpense"
}
