import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { requireManagerApproval, requireOpenShift, requireOperator, touchSession, type PosAccess } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { postLedgerEntry } from "../../lib/finance"
import { journalReady, resolvePaymentType, settleOrder } from "../../lib/checkoutCore"
import { postJournalEntry } from "../../lib/ledger"
import { reverseLoyaltyPoints } from "../../lib/loyalty"
import { calculateDiscountAmount, calculateOrderTotal, calculateServiceCharge, roundKzt } from "../../lib/money"
import { cancelTicketLine, cancelTicketsForOrder, createKitchenTicket } from "../../lib/kitchen"
import { settingInForce } from "../../lib/retailSettings"
import { appendOutboxEvent } from "../../lib/outbox"
import { priceDraftLines, resolveDiscount, resolveOrderType, type PricedLine } from "../../lib/orderPricing"
import { draftLineInput, orderType as orderTypeValidator, paymentMethod as paymentMethodValidator } from "../../lib/validators"
import { assertPeriodOpen } from "../../lib/periods"
import { businessDateFor } from "../../lib/time"
import { consumeOrderStock, reverseOrderConsumption } from "../../lib/recipeConsumption"
import { hydrateOrder } from "./queries"

async function requireOrder(ctx: MutationCtx, orderId: Id<"orders">, access: PosAccess, statuses: string[]) {
  const order = await ctx.db.get(orderId)
  if (!order || order.restaurantId !== access.restaurant._id || order.terminalId !== access.terminal._id) {
    throw new ConvexError("Заказ не найден на этой кассе")
  }
  if (!statuses.includes(order.status)) throw new ConvexError("Операция недоступна для текущего статуса заказа")
  return order
}

/**
 * Rewrites the draft's lines. Lines already sent to the kitchen and voided lines stay as they are
 * (W1-POS-04 changes them only through voidLine); the rest are replaced by the freshly priced input.
 */
async function replaceLines(ctx: MutationCtx, orderId: Id<"orders">, existing: Doc<"orderLines">[], lines: PricedLine[]) {
  for (const line of existing) if (!line.sentToKitchenAt && !line.voidedAt) await ctx.db.delete(line._id)
  for (const line of lines) {
    await ctx.db.insert("orderLines", {
      orderId,
      clientLineId: line.clientLineId,
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
}

function buildSearchText(number: number, comment: string, tableLabel: string | undefined, names: string[]) {
  return `${number} ${comment} ${tableLabel ?? ""} ${names.join(" ")}`.toLocaleLowerCase("ru")
}

async function buildCheckoutResult(ctx: MutationCtx, order: Doc<"orders">, duplicate: boolean) {
  return { orderId: order._id, number: order.number, total: order.total, duplicate, receipt: await hydrateOrder(ctx, order) }
}

export const saveDraft = mutation({
  args: {
    sessionToken: v.string(),
    clientOrderId: v.string(),
    orderId: v.optional(v.id("orders")),
    expectedVersion: v.optional(v.number()),
    // orderTypeExternalId from activeForPos; the legacy orderType maps to the published type of that mode.
    orderTypeExternalId: v.optional(v.string()),
    orderType: v.optional(orderTypeValidator),
    tableLabel: v.optional(v.string()),
    hallLabel: v.optional(v.string()),
    guestCount: v.optional(v.number()),
    discountTypeExternalId: v.optional(v.string()),
    discountPercent: v.number(), // free percent with a reason; ignored when a discount type is chosen
    discountReason: v.optional(v.string()),
    serviceChargeWaived: v.optional(v.boolean()),
    managerApprovalToken: v.optional(v.string()),
    comment: v.string(),
    lines: v.array(draftLineInput),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    let order = args.orderId ? await ctx.db.get(args.orderId) : null
    if (!order) {
      order = await ctx.db.query("orders").withIndex("by_client_order_id", (q) => q.eq("clientOrderId", args.clientOrderId)).unique()
    }
    if (order && order.terminalId !== access.terminal._id) throw new ConvexError("Этот заказ нельзя редактировать")
    if (order && !["draft", "held"].includes(order.status)) return { outcome: "not-editable" as const }
    if (order && args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) {
      throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    }
    if (args.guestCount !== undefined && !(Number.isInteger(args.guestCount) && args.guestCount >= 1 && args.guestCount <= 99)) throw new ConvexError("Число гостей — от 1 до 99")
    const now = Date.now()
    const restaurantExternalId = access.restaurant.externalId

    // Lines already on the kitchen ticket are fixed: the input must repeat them unchanged.
    const existingLines = order ? await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200) : []
    const sent = existingLines.filter((line) => line.sentToKitchenAt && !line.voidedAt)
    for (const line of sent) {
      const input = args.lines.find((row) => row.clientLineId && row.clientLineId === line.clientLineId)
      if (!input || input.productId !== line.productId || input.quantity !== line.quantity) throw new ConvexError(`«${line.productName}» уже на кухне — изменить её можно только через «Удалить позицию»`)
    }
    // Sent lines are kept as they are; a voided line's id never brings it back.
    const keptIds = new Set(existingLines.filter((line) => line.clientLineId && (line.voidedAt || line.sentToKitchenAt)).map((line) => line.clientLineId))
    const pricedLines = await priceDraftLines(ctx, restaurantExternalId, args.lines.filter((row) => !(row.clientLineId && keptIds.has(row.clientLineId))), now)
    const subtotal = sent.reduce((sum, line) => sum + (line.lineTotal ?? line.unitPrice * line.quantity), 0) + pricedLines.reduce((sum, line) => sum + line.lineTotal, 0)

    const orderType = await resolveOrderType(ctx, restaurantExternalId, { orderTypeExternalId: args.orderTypeExternalId, orderType: args.orderType }, now)
    const discount = await resolveDiscount(ctx, restaurantExternalId, { discountTypeExternalId: args.discountTypeExternalId, discountPercent: args.discountPercent, discountReason: args.discountReason }, subtotal, now)
    const serviceChargeAmount = args.serviceChargeWaived ? 0 : calculateServiceCharge(subtotal, discount.amount, orderType.serviceChargePercent)
    const total = calculateOrderTotal(subtotal, discount.amount, serviceChargeAmount)

    const needsApproval = discount.needsManager || Boolean(args.serviceChargeWaived)
    const alreadyApproved =
      order?.discountApprovedBy && order.discountTypeExternalId === discount.externalId && order.discountPercent === discount.percent && Boolean(order.serviceChargeWaived) === Boolean(args.serviceChargeWaived)
    const manager = needsApproval && !alreadyApproved ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    const discountApprovedBy = manager?._id ?? (alreadyApproved ? order!.discountApprovedBy : undefined)

    const names = [...sent.map((line) => line.productName), ...pricedLines.map((line) => `${line.product.name} ${line.product.nameKk}`)]
    const value = {
      orderType: orderType.serviceMode,
      orderTypeExternalId: orderType.externalId,
      orderTypeName: orderType.name,
      tableLabel: args.tableLabel,
      hallLabel: args.hallLabel?.trim() || undefined,
      guestCount: args.guestCount,
      status: "draft" as const,
      discountTypeExternalId: discount.externalId,
      discountTypeName: discount.name,
      discountPercent: discount.percent,
      discountAmount: discount.amount,
      discountReason: discount.reason,
      discountApprovedBy,
      subtotal,
      serviceChargePercent: orderType.serviceChargePercent,
      serviceChargeAmount,
      serviceChargeWaived: args.serviceChargeWaived,
      total,
      retailConfigVersion: [orderType.tag, discount.tag].filter(Boolean).join(";") || undefined,
      currentShiftId: shift._id,
      updatedBy: access.employee._id,
      comment: args.comment.trim(),
      updatedAt: now,
    }
    let orderId: Id<"orders">
    if (order) {
      orderId = order._id
      await ctx.db.patch(orderId, { ...value, version: (order.version ?? 1) + 1, searchText: buildSearchText(order.number, args.comment, args.tableLabel, names) })
    } else {
      const number = access.terminal.nextOrderNumber
      await ctx.db.patch(access.terminal._id, { nextOrderNumber: number + 1 })
      orderId = await ctx.db.insert("orders", {
        ...value,
        number,
        clientOrderId: args.clientOrderId,
        restaurantId: access.restaurant._id,
        terminalId: access.terminal._id,
        originatingShiftId: shift._id,
        businessDate: shift.businessDate,
        createdBy: access.employee._id,
        version: 1,
        createdAt: now,
        searchText: buildSearchText(number, args.comment, args.tableLabel, names),
      })
    }
    await replaceLines(ctx, orderId, existingLines, pricedLines)
    await touchSession(ctx, access.session._id)
    if (manager) {
      const what = discount.name ?? (discount.amount ? `скидку ${discount.percent}%` : "")
      await writeAudit(ctx, access, {
        action: "order.manager-override",
        summary: `Менеджер подтвердил ${[what, args.serviceChargeWaived ? "отмену сервисного сбора" : ""].filter(Boolean).join(" и ")} для заказа`,
        shiftId: shift._id,
        orderId,
        managerId: manager._id,
      })
    }
    return await hydrateOrder(ctx, (await ctx.db.get(orderId))!)
  },
})

export const hold = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    const order = await requireOrder(ctx, args.orderId, access, ["draft"])
    const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100)
    if (!lines.length) throw new ConvexError("Заказ не содержит позиций")
    const now = Date.now()
    await ctx.db.patch(order._id, { status: "held", heldAt: now, updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await writeAudit(ctx, access, { action: "order.hold", summary: `Отложен заказ №${order.number}`, shiftId: shift._id, orderId: order._id })
    return order._id
  },
})

export const resume = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    const order = await requireOrder(ctx, args.orderId, access, ["held"])
    if (order.currentShiftId !== shift._id) throw new ConvexError("Заказ принадлежит другой смене")
    await ctx.db.patch(order._id, { status: "draft", heldAt: undefined, updatedAt: Date.now(), updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await writeAudit(ctx, access, { action: "order.resume", summary: `Возобновлён заказ №${order.number}`, shiftId: shift._id, orderId: order._id })
    return order._id
  },
})

/**
 * Cancels an open check (W1-POS-06). The reason comes from the retail settings (the free-text
 * `reason` stays for older clients); a write-off reason writes off what the kitchen already got.
 */
export const cancel = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    expectedVersion: v.optional(v.number()),
    deletionReasonExternalId: v.optional(v.string()),
    comment: v.optional(v.string()),
    reason: v.optional(v.string()),
    managerApprovalToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    const now = Date.now()
    const setting = args.deletionReasonExternalId ? await settingInForce(ctx, "deletion-reason", args.deletionReasonExternalId, access.restaurant.externalId, now, "Причина отмены") : null
    const data = setting?.data.kind === "deletion-reason" ? setting.data : null
    const comment = (args.comment ?? args.reason ?? "").trim()
    if (setting ? data?.requireComment && comment.length < 3 : comment.length < 3) throw new ConvexError(setting ? "Для этой причины нужен комментарий" : "Укажите причину отмены")
    const businessDate = businessDateFor(now, access.restaurant.businessDayCutoffMinutes)
    await assertPeriodOpen(ctx, posPeriodScope(access, businessDate))
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    await ctx.db.patch(order._id, { status: "cancelled", cancelledAt: now, updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await cancelTicketsForOrder(ctx, order._id, now)
    if (data?.writeOff) {
      const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
      const cooked = lines.filter((line) => line.sentToKitchenAt && !line.voidedAt)
      if (cooked.length) {
        await consumeOrderStock(ctx, { order, lines: cooked, restaurantExternalId: access.restaurant.externalId, terminal: access.terminal, idempotencyKey: `cancel:${order._id}`, occurredAt: now, businessDate, sourceExternalId: `${order._id}:cancel`, movementKind: "writeoff", debitAccount: data.expenseAccount })
      }
    }
    await ctx.db.insert("orderDeletionEvents", {
      orderId: order._id,
      deletionReasonName: setting?.name ?? "Отмена заказа",
      writeOff: data?.writeOff ?? false,
      comment,
      actorId: access.employee._id,
      managerId: manager._id,
      createdAt: now,
      ...(setting ? { deletionReasonExternalId: setting.externalId, deletionReasonVersion: setting.version } : {}),
    })
    await writeAudit(ctx, access, { action: "order.cancel", summary: `Отменён заказ №${order.number}: ${[setting?.name, comment].filter(Boolean).join(" — ")}`, shiftId: order.currentShiftId, orderId: order._id, managerId: manager._id })
  },
})

export const checkout = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    idempotencyKey: v.string(),
    // paymentTypeExternalId from activeForPos; the legacy `method` maps to the seeded type until M-2 deploy 2.
    payments: v.array(v.object({ paymentTypeExternalId: v.optional(v.string()), method: v.optional(paymentMethodValidator), amount: v.number(), tendered: v.optional(v.number()) })),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    await assertPeriodOpen(ctx, posPeriodScope(access, shift.businessDate))
    const persistedOrder = await ctx.db.get(args.orderId)
    if (!persistedOrder || persistedOrder.restaurantId !== access.restaurant._id || persistedOrder.terminalId !== access.terminal._id) {
      throw new ConvexError("Заказ не найден на этой кассе")
    }
    if (persistedOrder.checkoutIdempotencyKey === args.idempotencyKey) {
      return await buildCheckoutResult(ctx, persistedOrder, true)
    }
    const existingPayment = await ctx.db.query("payments").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).first()
    if (existingPayment) {
      if (existingPayment.orderId !== persistedOrder._id) throw new ConvexError("Ключ оплаты уже использован")
      return await buildCheckoutResult(ctx, persistedOrder, true)
    }
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (order.currentShiftId !== shift._id) throw new ConvexError("Заказ принадлежит другой смене")
    await settleOrder(ctx, {
      order,
      shift,
      actor: { employeeId: access.employee._id, restaurant: access.restaurant, terminal: access.terminal },
      payments: args.payments,
      idempotencyKey: args.idempotencyKey,
      source: "pos",
      occurredAt: Date.now(),
    })
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "order.checkout", summary: `Оплачен заказ №${order.number} на ${order.total} ₸`, shiftId: shift._id, orderId: order._id })
    return await buildCheckoutResult(ctx, (await ctx.db.get(args.orderId))!, false)
  },
})

export const refund = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    idempotencyKey: v.string(),
    amount: v.number(),
    // Optional: which lines are returned; the amount must then match their share of the paid total.
    lines: v.optional(v.array(v.object({ orderLineId: v.id("orderLines"), quantity: v.number() }))),
    paymentTypeExternalId: v.optional(v.string()),
    method: v.optional(paymentMethodValidator),
    reason: v.string(),
    managerApprovalToken: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    await assertPeriodOpen(ctx, posPeriodScope(access, shift.businessDate))
    const persistedOrder = await ctx.db.get(args.orderId)
    if (!persistedOrder || persistedOrder.restaurantId !== access.restaurant._id || persistedOrder.terminalId !== access.terminal._id) {
      throw new ConvexError("Заказ не найден на этой кассе")
    }
    const existing = await ctx.db.query("payments").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique()
    if (existing) {
      if (existing.orderId !== persistedOrder._id || existing.type !== "refund") throw new ConvexError("Ключ возврата уже использован")
      return existing._id
    }
    const order = await requireOrder(ctx, args.orderId, access, ["paid", "partially_refunded"])
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    if (args.reason.trim().length < 3 || !Number.isInteger(args.amount) || args.amount <= 0) throw new ConvexError("Укажите сумму в целых тенге и причину возврата")

    const payments = await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(100)
    const paid = payments.filter((p) => p.type === "sale").reduce((sum, p) => sum + p.amount, 0)
    const refunded = payments.filter((p) => p.type === "refund").reduce((sum, p) => sum + p.amount, 0)
    if (args.amount > paid - refunded) throw new ConvexError("Сумма возврата превышает доступный остаток")
    if (args.lines?.length) {
      const orderLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
      let linesAmount = 0
      for (const row of args.lines) {
        const line = orderLines.find((candidate) => candidate._id === row.orderLineId && !candidate.voidedAt)
        if (!line || !Number.isInteger(row.quantity) || row.quantity <= 0 || row.quantity > line.quantity) throw new ConvexError("Проверьте позиции возврата")
        linesAmount += (lineAmount(line) / line.quantity) * row.quantity
      }
      // A line's share of what the guest paid: its part of the subtotal applied to the order total.
      const expected = order.subtotal > 0 ? roundKzt((linesAmount * order.total) / order.subtotal) : 0
      if (Math.abs(expected - args.amount) > 1) throw new ConvexError(`Сумма возврата по позициям — ${expected} ₸`)
    }
    // A refund goes back the way it was paid: by payment type, or by kind for payments before M-2.
    const original = payments.find((p) => p.type === "sale" && (args.paymentTypeExternalId ? p.paymentTypeExternalId === args.paymentTypeExternalId : p.method === args.method))
    if (!original) throw new ConvexError("Возврат должен использовать исходный способ оплаты")
    const sameWay = (p: Doc<"payments">) => (args.paymentTypeExternalId ? p.paymentTypeExternalId === args.paymentTypeExternalId : p.method === original.method)
    const paidThisWay = payments.filter((p) => p.type === "sale" && sameWay(p)).reduce((sum, p) => sum + p.amount, 0)
    const refundedThisWay = payments.filter((p) => p.type === "refund" && sameWay(p)).reduce((sum, p) => sum + p.amount, 0)
    if (args.amount > paidThisWay - refundedThisWay) throw new ConvexError("Возврат должен использовать исходный способ оплаты")
    const type = await refundPaymentType(ctx, access.restaurant.externalId, original)

    const now = Date.now()
    const paymentId = await ctx.db.insert("payments", {
      orderId: order._id,
      shiftId: shift._id,
      type: "refund",
      method: original.method,
      processorKind: original.method,
      paymentTypeExternalId: original.paymentTypeExternalId,
      paymentTypeName: original.paymentTypeName ?? type.name,
      restaurantId: access.restaurant._id,
      amount: roundKzt(args.amount),
      idempotencyKey: args.idempotencyKey,
      status: "recorded",
      createdBy: access.employee._id,
      createdAt: now,
    })
    const totalRefunded = refunded + roundKzt(args.amount)
    if (totalRefunded === paid) await cancelTicketsForOrder(ctx, order._id, now)
    await ctx.db.patch(order._id, { status: totalRefunded === paid ? "refunded" : "partially_refunded", updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "refund", amount: roundKzt(args.amount), reason: `${args.reason.trim()} · заказ №${order.number}`, actorId: access.employee._id, orderId: order._id, createdAt: now })
    await postLedgerEntry(ctx, {
      restaurantExternalId: access.restaurant.externalId,
      occurredAt: now,
      kind: "expense",
      category: "Возврат",
      amount: roundKzt(args.amount),
      sourceModuleId: "orders",
      sourceExternalId: String(paymentId),
      description: `${args.reason.trim()} · заказ №${order.number}`,
      businessDate: shift.businessDate,
    })
    if (await journalReady(ctx)) {
      const entry = await postJournalEntry(ctx, {
        externalId: `refund:${args.idempotencyKey}`,
        restaurantExternalId: access.restaurant.externalId,
        sourceModuleId: "orders",
        sourceExternalId: String(order._id),
        sourceNumber: String(order.number),
        occurredAt: now,
        businessDate: shift.businessDate,
        debitAccount: "salesReturns",
        creditAccount: type.account,
        amount: roundKzt(args.amount),
        description: `Возврат по заказу №${order.number}: ${type.name}`,
      })
      await ctx.db.patch(paymentId, { journalEntryId: entry.externalId })
    }
    await reverseOrderConsumption(ctx, { order, refundKey: String(paymentId), share: Math.min(1, roundKzt(args.amount) / paid), occurredAt: now, businessDate: shift.businessDate })
    await reverseLoyaltyPoints(ctx, order, { paidTotal: paid, refundedTotal: totalRefunded, paymentId, occurredAt: now })
    await appendOutboxEvent(ctx, {
      aggregateType: "order",
      aggregateExternalId: String(order._id),
      eventType: "order.refunded",
      restaurantExternalId: access.restaurant.externalId,
      payload: { number: order.number, amount: roundKzt(args.amount), full: totalRefunded === paid, businessDate: shift.businessDate, paymentTypeExternalId: original.paymentTypeExternalId ?? null, lines: args.lines ?? [] },
    })
    await writeAudit(ctx, access, { action: "order.refund", summary: `Возврат ${roundKzt(args.amount)} ₸ по заказу №${order.number}: ${args.reason.trim()}`, shiftId: shift._id, orderId: order._id, managerId: manager._id })
    return paymentId
  },
})

/** «На кухню» before payment (W1-POS-04): a new ticket for the lines not sent yet. */
export const sendToKitchen = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders"), expectedVersion: v.optional(v.number()), lineIds: v.optional(v.array(v.id("orderLines"))) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
    const chosen = args.lineIds ? new Set(args.lineIds) : null
    const unsent = lines.filter((line) => !line.sentToKitchenAt && !line.voidedAt && (!chosen || chosen.has(line._id)))
    if (!unsent.length) throw new ConvexError("Нет новых позиций для кухни")
    const now = Date.now()
    // saveDraft recognises sent lines by clientLineId, so every sent line needs one.
    for (const line of unsent) if (!line.clientLineId) await ctx.db.patch(line._id, { clientLineId: String(line._id) })
    const ticketId = await createKitchenTicket(ctx, { order, lines: unsent, restaurantId: access.restaurant._id, source: "pos", now })
    const version = (order.version ?? 1) + 1
    await ctx.db.patch(order._id, { kitchenSentAt: order.kitchenSentAt ?? now, updatedAt: now, updatedBy: access.employee._id, version })
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "order.send-to-kitchen", summary: `Заказ №${order.number}: на кухню ${unsent.length} поз.`, shiftId: shift._id, orderId: order._id })
    return { ticketId, version, order: await hydrateOrder(ctx, (await ctx.db.get(order._id))!) }
  },
})

/**
 * Removes a line with a deletion reason (W1-POS-04). A manager confirms when the reason requires it or
 * the line is already on the kitchen ticket; a write-off reason takes the stock by recipe to the
 * reason's expense account. Totals are recalculated with the order's discount and service charge.
 */
export const voidLine = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    orderLineId: v.id("orderLines"),
    expectedVersion: v.optional(v.number()),
    deletionReasonExternalId: v.string(),
    comment: v.optional(v.string()),
    managerApprovalToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    const line = await ctx.db.get(args.orderLineId)
    if (!line || line.orderId !== order._id || line.voidedAt) throw new ConvexError("Позиция не найдена в заказе")
    const now = Date.now()
    const reason = await settingInForce(ctx, "deletion-reason", args.deletionReasonExternalId, access.restaurant.externalId, now, "Причина удаления")
    if (reason.data.kind !== "deletion-reason") throw new ConvexError("Причина удаления недоступна на этой кассе")
    const comment = args.comment?.trim() ?? ""
    if (reason.data.requireComment && comment.length < 3) throw new ConvexError("Для этой причины нужен комментарий")
    const manager = reason.data.requireManager || line.sentToKitchenAt ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    if (reason.data.writeOff) await assertPeriodOpen(ctx, posPeriodScope(access, shift.businessDate))

    await ctx.db.patch(line._id, { voidedAt: now, voidReasonExternalId: reason.externalId, ...(line.clientLineId ? {} : { clientLineId: String(line._id) }) })
    await ctx.db.insert("orderDeletionEvents", { orderId: order._id, orderLineId: line._id, deletionReasonName: reason.name, deletionReasonExternalId: reason.externalId, deletionReasonVersion: reason.version, writeOff: reason.data.writeOff, comment, actorId: access.employee._id, managerId: manager?._id, createdAt: now })
    if (line.sentToKitchenAt) await cancelTicketLine(ctx, line, now)
    if (reason.data.writeOff) {
      await consumeOrderStock(ctx, {
        order,
        lines: [line],
        restaurantExternalId: access.restaurant.externalId,
        terminal: access.terminal,
        idempotencyKey: `void:${line._id}`,
        occurredAt: now,
        businessDate: shift.businessDate,
        sourceExternalId: `${order._id}:void:${line._id}`,
        movementKind: "writeoff",
        debitAccount: reason.data.expenseAccount,
      })
    }

    const version = (order.version ?? 1) + 1
    await ctx.db.patch(order._id, { ...(await recalculatedTotals(ctx, order)), updatedAt: now, updatedBy: access.employee._id, version })
    await writeAudit(ctx, access, {
      action: "order.void-line",
      summary: `Заказ №${order.number}: удалена «${line.productName}» ×${line.quantity} — ${reason.name}${comment ? `: ${comment}` : ""}`,
      shiftId: shift._id,
      orderId: order._id,
      managerId: manager?._id,
    })
    return { version, order: await hydrateOrder(ctx, (await ctx.db.get(order._id))!) }
  },
})

/**
 * Splits part of an open check into a new held check (W1-POS-05): whole lines move, a partial
 * quantity is divided. Lines already on the kitchen ticket keep their ticket. A percent discount
 * and the service charge rules apply to both checks; a fixed discount stays on the original.
 */
export const split = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders"), expectedVersion: v.optional(v.number()), lines: v.array(v.object({ orderLineId: v.id("orderLines"), quantity: v.number() })) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await requireOpenShift(ctx, access.terminal._id)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (order.currentShiftId !== shift._id) throw new ConvexError("Заказ принадлежит другой смене")
    if (args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    const allLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
    const lines = allLines.filter((line) => !line.voidedAt)
    const moving = new Map<Id<"orderLines">, number>()
    for (const row of args.lines) {
      const line = lines.find((candidate) => candidate._id === row.orderLineId)
      if (!line) throw new ConvexError("Позиция не найдена в заказе")
      const quantity = (moving.get(line._id) ?? 0) + row.quantity
      if (!Number.isInteger(row.quantity) || row.quantity <= 0 || quantity > line.quantity) throw new ConvexError(`Проверьте количество «${line.productName}»`)
      moving.set(line._id, quantity)
    }
    if (!moving.size) throw new ConvexError("Выберите позиции для нового чека")
    if (lines.every((line) => moving.get(line._id) === line.quantity)) throw new ConvexError("В исходном чеке должна остаться хотя бы одна позиция")

    const now = Date.now()
    const siblings = await ctx.db.query("orders").withIndex("by_split_from", (q) => q.eq("splitFromOrderId", order._id)).take(50)
    const number = access.terminal.nextOrderNumber
    await ctx.db.patch(access.terminal._id, { nextOrderNumber: number + 1 })
    const tableLabel = `${order.tableLabel ?? `Чек №${order.number}`} /${siblings.length + 2}`
    const splitId = await ctx.db.insert("orders", {
      number,
      orderType: order.orderType,
      orderTypeExternalId: order.orderTypeExternalId,
      orderTypeName: order.orderTypeName,
      tableLabel,
      hallLabel: order.hallLabel,
      status: "held",
      heldAt: now,
      discountPercent: order.discountPercent,
      discountTypeExternalId: order.discountPercent > 0 ? order.discountTypeExternalId : undefined,
      discountTypeName: order.discountPercent > 0 ? order.discountTypeName : undefined,
      discountReason: order.discountPercent > 0 ? order.discountReason : undefined,
      discountApprovedBy: order.discountPercent > 0 ? order.discountApprovedBy : undefined,
      subtotal: 0,
      serviceChargePercent: order.serviceChargePercent,
      serviceChargeAmount: 0,
      serviceChargeWaived: order.serviceChargeWaived,
      total: 0,
      retailConfigVersion: order.retailConfigVersion,
      splitFromOrderId: order._id,
      restaurantId: access.restaurant._id,
      terminalId: access.terminal._id,
      originatingShiftId: shift._id,
      currentShiftId: shift._id,
      businessDate: shift.businessDate,
      kitchenSentAt: order.kitchenSentAt,
      createdBy: access.employee._id,
      updatedBy: access.employee._id,
      comment: "",
      version: 1,
      createdAt: now,
      updatedAt: now,
      searchText: "",
    })
    const movedNames: string[] = []
    for (const line of lines) {
      const quantity = moving.get(line._id)
      if (!quantity) continue
      movedNames.push(`${line.productName} ×${quantity}`)
      if (quantity === line.quantity) {
        await ctx.db.patch(line._id, { orderId: splitId })
        continue
      }
      const perUnit = lineAmount(line) / line.quantity
      await ctx.db.patch(line._id, { quantity: line.quantity - quantity, lineTotal: roundKzt(perUnit * (line.quantity - quantity)) })
      const { _id, _creationTime, ...copy } = line
      await ctx.db.insert("orderLines", { ...copy, orderId: splitId, clientLineId: crypto.randomUUID(), quantity, lineTotal: roundKzt(perUnit * quantity) })
    }
    const splitOrder = (await ctx.db.get(splitId))!
    await ctx.db.patch(splitId, { ...(await recalculatedTotals(ctx, splitOrder)), searchText: buildSearchText(number, "", tableLabel, movedNames) })
    await ctx.db.patch(order._id, { ...(await recalculatedTotals(ctx, order)), updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "order.split", summary: `Из заказа №${order.number} выделен чек №${number}: ${movedNames.join(", ")}`, shiftId: shift._id, orderId: order._id })
    return { orderId: splitId, original: await hydrateOrder(ctx, (await ctx.db.get(order._id))!), created: await hydrateOrder(ctx, (await ctx.db.get(splitId))!) }
  },
})

/** Moves an open check to another table of the restaurant; an occupied table is refused (merging is W2). */
export const moveToTable = mutation({
  args: { sessionToken: v.string(), orderId: v.id("orders"), expectedVersion: v.optional(v.number()), tableLabel: v.string(), hallLabel: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (args.expectedVersion != null && (order.version ?? 1) !== args.expectedVersion) throw new ConvexError("Заказ изменён на другой кассе. Обновите данные")
    const tableLabel = args.tableLabel.trim()
    const hallLabel = args.hallLabel?.trim() || undefined
    if (!tableLabel) throw new ConvexError("Укажите стол")
    for (const status of ["draft", "held"] as const) {
      const open = await ctx.db.query("orders").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", access.restaurant._id).eq("status", status)).take(200)
      const occupied = open.find((row) => row._id !== order._id && row.tableLabel === tableLabel && (row.hallLabel ?? undefined) === hallLabel)
      if (occupied) throw new ConvexError(`За столом «${tableLabel}» уже открыт чек №${occupied.number} — объедините чеки или выберите другой стол`)
    }
    const now = Date.now()
    await ctx.db.patch(order._id, { tableLabel, hallLabel, updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await writeAudit(ctx, access, { action: "order.move-table", summary: `Заказ №${order.number}: ${order.tableLabel ?? "без стола"} → ${tableLabel}`, shiftId: order.currentShiftId, orderId: order._id })
    return await hydrateOrder(ctx, (await ctx.db.get(order._id))!)
  },
})

export const transfer = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    // targetTerminalId from shifts.availableTransferTargets; the externalId form stays for older clients.
    targetTerminalId: v.optional(v.id("posTerminals")),
    targetTerminalExternalId: v.optional(v.string()),
    reason: v.string(),
    managerApprovalToken: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    const order = await requireOrder(ctx, args.orderId, access, ["held"])
    const target = args.targetTerminalId
      ? await ctx.db.get(args.targetTerminalId)
      : args.targetTerminalExternalId
        ? await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", args.targetTerminalExternalId!)).unique()
        : null
    if (!target?.active || target.restaurantId !== access.restaurant._id || target._id === access.terminal._id) throw new ConvexError("Целевая касса недоступна")
    const targetShift = await requireOpenShift(ctx, target._id)
    const now = Date.now()
    await ctx.db.patch(order._id, { terminalId: target._id, currentShiftId: targetShift._id, updatedAt: now, updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await ctx.db.insert("shiftEvents", { shiftId: order.currentShiftId!, type: "order-transfer-out", amount: 0, reason: `Заказ №${order.number} перенесён на ${target.name}`, actorId: access.employee._id, orderId: order._id, createdAt: now })
    await ctx.db.insert("shiftEvents", { shiftId: targetShift._id, type: "order-transfer-in", amount: 0, reason: `Заказ №${order.number} принят с ${access.terminal.name}`, actorId: access.employee._id, orderId: order._id, createdAt: now })
    await writeAudit(ctx, access, { action: "order.transfer", summary: `Заказ №${order.number} перенесён на ${target.name}: ${args.reason.trim()}`, shiftId: order.currentShiftId, orderId: order._id, managerId: manager._id })
    return order._id
  },
})

/** Money postings of a POS order are checked against period locks of its organization and restaurant. */
function posPeriodScope(access: PosAccess, businessDate: string) {
  return { organizationExternalId: access.restaurant.organizationExternalId, restaurantExternalId: access.restaurant.externalId, businessDate, moduleId: "orders" }
}

/** The account a refund leaves from: the original payment's type, or the seeded type of its kind. */
async function refundPaymentType(ctx: MutationCtx, restaurantExternalId: string, original: Doc<"payments">) {
  if (original.paymentTypeExternalId) {
    const row = await ctx.db.query("retailSettings").withIndex("by_external_id", (q) => q.eq("externalId", original.paymentTypeExternalId!)).unique()
    if (row?.data.kind === "payment-type") return { name: row.name, account: row.data.account }
  }
  return resolvePaymentType(ctx, restaurantExternalId, { method: original.method }, Date.now())
}

/** The order's discount on a new subtotal: a percent stays a percent, a fixed amount is capped, a markup scales. */
function recalculatedDiscount(order: Doc<"orders">, subtotal: number) {
  if (order.discountPercent > 0) return calculateDiscountAmount(subtotal, order.discountPercent)
  const amount = order.discountAmount ?? 0
  if (amount > 0) return Math.min(amount, subtotal)
  if (amount < 0 && order.subtotal > 0) return roundKzt((amount * subtotal) / order.subtotal)
  return 0
}

/** Totals of an order from its current, not voided lines, keeping its discount and service charge rules. */
async function recalculatedTotals(ctx: MutationCtx, order: Doc<"orders">) {
  const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
  const subtotal = lines.filter((line) => !line.voidedAt).reduce((sum, line) => sum + lineAmount(line), 0)
  const discountAmount = recalculatedDiscount(order, subtotal)
  const serviceChargeAmount = order.serviceChargeWaived ? 0 : calculateServiceCharge(subtotal, discountAmount, order.serviceChargePercent)
  return { subtotal, discountAmount, serviceChargeAmount, total: calculateOrderTotal(subtotal, discountAmount, serviceChargeAmount) }
}

const lineAmount = (line: Doc<"orderLines">) => line.lineTotal ?? line.unitPrice * line.quantity
