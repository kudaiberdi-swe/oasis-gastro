import { ConvexError } from "convex/values"

import type { Doc, Id } from "../../../_generated/dataModel"
import { calculateCashReconciliation } from "../../../lib/money"
import type { ReportColumn, ReportConfig, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { count, factReport, facts, matcher, money, percentOf, restaurantDocs, round1, sumFacts, type FactType } from "./_facts"
import { aggregate, col, dayEnd, dayStart, localDate, SCAN_BUDGET } from "./_shared"
import { localDateTime, restaurantNames } from "./_scope"

// Sales reports of W2 (docs/IMPLEMENTATION-PLAN.md W2-RPT-03) and the W1-RPT-06 leftovers (sales-olap,
// sales-10, sales-20). A report is listed here only with a test (tests/convex/reportsSales.test.ts).
// Totals over the facts reconcile with sales-01.

const SOLD = ["paid", "partially_refunded", "refunded"]
type Cells = Record<string, number | string>

/** sales-03: revenue of the kitchen stations (products.prepArea) by day, one column per station. */
const stationsByDay: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "station", config, restaurants)
  const byQuantity = config.measure === "count"
  const stations = new Map<string, string>()
  const byDay = new Map<string, Record<string, number>>()
  for (const fact of rows) {
    stations.set(fact.dimensionKey, fact.dimensionLabel)
    const day = byDay.get(fact.businessDate) ?? {}
    day[fact.dimensionKey] = (day[fact.dimensionKey] ?? 0) + (byQuantity ? fact.quantity : fact.netAmount)
    byDay.set(fact.businessDate, day)
  }
  const ordered = [...stations.entries()].sort(([, a], [, b]) => a.localeCompare(b, "ru"))
  const unit: ReportColumn["unit"] = byQuantity ? "quantity" : "money"
  const columns = [col("group", "Дата", "date"), ...ordered.map(([key, label]) => col(`station:${key}`, label, unit)), col("total", "Итого", unit)]
  const totals: Record<string, number> = { total: 0 }
  const out = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const cells: Cells = { group: date }
      let sum = 0
      for (const [key] of ordered) {
        const value = values[key] ?? 0
        cells[`station:${key}`] = value
        totals[`station:${key}`] = (totals[`station:${key}`] ?? 0) + value
        sum += value
      }
      cells.total = sum
      totals.total += sum
      return { key: date, cells }
    })
  const kpis: ReportResult["kpis"] = ordered.map(([key, label]) => ({ key: `share:${key}`, label: `Доля: ${label}`, value: percentOf(totals[`station:${key}`] ?? 0, totals.total), unit: "percent" as const }))
  return { sourceLabel: "Продажи по станциям кухни (предагрегат за день)", columns, rows: out, totals, kpis: [{ key: "total", label: byQuantity ? "Порций" : "Выручка", value: totals.total, unit }, ...kpis], truncated }
}

/** sales-05: dishes by POS terminal (fact terminal-product, key `<terminal>:<product>`). */
const dishesByTerminal: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "terminal-product", config, restaurants)
  const matches = matcher(config)
  const terminalNames = new Map<string, string>()
  const terminalName = async (key: string) => {
    if (!terminalNames.has(key)) {
      const terminal = await ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", key)).unique()
      terminalNames.set(key, terminal?.name ?? key)
    }
    return terminalNames.get(key)!
  }
  const columns = [col("terminal", "Касса", "text"), col("group", "Блюдо", "text"), col("quantity", "Количество", "quantity"), col("grossAmount", "По меню", "money"), col("netAmount", "Выручка", "money"), col("terminalShare", "Доля в выручке кассы, %", "percent")]
  const input = []
  for (const [key, group] of sumFacts(rows)) {
    const split = key.indexOf(":")
    const terminalKey = split > 0 ? key.slice(0, split) : key
    const terminal = await terminalName(terminalKey)
    if (!matches(group.label, terminal)) continue
    input.push({ key, label: group.label, text: { terminal, terminalKey }, values: { quantity: group.values.quantity, grossAmount: group.values.grossAmount, netAmount: group.values.netAmount } })
  }
  const result = aggregate(input, columns)
  const byTerminal = new Map<string, number>()
  for (const row of result.rows) byTerminal.set(String(row.cells.terminalKey), (byTerminal.get(String(row.cells.terminalKey)) ?? 0) + Number(row.cells.netAmount))
  for (const row of result.rows) {
    row.cells.terminalShare = percentOf(Number(row.cells.netAmount), byTerminal.get(String(row.cells.terminalKey)) ?? 0)
    delete row.cells.terminalKey
  }
  delete result.totals.terminalShare
  result.rows.sort((a, b) => String(a.cells.terminal).localeCompare(String(b.cells.terminal), "ru") || Number(b.cells.netAmount) - Number(a.cells.netAmount))
  return { sourceLabel: "Продажи по кассам и блюдам (предагрегат за день)", columns, ...result, kpis: [{ key: "net", label: "Выручка", value: result.totals.netAmount ?? 0, unit: "money" }, { key: "terminals", label: "Касс", value: byTerminal.size, unit: "count" }], truncated }
}

/** sales-09: cash balance of each shift — from its Z-report when closed, live from payments and cash operations when open. */
const cashBalance: Calculator = async (ctx, config, restaurants) => {
  const columns = [
    col("group", "Смена", "text"), col("terminal", "Касса", "text"), col("date", "Дата", "date"), col("status", "Статус", "text"),
    col("openingCash", "Начальный остаток", "money"), col("cashSales", "Продажи наличными", "money"), col("cashRefunds", "Возвраты наличными", "money"),
    col("cashIn", "Внесения", "money"), col("cashOut", "Изъятия", "money"), col("expected", "Ожидаемый остаток", "money"), col("counted", "Фактический остаток", "money"), col("variance", "Расхождение", "money"),
  ]
  const terminals = new Map<Id<"posTerminals">, string>()
  const rows = []
  let scanned = 0
  let truncated = false
  for (const restaurant of await restaurantDocs(ctx, restaurants)) {
    for await (const shift of ctx.db.query("shifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantId", restaurant._id).gte("openedAt", dayStart(config.dateFrom)).lte("openedAt", dayEnd(config.dateTo)))) {
      if ((scanned += 1) > SCAN_BUDGET) {
        truncated = true
        break
      }
      if (!terminals.has(shift.terminalId)) terminals.set(shift.terminalId, (await ctx.db.get(shift.terminalId))?.name ?? "Касса")
      const z = await ctx.db.query("zReports").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).first()
      let values: Record<string, number>
      if (z) {
        const { snapshot } = z
        values = { openingCash: z.openingCash, cashSales: snapshot.payments.cash.sales, cashRefunds: snapshot.payments.cash.refunds, cashIn: snapshot.cashMovements.cashIn, cashOut: snapshot.cashMovements.cashOut, expected: snapshot.expectedCash, counted: z.countedCash, variance: z.variance }
      } else {
        const live = { cashSales: 0, cashRefunds: 0, cashIn: 0, cashOut: 0 }
        for await (const payment of ctx.db.query("payments").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id))) {
          if ((scanned += 1) > SCAN_BUDGET) {
            truncated = true
            break
          }
          if (payment.method !== "cash") continue
          if (payment.type === "sale") live.cashSales += payment.amount
          else live.cashRefunds += payment.amount
        }
        for await (const event of ctx.db.query("shiftEvents").withIndex("by_shift_created", (q) => q.eq("shiftId", shift._id))) {
          if ((scanned += 1) > SCAN_BUDGET) {
            truncated = true
            break
          }
          if (event.type === "cash-in") live.cashIn += event.amount
          if (event.type === "cash-out") live.cashOut += event.amount
        }
        const expected = calculateCashReconciliation({ openingCash: shift.openingCash, ...live })
        const counted = shift.status === "closed" ? (shift.countedCash ?? 0) : 0
        values = { openingCash: shift.openingCash, ...live, expected, counted, variance: shift.status === "closed" ? counted - expected : 0 }
      }
      rows.push({ key: String(shift._id), label: `№${shift.number}${z ? ` · ${z.number}` : ""}`, text: { terminal: terminals.get(shift.terminalId)!, date: shift.businessDate, status: shift.status === "open" ? "Открыта" : "Закрыта" }, values })
    }
  }
  const result = aggregate(rows, columns)
  result.rows.sort((a, b) => String(a.cells.date).localeCompare(String(b.cells.date)) || String(a.cells.group).localeCompare(String(b.cells.group)))
  return { sourceLabel: "Кассовые смены, Z-отчёты и кассовые операции", columns, ...result, kpis: [{ key: "cashSales", label: "Продажи наличными", value: result.totals.cashSales ?? 0, unit: "money" }, { key: "variance", label: "Расхождение", value: result.totals.variance ?? 0, unit: "money" }], truncated }
}

const CONCEPT_LABEL: Record<string, string> = { "fast-food": "Фастфуд", "table-service": "Ресторан с обслуживанием", delivery: "Доставка (dark kitchen)" }

/**
 * sales-15: sales by restaurant concept. The concept is the restaurant's format (`restaurants.serviceMode`,
 * corporation card) — the schema has no separate `concept` field yet.
 */
const byConcept: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "branch", config, restaurants)
  const concept = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row.serviceMode ?? "none"]))
  const groups = sumFacts(rows, (fact) => concept.get(fact.restaurantExternalId) ?? "none")
  const members = new Map<string, Set<string>>()
  for (const fact of rows) {
    const key = concept.get(fact.restaurantExternalId) ?? "none"
    members.set(key, (members.get(key) ?? new Set()).add(fact.restaurantExternalId))
  }
  const columns = [col("group", "Концепция", "text"), col("restaurants", "Ресторанов", "count"), col("orderCount", "Заказов", "count"), col("guestCount", "Гостей", "count"), col("netAmount", "Выручка", "money"), col("refundAmount", "Возвраты", "money"), col("averageCheck", "Средний чек", "money"), col("share", "Доля выручки, %", "percent")]
  const total = [...groups.values()].reduce((sum, group) => sum + group.values.netAmount, 0)
  const matches = matcher(config)
  const input = [...groups.entries()]
    .map(([key, group]) => ({ key, label: CONCEPT_LABEL[key] ?? (key === "none" ? "Без концепции" : key), values: { restaurants: members.get(key)?.size ?? 0, orderCount: group.values.orderCount, guestCount: group.values.guestCount, netAmount: group.values.netAmount, refundAmount: group.values.refundAmount } }))
    .filter((row) => matches(row.label))
  const result = aggregate(input, columns, "netAmount")
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orderCount) ? Math.round(Number(row.cells.netAmount) / Number(row.cells.orderCount)) : 0
    row.cells.share = percentOf(Number(row.cells.netAmount), total)
  }
  delete result.totals.averageCheck
  delete result.totals.share
  return { sourceLabel: "Продажи кассы по формату ресторана (предагрегат за день)", columns, ...result, kpis: [{ key: "net", label: "Выручка", value: total, unit: "money" }], truncated }
}

/** sales-16: sales by restaurant with discounts, refunds and the share of the chain. */
const byRestaurant: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "branch", config, restaurants)
  const matches = matcher(config)
  const columns = [col("group", "Ресторан", "text"), col("orderCount", "Заказов", "count"), col("guestCount", "Гостей", "count"), col("grossAmount", "По меню", "money"), col("discountAmount", "Скидки", "money"), col("netAmount", "Выручка", "money"), col("refundAmount", "Возвраты", "money"), col("netOfRefunds", "За вычетом возвратов", "money"), col("averageCheck", "Средний чек", "money"), col("share", "Доля выручки, %", "percent")]
  const input = [...sumFacts(rows)].filter(([, group]) => matches(group.label)).map(([key, group]) => ({ key, label: group.label, values: { orderCount: group.values.orderCount, guestCount: group.values.guestCount, grossAmount: group.values.grossAmount, discountAmount: group.values.discountAmount, netAmount: group.values.netAmount, refundAmount: group.values.refundAmount, netOfRefunds: group.values.netAmount - group.values.refundAmount } }))
  const result = aggregate(input, columns, "netAmount")
  const total = result.totals.netAmount ?? 0
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orderCount) ? Math.round(Number(row.cells.netAmount) / Number(row.cells.orderCount)) : 0
    row.cells.share = percentOf(Number(row.cells.netAmount), total)
  }
  result.totals.averageCheck = result.totals.orderCount ? Math.round(total / result.totals.orderCount) : 0
  delete result.totals.share
  return { sourceLabel: "Продажи кассы по ресторанам (предагрегат за день)", columns, ...result, kpis: [{ key: "net", label: "Выручка", value: total, unit: "money" }, { key: "netOfRefunds", label: "Выручка за вычетом возвратов", value: result.totals.netOfRefunds ?? 0, unit: "money" }, { key: "restaurants", label: "Ресторанов", value: result.rows.length, unit: "count" }], truncated }
}

/** sales-17: sales by channel (POS, delivery by source, kiosk) with refunds and share. */
const byChannel: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "channel", config, restaurants)
  const matches = matcher(config)
  const columns = [col("group", "Канал", "text"), col("orderCount", "Заказов", "count"), col("guestCount", "Гостей", "count"), col("netAmount", "Выручка", "money"), col("refundAmount", "Возвраты", "money"), col("averageCheck", "Средний чек", "money"), col("share", "Доля выручки, %", "percent")]
  const input = [...sumFacts(rows)].filter(([, group]) => matches(group.label)).map(([key, group]) => ({ key, label: group.label, values: { orderCount: group.values.orderCount, guestCount: group.values.guestCount, netAmount: group.values.netAmount, refundAmount: group.values.refundAmount } }))
  const result = aggregate(input, columns, "netAmount")
  const total = result.totals.netAmount ?? 0
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orderCount) ? Math.round(Number(row.cells.netAmount) / Number(row.cells.orderCount)) : 0
    row.cells.share = percentOf(Number(row.cells.netAmount), total)
  }
  delete result.totals.averageCheck
  delete result.totals.share
  return { sourceLabel: "Продажи по каналам (предагрегат за день)", columns, ...result, kpis: [{ key: "net", label: "Выручка", value: total, unit: "money" }, { key: "channels", label: "Каналов", value: result.rows.length, unit: "count" }], truncated }
}

/** sales-18: sales by 15-minute interval of the payment time; `groupBy: "hour"` folds them into hours. */
const byQuarterHour: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "quarter-hour", config, restaurants)
  const byHour = config.groupBy === "hour"
  const columns = [col("group", byHour ? "Час" : "Интервал", "text"), col("hour", "Час", "text"), col("orderCount", "Заказов", "count"), col("guestCount", "Гостей", "count"), col("netAmount", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("share", "Доля выручки, %", "percent")]
  const input = rows.map((fact) => {
    const hour = `${fact.dimensionKey.slice(0, 2)}:00`
    const [h, m] = fact.dimensionKey.split(":").map(Number)
    const end = h * 60 + m + 15
    const label = byHour ? `${hour}–${String((h + 1) % 24).padStart(2, "0")}:00` : `${fact.dimensionKey}–${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`
    return { key: byHour ? hour : fact.dimensionKey, label, text: { hour }, values: { orderCount: fact.orderCount, guestCount: fact.guestCount, netAmount: fact.netAmount } }
  })
  const result = aggregate(input, columns)
  const total = result.totals.netAmount ?? 0
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.orderCount) ? Math.round(Number(row.cells.netAmount) / Number(row.cells.orderCount)) : 0
    row.cells.share = percentOf(Number(row.cells.netAmount), total)
  }
  result.rows.sort((a, b) => a.key.localeCompare(b.key))
  delete result.totals.averageCheck
  delete result.totals.share
  const peak = [...result.rows].sort((a, b) => Number(b.cells.netAmount) - Number(a.cells.netAmount))[0]
  return { sourceLabel: "Продажи по времени оплаты (предагрегат за день)", columns, ...result, kpis: [{ key: "net", label: "Выручка", value: total, unit: "money" }, { key: "peakShare", label: `Пик${peak ? `: ${peak.cells.group}` : ""}`, value: peak ? Number(peak.cells.share) : 0, unit: "percent" }], truncated }
}

/**
 * sales-24: sales without revenue — payments by payment types marked «без выручки» (retail settings,
 * `revenue: false`: representation, staff meals…) and zero checks at their menu (nominal) value.
 */
const withoutRevenue: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Основание", "text"), col("kind", "Вид", "text"), col("count", "Чеков / оплат", "count"), col("amount", "Сумма по номиналу", "money"), col("refunds", "Возвраты", "money")]
  const settings = await ctx.db.query("retailSettings").withIndex("by_kind_order", (q) => q.eq("kind", "payment-type")).take(200)
  const withoutRevenueTypes = new Set(settings.filter((row) => row.data.kind === "payment-type" && !row.data.revenue).map((row) => row.externalId))
  const payments = await facts(ctx, "payment-type", config, restaurants)
  const rows = []
  for (const fact of payments.rows) {
    if (!withoutRevenueTypes.has(fact.dimensionKey)) continue
    rows.push({ key: `payment:${fact.dimensionKey}`, label: fact.dimensionLabel, text: { kind: "Оплата без выручки" }, values: { count: fact.orderCount, amount: fact.netAmount, refunds: fact.refundAmount } })
  }
  // Zero checks: only the days whose branch fact counts one are read, order by order.
  const branch = await facts(ctx, "branch", config, restaurants)
  const byExternalId = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row]))
  let zeroChecks = 0
  let scanned = 0
  let truncated = payments.truncated || branch.truncated
  for (const fact of branch.rows) {
    const restaurant = byExternalId.get(fact.restaurantExternalId)
    if (!fact.zeroRevenueCount || !restaurant) continue
    zeroChecks += fact.zeroRevenueCount
    for await (const order of ctx.db.query("orders").withIndex("by_restaurant_business_date", (q) => q.eq("restaurantId", restaurant._id).eq("businessDate", fact.businessDate))) {
      if ((scanned += 1) > SCAN_BUDGET) {
        truncated = true
        break
      }
      if (!SOLD.includes(order.status) || order.total !== 0) continue
      const reason = order.discountTypeName ?? (order.discountPercent ? `Скидка ${order.discountPercent}%` : "Без скидки")
      rows.push({ key: `zero:${order.discountTypeExternalId ?? `percent-${order.discountPercent}`}`, label: `Нулевой чек · ${reason}`, text: { kind: "Нулевой чек" }, values: { count: 1, amount: order.subtotal, refunds: 0 } })
    }
  }
  const result = aggregate(rows, columns, "amount")
  return { sourceLabel: "Оплаты без выручки и нулевые чеки", columns, ...result, kpis: [{ key: "nominal", label: "Сумма по номиналу", value: result.totals.amount ?? 0, unit: "money" }, { key: "zeroChecks", label: "Нулевых чеков", value: zeroChecks, unit: "count" }], truncated }
}

/** sales-25: orders and guests by day (or by restaurant with `groupBy: "restaurant"`), guests per order. */
const ordersAndGuests: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "branch", config, restaurants)
  const byRestaurant = config.groupBy === "restaurant"
  const columns = [col("group", byRestaurant ? "Ресторан" : "Дата", byRestaurant ? "text" : "date"), col("orderCount", "Заказов", "count"), col("guestCount", "Гостей", "count"), col("guestsPerOrder", "Гостей на заказ", "count"), col("netAmount", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("perGuest", "Выручка на гостя", "money")]
  const input = rows.map((fact) => ({ key: byRestaurant ? fact.restaurantExternalId : fact.businessDate, label: byRestaurant ? fact.dimensionLabel : fact.businessDate, values: { orderCount: fact.orderCount, guestCount: fact.guestCount, netAmount: fact.netAmount } }))
  const result = aggregate(input, columns)
  const derive = (cells: Record<string, number | string>) => {
    const orders = Number(cells.orderCount) || 0
    const guests = Number(cells.guestCount) || 0
    const net = Number(cells.netAmount) || 0
    cells.guestsPerOrder = orders ? Math.round((guests / orders) * 100) / 100 : 0
    cells.averageCheck = orders ? Math.round(net / orders) : 0
    cells.perGuest = guests ? Math.round(net / guests) : 0
  }
  for (const row of result.rows) derive(row.cells)
  result.rows.sort((a, b) => (byRestaurant ? Number(b.cells.netAmount) - Number(a.cells.netAmount) : a.key.localeCompare(b.key)))
  const totals: Record<string, number | string> = { ...result.totals }
  derive(totals)
  const orders = result.totals.orderCount ?? 0
  const guests = result.totals.guestCount ?? 0
  return { sourceLabel: "Заказы и гости кассы (предагрегат за день)", columns, rows: result.rows, totals: totals as Record<string, number>, kpis: [{ key: "orders", label: "Заказов", value: orders, unit: "count" }, { key: "guests", label: "Гостей", value: guests, unit: "count" }, { key: "guestsPerOrder", label: "Гостей на заказ", value: Number(totals.guestsPerOrder), unit: "count" }], truncated }
}

/**
 * sales-26: average service time — check open → payment (`serviceMinutesTotal` of the facts) and, from
 * the KDS, kitchen send → ready and cooking start → ready of the tickets, by business day.
 */
const serviceTime: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated: factsTruncated } = await facts(ctx, "branch", config, restaurants)
  type Day = { orders: number; minutes: number; tickets: number; kitchenMinutes: number; cooked: number; cookMinutes: number }
  const days = new Map<string, Day>()
  const day = (date: string) => days.get(date) ?? days.set(date, { orders: 0, minutes: 0, tickets: 0, kitchenMinutes: 0, cooked: 0, cookMinutes: 0 }).get(date)!
  for (const fact of rows) {
    const row = day(fact.businessDate)
    row.orders += fact.orderCount
    row.minutes += fact.serviceMinutesTotal
  }
  let scanned = 0
  let truncated = factsTruncated
  const businessDates = new Map<Id<"orders">, string | undefined>()
  // A business day ends up to 12 h after midnight (restaurant cutoff), so the ticket range runs 12 h past the period.
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo) + 12 * 3_600_000
  for (const restaurant of await restaurantDocs(ctx, restaurants)) {
    for (const status of ["ready", "completed"] as const) {
      for await (const ticket of ctx.db.query("kitchenTickets").withIndex("by_restaurant_status_created", (q) => q.eq("restaurantId", restaurant._id).eq("status", status).gte("createdAt", from).lte("createdAt", to))) {
        if ((scanned += 1) > SCAN_BUDGET) {
          truncated = true
          break
        }
        if (!ticket.readyAt) continue
        if (!businessDates.has(ticket.orderId)) businessDates.set(ticket.orderId, (await ctx.db.get(ticket.orderId))?.businessDate)
        const date = businessDates.get(ticket.orderId) ?? localDate(ticket.createdAt)
        if (date < config.dateFrom || date > config.dateTo) continue
        const row = day(date)
        row.tickets += 1
        row.kitchenMinutes += Math.max(0, ticket.readyAt - ticket.createdAt) / 60_000
        if (ticket.startedAt) {
          row.cooked += 1
          row.cookMinutes += Math.max(0, ticket.readyAt - ticket.startedAt) / 60_000
        }
      }
    }
  }
  const columns = [col("group", "Дата", "date"), col("orderCount", "Заказов", "count"), col("serviceMinutes", "Обслуживание: открытие → оплата", "minutes"), col("tickets", "Тикетов КДС", "count"), col("kitchenMinutes", "Кухня: отправка → готово", "minutes"), col("cookMinutes", "Приготовление: начало → готово", "minutes")]
  const cellsOf = (row: Day): Cells => ({ orderCount: row.orders, serviceMinutes: row.orders ? round1(row.minutes / row.orders) : 0, tickets: row.tickets, kitchenMinutes: row.tickets ? round1(row.kitchenMinutes / row.tickets) : 0, cookMinutes: row.cooked ? round1(row.cookMinutes / row.cooked) : 0 })
  const all = [...days.values()].reduce<Day>((sum, row) => ({ orders: sum.orders + row.orders, minutes: sum.minutes + row.minutes, tickets: sum.tickets + row.tickets, kitchenMinutes: sum.kitchenMinutes + row.kitchenMinutes, cooked: sum.cooked + row.cooked, cookMinutes: sum.cookMinutes + row.cookMinutes }), { orders: 0, minutes: 0, tickets: 0, kitchenMinutes: 0, cooked: 0, cookMinutes: 0 })
  const totals = cellsOf(all) as Record<string, number>
  const out = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({ key: date, cells: { group: date, ...cellsOf(row) } }))
  return { sourceLabel: "Время чеков (предагрегат) и таймеры тикетов КДС", columns, rows: out, totals, kpis: [{ key: "service", label: "Среднее время обслуживания", value: totals.serviceMinutes, unit: "minutes" }, { key: "kitchen", label: "Среднее время кухни", value: totals.kitchenMinutes, unit: "minutes" }], truncated }
}

// ── W1-RPT-06 leftovers: the OLAP constructor, checks and refunds by check ─────────────────────

const OLAP_DIMENSIONS = ["day", "week", "month", "hour", "restaurant", "terminal", "table", "employee", "category", "product", "payment-type", "order-type"] as const
type OlapDimension = (typeof OLAP_DIMENSIONS)[number]
const OLAP_LABEL: Record<OlapDimension, string> = { day: "День", week: "Неделя", month: "Месяц", hour: "Час", restaurant: "Ресторан", terminal: "Касса", table: "Стол", employee: "Официант", category: "Категория", product: "Блюдо", "payment-type": "Тип оплаты", "order-type": "Тип заказа" }
/** The fact type each sales grouping is stored under; day / week / month / restaurant are on every fact. */
const OLAP_FACT: Partial<Record<OlapDimension, FactType>> = { hour: "hour", terminal: "terminal", table: "table", employee: "employee", category: "category", product: "product", "payment-type": "payment-type", "order-type": "order-type" }
const TIME_LIKE = new Set<OlapDimension>(["day", "week", "month", "hour"])
const UNAVAILABLE = "Такая комбинация пока недоступна"

/** Monday of the ISO week of a business date. */
function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}
const ruDate = (date: string) => date.split("-").reverse().join(".")

/**
 * sales-olap: a pivot over the daily sales facts — `groupBy` (day by default) and an optional
 * `secondaryGroupBy` of the twelve groupings, `measure` amount (net revenue, default) | count (orders) |
 * average (average check). A fact keeps one sales dimension (product, employee, hour…) next to the date
 * and the restaurant, so two sales dimensions at once (product × employee) are refused with a hint
 * instead of a made-up number.
 */
const salesOlap: Calculator = async (ctx, config, restaurants) => {
  const pick = (value: string | undefined) => {
    if (value === undefined) return undefined
    if (!(OLAP_DIMENSIONS as readonly string[]).includes(value)) throw new ConvexError(`${UNAVAILABLE}: группировки «${value}» в продажах нет. Доступны: ${OLAP_DIMENSIONS.map((dimension) => OLAP_LABEL[dimension].toLocaleLowerCase("ru")).join(", ")}`)
    return value as OlapDimension
  }
  const primary = pick(config.groupBy) ?? "day"
  const secondary = pick(config.secondaryGroupBy)
  const dimensions = secondary && secondary !== primary ? [primary, secondary] : [primary]
  const salesDimensions = dimensions.filter((dimension) => OLAP_FACT[dimension])
  if (salesDimensions.length > 1) throw new ConvexError(`${UNAVAILABLE}: «${OLAP_LABEL[salesDimensions[0]]}» × «${OLAP_LABEL[salesDimensions[1]]}» в дневных итогах не хранится. Сочетайте один разрез продаж с днём, неделей, месяцем или рестораном`)
  const factType: FactType = salesDimensions.length ? OLAP_FACT[salesDimensions[0]]! : "branch"
  const measure = config.measure ?? "amount"
  const { rows, truncated } = await facts(ctx, factType, config, restaurants)
  const names = await restaurantNames(ctx, restaurants)
  const matches = matcher(config)
  const value = (dimension: OlapDimension, fact: Doc<"dailySalesFacts">) => {
    switch (dimension) {
      case "day":
        return { key: fact.businessDate, label: fact.businessDate }
      case "week": {
        const monday = weekStart(fact.businessDate)
        const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
        return { key: monday, label: `${ruDate(monday)} – ${ruDate(sunday)}` }
      }
      case "month":
        return { key: fact.businessDate.slice(0, 7), label: fact.businessDate.slice(0, 7) }
      case "restaurant":
        return { key: fact.restaurantExternalId, label: names.get(fact.restaurantExternalId) ?? fact.restaurantExternalId }
      default:
        return { key: fact.dimensionKey, label: fact.dimensionLabel }
    }
  }
  const groups = new Map<string, { keys: string[]; labels: string[]; orders: number; net: number }>()
  for (const fact of rows) {
    const values = dimensions.map((dimension) => value(dimension, fact))
    if (!matches(...values.map((item) => item.label))) continue
    const key = values.map((item) => item.key).join("|")
    const group = groups.get(key) ?? { keys: values.map((item) => item.key), labels: values.map((item) => item.label), orders: 0, net: 0 }
    group.orders += fact.orderCount
    group.net += fact.netAmount
    groups.set(key, group)
  }
  const countLabel = factType === "payment-type" ? "Оплат" : factType === "product" || factType === "category" ? "Чеков с позицией" : "Заказов"
  const average = (net: number, orders: number) => (orders ? Math.round(net / orders) : 0)
  const valueOf = (group: { orders: number; net: number }) => (measure === "count" ? group.orders : measure === "average" ? average(group.net, group.orders) : group.net)
  // Time groupings in order; otherwise the first grouping by name when there are two, then by the measure.
  const out = [...groups.entries()]
    .sort(([, a], [, b]) => (TIME_LIKE.has(primary) ? a.keys[0].localeCompare(b.keys[0]) : dimensions.length > 1 ? a.labels[0].localeCompare(b.labels[0], "ru") : 0) || valueOf(b) - valueOf(a))
    .map(([key, group]) => {
      const cells: Cells = { group: group.labels[0] }
      if (dimensions.length > 1) cells.secondary = group.labels[1]
      cells.value = valueOf(group)
      if (measure === "average") Object.assign(cells, { orderCount: group.orders, netAmount: group.net })
      return { key, cells }
    })
  const orders = [...groups.values()].reduce((sum, group) => sum + group.orders, 0)
  const net = [...groups.values()].reduce((sum, group) => sum + group.net, 0)
  const measureLabel = measure === "count" ? countLabel : measure === "average" ? "Средний чек" : "Выручка"
  const unitOf = (dimension: OlapDimension): ReportColumn["unit"] => (dimension === "day" ? "date" : "text")
  const columns = [
    col("group", OLAP_LABEL[primary], unitOf(primary)),
    ...(dimensions.length > 1 ? [col("secondary", OLAP_LABEL[dimensions[1]], unitOf(dimensions[1]))] : []),
    col("value", measureLabel, measure === "count" ? "count" : "money"),
    ...(measure === "average" ? [col("orderCount", countLabel, "count"), col("netAmount", "Выручка", "money")] : []),
  ]
  const totals: Record<string, number> = measure === "average" ? { value: average(net, orders), orderCount: orders, netAmount: net } : { value: measure === "count" ? orders : net }
  return {
    sourceLabel: `Продажи кассы (предагрегат за день): ${dimensions.map((dimension) => OLAP_LABEL[dimension].toLocaleLowerCase("ru")).join(" × ")}, ${measureLabel.toLocaleLowerCase("ru")}`,
    columns,
    rows: out,
    totals,
    kpis: [
      { key: "net", label: "Выручка", value: net, unit: "money" },
      { key: "orders", label: countLabel, value: orders, unit: "count" },
      { key: "average", label: "Средний чек", value: average(net, orders), unit: "money" },
    ],
    truncated,
  }
}

const ORDER_STATUS: Record<Doc<"orders">["status"], string> = { draft: "Открыт", held: "Отложен", paid: "Оплачен", cancelled: "Отменён", partially_refunded: "Частичный возврат", refunded: "Возвращён" }
const CHECKS_PAGE = 200
const pageOf = (config: ReportConfig) => (typeof config.extra?.page === "number" && Number.isInteger(config.extra.page) && config.extra.page > 0 ? config.extra.page : 1)

/** Display names of employees by id, memoized. */
function employeeNames(ctx: Parameters<Calculator>[0]) {
  const cache = new Map<Id<"employees">, string>()
  return async (id: Id<"employees"> | undefined) => {
    if (!id) return "—"
    if (!cache.has(id)) cache.set(id, (await ctx.db.get(id))?.displayName ?? "Сотрудник")
    return cache.get(id)!
  }
}

/**
 * sales-10: the checks of the period — not a pre-aggregate: the orders of each restaurant over
 * orders.by_restaurant_business_date, oldest first, 200 per page (`extra.page`, from 1; `extra.status`
 * narrows to one status). Lines and the waiter are read only for the page shown; the KPIs count every
 * check found.
 */
const checks: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Чек", "text"), col("date", "Дата", "date"), col("time", "Время", "text"), col("restaurant", "Ресторан", "text"), col("table", "Стол", "text"), col("waiter", "Официант", "text"), col("lines", "Позиций", "count"), col("total", "Сумма", "money"), col("status", "Статус", "text")]
  const matches = matcher(config)
  const onlyStatus = typeof config.extra?.status === "string" ? config.extra.status : undefined
  const found: { order: Doc<"orders">; restaurant: string }[] = []
  let scanned = 0
  let truncated = false
  for (const restaurant of await restaurantDocs(ctx, restaurants)) {
    for await (const order of ctx.db.query("orders").withIndex("by_restaurant_business_date", (q) => q.eq("restaurantId", restaurant._id).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if ((scanned += 1) > SCAN_BUDGET) {
        truncated = true
        break
      }
      if (onlyStatus && order.status !== onlyStatus) continue
      if (!matches(String(order.number), order.tableLabel ?? "", ORDER_STATUS[order.status])) continue
      found.push({ order, restaurant: restaurant.name })
    }
  }
  found.sort((a, b) => a.order.createdAt - b.order.createdAt)
  const pages = Math.max(1, Math.ceil(found.length / CHECKS_PAGE))
  const page = Math.min(pageOf(config), pages)
  const waiter = employeeNames(ctx)
  const rows = []
  for (const { order, restaurant } of found.slice((page - 1) * CHECKS_PAGE, page * CHECKS_PAGE)) {
    const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
    const positions = lines.filter((line) => !line.voidedAt).reduce((sum, line) => sum + line.quantity, 0)
    rows.push({ key: String(order._id), cells: { group: `№${order.number}`, date: order.businessDate ?? localDate(order.createdAt), time: localDateTime(order.createdAt).slice(11), restaurant, table: order.tableLabel ?? "—", waiter: await waiter(order.createdBy), lines: positions, total: order.total, status: ORDER_STATUS[order.status] } })
  }
  const sold = found.filter(({ order }) => SOLD.includes(order.status))
  const soldTotal = sold.reduce((sum, { order }) => sum + order.total, 0)
  return {
    sourceLabel: pages > 1 ? `Чеки кассы за период: страница ${page} из ${pages} (по ${CHECKS_PAGE} чеков)` : "Чеки кассы за период",
    columns,
    rows,
    totals: { lines: rows.reduce((sum, row) => sum + row.cells.lines, 0), total: rows.reduce((sum, row) => sum + row.cells.total, 0) },
    kpis: [
      { key: "checks", label: "Чеков", value: found.length, unit: "count" },
      { key: "sold", label: "Оплачено чеков", value: sold.length, unit: "count" },
      { key: "soldTotal", label: "Сумма оплаченных", value: soldTotal, unit: "money" },
      { key: "average", label: "Средний чек", value: sold.length ? Math.round(soldTotal / sold.length) : 0, unit: "money" },
      { key: "cancelled", label: "Отменено", value: found.filter(({ order }) => order.status === "cancelled").length, unit: "count" },
    ],
    truncated: truncated || pages > 1,
  }
}

const METHOD_LABEL: Record<Doc<"payments">["method"], string> = { cash: "Наличные", card: "Карта", qr: "QR" }

/**
 * sales-20: refunds by check — the refund payments of the period over payments.by_restaurant_created;
 * payments recorded before they carried a restaurant (restaurantId empty, before M-2) are placed by
 * their shift. The reason is the one of the shift event written with the refund.
 */
const refundsByCheck: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Когда", "text"), col("check", "Чек", "text"), col("restaurant", "Ресторан", "text"), col("terminal", "Касса", "text"), col("paymentType", "Тип оплаты", "text"), col("amount", "Сумма возврата", "money"), col("kind", "Возврат", "text"), col("reason", "Причина", "text"), col("cashier", "Кассир", "text")]
  const matches = matcher(config)
  const docs = await restaurantDocs(ctx, restaurants)
  const byId = new Map(docs.map((row) => [row._id, row]))
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  const shifts = new Map<Id<"shifts">, Doc<"shifts"> | null>()
  const shiftOf = async (id: Id<"shifts">) => {
    if (!shifts.has(id)) shifts.set(id, await ctx.db.get(id))
    return shifts.get(id) ?? null
  }
  const refunds: { payment: Doc<"payments">; restaurant: Doc<"restaurants"> }[] = []
  let scanned = 0
  let truncated = false
  for (const restaurantId of [...docs.map((row) => row._id), undefined]) {
    for await (const payment of ctx.db.query("payments").withIndex("by_restaurant_created", (q) => q.eq("restaurantId", restaurantId).gte("createdAt", from).lte("createdAt", to))) {
      if ((scanned += 1) > SCAN_BUDGET) {
        truncated = true
        break
      }
      if (payment.type !== "refund") continue
      const shiftRestaurant = restaurantId ? undefined : (await shiftOf(payment.shiftId))?.restaurantId
      const restaurant = byId.get(restaurantId ?? shiftRestaurant!)
      if (restaurant) refunds.push({ payment, restaurant })
    }
  }
  const cashier = employeeNames(ctx)
  const terminals = new Map<Id<"posTerminals">, string>()
  const checksWithRefund = new Set<string>()
  const rows = []
  for (const { payment, restaurant } of refunds.sort((a, b) => a.payment.createdAt - b.payment.createdAt)) {
    const order = await ctx.db.get(payment.orderId)
    const shift = await shiftOf(payment.shiftId)
    if (shift && !terminals.has(shift.terminalId)) terminals.set(shift.terminalId, (await ctx.db.get(shift.terminalId))?.name ?? "Касса")
    const events = await ctx.db.query("shiftEvents").withIndex("by_shift_created", (q) => q.eq("shiftId", payment.shiftId).eq("createdAt", payment.createdAt)).take(10)
    const event = events.find((row) => row.type === "refund" && row.orderId === payment.orderId)
    const reason = event ? event.reason.replace(/ · заказ №\d+$/, "") : "—"
    const check = order ? `№${order.number}` : "—"
    const name = await cashier(payment.createdBy)
    const paymentType = payment.paymentTypeName ?? METHOD_LABEL[payment.method]
    if (!matches(check, reason, name, paymentType)) continue
    checksWithRefund.add(String(payment.orderId))
    rows.push({ key: String(payment._id), cells: { group: localDateTime(payment.createdAt), check, restaurant: restaurant.name, terminal: shift ? terminals.get(shift.terminalId)! : "—", paymentType, amount: payment.amount, kind: order?.status === "refunded" ? "Полный" : "Частичный", reason, cashier: name } })
  }
  const amount = rows.reduce((sum, row) => sum + row.cells.amount, 0)
  return {
    sourceLabel: "Возвратные оплаты кассы за период",
    columns,
    rows,
    totals: { amount },
    kpis: [
      { key: "amount", label: "Возвращено", value: amount, unit: "money" },
      { key: "refunds", label: "Возвратов", value: rows.length, unit: "count" },
      { key: "checks", label: "Чеков с возвратом", value: checksWithRefund.size, unit: "count" },
    ],
    truncated,
  }
}

export const SALES_CALCULATORS: Record<string, Calculator> = {
  "sales-olap": salesOlap,
  "sales-10": checks,
  "sales-20": refundsByCheck,
  "sales-03": stationsByDay,
  "sales-05": dishesByTerminal,
  "sales-08": factReport({ factType: "table", dimensionLabel: "Стол", measures: [count("orderCount", "Заказов"), count("guestCount", "Гостей"), money("netAmount", "Выручка")], average: true, sortBy: "netAmount" }),
  "sales-09": cashBalance,
  "sales-15": byConcept,
  "sales-16": byRestaurant,
  "sales-17": byChannel,
  "sales-18": byQuarterHour,
  "sales-24": withoutRevenue,
  "sales-25": ordersAndGuests,
  "sales-26": serviceTime,
}
