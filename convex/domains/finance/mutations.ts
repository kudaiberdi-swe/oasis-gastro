import { v } from "convex/values"

import { internalMutation, mutation } from "../../_generated/server"
import { postLedgerEntry } from "../../lib/finance"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

export const recordExpense = mutation({
  args: { restaurantExternalId: v.string(), amount: v.number(), category: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.finance.*")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (args.amount <= 0) throw new Error("Сумма должна быть больше нуля")
    if (!args.category.trim()) throw new Error("Укажите статью расхода")
    const email = await getOfficeAuthEmail(ctx)
    const now = Date.now()
    await postLedgerEntry(ctx, {
      restaurantExternalId: args.restaurantExternalId,
      occurredAt: now,
      kind: "expense",
      category: args.category.trim(),
      amount: args.amount,
      sourceModuleId: "manual",
      sourceExternalId: crypto.randomUUID(),
      description: args.description.trim(),
      createdByEmail: email!,
    })
    await writeOfficeAudit(ctx, email!, {
      action: "finance.expense.record",
      summary: `Расход «${args.category.trim()}»: ${args.amount} ₸${args.description.trim() ? ` — ${args.description.trim()}` : ""}`,
      resourceType: "ledger-entry",
      resourceExternalId: args.category.trim(),
      restaurantExternalId: args.restaurantExternalId,
    })
  },
})

/**
 * One-off backfill for revenue/COGS that happened before the ledger existed — payments from
 * checkout/refund and stock receipts, matched by (sourceModuleId, sourceExternalId) so re-running
 * this after the ledger is already live is a no-op. Run once via
 * `npx convex run domains/finance/mutations:backfillFromPayments`.
 */
export const backfillFromPayments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [payments, receipts, existingEntries] = await Promise.all([
      ctx.db.query("payments").collect(),
      ctx.db.query("stockMovements").withIndex("by_occurred_at").collect().then((rows) => rows.filter((row) => row.kind === "receipt")),
      ctx.db.query("ledgerEntries").collect(),
    ])
    const known = new Set(existingEntries.map((entry) => `${entry.sourceModuleId}:${entry.sourceExternalId}`))
    let posted = 0

    for (const payment of payments) {
      const key = `orders:${payment.type === "sale" ? payment.orderId : payment._id}`
      if (known.has(key)) continue
      const order = await ctx.db.get(payment.orderId)
      if (!order || !order.restaurantId) continue
      const restaurant = await ctx.db.get(order.restaurantId)
      if (!restaurant) continue
      if (payment.type === "sale") {
        await postLedgerEntry(ctx, {
          restaurantExternalId: restaurant.externalId,
          occurredAt: payment.createdAt,
          kind: "revenue",
          category: "Продажи",
          amount: payment.amount,
          sourceModuleId: "orders",
          sourceExternalId: String(payment.orderId),
          description: `Заказ №${order.number} (доначислено)`,
        })
      } else {
        await postLedgerEntry(ctx, {
          restaurantExternalId: restaurant.externalId,
          occurredAt: payment.createdAt,
          kind: "expense",
          category: "Возврат",
          amount: payment.amount,
          sourceModuleId: "orders",
          sourceExternalId: String(payment._id),
          description: `Возврат по заказу №${order.number} (доначислено)`,
        })
      }
      known.add(key)
      posted += 1
    }

    for (const movement of receipts) {
      const key = `stock:${movement._id}`
      if (known.has(key)) continue
      const item = await ctx.db.get(movement.inventoryItemId)
      await postLedgerEntry(ctx, {
        restaurantExternalId: movement.restaurantExternalId,
        occurredAt: movement.occurredAt,
        kind: "expense",
        category: "Закупка сырья",
        amount: movement.quantityDelta * movement.unitCost,
        sourceModuleId: "stock",
        sourceExternalId: String(movement._id),
        description: `Приход «${item?.name ?? "—"}» (доначислено)`,
      })
      known.add(key)
      posted += 1
    }

    return { posted }
  },
})
