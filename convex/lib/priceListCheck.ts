import type { GenericQueryCtx } from "convex/server"

import type { DataModel, Doc, Id } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>

export type PriceVerdict = "ok" | "warn" | "block"

// Receipt price control by the supplier's price list (W2-CAT-15). Without a published list for the item
// the receipt falls back to the warehouse average and the supplier's own policy (lib/priceChecks).

export function verdictFor(policy: Doc<"priceLists">["deviationPolicy"], deviationPercent: number, tolerance: number): PriceVerdict {
  if (policy === "ignore") return "ok"
  const over = Math.abs(deviationPercent) > tolerance
  if (policy === "block") return over ? "block" : "ok"
  if (policy === "block-higher") return deviationPercent > tolerance ? "block" : over ? "warn" : "ok"
  return over ? "warn" : "ok"
}

/** The supplier's list in force at a moment: the latest published one with effectiveFrom ≤ at. */
export async function supplierPriceListAt(ctx: QueryCtx, supplierId: Id<"suppliers">, at: number) {
  return ctx.db
    .query("priceLists")
    .withIndex("by_supplier_status_effective", (q) => q.eq("supplierId", supplierId).eq("status", "published").lte("effectiveFrom", at))
    .order("desc")
    .first()
}

/** `price` is per stock unit; the list's price is per supplier package. null — the list has no such item. */
export async function checkReceiptLinePrice(ctx: QueryCtx, args: { supplierId: Id<"suppliers">; inventoryItemId: Id<"inventoryItems">; price: number; at: number; list?: Doc<"priceLists"> | null }) {
  const list = args.list === undefined ? await supplierPriceListAt(ctx, args.supplierId, args.at) : args.list
  if (!list) return null
  const line = await ctx.db.query("priceListLines").withIndex("by_list_item", (q) => q.eq("priceListId", list._id).eq("inventoryItemId", args.inventoryItemId)).first()
  if (!line) return null
  const expected = line.price / (line.packageCoefficient > 0 ? line.packageCoefficient : 1)
  if (!(expected > 0)) return null
  const deviationPercent = Math.round(((args.price - expected) / expected) * 1000) / 10
  return { expected, deviationPercent, verdict: verdictFor(list.deviationPolicy, deviationPercent, line.deviationPercent ?? list.deviationPercent), priceListNumber: `${list.name} · v${list.version}` }
}
