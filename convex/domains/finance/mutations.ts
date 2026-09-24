import { v, ConvexError } from "convex/values"

import { internalMutation, mutation } from "../../_generated/server"
import { postLedgerEntry } from "../../lib/finance"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"

export const recordExpense = mutation({
  args: { restaurantExternalId: v.string(), amount: v.number(), category: v.string(), description: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.finance.*")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (args.amount <= 0) throw new ConvexError("Сумма должна быть больше нуля")
    if (!args.category.trim()) throw new ConvexError("Укажите статью расхода")
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

    // Live checkout posts ONE revenue entry per order keyed by the order id, so sale payments are
    // summed per order here too — keying each payment separately would double-post orders that
    // already have a live entry, and the old per-payment loop dropped every split part but the first.
    const salesByOrder = new Map<string, { orderId: (typeof payments)[number]["orderId"]; amount: number; occurredAt: number }>()
    for (const payment of payments) {
      if (payment.type !== "sale") continue
      const entry = salesByOrder.get(String(payment.orderId)) ?? { orderId: payment.orderId, amount: 0, occurredAt: payment.createdAt }
      entry.amount += payment.amount
      entry.occurredAt = Math.max(entry.occurredAt, payment.createdAt)
      salesByOrder.set(String(payment.orderId), entry)
    }
    for (const sale of salesByOrder.values()) {
      const key = `orders:${sale.orderId}`
      if (known.has(key)) continue
      const order = await ctx.db.get(sale.orderId)
      if (!order || !order.restaurantId) continue
      const restaurant = await ctx.db.get(order.restaurantId)
      if (!restaurant) continue
      await postLedgerEntry(ctx, {
        restaurantExternalId: restaurant.externalId,
        occurredAt: sale.occurredAt,
        kind: "revenue",
        category: "Продажи",
        amount: sale.amount,
        sourceModuleId: "orders",
        sourceExternalId: String(sale.orderId),
        description: `Заказ №${order.number} (доначислено)`,
      })
      known.add(key)
      posted += 1
    }

    for (const payment of payments) {
      if (payment.type !== "refund") continue
      const key = `orders:${payment._id}`
      if (known.has(key)) continue
      const order = await ctx.db.get(payment.orderId)
      if (!order || !order.restaurantId) continue
      const restaurant = await ctx.db.get(order.restaurantId)
      if (!restaurant) continue
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
