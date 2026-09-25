import type { Doc } from "../_generated/dataModel"

// Receipt price control (W1-STK-10) until price lists exist (W2): the reference is the current average
// cost of the item on the receiving warehouse, the policy is the supplier's.

export type PriceCheck = { lineNo: number; itemName: string; unitCost: number; reference: number; deviationPercent: number; outcome: "ok" | "warn" | "block"; source?: "price-list" | "average"; priceListName?: string }

export function checkPrice(supplier: Pick<Doc<"suppliers">, "priceDeviationPolicy" | "allowedDeviationPercent">, line: { lineNo: number; itemName: string; unitCost: number }, reference: number): PriceCheck {
  if (!(reference > 0) || supplier.priceDeviationPolicy === "ignore") return { ...line, reference, deviationPercent: 0, outcome: "ok" }
  const deviationPercent = Math.round(((line.unitCost - reference) / reference) * 1000) / 10
  const over = Math.abs(deviationPercent) > supplier.allowedDeviationPercent
  const higher = deviationPercent > supplier.allowedDeviationPercent
  const outcome = supplier.priceDeviationPolicy === "block" ? (over ? "block" : "ok") : supplier.priceDeviationPolicy === "block-higher" ? (higher ? "block" : over ? "warn" : "ok") : over ? "warn" : "ok"
  return { ...line, reference, deviationPercent, outcome }
}
