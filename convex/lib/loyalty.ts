import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Doc, Id } from "../_generated/dataModel"
import { LOYALTY_ACCRUAL_PER_TENGE } from "./policy"

type MutationCtx = GenericMutationCtx<DataModel>

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

export async function findOrCreateGuest(ctx: MutationCtx, phone: string, name?: string): Promise<Doc<"guests">> {
  const existing = await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", phone)).unique()
  if (existing) {
    if (name && !existing.name) await ctx.db.patch(existing._id, { name })
    return (await ctx.db.get(existing._id))!
  }
  const id = await ctx.db.insert("guests", { phone, name, points: 0, createdAt: Date.now() })
  return (await ctx.db.get(id))!
}

/** Called from orders/mutations.ts:checkout right after a paid order is confirmed. */
export async function accrueLoyaltyPoints(ctx: MutationCtx, order: Doc<"orders">, occurredAt: number) {
  if (!order.guestId) return
  const guest = await ctx.db.get(order.guestId)
  if (!guest) return
  const points = Math.floor(order.total / LOYALTY_ACCRUAL_PER_TENGE)
  if (points <= 0) return
  const balanceAfter = guest.points + points
  await ctx.db.patch(guest._id, { points: balanceAfter })
  await ctx.db.insert("loyaltyTransactions", {
    guestId: guest._id,
    kind: "accrual",
    points,
    orderId: order._id,
    balanceAfter,
    occurredAt,
  })
}

/**
 * Called from orders/mutations.ts:refund after the refund payment is recorded (refund replays with
 * the same idempotency key return before this runs). Reverses the points accrued on the order in
 * proportion to the refunded share. Computed cumulatively — target minus already reversed — so a
 * series of partial refunds adds up to exactly the accrued points. The balance never goes below 0:
 * points the guest already spent are recorded as `shortfall`.
 */
export async function reverseLoyaltyPoints(
  ctx: MutationCtx,
  order: Doc<"orders">,
  refund: { paidTotal: number; refundedTotal: number; paymentId: Id<"payments">; occurredAt: number },
) {
  if (!order.guestId || refund.paidTotal <= 0) return
  const guest = await ctx.db.get(order.guestId)
  if (!guest) return
  const history = await ctx.db.query("loyaltyTransactions").withIndex("by_guest_occurred", (q) => q.eq("guestId", guest._id)).order("desc").take(500)
  const forOrder = history.filter((transaction) => transaction.orderId === order._id)
  const accrued = forOrder.filter((transaction) => transaction.kind === "accrual").reduce((sum, transaction) => sum + transaction.points, 0)
  if (accrued <= 0) return
  const alreadyReversed = forOrder
    .filter((transaction) => transaction.kind === "reversal")
    .reduce((sum, transaction) => sum - transaction.points + (transaction.shortfall ?? 0), 0)
  const target = Math.floor((accrued * Math.min(refund.refundedTotal, refund.paidTotal)) / refund.paidTotal)
  const owed = target - alreadyReversed
  if (owed <= 0) return
  const deducted = Math.min(owed, guest.points)
  const balanceAfter = guest.points - deducted
  await ctx.db.patch(guest._id, { points: balanceAfter })
  await ctx.db.insert("loyaltyTransactions", {
    guestId: guest._id,
    kind: "reversal",
    points: -deducted,
    orderId: order._id,
    paymentId: refund.paymentId,
    ...(owed > deducted ? { shortfall: owed - deducted } : {}),
    balanceAfter,
    occurredAt: refund.occurredAt,
  })
}
