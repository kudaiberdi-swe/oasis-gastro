import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../_generated/dataModel"
import { SYSTEM_ACCOUNTS } from "./accounts"
import { orderDiscountAmount } from "./money"

type MutationCtx = GenericMutationCtx<DataModel>
type FactType = Doc<"dailySalesFacts">["factType"]
type Measures = Partial<Pick<Doc<"dailySalesFacts">, "orderCount" | "guestCount" | "quantity" | "grossAmount" | "discountAmount" | "serviceChargeAmount" | "netAmount" | "costAmount" | "refundAmount" | "refundCount" | "serviceMinutesTotal" | "zeroRevenueCount">>
type Delta = { factType: FactType; key: string; label: string; measures: Measures }

// Daily sales facts (W1-RPT-02). Every event adds its deltas once (reportFactEvents); the nightly rebuild
// replays the same events, so incremental and rebuilt facts agree.

const ZERO = { orderCount: 0, guestCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, netAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0 }
const ALMATY_OFFSET_MS = 5 * 3_600_000
const TYPE_LABEL: Record<Doc<"orders">["orderType"], string> = { "dine-in": "В зале", takeaway: "С собой", delivery: "Доставка" }

async function add(ctx: MutationCtx, restaurantExternalId: string, businessDate: string, delta: Delta) {
  const row = await ctx.db
    .query("dailySalesFacts")
    .withIndex("by_restaurant_type_key_date", (q) => q.eq("restaurantExternalId", restaurantExternalId).eq("factType", delta.factType).eq("dimensionKey", delta.key).eq("businessDate", businessDate))
    .unique()
  const now = Date.now()
  if (!row) {
    await ctx.db.insert("dailySalesFacts", { restaurantExternalId, businessDate, factType: delta.factType, dimensionKey: delta.key, dimensionLabel: delta.label, ...ZERO, ...delta.measures, updatedAt: now })
    return
  }
  const patch: Record<string, number> = { updatedAt: now }
  for (const [key, value] of Object.entries(delta.measures)) patch[key] = (row[key as keyof Measures] ?? 0) + (value ?? 0)
  await ctx.db.patch(row._id, patch)
}

/** Applies the deltas of one source event once; a repeat of the same key does nothing. */
async function applyOnce(ctx: MutationCtx, sourceKey: string, restaurantExternalId: string, businessDate: string, deltas: Delta[]) {
  if (await ctx.db.query("reportFactEvents").withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey)).unique()) return false
  await ctx.db.insert("reportFactEvents", { sourceKey, restaurantExternalId, businessDate, appliedAt: Date.now() })
  for (const delta of deltas) await add(ctx, restaurantExternalId, businessDate, delta)
  return true
}

const lineAmount = (line: Doc<"orderLines">) => line.lineTotal ?? line.unitPrice * line.quantity

async function context(ctx: MutationCtx, order: Doc<"orders">) {
  const restaurant = order.restaurantId ? await ctx.db.get(order.restaurantId) : null
  const businessDate = order.businessDate
  if (!restaurant || !businessDate) return null
  return { restaurantExternalId: restaurant.externalId, restaurantName: restaurant.name, businessDate }
}

/** The checkout of a paid order: one delta per dimension. `cost` is the recipe write-off of the sale. */
export async function applyCheckoutFacts(ctx: MutationCtx, order: Doc<"orders">, cost: number) {
  const where = await context(ctx, order)
  if (!where) return
  const allLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
  const lines = allLines.filter((line) => !line.voidedAt)
  const payments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(50)
  const sales = payments.filter((payment) => payment.type === "sale")
  const discount = orderDiscountAmount(order)
  const net = order.total
  const paidAt = order.paidAt ?? order.createdAt
  const local = new Date(paidAt + ALMATY_OFFSET_MS)
  const hour = local.getUTCHours()
  const quarter = `${String(hour).padStart(2, "0")}:${String(Math.floor(local.getUTCMinutes() / 15) * 15).padStart(2, "0")}`
  const orderMeasures: Measures = { orderCount: 1, guestCount: order.guestCount ?? 1, grossAmount: order.subtotal, discountAmount: discount, serviceChargeAmount: order.serviceChargeAmount, netAmount: net, costAmount: cost, serviceMinutesTotal: Math.max(0, Math.round((paidAt - order.createdAt) / 60_000)), zeroRevenueCount: net === 0 ? 1 : 0 }
  const deltas: Delta[] = [
    { factType: "branch", key: where.restaurantExternalId, label: where.restaurantName, measures: { ...orderMeasures, quantity: lines.reduce((sum, line) => sum + line.quantity, 0) } },
    { factType: "hour", key: String(hour).padStart(2, "0"), label: `${String(hour).padStart(2, "0")}:00`, measures: orderMeasures },
    { factType: "quarter-hour", key: quarter, label: quarter, measures: orderMeasures },
    { factType: "order-type", key: order.orderTypeExternalId ?? order.orderType, label: order.orderTypeName ?? TYPE_LABEL[order.orderType], measures: orderMeasures },
  ]
  if (order.terminalId) {
    const terminal = await ctx.db.get(order.terminalId)
    deltas.push({ factType: "terminal", key: terminal?.externalId ?? String(order.terminalId), label: terminal?.name ?? "Касса", measures: orderMeasures })
  }
  if (order.createdBy) {
    const employee = await ctx.db.get(order.createdBy)
    deltas.push({ factType: "employee", key: employee?.code ?? String(order.createdBy), label: employee?.displayName ?? "Сотрудник", measures: orderMeasures })
  }
  if (order.tableLabel) deltas.push({ factType: "table", key: order.tableLabel, label: order.tableLabel, measures: orderMeasures })
  if (discount !== 0) deltas.push({ factType: "discount-type", key: order.discountTypeExternalId ?? `percent-${order.discountPercent}`, label: order.discountTypeName ?? `Скидка ${order.discountPercent}%`, measures: { orderCount: 1, discountAmount: discount, grossAmount: order.subtotal } })
  if (order.serviceChargeAmount) deltas.push({ factType: "service-charge", key: String(order.serviceChargePercent), label: `Сервисный сбор ${order.serviceChargePercent}%`, measures: { orderCount: 1, serviceChargeAmount: order.serviceChargeAmount, netAmount: net } })

  // Lines: their share of the order's net and cost, by product, category and size.
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  for (const line of lines) {
    const share = subtotal > 0 ? lineAmount(line) / subtotal : 0
    const product = await ctx.db.get(line.productId)
    const measures: Measures = { quantity: line.quantity, grossAmount: lineAmount(line), netAmount: Math.round(net * share), costAmount: Math.round(cost * share), orderCount: 1 }
    deltas.push({ factType: "product", key: line.productExternalId ?? String(line.productId), label: line.productName, measures })
    if (product) deltas.push({ factType: "category", key: product.category, label: product.category, measures })
    if (line.sizeLabel) deltas.push({ factType: "size", key: line.sizeExternalId ?? line.sizeLabel, label: line.sizeLabel, measures: { quantity: line.quantity, grossAmount: lineAmount(line) } })
    for (const modifier of line.modifierSelections ?? []) deltas.push({ factType: "modifier", key: modifier.externalId, label: modifier.name, measures: { quantity: modifier.quantity * line.quantity, grossAmount: Math.round(modifier.unitPrice * modifier.quantity * line.quantity) } })
  }
  for (const payment of sales) {
    deltas.push({ factType: "payment-type", key: payment.paymentTypeExternalId ?? payment.method, label: payment.paymentTypeName ?? payment.method, measures: { orderCount: 1, netAmount: payment.amount } })
    const cashier = await ctx.db.get(payment.createdBy)
    deltas.push({ factType: "cashier", key: cashier?.code ?? String(payment.createdBy), label: cashier?.displayName ?? "Кассир", measures: { orderCount: 1, netAmount: payment.amount } })
  }
  await applyOnce(ctx, `order:${order._id}:checkout`, where.restaurantExternalId, where.businessDate, deltas)
}

/** A refund: refund amount and count, and the cost back in the same share (mirrors the COGS reversal). */
export async function applyRefundFacts(ctx: MutationCtx, order: Doc<"orders">, payment: Doc<"payments">, share: number, cost: number) {
  const where = await context(ctx, order)
  if (!where) return
  const measures: Measures = { refundAmount: payment.amount, refundCount: 1, costAmount: -Math.round(cost * share) }
  await applyOnce(ctx, `order:${order._id}:refund:${payment._id}`, where.restaurantExternalId, where.businessDate, [
    { factType: "branch", key: where.restaurantExternalId, label: where.restaurantName, measures },
    { factType: "payment-type", key: payment.paymentTypeExternalId ?? payment.method, label: payment.paymentTypeName ?? payment.method, measures: { refundAmount: payment.amount, refundCount: 1 } },
  ])
}

/** A cancelled check or a voided line by its deletion reason (count and amount). */
export async function applyDeletionFacts(ctx: MutationCtx, order: Doc<"orders">, sourceKey: string, reason: { key: string; label: string }, amount: number, quantity: number) {
  const where = await context(ctx, order)
  if (!where) return
  await applyOnce(ctx, sourceKey, where.restaurantExternalId, where.businessDate, [{ factType: "deletion-reason", key: reason.key, label: reason.label, measures: { orderCount: 1, quantity, grossAmount: amount } }])
}

/** COGS of an order from its journal lines (sale write-off minus reversals). */
export async function orderCost(ctx: MutationCtx, order: Doc<"orders">) {
  let cost = 0
  const cogs = SYSTEM_ACCOUNTS.cogs.externalId
  for await (const entry of ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", String(order._id)))) {
    if (entry.debitAccountExternalId === cogs && !entry.reversalOf) cost += entry.amount
  }
  return cost
}
