import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { requireOperator, type PosAccess } from "../../lib/auth"
import { findOrCreateGuest, normalizePhone } from "../../lib/loyalty"
import { getOfficeAuthEmail, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

async function requireOpenOrder(ctx: MutationCtx, orderId: Id<"orders">, access: PosAccess) {
  const order = await ctx.db.get(orderId)
  if (!order || order.restaurantId !== access.restaurant._id || order.terminalId !== access.terminal._id) {
    throw new Error("Заказ не найден на этой кассе")
  }
  if (!["draft", "held"].includes(order.status)) throw new Error("Операция недоступна для текущего статуса заказа")
  return order
}

export const attachGuestToOrder = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders"), phone: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOpenOrder(ctx, args.orderId, access)
    const phone = normalizePhone(args.phone)
    if (!phone) throw new Error("Укажите корректный номер телефона")
    const guest = await findOrCreateGuest(ctx, phone, args.name?.trim() || undefined)
    // Deliberately doesn't bump `version` — that field is saveDraft's optimistic-concurrency guard
    // against two terminals editing the same order's *content* at once. Attaching a guest isn't a
    // content edit and happens while the draft stays open on this same terminal; bumping it here
    // would desync the draft hook's locally cached version and make its next content edit fail
    // with a false "order changed on another terminal" conflict.
    await ctx.db.patch(order._id, { guestId: guest._id, updatedAt: Date.now() })
    return { guestId: guest._id, phone: guest.phone, name: guest.name, points: guest.points }
  },
})

export const detachGuestFromOrder = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOpenOrder(ctx, args.orderId, access)
    await ctx.db.patch(order._id, { guestId: undefined, updatedAt: Date.now() })
  },
})

export const adjustPoints = mutation({
  args: { guestId: v.id("guests"), points: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    await requireOfficeCapability(ctx, "office.loyalty.*")
    if (!Number.isInteger(args.points) || args.points === 0) throw new Error("Укажите ненулевое целое число баллов")
    if (!args.reason.trim()) throw new Error("Укажите причину корректировки")
    const email = await getOfficeAuthEmail(ctx)
    const guest = await ctx.db.get(args.guestId)
    if (!guest) throw new Error("Гость не найден")
    const balanceAfter = guest.points + args.points
    if (balanceAfter < 0) throw new Error(`Недостаточно баллов: у гостя ${guest.points}`)
    const now = Date.now()
    await ctx.db.patch(guest._id, { points: balanceAfter })
    await ctx.db.insert("loyaltyTransactions", {
      guestId: guest._id,
      kind: "adjustment",
      points: args.points,
      balanceAfter,
      reason: args.reason.trim(),
      actorEmail: email!,
      occurredAt: now,
    })
    await writeOfficeAudit(ctx, email!, {
      action: "loyalty.adjust",
      summary: `Корректировка баллов «${guest.phone}»: ${args.points > 0 ? "+" : ""}${args.points} (${args.reason.trim()})`,
      resourceType: "guest",
      resourceExternalId: guest.phone,
    })
  },
})
