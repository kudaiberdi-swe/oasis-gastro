import type { GenericMutationCtx } from "convex/server"
import type { DataModel, Doc } from "../_generated/dataModel"
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
