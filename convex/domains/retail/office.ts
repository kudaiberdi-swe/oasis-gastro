import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import type { Doc, Id } from "../../_generated/dataModel"
import { requireOfficeCapability, requireRestaurantScope, scopedRestaurants } from "../../lib/officeAccess"
import { orderDiscountAmount } from "../../lib/money"

// Office views of the POS (W1-RTL-04/05/06): cash operations journal, orders and receipts, cash shifts.
// Every list reads index ranges of the user's restaurants — no take-and-filter over all rows (B-27).

type User = { restaurantScopes: string[] }

/** The restaurants a list covers: the one asked for (checked) or every restaurant in scope. */
async function restaurantsFor(ctx: QueryCtx, user: User, restaurantExternalId?: string) {
  if (restaurantExternalId) {
    await requireRestaurantScope(ctx, user, restaurantExternalId)
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
    return restaurant ? [restaurant] : []
  }
  return scopedRestaurants(ctx, user)
}

async function employeeName(ctx: QueryCtx, id: Id<"employees"> | undefined) {
  return id ? ((await ctx.db.get(id))?.displayName ?? "Сотрудник") : null
}

/**
 * Cash in / out of the shifts of the user's restaurants, newest first. With a direction the list pages;
 * without one it shows the latest of both kinds (bounded by the page size).
 */
export const listCashOperations = query({
  args: { restaurantExternalId: v.optional(v.string()), direction: v.optional(v.union(v.literal("cash-in"), v.literal("cash-out"))), from: v.optional(v.number()), to: v.optional(v.number()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.cash-operations.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurants = await restaurantsFor(ctx, user, args.restaurantExternalId)
    const allowed = new Set(restaurants.map((restaurant) => restaurant._id))
    const from = args.from ?? 0
    const to = args.to ?? Number.MAX_SAFE_INTEGER
    const range = (type: "cash-in" | "cash-out") => ctx.db.query("shiftEvents").withIndex("by_type_created", (q) => q.eq("type", type).gte("createdAt", from).lte("createdAt", to)).order("desc")
    let events: Doc<"shiftEvents">[]
    let isDone = true
    let continueCursor = ""
    if (args.direction) {
      const page = await range(args.direction).paginate(args.paginationOpts)
      events = page.page
      isDone = page.isDone
      continueCursor = page.continueCursor
    } else {
      const size = Math.min(args.paginationOpts.numItems, 200)
      const [cashIn, cashOut] = await Promise.all([range("cash-in").take(size), range("cash-out").take(size)])
      events = [...cashIn, ...cashOut].sort((a, b) => b.createdAt - a.createdAt).slice(0, size)
    }
    const rows = []
    for (const event of events) {
      const shift = await ctx.db.get(event.shiftId)
      if (!shift || !allowed.has(shift.restaurantId)) continue
      rows.push({
        _id: event._id,
        direction: event.type as "cash-in" | "cash-out",
        amount: event.type === "cash-out" ? -event.amount : event.amount,
        reason: event.reason,
        operationTypeName: event.cashOperationTypeName ?? null,
        employeeName: await employeeName(ctx, event.actorId),
        shiftNumber: shift.number,
        businessDate: shift.businessDate,
        restaurantName: restaurants.find((row) => row._id === shift.restaurantId)?.name ?? "",
        createdAt: event.createdAt,
      })
    }
    return { page: rows, isDone, continueCursor }
  },
})

const ORDER_STATUS = { open: ["draft"], held: ["held"], paid: ["paid"], refunded: ["refunded", "partially_refunded"], cancelled: ["cancelled"] } as const

/** Orders and receipts: by status tab, search, restaurant; paged over index ranges. */
export const listOrders = query({
  args: {
    status: v.optional(v.union(v.literal("all"), v.literal("open"), v.literal("held"), v.literal("paid"), v.literal("refunded"), v.literal("cancelled"))),
    search: v.optional(v.string()),
    restaurantExternalId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.orders.view")
    const restaurants = await restaurantsFor(ctx, user, args.restaurantExternalId)
    if (!restaurants.length) return { page: [], isDone: true, continueCursor: "" }
    const statuses: readonly string[] | null = args.status && args.status !== "all" ? ORDER_STATUS[args.status] : null
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const network = user.restaurantScopes.includes("*") && !args.restaurantExternalId
    const single = restaurants.length === 1 ? restaurants[0] : null
    const allowed = new Set(restaurants.map((restaurant) => restaurant._id))
    let page
    if (needle) {
      page = await ctx.db.query("orders").withSearchIndex("search_orders", (q) => (single ? q.search("searchText", needle).eq("restaurantId", single._id) : q.search("searchText", needle))).paginate(args.paginationOpts)
    } else if (single && statuses?.length === 1) {
      page = await ctx.db.query("orders").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", single._id).eq("status", statuses[0] as Doc<"orders">["status"])).order("desc").paginate(args.paginationOpts)
    } else if (single) {
      page = await ctx.db.query("orders").withIndex("by_restaurant_created", (q) => q.eq("restaurantId", single._id)).order("desc").paginate(args.paginationOpts)
    } else if (statuses?.length === 1) {
      page = await ctx.db.query("orders").withIndex("by_status_created", (q) => q.eq("status", statuses[0] as Doc<"orders">["status"])).order("desc").paginate(args.paginationOpts)
    } else {
      page = await ctx.db.query("orders").withIndex("by_status_created").order("desc").paginate(args.paginationOpts)
    }
    const visible = page.page.filter((order) => (network || (order.restaurantId && allowed.has(order.restaurantId))) && (!statuses || statuses.includes(order.status)))
    return {
      ...page,
      page: await Promise.all(
        visible.map(async (order) => {
          const terminal = order.terminalId ? await ctx.db.get(order.terminalId) : null
          const shift = order.originatingShiftId ? await ctx.db.get(order.originatingShiftId) : null
          const restaurant = order.restaurantId ? await ctx.db.get(order.restaurantId) : null
          return {
            _id: order._id,
            number: order.number,
            source: "Sandyq POS",
            status: order.status,
            createdAt: order.createdAt,
            paidAt: order.paidAt ?? null,
            businessDate: order.businessDate ?? null,
            shiftNumber: shift?.number ?? null,
            restaurantName: restaurant?.name ?? "",
            terminalName: terminal?.name ?? null,
            cashierName: await employeeName(ctx, order.createdBy),
            tableLabel: order.tableLabel ?? null,
            orderTypeName: order.orderTypeName ?? null,
            total: order.total,
          }
        }),
      ),
    }
  },
})

/** The receipt card: lines with sizes and modifiers, totals, payments with types, refunds, deletions, config snapshot, audit. */
export const getOrderDetail = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.orders.view")
    const order = await ctx.db.get(args.orderId)
    const restaurant = order?.restaurantId ? await ctx.db.get(order.restaurantId) : null
    if (!order || !restaurant) return null
    try {
      await requireRestaurantScope(ctx, user, restaurant.externalId)
    } catch {
      return null
    }
    const [lines, payments, deletions, audit] = await Promise.all([
      ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200),
      ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(50),
      ctx.db.query("orderDeletionEvents").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(50),
      ctx.db.query("auditEvents").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).order("desc").take(50),
    ])
    const terminal = order.terminalId ? await ctx.db.get(order.terminalId) : null
    return {
      order: {
        _id: order._id,
        number: order.number,
        status: order.status,
        orderTypeName: order.orderTypeName ?? null,
        tableLabel: order.tableLabel ?? null,
        guestCount: order.guestCount ?? null,
        comment: order.comment ?? "",
        createdAt: order.createdAt,
        paidAt: order.paidAt ?? null,
        businessDate: order.businessDate ?? null,
        restaurantName: restaurant.name,
        terminalName: terminal?.name ?? null,
        cashierName: await employeeName(ctx, order.createdBy),
        retailConfigVersion: order.retailConfigVersion ?? null,
      },
      lines: lines.map((line) => ({
        _id: line._id,
        productName: line.productName,
        sizeLabel: line.sizeLabel ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal ?? line.unitPrice * line.quantity,
        modifiers: [...(line.kitchenModifiers ?? []).map((modifier) => modifier.label), ...line.modifiers],
        voided: Boolean(line.voidedAt),
        sentToKitchen: Boolean(line.sentToKitchenAt),
      })),
      totals: { subtotal: order.subtotal, discount: orderDiscountAmount(order), discountName: order.discountTypeName ?? null, serviceCharge: order.serviceChargeAmount, serviceChargePercent: order.serviceChargePercent, loyaltyRedeemed: order.loyaltyRedeemed ?? 0, total: order.total },
      payments: payments.map((payment) => ({ _id: payment._id, type: payment.type, name: payment.paymentTypeName ?? payment.method, amount: payment.amount, tendered: payment.tendered ?? null, change: payment.change ?? null, createdAt: payment.createdAt })),
      deletions: deletions.map((event) => ({ _id: event._id, reason: event.deletionReasonName, comment: event.comment, writeOff: event.writeOff, line: event.orderLineId ? (lines.find((line) => line._id === event.orderLineId)?.productName ?? null) : null, createdAt: event.createdAt })),
      audit: audit.map((event) => ({ _id: event._id, action: event.action, summary: event.summary, occurredAt: event.occurredAt })),
    }
  },
})

/** Cash shifts of the user's restaurants with sales, refunds, cash and acceptance status. */
export const listShifts = query({
  args: { status: v.optional(v.union(v.literal("all"), v.literal("open"), v.literal("closed"))), restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.cash-shifts.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurants = await restaurantsFor(ctx, user, args.restaurantExternalId)
    const first = restaurants[0]
    if (!first) return { page: [], isDone: true, continueCursor: "" }
    if (restaurants.length > 1 && !args.restaurantExternalId) {
      // Several restaurants: the latest shifts of each (bounded), newest first — pick a restaurant to page further.
      const rows: Doc<"shifts">[] = []
      for (const restaurant of restaurants.slice(0, 50)) {
        const recent = args.status && args.status !== "all"
          ? await ctx.db.query("shifts").withIndex("by_restaurant_status_closed", (q) => q.eq("restaurantId", restaurant._id).eq("status", args.status as "open" | "closed")).order("desc").take(20)
          : await ctx.db.query("shifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantId", restaurant._id)).order("desc").take(20)
        rows.push(...recent)
      }
      rows.sort((a, b) => b.openedAt - a.openedAt)
      return { page: await Promise.all(rows.slice(0, args.paginationOpts.numItems).map((shift) => shiftCard(ctx, shift, restaurants))), isDone: true, continueCursor: "" }
    }
    const page = args.status && args.status !== "all"
      ? await ctx.db.query("shifts").withIndex("by_restaurant_status_closed", (q) => q.eq("restaurantId", first._id).eq("status", args.status as "open" | "closed")).order("desc").paginate(args.paginationOpts)
      : await ctx.db.query("shifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantId", first._id)).order("desc").paginate(args.paginationOpts)
    return { ...page, page: await Promise.all(page.page.map((shift) => shiftCard(ctx, shift, restaurants))) }
  },
})

async function shiftCard(ctx: QueryCtx, shift: Doc<"shifts">, restaurants: Doc<"restaurants">[]) {
  let sales = 0
  let refunds = 0
  for await (const payment of ctx.db.query("payments").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id))) {
    if (payment.type === "sale") sales += payment.amount
    else refunds += payment.amount
  }
  const [terminal, acceptances, zReport] = await Promise.all([
    ctx.db.get(shift.terminalId),
    ctx.db.query("cashShiftAcceptances").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(10),
    ctx.db.query("zReports").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).first(),
  ])
  const accepted = acceptances.find((row) => !row.reversedAt)
  if (!restaurants.some((restaurant) => restaurant._id === shift.restaurantId)) throw new ConvexError("Нет доступа к ресторану")
  return {
    _id: shift._id,
    number: shift.number,
    terminalName: terminal?.name ?? "Касса",
    restaurantName: restaurants.find((restaurant) => restaurant._id === shift.restaurantId)?.name ?? "",
    businessDate: shift.businessDate,
    status: accepted ? ("accepted" as const) : shift.status,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? null,
    openedByName: await employeeName(ctx, shift.openedBy),
    closedByName: await employeeName(ctx, shift.closedBy),
    sales,
    refunds,
    expectedCash: shift.expectedCash ?? null,
    countedCash: shift.countedCash ?? null,
    variance: shift.variance ?? null,
    zReportNumber: shift.zReportNumber ?? null,
    zReportId: zReport?._id ?? null,
    acceptance: accepted ? { recountedCash: accepted.recountedCash, variance: accepted.variance, acceptedAt: accepted.acceptedAt, note: accepted.note } : null,
  }
}

/** A Z-report for printing from «Кассовые смены» (the POS reads it with a PIN session instead). */
export const getZReport = query({
  args: { zReportId: v.id("zReports") },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.cash-shifts.view")
    const report = await ctx.db.get(args.zReportId)
    const restaurant = report ? await ctx.db.get(report.restaurantId) : null
    if (!report || !restaurant) return null
    await requireRestaurantScope(ctx, user, restaurant.externalId)
    const terminal = await ctx.db.get(report.terminalId)
    return { ...report, restaurantName: restaurant.name, restaurantAddress: restaurant.address, terminalName: terminal?.name ?? "Касса", terminalNumber: terminal?.terminalNumber ?? 0 }
  },
})

// ── iiko orders and cash shifts (W2-RTL-01, decision D7) ─────────────────────────────────────────────
// Read-only projections of the iiko sales of linked Sandyq departments: no actions, no receipt card,
// no personal data (the shift manager only by the iiko employee code).

/** iiko orders of the user's restaurants, newest first. */
export const listIikoOrders = query({
  args: { restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.orders.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurants = await restaurantsFor(ctx, user, args.restaurantExternalId)
    if (!restaurants.length) return { page: [], isDone: true, continueCursor: "" }
    const names = new Map(restaurants.map((restaurant) => [restaurant.externalId, restaurant.name]))
    const single = args.restaurantExternalId ? restaurants[0] : null
    const page = single
      ? await ctx.db.query("iikoOrders").withIndex("by_restaurant_opened", (q) => q.eq("restaurantExternalId", single.externalId)).order("desc").paginate(args.paginationOpts)
      : await ctx.db.query("iikoOrders").withIndex("by_opened").order("desc").paginate(args.paginationOpts)
    const shiftNumbers = new Map<string, number | null>()
    const rows = []
    for (const order of page.page) {
      if (!names.has(order.restaurantExternalId)) continue
      const shiftId = order.cashShiftExternalId
      if (shiftId && !shiftNumbers.has(shiftId)) shiftNumbers.set(shiftId, (await ctx.db.query("iikoCashShifts").withIndex("by_external_id", (q) => q.eq("externalId", shiftId)).unique())?.sessionNumber ?? null)
      rows.push({
        _id: order._id,
        number: order.orderNumber,
        source: "iiko" as const,
        openedAt: order.openedAt,
        businessDate: order.businessDate,
        restaurantName: names.get(order.restaurantExternalId) ?? "",
        orderTypeName: order.orderTypeName ?? null,
        shiftNumber: shiftId ? (shiftNumbers.get(shiftId) ?? null) : null,
        guestCount: order.guestCount,
        grossAmount: order.grossAmount,
        total: order.total,
      })
    }
    return { ...page, page: rows }
  },
})

/** iiko cash shifts of the user's restaurants, newest first. */
export const listIikoShifts = query({
  args: { restaurantExternalId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.cash-shifts.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const restaurants = await restaurantsFor(ctx, user, args.restaurantExternalId)
    if (!restaurants.length) return { page: [], isDone: true, continueCursor: "" }
    const names = new Map(restaurants.map((restaurant) => [restaurant.externalId, restaurant.name]))
    const single = args.restaurantExternalId ? restaurants[0] : null
    const page = single
      ? await ctx.db.query("iikoCashShifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantExternalId", single.externalId)).order("desc").paginate(args.paginationOpts)
      : await ctx.db.query("iikoCashShifts").withIndex("by_opened").order("desc").paginate(args.paginationOpts)
    const rows = []
    for (const shift of page.page) {
      if (!names.has(shift.restaurantExternalId)) continue
      const managerId = shift.managerEmployeeExternalId
      const manager = managerId ? await ctx.db.query("iikoEmployees").withIndex("by_external_id", (q) => q.eq("externalId", managerId)).unique() : null
      rows.push({
        _id: shift._id,
        number: shift.sessionNumber,
        source: "iiko" as const,
        cashRegisterNumber: shift.cashRegisterNumber ?? null,
        restaurantName: names.get(shift.restaurantExternalId) ?? "",
        status: shift.status,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt ?? null,
        managerCode: manager?.code ?? null,
        startCash: shift.startCash,
        salesCash: shift.salesCash,
        salesCard: shift.salesCard,
        salesCredit: shift.salesCredit,
        payIn: shift.payIn,
        payOut: shift.payOut,
        cashDiff: shift.cashDiff,
        ordersTotal: shift.ordersTotal,
      })
    }
    return { ...page, page: rows }
  },
})
