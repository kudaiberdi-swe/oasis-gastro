import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { MutationCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { requireManagerApproval, requireOpenShift, requireOperator, touchSession, type PosAccess } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { postLedgerEntry } from "../../lib/finance"
import { accrueLoyaltyPoints, reverseLoyaltyPoints } from "../../lib/loyalty"
import { calculateDiscountAmount, calculateOrderTotal, calculateServiceCharge, roundKzt } from "../../lib/money"
import { DISCOUNT_APPROVAL_PERCENT, SERVICE_CHARGE_PERCENT } from "../../lib/policy"
import { draftLineInput, orderType as orderTypeValidator, paymentMethod as paymentMethodValidator } from "../../lib/validators"
import { assertPeriodOpen } from "../../lib/periods"
import { businessDateFor } from "../../lib/time"
import { resolvePrice } from "../../lib/pricing"
import { isAvailable } from "../../lib/availability"
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

async function priceLines(ctx: MutationCtx, restaurantExternalId: string, lines: Array<{ clientLineId?: string; productId: Id<"products">; quantity: number; modifiers?: string[] }>) {
  const result = []
  for (const input of lines) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 99) throw new ConvexError("Некорректное количество")
    const product = await ctx.db.get(input.productId)
    if (!product?.enabled) throw new ConvexError("Позиция недоступна")
    if (!(await isAvailable(ctx, product._id, restaurantExternalId, Date.now()))) throw new ConvexError(`«${product.name}» сейчас нет в наличии`)
    const { price: unitPrice } = await resolvePrice(ctx, { product, restaurantExternalId, at: Date.now() })
    result.push({ clientLineId: input.clientLineId, productId: product._id, product, quantity: input.quantity, unitPrice, modifiers: input.modifiers ?? [] })
  }
  return result
}

async function replaceLines(ctx: MutationCtx, orderId: Id<"orders">, lines: Array<{ clientLineId?: string; product: Doc<"products">; quantity: number; unitPrice: number; modifiers: string[] }>) {
  const old = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(200)
  for (const line of old) await ctx.db.delete(line._id)
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
    })
  }
}

function buildSearchText(number: number, comment: string, tableLabel: string | undefined, lines: Array<{ product: Doc<"products"> }>) {
  return `${number} ${comment} ${tableLabel ?? ""} ${lines.map((line) => `${line.product.name} ${line.product.nameKk}`).join(" ")}`.toLocaleLowerCase("ru")
}

async function ensurePosKitchenTicket(ctx: MutationCtx, order: Doc<"orders">, now: number) {
  const existing = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", order._id)).unique()
  if (existing) return existing._id
  const ticketId = await ctx.db.insert("kitchenTickets", {
    orderId: order._id,
    orderNumber: order.number,
    status: "queued",
    fulfillment: order.orderType,
    source: "pos",
    createdAt: now,
    updatedAt: now,
  })
  const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100)
  for (const line of lines) {
    await ctx.db.insert("kitchenTicketLines", {
      ticketId,
      productExternalId: line.productExternalId ?? String(line.productId),
      productName: line.productName,
      quantity: line.quantity,
      instructions: line.modifiers,
    })
  }
  return ticketId
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
    orderType: orderTypeValidator,
    tableLabel: v.optional(v.string()),
    discountPercent: v.number(),
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
    if (args.discountPercent < 0 || args.discountPercent > 100) throw new ConvexError("Некорректная скидка")
    if (args.discountPercent > 0 && (args.discountReason?.trim().length ?? 0) < 3) throw new ConvexError("Для скидки укажите причину")

    const needsApproval = args.discountPercent > DISCOUNT_APPROVAL_PERCENT || Boolean(args.serviceChargeWaived)
    const alreadyApproved = order?.discountApprovedBy && order.discountPercent === args.discountPercent && Boolean(order.serviceChargeWaived) === Boolean(args.serviceChargeWaived)
    const manager = needsApproval && !alreadyApproved ? await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id) : null
    const discountApprovedBy = manager?._id ?? (alreadyApproved ? order!.discountApprovedBy : undefined)

    const pricedLines = await priceLines(ctx, access.restaurant.externalId, args.lines)
    const subtotal = pricedLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
    const discountAmount = calculateDiscountAmount(subtotal, args.discountPercent)
    const serviceChargeAmount = args.serviceChargeWaived ? 0 : calculateServiceCharge(subtotal, discountAmount)
    const total = calculateOrderTotal(subtotal, discountAmount, serviceChargeAmount)
    const now = Date.now()

    let orderId: Id<"orders">
    if (order) {
      orderId = order._id
      await ctx.db.patch(orderId, {
        orderType: args.orderType,
        tableLabel: args.tableLabel,
        status: "draft",
        discountPercent: args.discountPercent,
        discountReason: args.discountReason?.trim(),
        discountApprovedBy,
        subtotal,
        serviceChargePercent: SERVICE_CHARGE_PERCENT,
        serviceChargeAmount,
        serviceChargeWaived: args.serviceChargeWaived,
        total,
        currentShiftId: shift._id,
        updatedBy: access.employee._id,
        comment: args.comment.trim(),
        version: (order.version ?? 1) + 1,
        updatedAt: now,
        searchText: buildSearchText(order.number, args.comment, args.tableLabel, pricedLines),
      })
      await replaceLines(ctx, orderId, pricedLines)
    } else {
      const number = access.terminal.nextOrderNumber
      await ctx.db.patch(access.terminal._id, { nextOrderNumber: number + 1 })
      orderId = await ctx.db.insert("orders", {
        number,
        orderType: args.orderType,
        tableLabel: args.tableLabel,
        status: "draft",
        discountPercent: args.discountPercent,
        discountReason: args.discountReason?.trim(),
        discountApprovedBy,
        subtotal,
        serviceChargePercent: SERVICE_CHARGE_PERCENT,
        serviceChargeAmount,
        serviceChargeWaived: args.serviceChargeWaived,
        total,
        clientOrderId: args.clientOrderId,
        restaurantId: access.restaurant._id,
        terminalId: access.terminal._id,
        originatingShiftId: shift._id,
        currentShiftId: shift._id,
        createdBy: access.employee._id,
        updatedBy: access.employee._id,
        comment: args.comment.trim(),
        version: 1,
        createdAt: now,
        updatedAt: now,
        searchText: buildSearchText(number, args.comment, args.tableLabel, pricedLines),
      })
      await replaceLines(ctx, orderId, pricedLines)
    }
    await touchSession(ctx, access.session._id)
    if (manager) {
      await writeAudit(ctx, access, {
        action: "order.manager-override",
        summary: `Менеджер подтвердил скидку ${args.discountPercent}%${args.serviceChargeWaived ? " и отмену сервисного сбора" : ""} для заказа`,
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

export const cancel = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    reason: v.string(),
    managerApprovalToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await requireOrder(ctx, args.orderId, access, ["draft", "held"])
    if (args.reason.trim().length < 3) throw new ConvexError("Укажите причину отмены")
    await assertPeriodOpen(ctx, posPeriodScope(access, businessDateFor(Date.now(), access.restaurant.businessDayCutoffMinutes)))
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    await ctx.db.patch(order._id, { status: "cancelled", cancelledAt: Date.now(), updatedAt: Date.now(), updatedBy: access.employee._id, version: (order.version ?? 1) + 1 })
    await ctx.db.insert("orderDeletionEvents", {
      orderId: order._id,
      deletionReasonName: "Отмена заказа",
      writeOff: false,
      comment: args.reason.trim(),
      actorId: access.employee._id,
      managerId: manager._id,
      createdAt: Date.now(),
    })
    await writeAudit(ctx, access, { action: "order.cancel", summary: `Отменён заказ №${order.number}: ${args.reason.trim()}`, shiftId: order.currentShiftId, orderId: order._id, managerId: manager._id })
  },
})

export const checkout = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    idempotencyKey: v.string(),
    payments: v.array(v.object({ method: paymentMethodValidator, amount: v.number(), tendered: v.optional(v.number()) })),
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
    if (!args.payments.length) throw new ConvexError("Добавьте оплату")

    const paymentTotal = args.payments.reduce((sum, payment) => sum + payment.amount, 0)
    if (paymentTotal !== order.total) throw new ConvexError("Сумма оплат не равна сумме заказа")

    const now = Date.now()
    for (const [index, payment] of args.payments.entries()) {
      if (!Number.isInteger(payment.amount) || payment.amount <= 0) throw new ConvexError("Сумма оплаты должна быть указана в целых тенге")
      if (payment.tendered != null && !Number.isInteger(payment.tendered)) throw new ConvexError("Полученная сумма должна быть указана в целых тенге")
      if (payment.method === "cash" && (payment.tendered ?? payment.amount) < payment.amount) throw new ConvexError("Полученной наличности недостаточно")
      const paymentKey = args.payments.length === 1 ? args.idempotencyKey : `${args.idempotencyKey}:${index}`
      await ctx.db.insert("payments", {
        orderId: order._id,
        shiftId: shift._id,
        type: "sale",
        method: payment.method,
        amount: payment.amount,
        ...(payment.method === "cash" ? { tendered: payment.tendered ?? payment.amount, change: (payment.tendered ?? payment.amount) - payment.amount } : {}),
        idempotencyKey: paymentKey,
        status: "recorded",
        createdBy: access.employee._id,
        createdAt: now,
      })
    }

    await ensurePosKitchenTicket(ctx, order, now)
    await ctx.db.patch(order._id, {
      status: "paid",
      paymentMethod: args.payments.length === 1 ? args.payments[0].method : undefined,
      checkoutIdempotencyKey: args.idempotencyKey,
      paidAt: now,
      updatedAt: now,
      updatedBy: access.employee._id,
      version: (order.version ?? 1) + 1,
    })
    await ctx.db.insert("shiftEvents", { shiftId: shift._id, type: "order-paid", amount: order.total, reason: `Заказ №${order.number}`, actorId: access.employee._id, orderId: order._id, createdAt: now })
    await postLedgerEntry(ctx, {
      restaurantExternalId: access.restaurant.externalId,
      occurredAt: now,
      kind: "revenue",
      category: "Продажи",
      amount: order.total,
      sourceModuleId: "orders",
      sourceExternalId: String(order._id),
      description: `Заказ №${order.number}`,
      businessDate: shift.businessDate,
    })
    // Sale write-off by recipe and cost of goods sold (W1-RCP-03); never fails the sale.
    const soldLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
    await consumeOrderStock(ctx, { order, lines: soldLines, restaurantExternalId: access.restaurant.externalId, terminal: access.terminal, idempotencyKey: args.idempotencyKey, occurredAt: now, businessDate: shift.businessDate })
    await accrueLoyaltyPoints(ctx, order, now)
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
    method: paymentMethodValidator,
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
    const paidByMethod = payments.filter((p) => p.type === "sale" && p.method === args.method).reduce((sum, p) => sum + p.amount, 0)
    const refundedByMethod = payments.filter((p) => p.type === "refund" && p.method === args.method).reduce((sum, p) => sum + p.amount, 0)
    if (args.amount > paidByMethod - refundedByMethod) throw new ConvexError("Возврат должен использовать исходный способ оплаты")

    const now = Date.now()
    const paymentId = await ctx.db.insert("payments", {
      orderId: order._id,
      shiftId: shift._id,
      type: "refund",
      method: args.method,
      amount: roundKzt(args.amount),
      idempotencyKey: args.idempotencyKey,
      status: "recorded",
      createdBy: access.employee._id,
      createdAt: now,
    })
    const totalRefunded = refunded + roundKzt(args.amount)
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
    await reverseOrderConsumption(ctx, { order, refundKey: String(paymentId), share: Math.min(1, roundKzt(args.amount) / paid), occurredAt: now, businessDate: shift.businessDate })
    await reverseLoyaltyPoints(ctx, order, { paidTotal: paid, refundedTotal: totalRefunded, paymentId, occurredAt: now })
    await writeAudit(ctx, access, { action: "order.refund", summary: `Возврат ${roundKzt(args.amount)} ₸ по заказу №${order.number}: ${args.reason.trim()}`, shiftId: shift._id, orderId: order._id, managerId: manager._id })
    return paymentId
  },
})

export const transfer = mutation({
  args: {
    sessionToken: v.string(),
    orderId: v.id("orders"),
    targetTerminalExternalId: v.string(),
    reason: v.string(),
    managerApprovalToken: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const manager = await requireManagerApproval(ctx, args.managerApprovalToken, access.restaurant._id)
    const order = await requireOrder(ctx, args.orderId, access, ["held"])
    const target = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", args.targetTerminalExternalId)).unique()
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
