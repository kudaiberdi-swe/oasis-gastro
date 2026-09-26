import { v } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel } from "../../_generated/dataModel"
import { postJournalEntry } from "../../lib/ledger"
import { applyStockMovement } from "../../lib/stockAccounting"
import { stockAccountOf } from "../../lib/stockPosting"
import { businessDateFor } from "../../lib/time"
import { resolveRestaurantForDepartment } from "./projections"

type MutationCtx = GenericMutationCtx<DataModel>
type Result = { changed: boolean; skipped?: string }

// iiko operational projections: opening stock balances (W1-IIKO-05) and the cash shifts and orders of
// Sandyq departments for the office registers (W2-RTL-01, decision D7 — no personal data). iiko stays
// read-only; nothing here is ever written back.

const MODULE = "iiko-opening-balance"

export const openingBalanceArgs = { storeExternalId: v.string(), productExternalId: v.string(), amount: v.number(), sum: v.number(), occurredAt: v.number() }

export const cashShiftArgs = {
  externalId: v.string(),
  departmentExternalId: v.string(),
  sessionNumber: v.number(),
  cashRegisterNumber: v.optional(v.number()),
  status: v.string(),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
  managerEmployeeExternalId: v.optional(v.string()),
  startCash: v.number(),
  salesCash: v.number(),
  salesCard: v.number(),
  salesCredit: v.number(),
  payIn: v.number(),
  payOut: v.number(),
  cashDiff: v.number(),
  ordersTotal: v.number(),
  payloadHash: v.string(),
}

export const orderArgs = {
  externalId: v.string(),
  departmentExternalId: v.string(),
  orderNumber: v.number(),
  openedAt: v.number(),
  orderTypeName: v.optional(v.string()),
  cashShiftExternalId: v.optional(v.string()),
  grossAmount: v.number(),
  total: v.number(),
  guestCount: v.number(),
  payloadHash: v.string(),
}

/**
 * iiko's balance of an item in a store becomes an opening movement (Дт stock Кт opening balances) — only
 * while Sandyq has no movement of that item in that warehouse. Otherwise iiko never overrides Sandyq's
 * accounting: a different quantity is reported for reconciliation and nothing is applied.
 */
export async function applyOpeningBalance(ctx: MutationCtx, args: { storeExternalId: string; productExternalId: string; amount: number; sum: number; occurredAt: number }): Promise<Result> {
  const warehouse = await ctx.db.query("warehouses").withIndex("by_iiko_store", (q) => q.eq("iikoStoreExternalId", args.storeExternalId)).unique()
  if (!warehouse) return { changed: false, skipped: `склад iiko ${args.storeExternalId}: не импортирован` }
  const item = await ctx.db.query("inventoryItems").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", args.productExternalId)).first()
  if (!item) return { changed: false }
  const quantity = Math.round(args.amount * 1000) / 1000
  const existing = await ctx.db.query("stockMovements").withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id)).first()
  if (existing) {
    const balance = await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id)).unique()
    const own = balance?.quantity ?? 0
    return Math.abs(own - quantity) < 0.001 ? { changed: false } : { changed: false, skipped: `«${item.name}» на «${warehouse.name}»: в Sandyq ${own}, в iiko ${quantity}` }
  }
  if (!(quantity > 0)) return { changed: false, skipped: quantity < 0 ? `«${item.name}» на «${warehouse.name}»: отрицательный остаток в iiko (${quantity}) не переносится` : undefined }

  const sum = Math.max(0, Math.round(args.sum))
  const sourceExternalId = `iiko-balance:${args.storeExternalId}:${args.productExternalId}`
  await applyStockMovement(ctx, {
    externalId: sourceExternalId,
    kind: "adjustment",
    sourceModuleId: MODULE,
    sourceExternalId,
    sourceNumber: "Остатки iiko",
    warehouseId: warehouse._id,
    inventoryItemId: item._id,
    quantityDelta: quantity,
    unitCost: sum / quantity,
    occurredAt: args.occurredAt,
    allowNegative: true,
    reason: "Начальный остаток из iiko",
  })
  if (sum > 0) {
    await postJournalEntry(ctx, {
      externalId: `${sourceExternalId}:je`,
      restaurantExternalId: warehouse.restaurantExternalId,
      sourceModuleId: MODULE,
      sourceExternalId,
      sourceNumber: "Остатки iiko",
      occurredAt: args.occurredAt,
      debitAccount: stockAccountOf(item),
      creditAccount: "openingBalance",
      amount: sum,
      description: `Начальный остаток «${item.name}» из iiko`,
      warehouseExternalId: warehouse.externalId,
      quantity,
      itemName: item.name,
    })
  }
  return { changed: true }
}

export async function applyCashShift(ctx: MutationCtx, args: {
  externalId: string
  departmentExternalId: string
  sessionNumber: number
  cashRegisterNumber?: number
  status: string
  openedAt: number
  closedAt?: number
  managerEmployeeExternalId?: string
  startCash: number
  salesCash: number
  salesCard: number
  salesCredit: number
  payIn: number
  payOut: number
  cashDiff: number
  ordersTotal: number
  payloadHash: string
}): Promise<Result> {
  const restaurant = await resolveRestaurantForDepartment(ctx, args.departmentExternalId)
  if (!restaurant) return { changed: false, skipped: `смена ${args.sessionNumber}: подразделение ${args.departmentExternalId} не сопоставлено с рестораном` }
  const existing = await ctx.db.query("iikoCashShifts").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
  if (existing?.sourceHash === args.payloadHash) return { changed: false }
  const { payloadHash, ...fields } = args
  const value = { ...fields, restaurantExternalId: restaurant.externalId, sourceHash: payloadHash, importedAt: Date.now() }
  if (existing) await ctx.db.replace(existing._id, value)
  else await ctx.db.insert("iikoCashShifts", value)
  return { changed: true }
}

export async function applyOrder(ctx: MutationCtx, args: { externalId: string; departmentExternalId: string; orderNumber: number; openedAt: number; orderTypeName?: string; cashShiftExternalId?: string; grossAmount: number; total: number; guestCount: number; payloadHash: string }): Promise<Result> {
  const restaurant = await resolveRestaurantForDepartment(ctx, args.departmentExternalId)
  if (!restaurant) return { changed: false, skipped: `заказ ${args.orderNumber}: подразделение ${args.departmentExternalId} не сопоставлено с рестораном` }
  const existing = await ctx.db.query("iikoOrders").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
  if (existing?.sourceHash === args.payloadHash) return { changed: false }
  const { payloadHash, ...fields } = args
  const value = { ...fields, restaurantExternalId: restaurant.externalId, businessDate: businessDateFor(args.openedAt, restaurant.businessDayCutoffMinutes ?? 0), grossAmount: Math.round(args.grossAmount), total: Math.round(args.total), sourceHash: payloadHash, importedAt: Date.now() }
  if (existing) await ctx.db.replace(existing._id, value)
  else await ctx.db.insert("iikoOrders", value)
  return { changed: true }
}
