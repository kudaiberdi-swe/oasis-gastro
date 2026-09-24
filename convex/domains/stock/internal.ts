import { v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation } from "../../_generated/server"
import { nextAverage, roundQuantity } from "../../lib/stockAccounting"

const BATCH = 200

/**
 * B-12: after a backdated movement, recompute balanceAfter / averageUnitCostAfter of every later
 * movement of the (warehouse, item) pair in batches of 200, then write the balance and clear
 * `recalculating`. Each batch continues from the last recomputed movement.
 */
export const recalculateChain = internalMutation({
  args: { warehouseId: v.id("warehouses"), inventoryItemId: v.id("inventoryItems"), fromOccurredAt: v.number(), fromMovementId: v.id("stockMovements") },
  handler: async (ctx, args) => {
    const start = await ctx.db.get(args.fromMovementId)
    if (!start) return
    let quantity = start.balanceAfter
    let average = start.averageUnitCostAfter
    const later = await ctx.db
      .query("stockMovements")
      .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", args.warehouseId).eq("inventoryItemId", args.inventoryItemId).gte("occurredAt", start.occurredAt))
      .take(BATCH + 1)
    // Movements at the same instant as the start one that were inserted before it stay as they are.
    const chain = later.filter((movement) => movement._id !== start._id && (movement.occurredAt > start.occurredAt || movement._creationTime > start._creationTime))
    const batch = chain.slice(0, BATCH)
    for (const movement of batch) {
      // Inflows keep their own cost (a receipt price, or the cost a reversal gives back); outflows go at the running average.
      const unitCost = movement.quantityDelta > 0 ? movement.unitCost : average
      const averageAfter = nextAverage(quantity, average, movement.quantityDelta, unitCost)
      quantity = roundQuantity(quantity + movement.quantityDelta)
      average = averageAfter
      await ctx.db.patch(movement._id, { balanceAfter: quantity, averageUnitCostAfter: average, unitCost, amount: Math.round(Math.abs(movement.quantityDelta) * unitCost) })
    }
    if (chain.length > BATCH) {
      await ctx.scheduler.runAfter(0, internal.domains.stock.internal.recalculateChain, { ...args, fromMovementId: batch[batch.length - 1]._id, fromOccurredAt: batch[batch.length - 1].occurredAt })
      return
    }
    const balance = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", args.warehouseId).eq("inventoryItemId", args.inventoryItemId)).unique()
    if (balance) await ctx.db.patch(balance._id, { quantity, averageUnitCost: average, recalculating: false, updatedAt: Date.now() })
  },
})
