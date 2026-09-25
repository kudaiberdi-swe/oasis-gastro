import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { businessDateFor } from "./time"

type MutationCtx = GenericMutationCtx<DataModel>
export type StockFactKind = keyof Doc<"dailyStockFacts">["byKind"]

// Daily stock facts (W2-RPT-01): each movement is added to its day once (stockMovements.dailyFactAt).

const EMPTY_KINDS: Doc<"dailyStockFacts">["byKind"] = { receipt: 0, sale: 0, writeoff: 0, transferIn: 0, transferOut: 0, inventory: 0, production: 0, supplierReturn: 0, outgoingInvoice: 0, other: 0 }

/** What moved the stock, from the movement's kind and source module. */
export function stockFactKind(movement: Pick<Doc<"stockMovements">, "kind" | "sourceModuleId" | "quantityDelta">): StockFactKind {
  const module = movement.sourceModuleId ?? ""
  if (movement.kind === "receipt" || module === "receipts") return "receipt"
  if (movement.kind === "sale" || module === "orders" || module === "sales-acts") return "sale"
  if (movement.kind === "production" || ["production", "processing-acts", "assembly-acts"].includes(module)) return "production"
  if (movement.kind === "writeoff" || module === "writeoffs") return "writeoff"
  if (module === "inventories" || movement.kind === "adjustment") return "inventory"
  if (module === "transfers" || module === "internal-orders") return movement.quantityDelta > 0 ? "transferIn" : "transferOut"
  if (module === "supplier-returns") return "supplierReturn"
  if (module === "outgoing-invoices") return "outgoingInvoice"
  return "other"
}

export async function applyStockFact(ctx: MutationCtx, movement: Doc<"stockMovements">) {
  if (movement.dailyFactAt || !movement.warehouseId) return
  // A reversal lands in its original's kind and direction, with the opposite sign.
  const original = movement.reversalOf ? await ctx.db.get(movement.reversalOf) : null
  const basis = original ?? movement
  const kind = stockFactKind(basis)
  const inbound = basis.quantityDelta > 0
  const quantity = Math.abs(movement.quantityDelta) * (original ? -1 : 1)
  const value = (movement.amount ?? 0) * (original ? -1 : 1)
  const businessDate = businessDateFor(movement.occurredAt)
  const row = await ctx.db.query("dailyStockFacts").withIndex("by_warehouse_item_date", (q) => q.eq("warehouseId", movement.warehouseId!).eq("inventoryItemId", movement.inventoryItemId).eq("businessDate", businessDate)).unique()
  const now = Date.now()
  const base = row ?? { inQuantity: 0, inValue: 0, outQuantity: 0, outValue: 0, byKind: EMPTY_KINDS, movementCount: 0 }
  const next = {
    inQuantity: base.inQuantity + (inbound ? quantity : 0),
    inValue: base.inValue + (inbound ? value : 0),
    outQuantity: base.outQuantity + (inbound ? 0 : quantity),
    outValue: base.outValue + (inbound ? 0 : value),
    byKind: { ...base.byKind, [kind]: Math.round((base.byKind[kind] + movement.quantityDelta) * 1000) / 1000 },
    movementCount: base.movementCount + 1,
    updatedAt: now,
  }
  if (row) await ctx.db.patch(row._id, next)
  else await ctx.db.insert("dailyStockFacts", { warehouseId: movement.warehouseId, restaurantExternalId: movement.restaurantExternalId, inventoryItemId: movement.inventoryItemId, businessDate, ...next })
  await ctx.db.patch(movement._id, { dailyFactAt: now })
}
