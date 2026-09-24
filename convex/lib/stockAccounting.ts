import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import { internal } from "../_generated/api"
import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { assertPeriodOpen } from "./periods"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>

// Immutable stock movements with weighted average cost (W1-PLT-02). A movement never changes; a
// correction is a reversal. Quantities round to 0.001, money to whole tenge.

export const roundQuantity = (value: number) => Math.round(value * 1000) / 1000
const roundMoney = (value: number) => Math.round(value)

export type StockMovementInput = {
  /** Idempotency key: a repeat returns the existing movement. */
  externalId: string
  kind: Doc<"stockMovements">["kind"]
  sourceModuleId: string
  sourceExternalId: string
  sourceNumber: string
  warehouseId: Id<"warehouses">
  inventoryItemId: Id<"inventoryItems">
  /** + in, − out. */
  quantityDelta: number
  /** Inflows: the cost per unit; outflows use the current average. */
  unitCost?: number
  occurredAt: number
  allowNegative?: boolean
  reversalOf?: Id<"stockMovements">
  actorEmail?: string
  reason?: string
}

/** Weighted average after an inflow; outflows keep the average. */
export function nextAverage(balanceQuantity: number, averageCost: number, delta: number, unitCost: number) {
  if (delta <= 0) return averageCost
  const quantity = balanceQuantity + delta
  if (quantity <= 0) return unitCost
  return (Math.max(0, balanceQuantity) * averageCost + delta * unitCost) / quantity
}

async function balanceOf(ctx: MutationCtx, warehouse: Doc<"warehouses">, inventoryItemId: Id<"inventoryItems">) {
  const existing = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", inventoryItemId)).unique()
  if (existing) return existing
  const id = await ctx.db.insert("stockBalances", { restaurantExternalId: warehouse.restaurantExternalId, inventoryItemId, warehouseId: warehouse._id, quantity: 0, averageUnitCost: 0, updatedAt: Date.now() })
  return (await ctx.db.get(id))!
}

export async function applyStockMovement(ctx: MutationCtx, input: StockMovementInput): Promise<Doc<"stockMovements">> {
  const existing = await ctx.db.query("stockMovements").withIndex("by_external_id", (q) => q.eq("externalId", input.externalId)).unique()
  if (existing) return existing

  const delta = roundQuantity(input.quantityDelta)
  if (delta === 0) throw new ConvexError("Количество движения не может быть нулевым")
  const warehouse = await ctx.db.get(input.warehouseId)
  if (!warehouse) throw new ConvexError("Склад не найден")
  const balance = await balanceOf(ctx, warehouse, input.inventoryItemId)

  const latest = await ctx.db
    .query("stockMovements")
    .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", input.inventoryItemId))
    .order("desc")
    .first()
  const backdated = latest !== null && input.occurredAt < latest.occurredAt
  await assertPeriodOpen(ctx, { organizationExternalId: warehouse.organizationExternalId, restaurantExternalId: warehouse.restaurantExternalId, businessDate: businessDateFor(input.occurredAt), moduleId: input.sourceModuleId })
  if (backdated && balance.recalculating) throw new ConvexError("Остаток пересчитывается после документа задним числом — повторите через минуту")

  // The balance and cost just before this movement: the current ones, or at occurredAt if backdated.
  let quantityBefore = balance.quantity
  let averageBefore = balance.averageUnitCost
  if (backdated) {
    const previous = await ctx.db
      .query("stockMovements")
      .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", input.inventoryItemId).lte("occurredAt", input.occurredAt))
      .order("desc")
      .first()
    quantityBefore = previous?.balanceAfter ?? 0
    averageBefore = previous?.averageUnitCostAfter ?? 0
  }

  const unitCost = delta > 0 ? (input.unitCost ?? averageBefore) : averageBefore
  const balanceAfter = roundQuantity(quantityBefore + delta)
  const allowNegative = input.allowNegative ?? warehouse.allowNegativeStock
  if (!allowNegative && balanceAfter < 0 && !input.reversalOf) throw new ConvexError(`Недостаточно остатка на складе «${warehouse.name}»`)
  const averageAfter = nextAverage(quantityBefore, averageBefore, delta, unitCost)

  const id = await ctx.db.insert("stockMovements", {
    restaurantExternalId: warehouse.restaurantExternalId,
    inventoryItemId: input.inventoryItemId,
    kind: input.kind,
    quantityDelta: delta,
    unitCost,
    balanceAfter,
    averageUnitCostAfter: averageAfter,
    ...(input.reason ? { reason: input.reason } : {}),
    actorEmail: input.actorEmail ?? "system",
    occurredAt: input.occurredAt,
    warehouseId: warehouse._id,
    externalId: input.externalId,
    sourceModuleId: input.sourceModuleId,
    sourceExternalId: input.sourceExternalId,
    sourceNumber: input.sourceNumber,
    amount: roundMoney(Math.abs(delta) * unitCost),
    ...(input.reversalOf ? { reversalOf: input.reversalOf } : {}),
  })

  if (backdated) {
    // Later movements' balanceAfter/averageAfter are now stale: re-chain them in batches.
    await ctx.db.patch(balance._id, { recalculating: true, updatedAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.domains.stock.internal.recalculateChain, { warehouseId: warehouse._id, inventoryItemId: input.inventoryItemId, fromOccurredAt: input.occurredAt, fromMovementId: id })
  } else {
    await ctx.db.patch(balance._id, { quantity: balanceAfter, averageUnitCost: averageAfter, updatedAt: Date.now() })
  }
  return (await ctx.db.get(id))!
}

/** Opposite movements for everything a source posted (debit ↔ credit for stock), idempotent per reversalKey. */
export async function reverseSourceMovements(ctx: MutationCtx, args: { sourceExternalId: string; occurredAt: number; reversalKey: string; share?: number; actorEmail?: string; reason?: string }) {
  const share = args.share ?? 1
  if (!(share > 0 && share <= 1)) throw new ConvexError("Доля сторно должна быть от 0 до 1")
  const originals = await ctx.db.query("stockMovements").withIndex("by_source", (q) => q.eq("sourceExternalId", args.sourceExternalId)).take(200)
  const reversals: Doc<"stockMovements">[] = []
  for (const movement of originals) {
    if (movement.reversalOf || !movement.warehouseId || !movement.externalId) continue
    const quantity = roundQuantity(-movement.quantityDelta * share)
    if (quantity === 0) continue
    reversals.push(
      await applyStockMovement(ctx, {
        externalId: `${movement.externalId}:reversal:${args.reversalKey}`,
        kind: "reversal",
        sourceModuleId: movement.sourceModuleId ?? "stock",
        sourceExternalId: args.sourceExternalId,
        sourceNumber: movement.sourceNumber ?? "",
        warehouseId: movement.warehouseId,
        inventoryItemId: movement.inventoryItemId,
        quantityDelta: quantity,
        unitCost: movement.unitCost,
        occurredAt: args.occurredAt,
        reversalOf: movement._id,
        actorEmail: args.actorEmail,
        reason: args.reason,
      }),
    )
  }
  return reversals
}
