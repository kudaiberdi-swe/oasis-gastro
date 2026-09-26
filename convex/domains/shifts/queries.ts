import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOpenShift, requireOperator } from "../../lib/auth"
import { calculateCashReconciliation, orderDiscountAmount } from "../../lib/money"
import { VARIANCE_APPROVAL_KZT, seesExpectedCash } from "../../lib/policy"

export async function calculateSummary(ctx: QueryCtx, shift: Doc<"shifts">) {
  const [payments, events] = await Promise.all([
    ctx.db.query("payments").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id)).collect(),
    ctx.db.query("shiftEvents").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id)).collect(),
  ])
  const totals = { cashSales: 0, cashRefunds: 0, card: 0, qr: 0, cashIn: 0, cashOut: 0, grossSales: 0, refunds: 0 }
  for (const payment of payments) {
    if (payment.type === "sale") {
      totals.grossSales += payment.amount
      if (payment.method === "cash") totals.cashSales += payment.amount
      if (payment.method === "card") totals.card += payment.amount
      if (payment.method === "qr") totals.qr += payment.amount
    } else {
      totals.refunds += payment.amount
      if (payment.method === "cash") totals.cashRefunds += payment.amount
      if (payment.method === "card") totals.card -= payment.amount
      if (payment.method === "qr") totals.qr -= payment.amount
    }
  }
  for (const event of events) {
    if (event.type === "cash-in") totals.cashIn += event.amount
    if (event.type === "cash-out") totals.cashOut += event.amount
  }
  return {
    ...totals,
    expectedCash: calculateCashReconciliation({ openingCash: shift.openingCash, cashSales: totals.cashSales, cashRefunds: totals.cashRefunds, cashIn: totals.cashIn, cashOut: totals.cashOut }),
    netSales: totals.grossSales - totals.refunds,
    paymentCount: payments.filter((p) => p.type === "sale").length,
  }
}

/**
 * The open shift as a cashier sees it (blind count, POS-DESIGN §6.2): the expected cash and every figure
 * it follows from are left out — cash sales and refunds, and the revenue that with card and QR gives the
 * cash. Card, QR, cash in / out and the payment count stay. Managers and administrators get it all.
 */
const BLIND = { cashSales: null, cashRefunds: null, grossSales: null, refunds: null, netSales: null, expectedCash: null }

export function blindSummary<T extends Awaited<ReturnType<typeof calculateSummary>>>(summary: T): Omit<T, keyof typeof BLIND> & typeof BLIND {
  return { ...summary, ...BLIND }
}

export async function buildClosePreview(ctx: QueryCtx, shift: Doc<"shifts">) {
  const [drafts, held, summary] = await Promise.all([
    ctx.db.query("orders").withIndex("by_shift_status_created", (q) => q.eq("currentShiftId", shift._id).eq("status", "draft")).take(100),
    ctx.db.query("orders").withIndex("by_shift_status_created", (q) => q.eq("currentShiftId", shift._id).eq("status", "held")).take(100),
    calculateSummary(ctx, shift),
  ])
  return {
    ...summary,
    blockers: [...drafts, ...held].map((order) => ({ orderId: order._id, number: order.number, tableLabel: order.tableLabel, status: order.status, total: order.total })),
    managerThreshold: VARIANCE_APPROVAL_KZT,
  }
}

export async function buildXReportSnapshot(ctx: QueryCtx, shift: Doc<"shifts">) {
  const [payments, events, orders] = await Promise.all([
    ctx.db.query("payments").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id)).collect(),
    ctx.db.query("shiftEvents").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id)).collect(),
    ctx.db.query("orders").withIndex("by_shift_status_created", (q) => q.eq("currentShiftId", shift._id)).collect(),
  ])
  const emptyMethod = () => ({ sales: 0, refunds: 0, net: 0, saleCount: 0, refundCount: 0 })
  const paymentTotals = { cash: emptyMethod(), card: emptyMethod(), qr: emptyMethod() }
  const saleOrderIds = new Set<string>()
  const refundOrderIds = new Set<string>()
  let sales = 0
  let refunds = 0
  for (const payment of payments) {
    const method = paymentTotals[payment.method]
    if (payment.type === "sale") {
      sales += payment.amount
      method.sales += payment.amount
      method.saleCount += 1
      saleOrderIds.add(String(payment.orderId))
    } else {
      refunds += payment.amount
      method.refunds += payment.amount
      method.refundCount += 1
      refundOrderIds.add(String(payment.orderId))
    }
  }
  for (const method of Object.values(paymentTotals)) method.net = method.sales - method.refunds

  let cashIn = 0
  let cashOut = 0
  let cashInCount = 0
  let cashOutCount = 0
  for (const event of events) {
    if (event.type === "cash-in") { cashIn += event.amount; cashInCount += 1 }
    if (event.type === "cash-out") { cashOut += event.amount; cashOutCount += 1 }
  }

  const orderCounts = { paid: 0, partiallyRefunded: 0, refunded: 0, cancelled: 0, draft: 0, held: 0, discounted: 0 }
  let catalogGrossSales = 0
  let discounts = 0
  let serviceCharge = 0
  let cancelledAmount = 0
  let draftTotal = 0
  let heldTotal = 0
  for (const order of orders) {
    if (order.status === "paid") orderCounts.paid += 1
    if (order.status === "partially_refunded") orderCounts.partiallyRefunded += 1
    if (order.status === "refunded") orderCounts.refunded += 1
    if (order.status === "cancelled") { orderCounts.cancelled += 1; cancelledAmount += order.total }
    if (order.status === "draft") { orderCounts.draft += 1; draftTotal += order.total }
    if (order.status === "held") { orderCounts.held += 1; heldTotal += order.total }
    if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
      catalogGrossSales += order.subtotal
      const discount = orderDiscountAmount(order)
      discounts += discount
      serviceCharge += order.serviceChargeAmount
      if (discount !== 0) orderCounts.discounted += 1
    }
  }

  const expectedCash = calculateCashReconciliation({ openingCash: shift.openingCash, cashSales: paymentTotals.cash.sales, cashRefunds: paymentTotals.cash.refunds, cashIn, cashOut })
  return {
    catalogGrossSales,
    discounts,
    serviceCharge,
    sales,
    refunds,
    netSales: sales - refunds,
    averageCheck: saleOrderIds.size ? Math.round(sales / saleOrderIds.size) : 0,
    expectedCash,
    payments: paymentTotals,
    cashMovements: { cashIn, cashOut, cashInCount, cashOutCount },
    orderCounts,
    openOrders: { count: orderCounts.draft, total: draftTotal },
    heldOrders: { count: orderCounts.held, total: heldTotal },
    cancelledAmount,
    saleOrderCount: saleOrderIds.size,
    refundOrderCount: refundOrderIds.size,
  }
}

export const current = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) return null
    const [full, openedBy] = await Promise.all([calculateSummary(ctx, shift), ctx.db.get(shift.openedBy)])
    const cashVisible = seesExpectedCash(access.employee.role)
    const summary = cashVisible ? full : blindSummary(full)
    const ageHours = (Date.now() - shift.openedAt) / 3_600_000
    return { ...shift, openedByName: openedBy?.displayName ?? "Сотрудник", summary, cashVisible, ageHours, requiresAttention: ageHours >= 24, openedOver24h: ageHours >= 24 }
  },
})

export const closePreview = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const shift = await getOpenShift(ctx, access.terminal._id)
    if (!shift) return null
    const preview = await buildClosePreview(ctx, shift)
    // A cashier learns the expected cash only by «Сверить» with a counted amount (mutations.reconcileCount).
    return seesExpectedCash(access.employee.role) ? { ...preview, cashVisible: true } : { ...blindSummary(preview), cashVisible: false }
  },
})

export const history = query({
  args: { sessionToken: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const cashVisible = seesExpectedCash(access.employee.role)
    const result = await ctx.db
      .query("shifts")
      .withIndex("by_terminal_opened", (q) => q.eq("terminalId", access.terminal._id))
      .order("desc")
      .paginate(args.paginationOpts)
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (shift) => ({
          ...shift,
          openedByName: (await ctx.db.get(shift.openedBy))?.displayName ?? "Сотрудник",
          // The open shift is still being counted blind; a closed one shows its totals to everyone.
          summary: cashVisible || shift.status !== "open" ? await calculateSummary(ctx, shift) : blindSummary(await calculateSummary(ctx, shift)),
          zReportId: (await ctx.db.query("zReports").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).first())?._id ?? null,
        })),
      ),
    }
  },
})

/** Terminals of the same restaurant with an open shift — where a held check can be transferred (W1-POS-05). */
export const availableTransferTargets = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const terminals = await ctx.db.query("posTerminals").withIndex("by_restaurant_active_and_number", (q) => q.eq("restaurantId", access.restaurant._id).eq("active", true)).take(50)
    const targets = []
    for (const terminal of terminals) {
      if (terminal._id === access.terminal._id) continue
      const shift = await getOpenShift(ctx, terminal._id)
      if (shift) targets.push({ terminalId: terminal._id, externalId: terminal.externalId, name: terminal.name, terminalNumber: terminal.terminalNumber, shiftNumber: shift.number })
    }
    return targets
  },
})

/** The Z-report of a closed shift of this terminal (W1-POS-08). */
export const getZReport = query({
  args: { sessionToken: v.string(), shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const report = await ctx.db.query("zReports").withIndex("by_shift", (q) => q.eq("shiftId", args.shiftId)).first()
    if (!report || report.restaurantId !== access.restaurant._id) return null
    return report
  },
})
