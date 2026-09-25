import type { Id } from "../../../_generated/dataModel"
import { calculateCashReconciliation } from "../../../lib/money"
import type { ReportColumn, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { count, factReport, facts, matcher, money, percentOf, restaurantDocs, round1, sumFacts } from "./_facts"
import { aggregate, col, dayEnd, dayStart, localDate, SCAN_BUDGET } from "./_shared"

// Sales reports of W2 (docs/IMPLEMENTATION-PLAN.md W2-RPT-03). A report is listed here only with a test
// (tests/convex/reportsSales.test.ts). Totals over the facts reconcile with sales-01.

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

export const SALES_CALCULATORS: Record<string, Calculator> = {
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
