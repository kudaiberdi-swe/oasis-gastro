import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOpenShift } from "../../lib/auth"
import { settleOrder } from "../../lib/checkoutCore"
import { canTransitionDelivery, findZone, polygonSelfIntersects, type DeliveryStatus } from "../../lib/deliveryCore"
import { cancelTicketsForOrder, createKitchenTicket } from "../../lib/kitchen"
import { journalReady, postJournalEntry } from "../../lib/ledger"
import { normalizePhone } from "../../lib/loyalty"
import { getOfficeAuthEmail, hasScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { priceDraftLines } from "../../lib/orderPricing"
import { appendOutboxEvent } from "../../lib/outbox"
import { assertPeriodOpen } from "../../lib/periods"
import { businessDateFor } from "../../lib/time"
import { ensureDeliveryTerminal, nextDeliveryNumber, requireDelivery, requireRestaurant, sourceServes } from "./shared"

// Delivery orders (W2-DLV-02/03), zones (DLV-06), couriers (DLV-07), sources (DLV-08).
// Prices come from the catalog (resolvePrice + modifiers) and payment from checkoutCore, like the POS (B-8).

const deliveryStatus = v.union(v.literal("unprocessed"), v.literal("unconfirmed"), v.literal("waiting"), v.literal("ready-to-cook"), v.literal("cooking"), v.literal("cooked"), v.literal("awaiting-dispatch"), v.literal("on-way"), v.literal("delivered"), v.literal("closed"), v.literal("cancelled"))
const EDITABLE: DeliveryStatus[] = ["unprocessed", "unconfirmed", "waiting"]

async function requireCourier(ctx: MutationCtx, externalId: string) {
  const courier = await ctx.db.query("couriers").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!courier) throw new ConvexError("Курьер не найден")
  return courier
}

const searchTextOf = (number: string, name: string, phone: string, address: string) => `${number} ${name} ${phone} ${address}`.toLocaleLowerCase("ru")

export const saveOrder = mutation({
  args: {
    externalId: v.optional(v.string()),
    channel: v.optional(v.union(v.literal("delivery"), v.literal("call-center"))),
    restaurantExternalId: v.string(),
    customerName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    sourceExternalId: v.string(),
    expectedAt: v.number(),
    courierExternalId: v.optional(v.union(v.string(), v.null())), // null unassigns; absent keeps the current one
    comment: v.string(),
    lines: v.array(v.object({ productExternalId: v.string(), quantity: v.number(), sizeExternalId: v.optional(v.string()), modifierSelections: v.optional(v.array(v.object({ modifierExternalId: v.string(), quantity: v.number() }))) })),
    expectedVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const capability = args.channel === "call-center" ? "office.call-center.edit" : "office.delivery-orders.edit"
    const { user } = await requireOfficeCapability(ctx, capability)
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await requireRestaurant(ctx, args.restaurantExternalId)
    if (!restaurant.active) throw new ConvexError("Ресторан отключён")
    const now = Date.now()
    await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: businessDateFor(args.expectedAt, restaurant.businessDayCutoffMinutes), moduleId: "delivery-orders" })

    const customerName = args.customerName.trim()
    const existing = args.externalId ? await requireDelivery(ctx, args.externalId) : null
    // A masked phone (no office.guests.pii) keeps the stored one.
    const phone = args.phone.includes("•") ? (existing?.phone ?? null) : normalizePhone(args.phone)
    if (customerName.length < 2 || !phone) throw new ConvexError("Укажите имя и корректный телефон гостя")
    const address = args.address.trim()
    if (address.length < 3) throw new ConvexError("Укажите адрес")
    if (existing && existing.restaurantExternalId !== restaurant.externalId) throw new ConvexError("Ресторан заказа изменить нельзя — отмените и создайте новый")
    if (existing && args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Заказ изменён другим пользователем. Обновите карточку")
    if (existing && !EDITABLE.includes(existing.status)) throw new ConvexError("Заказ в текущем статусе нельзя редактировать")
    if (!existing && args.expectedAt < now - 60_000) throw new ConvexError("Время доставки уже прошло")
    const source = await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", args.sourceExternalId)).unique()
    if (!source?.active || !sourceServes(source, restaurant.externalId)) throw new ConvexError("Источник заказа недоступен для ресторана")
    // The courier: absent keeps the current one, null frees them, a new one must be free (as assignCourier).
    const courierExternalId = args.courierExternalId === undefined ? existing?.courierExternalId : (args.courierExternalId ?? undefined)
    if (courierExternalId && courierExternalId !== existing?.courierExternalId) {
      const courier = await requireCourier(ctx, courierExternalId)
      if (courier.restaurantExternalId !== restaurant.externalId || !courier.active) throw new ConvexError("Курьер другого ресторана или отключён")
      if (!["available", "returning"].includes(courier.status)) throw new ConvexError(`Курьер «${courier.name}» сейчас занят`)
      await ctx.db.patch(courier._id, { status: "assigned", updatedAt: now })
    }
    if (existing?.courierExternalId && existing.courierExternalId !== courierExternalId) {
      const previous = await requireCourier(ctx, existing.courierExternalId)
      if (previous.status === "assigned") await ctx.db.patch(previous._id, { status: "available", updatedAt: now })
    }
    if (!args.lines.length) throw new ConvexError("Добавьте хотя бы одну позицию")

    // The catalog price of the restaurant at this moment, stop list and modifiers — as at the POS.
    const draftLines = []
    for (const line of args.lines) {
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
      if (!product) throw new ConvexError("Позиция не найдена")
      draftLines.push({ productId: product._id, quantity: line.quantity, sizeExternalId: line.sizeExternalId, modifierSelections: line.modifierSelections })
    }
    const priced = await priceDraftLines(ctx, restaurant.externalId, draftLines, now)
    const subtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0)
    const zone = args.latitude !== undefined && args.longitude !== undefined ? await findZone(ctx, restaurant.externalId, { latitude: args.latitude, longitude: args.longitude }) : null
    if (zone && subtotal < zone.minimumOrder) throw new ConvexError(`Минимальная сумма для зоны «${zone.name}»: ${zone.minimumOrder} ₸`)
    const deliveryFee = zone?.deliveryFee ?? 0
    const total = subtotal + deliveryFee
    const deliveryMs = (zone?.deliveryMinutes ?? 0) * 60_000
    const cookingMs = (zone?.cookingMinutes ?? 0) * 60_000

    // A guest is linked only when they already gave consent (W1-LOY-04); no guest is created here.
    const guest = await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", phone)).unique()
    const guestId = guest && guest.consentState === "granted" && guest.status !== "inactive" ? guest._id : undefined

    // The commercial order: held on the restaurant's delivery till, paid later through checkoutCore.
    // The delivery fee travels as the order's service charge, so it lands on service revenue.
    const terminal = await ensureDeliveryTerminal(ctx, restaurant)
    let orderId = existing?.orderId
    const number = existing?.number ?? (await nextDeliveryNumber(ctx, restaurant.organizationExternalId))
    const orderValue = {
      orderType: "delivery" as const,
      status: "held" as const,
      discountPercent: 0,
      subtotal,
      serviceChargePercent: 0,
      serviceChargeAmount: deliveryFee,
      total,
      comment: args.comment.trim(),
      guestId,
      updatedAt: now,
      heldAt: now,
      searchText: searchTextOf(number, customerName, phone, address),
    }
    if (orderId) {
      const commercial = await ctx.db.get(orderId)
      if (!commercial || !["draft", "held"].includes(commercial.status)) throw new ConvexError("Связанный заказ уже закрыт")
      for (const line of await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", orderId!)).take(200)) await ctx.db.delete(line._id)
      await ctx.db.patch(orderId, { ...orderValue, version: (commercial.version ?? 1) + 1 })
    } else {
      await ctx.db.patch(terminal._id, { nextOrderNumber: terminal.nextOrderNumber + 1 })
      orderId = await ctx.db.insert("orders", { ...orderValue, number: terminal.nextOrderNumber, clientOrderId: `delivery:${number}`, restaurantId: restaurant._id, terminalId: terminal._id, version: 1, createdAt: now })
    }
    for (const line of priced) {
      await ctx.db.insert("orderLines", {
        orderId,
        productId: line.product._id,
        productExternalId: line.product.externalId,
        productName: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        modifiers: line.modifiers,
        lineTotal: line.lineTotal,
        ...(line.sizeOption ? { sizeOptionId: line.sizeOption._id, sizeExternalId: line.sizeOption.externalId, sizeLabel: line.sizeOption.label } : {}),
        ...(line.modifierSelections ? { modifierSelections: line.modifierSelections, kitchenModifiers: line.kitchenModifiers } : {}),
      })
    }

    const value = {
      orderId,
      customerName,
      phone,
      email: args.email?.trim() || undefined,
      address,
      latitude: args.latitude,
      longitude: args.longitude,
      zoneExternalId: zone?.externalId,
      sourceExternalId: source.externalId,
      courierExternalId,
      guestId,
      expectedAt: args.expectedAt,
      cookingStartAt: args.expectedAt - deliveryMs - cookingMs,
      predictedCookingCompleteAt: args.expectedAt - deliveryMs,
      predictedDeliveryAt: args.expectedAt,
      subtotal,
      deliveryFee,
      total,
      comment: args.comment.trim(),
      searchText: searchTextOf(number, customerName, phone, address),
      updatedAt: now,
    }
    let externalId: string
    if (existing) {
      externalId = existing.externalId
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `delivery-${crypto.randomUUID()}`
      await ctx.db.insert("deliveryOrders", { ...value, externalId, number, organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, status: "unprocessed", paymentStatus: "unpaid", operatorKey: args.channel === "call-center" ? email : undefined, version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "delivery-order.save", summary: `Доставка ${number}: ${priced.length} позиций, ${total} ₸`, resourceType: "delivery-orders", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability })
    await appendOutboxEvent(ctx, { aggregateType: "delivery-order", aggregateExternalId: externalId, eventType: existing ? "delivery-order.updated" : "delivery-order.created", restaurantExternalId: restaurant.externalId, payload: { number, total } })
    return { externalId, number, total }
  },
})

/** Pays the commercial order through checkoutCore on the delivery till's open shift (B-8), once. */
async function settleDelivery(ctx: MutationCtx, delivery: Doc<"deliveryOrders">, source: Doc<"deliverySources">, payment: { paymentTypeExternalId?: string; amount?: number } | undefined, now: number) {
  if (delivery.paymentStatus === "paid" || !delivery.orderId) return {}
  const order = (await ctx.db.get(delivery.orderId))!
  const idempotencyKey = `delivery:${delivery.externalId}:settle`
  if (order.checkoutIdempotencyKey === idempotencyKey || order.status === "paid") return { paymentStatus: "paid" as const }
  if (order.status !== "held" && order.status !== "draft") throw new ConvexError("Связанный заказ уже закрыт")
  const restaurant = await requireRestaurant(ctx, delivery.restaurantExternalId)
  const terminal = await ensureDeliveryTerminal(ctx, restaurant)
  const shift = await getOpenShift(ctx, terminal._id)
  if (!shift) throw new ConvexError(`Откройте смену на кассе «${terminal.name}» ресторана — доставка оплачивается в ней`)
  await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: shift.businessDate, moduleId: "delivery-orders" })
  const paymentTypeExternalId = payment?.paymentTypeExternalId ?? source.defaultPaymentTypeExternalId
  if (!paymentTypeExternalId) throw new ConvexError("Укажите тип оплаты доставки")
  if (payment?.amount !== undefined && payment.amount !== order.total) throw new ConvexError(`Сумма оплаты должна быть ${order.total} ₸`)
  await ctx.db.patch(order._id, { currentShiftId: shift._id, originatingShiftId: order.originatingShiftId ?? shift._id })
  await settleOrder(ctx, {
    order: (await ctx.db.get(order._id))!,
    shift,
    actor: { employeeId: shift.openedBy, restaurant, terminal },
    payments: [{ paymentTypeExternalId, amount: order.total }],
    idempotencyKey,
    source: "delivery",
    occurredAt: now,
  })
  // The aggregator's commission: Dr commissions / Cr settlements with the aggregator.
  const commissionAmount = source.kind === "aggregator" && source.commissionPercent > 0 ? Math.round((order.total * source.commissionPercent) / 100) : 0
  if (commissionAmount > 0 && (await journalReady(ctx))) {
    await postJournalEntry(ctx, { externalId: `${idempotencyKey}:commission`, restaurantExternalId: restaurant.externalId, sourceModuleId: "delivery-orders", sourceExternalId: delivery.externalId, sourceNumber: delivery.number, occurredAt: now, businessDate: shift.businessDate, debitAccount: "aggregatorCommission", creditAccount: "aggregatorSettlements", amount: commissionAmount, description: `Комиссия «${source.name}» по ${delivery.number}` })
  }
  return { paymentStatus: "paid" as const, paymentTypeExternalId, ...(commissionAmount ? { commissionAmount } : {}) }
}

export const transitionOrder = mutation({
  args: { externalId: v.string(), to: deliveryStatus, expectedVersion: v.number(), courierExternalId: v.optional(v.string()), reason: v.optional(v.string()), payment: v.optional(v.object({ paymentTypeExternalId: v.optional(v.string()), amount: v.optional(v.number()) })), channel: v.optional(v.union(v.literal("delivery"), v.literal("call-center"))) },
  handler: async (ctx, args) => {
    const section = args.channel === "call-center" ? "office.call-center" : "office.delivery-orders"
    const capability = args.to === "cancelled" ? `${section}.cancel` : `${section}.edit`
    const { user } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const delivery = await requireDelivery(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, delivery.restaurantExternalId)
    if (delivery.version !== args.expectedVersion) throw new ConvexError("Заказ уже изменён. Обновите карточку")
    if (!canTransitionDelivery(delivery.status, args.to)) throw new ConvexError("Такой переход статуса недоступен")
    const now = Date.now()
    const restaurant = await requireRestaurant(ctx, delivery.restaurantExternalId)
    await assertPeriodOpen(ctx, { organizationExternalId: restaurant.organizationExternalId, restaurantExternalId: restaurant.externalId, businessDate: businessDateFor(now, restaurant.businessDayCutoffMinutes), moduleId: "delivery-orders" })
    const source = (await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", delivery.sourceExternalId)).unique())!
    const courierExternalId = args.courierExternalId ?? delivery.courierExternalId
    const courier = courierExternalId ? await requireCourier(ctx, courierExternalId) : null
    if (courier && courier.restaurantExternalId !== delivery.restaurantExternalId) throw new ConvexError("Курьер другого ресторана")
    const commercial = delivery.orderId ? await ctx.db.get(delivery.orderId) : null
    let patch: Partial<Doc<"deliveryOrders">> = {}

    if (args.to === "ready-to-cook" || args.to === "cooking") {
      // One kitchen ticket with everything not sent yet (W2-KDS-01).
      if (commercial) {
        const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", commercial._id)).take(200)
        await createKitchenTicket(ctx, { order: commercial, lines: lines.filter((line) => !line.sentToKitchenAt && !line.voidedAt), restaurantId: restaurant._id, source: "delivery", now })
      }
    }
    if (args.to === "on-way") {
      if (!courier) throw new ConvexError("Назначьте курьера")
      if (delivery.status !== "delivered" && !["available", "assigned", "returning"].includes(courier.status)) throw new ConvexError(`Курьер «${courier.name}» сейчас занят`)
      await ctx.db.patch(courier._id, { status: "on-delivery", updatedAt: now })
    }
    if (delivery.status === "delivered" && args.to === "on-way" && delivery.paymentStatus === "paid") throw new ConvexError("Заказ уже оплачен — вернуть в путь можно только через возврат")
    if (args.to === "delivered") {
      patch.actualDeliveredAt = now
      if (courier) await ctx.db.patch(courier._id, { status: "returning", updatedAt: now })
    }
    if (args.to === "closed" && courier?.status === "returning") await ctx.db.patch(courier._id, { status: "available", updatedAt: now })
    const settles = (args.to === "delivered" && source.settlementMode === "on-delivered") || (args.to === "closed" && (source.settlementMode === "on-closed" || delivery.paymentStatus !== "paid"))
    if (settles) patch = { ...patch, ...(await settleDelivery(ctx, delivery, source, args.payment, now)) }
    if (args.to === "cancelled") {
      const reason = args.reason?.trim() ?? ""
      if (reason.length < 3) throw new ConvexError("Укажите причину отмены")
      if (delivery.paymentStatus === "paid") throw new ConvexError("Заказ оплачен — отмена только через возврат на кассе")
      if (commercial && ["draft", "held"].includes(commercial.status)) {
        await ctx.db.patch(commercial._id, { status: "cancelled", cancelledAt: now, updatedAt: now, version: (commercial.version ?? 1) + 1 })
        await cancelTicketsForOrder(ctx, commercial._id, now)
      }
      if (courier && ["assigned", "on-delivery"].includes(courier.status)) await ctx.db.patch(courier._id, { status: "available", updatedAt: now })
      patch.cancelReason = reason
    }
    await ctx.db.patch(delivery._id, { ...patch, status: args.to, courierExternalId, version: delivery.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "delivery-order.status", summary: `Доставка ${delivery.number}: ${delivery.status} → ${args.to}${args.reason ? ` — ${args.reason.trim()}` : ""}`, resourceType: "delivery-orders", resourceExternalId: delivery.externalId, restaurantExternalId: delivery.restaurantExternalId, capability })
    await appendOutboxEvent(ctx, { aggregateType: "delivery-order", aggregateExternalId: delivery.externalId, eventType: `delivery-order.status.${args.to}`, restaurantExternalId: delivery.restaurantExternalId, payload: { from: delivery.status, to: args.to, courierExternalId: courierExternalId ?? null } })
    return { status: args.to, version: delivery.version + 1 }
  },
})

/** Assigns a free courier of the order's restaurant; the previous one (if only assigned) is freed. */
export const assignCourier = mutation({
  args: { deliveryExternalId: v.string(), courierExternalId: v.union(v.string(), v.null()), expectedVersion: v.number(), channel: v.optional(v.union(v.literal("delivery"), v.literal("call-center"))) },
  handler: async (ctx, args) => {
    const capability = args.channel === "call-center" ? "office.call-center.edit" : "office.delivery-orders.edit"
    const { user } = await requireOfficeCapability(ctx, capability)
    const email = (await getOfficeAuthEmail(ctx))!
    const delivery = await requireDelivery(ctx, args.deliveryExternalId)
    await requireRestaurantScope(ctx, user, delivery.restaurantExternalId)
    if (delivery.version !== args.expectedVersion) throw new ConvexError("Заказ уже изменён. Обновите карточку")
    if (["on-way", "delivered", "closed", "cancelled"].includes(delivery.status)) throw new ConvexError("Курьера назначают до отправки")
    const now = Date.now()
    if (args.courierExternalId === null) {
      // «Не назначен»: the assigned courier is free again.
      if (delivery.courierExternalId) {
        const previous = await requireCourier(ctx, delivery.courierExternalId)
        if (previous.status === "assigned") await ctx.db.patch(previous._id, { status: "available", updatedAt: now })
      }
      await ctx.db.patch(delivery._id, { courierExternalId: undefined, version: delivery.version + 1, updatedAt: now })
      await writeOfficeAudit(ctx, email, { action: "delivery-order.assign", summary: `Доставка ${delivery.number}: курьер снят`, resourceType: "delivery-orders", resourceExternalId: delivery.externalId, restaurantExternalId: delivery.restaurantExternalId, capability })
      return { version: delivery.version + 1 }
    }
    const courier = await requireCourier(ctx, args.courierExternalId)
    if (courier.restaurantExternalId !== delivery.restaurantExternalId || !courier.active) throw new ConvexError("Курьер другого ресторана или отключён")
    if (!["available", "returning"].includes(courier.status) && courier.externalId !== delivery.courierExternalId) throw new ConvexError(`Курьер «${courier.name}» сейчас занят`)
    if (delivery.courierExternalId && delivery.courierExternalId !== courier.externalId) {
      const previous = await requireCourier(ctx, delivery.courierExternalId)
      if (previous.status === "assigned") await ctx.db.patch(previous._id, { status: "available", updatedAt: now })
    }
    await ctx.db.patch(courier._id, { status: "assigned", updatedAt: now })
    await ctx.db.patch(delivery._id, { courierExternalId: courier.externalId, version: delivery.version + 1, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "delivery-order.assign", summary: `Доставка ${delivery.number}: курьер «${courier.name}»`, resourceType: "delivery-orders", resourceExternalId: delivery.externalId, restaurantExternalId: delivery.restaurantExternalId, capability })
    await appendOutboxEvent(ctx, { aggregateType: "delivery-order", aggregateExternalId: delivery.externalId, eventType: "delivery-order.courier-assigned", restaurantExternalId: delivery.restaurantExternalId, payload: { courierExternalId: courier.externalId } })
    return { version: delivery.version + 1 }
  },
})

const point = v.object({ latitude: v.number(), longitude: v.number() })

export const saveZone = mutation({
  args: { externalId: v.optional(v.string()), restaurantExternalId: v.string(), name: v.string(), priority: v.number(), polygon: v.array(point), deliveryFee: v.number(), minimumOrder: v.number(), cookingMinutes: v.number(), deliveryMinutes: v.number(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.delivery-zones.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    await requireRestaurant(ctx, args.restaurantExternalId)
    const name = args.name.trim()
    if (name.length < 2) throw new ConvexError("Укажите название зоны")
    if (args.polygon.length < 3) throw new ConvexError("Зона должна содержать минимум три точки")
    if (args.polygon.length > 200) throw new ConvexError("Не больше 200 точек в зоне")
    if (args.polygon.some((p) => !(Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180))) throw new ConvexError("Координаты вне допустимого диапазона")
    if (polygonSelfIntersects(args.polygon)) throw new ConvexError("Границы зоны пересекают сами себя")
    if ([args.deliveryFee, args.minimumOrder, args.cookingMinutes, args.deliveryMinutes].some((value) => !(value >= 0))) throw new ConvexError("Параметры зоны не могут быть отрицательными")
    if (!Number.isInteger(args.priority)) throw new ConvexError("Приоритет — целое число")
    const existing = args.externalId ? await ctx.db.query("deliveryZones").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Зона не найдена")
    if (existing) await requireRestaurantScope(ctx, user, existing.restaurantExternalId)
    const externalId = existing?.externalId ?? `zone-${crypto.randomUUID()}`
    const value = { restaurantExternalId: args.restaurantExternalId, name, priority: args.priority, polygon: args.polygon, deliveryFee: Math.round(args.deliveryFee), minimumOrder: Math.round(args.minimumOrder), cookingMinutes: Math.round(args.cookingMinutes), deliveryMinutes: Math.round(args.deliveryMinutes), active: args.active, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("deliveryZones", { ...value, externalId })
    await writeOfficeAudit(ctx, email, { action: "delivery-zone.save", summary: `Зона доставки «${name}»: ${args.polygon.length} точек, ${value.deliveryFee} ₸`, resourceType: "delivery-zones", resourceExternalId: externalId, restaurantExternalId: args.restaurantExternalId, capability: "office.delivery-zones.edit" })
    await appendOutboxEvent(ctx, { aggregateType: "delivery-zone", aggregateExternalId: externalId, eventType: existing ? "delivery-zone.updated" : "delivery-zone.created", restaurantExternalId: args.restaurantExternalId, payload: { active: args.active } })
    return externalId
  },
})

const transport = v.union(v.literal("foot"), v.literal("bicycle"), v.literal("scooter"), v.literal("car"))

export const saveCourier = mutation({
  args: { externalId: v.optional(v.string()), employeeCode: v.string(), restaurantExternalId: v.string(), name: v.string(), phone: v.string(), transport, active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.couriers.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await requireRestaurant(ctx, args.restaurantExternalId)
    const employee = await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", args.employeeCode.trim())).unique()
    if (!employee) throw new ConvexError("Сотрудник с таким кодом не найден")
    if (!employee.restaurantIds.includes(restaurant._id)) throw new ConvexError("Сотрудник не назначен в выбранный ресторан")
    const name = args.name.trim() || employee.displayName
    const existing = args.externalId ? await requireCourier(ctx, args.externalId) : await ctx.db.query("couriers").withIndex("by_employee_code", (q) => q.eq("employeeCode", employee.code)).unique()
    const phone = args.phone.includes("•") ? (existing?.phone ?? null) : normalizePhone(args.phone)
    if (!phone) throw new ConvexError("Укажите корректный телефон")
    if (existing) await requireRestaurantScope(ctx, user, existing.restaurantExternalId)
    if (existing && !args.active && ["assigned", "on-delivery"].includes(existing.status)) throw new ConvexError("Курьер на заказе — отключить можно после его завершения")
    const externalId = existing?.externalId ?? `courier-${employee.code}`
    const value = { employeeCode: employee.code, restaurantExternalId: restaurant.externalId, name, phone, transport: args.transport, active: args.active, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, { ...value, ...(args.active ? {} : { status: "offline" as const }) })
    else await ctx.db.insert("couriers", { ...value, externalId, status: "offline" })
    await writeOfficeAudit(ctx, email, { action: "courier.save", summary: `Курьер «${name}» (${employee.code})`, resourceType: "couriers", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.couriers.edit" })
    await appendOutboxEvent(ctx, { aggregateType: "courier", aggregateExternalId: externalId, eventType: existing ? "courier.updated" : "courier.created", restaurantExternalId: restaurant.externalId, payload: { active: args.active } })
    return externalId
  },
})

/** «Открыть смену» / «Закрыть смену»; a courier on an order stays on it. */
export const setCourierStatus = mutation({
  args: { externalId: v.string(), status: v.union(v.literal("offline"), v.literal("available")) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.couriers.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const courier = await requireCourier(ctx, args.externalId)
    await requireRestaurantScope(ctx, user, courier.restaurantExternalId)
    if (!courier.active) throw new ConvexError("Курьер отключён")
    if (["assigned", "on-delivery"].includes(courier.status)) throw new ConvexError("Курьер на заказе — смену можно закрыть после его завершения")
    const now = Date.now()
    await ctx.db.patch(courier._id, { status: args.status, updatedAt: now, ...(args.status === "available" && courier.status === "offline" ? { shiftStartedAt: now, shiftEndedAt: undefined } : {}), ...(args.status === "offline" ? { shiftEndedAt: now } : {}) })
    await writeOfficeAudit(ctx, email, { action: "courier.status", summary: `Курьер «${courier.name}»: ${args.status === "available" ? "смена открыта" : "смена закрыта"}`, resourceType: "couriers", resourceExternalId: courier.externalId, restaurantExternalId: courier.restaurantExternalId, capability: "office.couriers.edit" })
    await appendOutboxEvent(ctx, { aggregateType: "courier", aggregateExternalId: courier.externalId, eventType: `courier.status.${args.status}`, restaurantExternalId: courier.restaurantExternalId, payload: { from: courier.status, to: args.status } })
    return args.status
  },
})

export const saveSource = mutation({
  args: {
    externalId: v.optional(v.string()),
    name: v.string(),
    kind: v.union(v.literal("phone"), v.literal("website"), v.literal("app"), v.literal("aggregator"), v.literal("office")),
    restaurantExternalIds: v.array(v.string()),
    commissionPercent: v.number(),
    confirmationRequired: v.boolean(),
    settlementMode: v.union(v.literal("on-delivered"), v.literal("on-closed")),
    defaultPaymentTypeExternalId: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.delivery-sources.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (name.length < 2) throw new ConvexError("Укажите название источника")
    if (!(args.commissionPercent >= 0 && args.commissionPercent <= 100)) throw new ConvexError("Комиссия должна быть от 0 до 100 %")
    if (!args.restaurantExternalIds.length) throw new ConvexError("Выберите рестораны")
    for (const id of args.restaurantExternalIds) {
      if (id === "*" ? !user.restaurantScopes.includes("*") : !hasScope(user.restaurantScopes, id)) throw new ConvexError("Источник содержит ресторан вне доступной области")
      if (id !== "*") await requireRestaurantScope(ctx, user, id)
    }
    const existing = args.externalId ? await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique() : null
    if (args.externalId && !existing) throw new ConvexError("Источник не найден")
    // Restaurants outside the user's scope stay as they were.
    const hidden = (existing?.restaurantExternalIds ?? []).filter((id) => id !== "*" && !hasScope(user.restaurantScopes, id))
    const externalId = existing?.externalId ?? `source-${crypto.randomUUID()}`
    const value = { name, kind: args.kind, restaurantExternalIds: [...new Set([...args.restaurantExternalIds, ...hidden])], commissionPercent: args.commissionPercent, confirmationRequired: args.confirmationRequired, settlementMode: args.settlementMode, defaultPaymentTypeExternalId: args.defaultPaymentTypeExternalId, active: args.active, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("deliverySources", { ...value, externalId })
    await writeOfficeAudit(ctx, email, { action: "delivery-source.save", summary: `Источник заказов «${name}»: комиссия ${args.commissionPercent} %`, resourceType: "delivery-sources", resourceExternalId: externalId, capability: "office.delivery-sources.edit" })
    // A source spans restaurants: one event per organization it serves.
    const organizations = new Set<string>()
    if (value.restaurantExternalIds.includes("*")) for (const row of await ctx.db.query("organizations").take(50)) organizations.add(row.externalId)
    for (const id of value.restaurantExternalIds) if (id !== "*") organizations.add((await requireRestaurant(ctx, id)).organizationExternalId)
    for (const organizationExternalId of organizations) await appendOutboxEvent(ctx, { aggregateType: "delivery-source", aggregateExternalId: externalId, eventType: existing ? "delivery-source.updated" : "delivery-source.created", organizationExternalId, payload: { active: args.active } })
    return externalId
  },
})

