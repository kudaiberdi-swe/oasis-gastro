import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { requireOperator, type PosAccess } from "../../lib/auth"
import { findOrCreateGuest, normalizePhone } from "../../lib/loyalty"
import { quoteLoyalty, releaseReservation, reserveForOrder } from "../../lib/loyaltyCore"
import { getOfficeAuthEmail, requireNetworkScope, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

async function requireOpenOrder(ctx: MutationCtx, orderId: Id<"orders">, access: PosAccess) {
  const order = await ctx.db.get(orderId)
  if (!order || order.restaurantId !== access.restaurant._id || order.terminalId !== access.terminal._id) {
    throw new ConvexError("Заказ не найден на этой кассе")
  }
  if (!["draft", "held"].includes(order.status)) throw new ConvexError("Операция недоступна для текущего статуса заказа")
  return order
}

export const attachGuestToOrder = mutation({
  // guestId from searchForPos (its phones are masked); phone to find or create a guest by number.
  args: { sessionToken: v.string(), orderId: v.id("orders"), guestId: v.optional(v.id("guests")), phone: v.optional(v.string()), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOpenOrder(ctx, args.orderId, access)
    let guest
    if (args.guestId) {
      guest = await ctx.db.get(args.guestId)
      if (!guest) throw new ConvexError("Гость не найден")
    } else {
      const phone = args.phone ? normalizePhone(args.phone) : null
      if (!phone) throw new ConvexError("Укажите корректный номер телефона")
      guest = await findOrCreateGuest(ctx, phone, args.name?.trim() || undefined)
    }
    if (guest.status === "inactive") throw new ConvexError("Гость отключён в программе лояльности")
    // Deliberately doesn't bump `version` — that field is saveDraft's optimistic-concurrency guard
    // against two terminals editing the same order's *content* at once. Attaching a guest isn't a
    // content edit and happens while the draft stays open on this same terminal; bumping it here
    // would desync the draft hook's locally cached version and make its next content edit fail
    // with a false "order changed on another terminal" conflict.
    await releaseReservation(ctx, order._id, Date.now())
    await ctx.db.patch(order._id, { guestId: guest._id, loyaltyRedemptionPlanned: undefined, updatedAt: Date.now() })
    return { guestId: guest._id, phone: guest.phone, name: guest.name, points: guest.points }
  },
})

export const detachGuestFromOrder = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOpenOrder(ctx, args.orderId, access)
    await releaseReservation(ctx, order._id, Date.now())
    await ctx.db.patch(order._id, { guestId: undefined, loyaltyRedemptionPlanned: undefined, updatedAt: Date.now() })
  },
})

export const adjustPoints = mutation({
  args: { guestId: v.id("guests"), points: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.guests.edit")
    requireNetworkScope(user, role)
    if (!Number.isInteger(args.points) || args.points === 0) throw new ConvexError("Укажите ненулевое целое число баллов")
    if (!args.reason.trim()) throw new ConvexError("Укажите причину корректировки")
    const email = await getOfficeAuthEmail(ctx)
    const guest = await ctx.db.get(args.guestId)
    if (!guest) throw new ConvexError("Гость не найден")
    const balanceAfter = guest.points + args.points
    if (balanceAfter < 0) throw new ConvexError(`Недостаточно баллов: у гостя ${guest.points}`)
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

/**
 * How many points to spend on this check (W1-LOY-03), 0…what the program allows; checkout applies it.
 * Like attaching a guest, this doesn't bump the draft's version.
 */
export const setOrderRedemption = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders"), redemption: v.number() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOpenOrder(ctx, args.orderId, access)
    if (!order.guestId) throw new ConvexError("Сначала выберите гостя")
    const now = Date.now()
    const quote = await quoteLoyalty(ctx, { guestId: order.guestId, restaurantExternalId: access.restaurant.externalId, payable: order.total, at: now, ownReserved: order.loyaltyReserved })
    if (!quote) throw new ConvexError("Для гостя нет программы лояльности")
    if (!Number.isInteger(args.redemption) || args.redemption < 0 || args.redemption > quote.maxRedemption) throw new ConvexError(`Списать можно от 0 до ${quote.maxRedemption} баллов`)
    // The points are held for this check until it is paid, cancelled or 2 hours pass (W2-LOY-09).
    await reserveForOrder(ctx, order, quote.account, args.redemption, now)
    await ctx.db.patch(order._id, { loyaltyRedemptionPlanned: args.redemption || undefined, loyaltyProgramExternalId: quote.program.externalId, updatedAt: now })
    return { redemption: args.redemption, toPay: order.total - args.redemption, accrual: quote.accrualFor(args.redemption) }
  },
})
