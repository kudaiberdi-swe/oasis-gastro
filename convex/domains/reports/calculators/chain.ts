import type { Doc } from "../../../_generated/dataModel"
import type { ReportConfig, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { aggregate, col, dayEnd, dayStart, localDate } from "./_shared"
import { coversNetwork, localDateTime, restaurantNames, scopeOf, statusResult } from "./_scope"
import { balanceAt, newBudget, percent, spend, stockPairs, type Budget } from "./stockHelpers"

// Chain reports of W3 (docs/IMPLEMENTATION-PLAN.md W3-RPT-05). Sales come from the POS pre-aggregate
// (dailySalesFacts) and, side by side, from the read-only iiko projection of W2-RTL-01 (`iikoOrders`) —
// every column says its source, the two are never summed into one figure. P&L from the journal, stock
// from the movement chain, locks, outbox, audit and the iiko mirror as they are.

type QueryCtx = Parameters<Calculator>[0]
type Result = Omit<ReportResult, "reportId" | "generatedAt">
type Totals = { orders: number; guests: number; revenue: number; cost: number }

const ROW_LIMIT = 2000
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const shiftYear = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`
const periodDays = (config: Pick<ReportConfig, "dateFrom" | "dateTo">) => Math.round((Date.parse(`${config.dateTo}T00:00:00Z`) - Date.parse(`${config.dateFrom}T00:00:00Z`)) / 86_400_000) + 1
const zero = (): Totals => ({ orders: 0, guests: 0, revenue: 0, cost: 0 })

/** POS totals of a restaurant by business date (revenue net of refunds). */
async function posByDate(ctx: QueryCtx, restaurant: string, from: string, to: string, budget: Budget) {
  const byDate = new Map<string, Totals>()
  for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "branch").gte("businessDate", from).lte("businessDate", to))) {
    if (!spend(budget)) break
    const row = byDate.get(fact.businessDate) ?? zero()
    row.orders += fact.orderCount
    row.guests += fact.guestCount
    row.revenue += fact.netAmount - fact.refundAmount
    row.cost += fact.costAmount
    byDate.set(fact.businessDate, row)
  }
  return byDate
}

/** iiko orders of a restaurant by business date (read-only projection, no cost). */
async function iikoByDate(ctx: QueryCtx, restaurant: string, from: string, to: string, budget: Budget) {
  const byDate = new Map<string, Totals>()
  // openedAt is a day wider on both sides: the business date (by the iiko cutoff) is the filter.
  for await (const order of ctx.db.query("iikoOrders").withIndex("by_restaurant_opened", (q) => q.eq("restaurantExternalId", restaurant).gte("openedAt", dayStart(from) - 86_400_000).lte("openedAt", dayEnd(to) + 86_400_000))) {
    if (!spend(budget)) break
    if (order.businessDate < from || order.businessDate > to) continue
    const row = byDate.get(order.businessDate) ?? zero()
    row.orders += 1
    row.guests += order.guestCount
    row.revenue += order.total
    byDate.set(order.businessDate, row)
  }
  return byDate
}

const sumTotals = (byDate: Map<string, Totals>) => [...byDate.values()].reduce((sum, row) => ({ orders: sum.orders + row.orders, guests: sum.guests + row.guests, revenue: sum.revenue + row.revenue, cost: sum.cost + row.cost }), zero())
const averageCheck = (totals: Totals) => (totals.orders ? Math.round(totals.revenue / totals.orders) : 0)
const SOURCE_LABEL = "Касса Sandyq (предагрегат за день) и iiko (только чтение, заказы W2-RTL-01) — отдельными колонками"

// ── 01: comparison of restaurants ──────────────────────────────────────────────

const comparison: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Ресторан", "text"), col("orders", "Чеков", "count"), col("guests", "Гостей", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("cost", "Себестоимость", "money"), col("foodCost", "Фудкост, %", "percent"), col("share", "Доля выручки, %", "percent"), col("iikoOrders", "Чеков iiko", "count"), col("iikoRevenue", "Выручка iiko", "money")]
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const rows = []
  const totals = { orders: 0, guests: 0, revenue: 0, cost: 0, iikoOrders: 0, iikoRevenue: 0 }
  for (const restaurant of restaurants) {
    const pos = sumTotals(await posByDate(ctx, restaurant, config.dateFrom, config.dateTo, budget))
    const iiko = sumTotals(await iikoByDate(ctx, restaurant, config.dateFrom, config.dateTo, budget))
    if (!pos.orders && !iiko.orders) continue
    totals.orders += pos.orders
    totals.guests += pos.guests
    totals.revenue += pos.revenue
    totals.cost += pos.cost
    totals.iikoOrders += iiko.orders
    totals.iikoRevenue += iiko.revenue
    rows.push({ key: restaurant, cells: { group: names.get(restaurant) ?? restaurant, orders: pos.orders, guests: pos.guests, revenue: pos.revenue, averageCheck: averageCheck(pos), cost: pos.cost, foodCost: percent(pos.cost, pos.revenue), share: 0, iikoOrders: iiko.orders, iikoRevenue: iiko.revenue } })
  }
  for (const row of rows) row.cells.share = percent(Number(row.cells.revenue), totals.revenue)
  rows.sort((a, b) => Number(b.cells.revenue) - Number(a.cells.revenue))
  return {
    sourceLabel: SOURCE_LABEL,
    columns,
    rows,
    totals,
    kpis: [
      { key: "revenue", label: "Выручка кассы", value: totals.revenue, unit: "money" },
      { key: "averageCheck", label: "Средний чек", value: averageCheck({ ...zero(), orders: totals.orders, revenue: totals.revenue }), unit: "money" },
      { key: "foodCost", label: "Фудкост", value: percent(totals.cost, totals.revenue), unit: "percent" },
      { key: "iikoRevenue", label: "Выручка iiko", value: totals.iikoRevenue, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── 02: consolidated sales ─────────────────────────────────────────────────────

const consolidatedSales: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Дата", "date"), col("restaurants", "Ресторанов с продажами", "count"), col("orders", "Чеков", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("iikoOrders", "Чеков iiko", "count"), col("iikoRevenue", "Выручка iiko", "money")]
  const budget = newBudget()
  const rows = []
  for (const restaurant of restaurants) {
    for (const [date, pos] of await posByDate(ctx, restaurant, config.dateFrom, config.dateTo, budget)) rows.push({ key: date, label: date, values: { restaurants: 1, orders: pos.orders, revenue: pos.revenue } })
    for (const [date, iiko] of await iikoByDate(ctx, restaurant, config.dateFrom, config.dateTo, budget)) rows.push({ key: date, label: date, values: { iikoOrders: iiko.orders, iikoRevenue: iiko.revenue } })
  }
  const result = aggregate(rows, columns)
  result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
  for (const row of result.rows) row.cells.averageCheck = Number(row.cells.orders) ? Math.round(Number(row.cells.revenue) / Number(row.cells.orders)) : 0
  delete result.totals.restaurants
  delete result.totals.averageCheck
  const t = result.totals
  return {
    sourceLabel: SOURCE_LABEL,
    columns,
    ...result,
    kpis: [
      { key: "revenue", label: "Выручка кассы", value: t.revenue ?? 0, unit: "money" },
      { key: "orders", label: "Чеков кассы", value: t.orders ?? 0, unit: "count" },
      { key: "iikoRevenue", label: "Выручка iiko", value: t.iikoRevenue ?? 0, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── 03: consolidated P&L ──────────────────────────────────────────────────────

const COGS_CODE = "7010"
const PNL_LINES = [
  { key: "income", label: "Выручка" },
  { key: "returns", label: "Возвраты и скидки" },
  { key: "net", label: "Чистая выручка" },
  { key: "cogs", label: "Себестоимость" },
  { key: "gross", label: "Валовая прибыль" },
  { key: "expenses", label: "Расходы" },
  { key: "result", label: "Финансовый результат" },
] as const

const consolidatedPnl: Calculator = async (ctx, config, restaurants) => {
  const accounts = new Map((await ctx.db.query("accounts").withIndex("by_code").take(200)).map((account) => [account.externalId, account]))
  const names = await restaurantNames(ctx, restaurants)
  const budget = newBudget()
  const perRestaurant = new Map<string, { income: number; returns: number; cogs: number; expenses: number }>()
  for (const restaurant of restaurants) {
    const sums = { income: 0, returns: 0, cogs: 0, expenses: 0 }
    for await (const entry of ctx.db.query("journalEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      for (const [externalId, sign] of [[entry.creditAccountExternalId, 1], [entry.debitAccountExternalId, -1]] as const) {
        const account = accounts.get(externalId)
        if (!account) continue
        // Income grows on the credit side, expenses and returns on the debit side (as finance-02).
        if (account.type === "income") sums.income += sign * entry.amount
        else if (account.type === "contra-income") sums.returns -= sign * entry.amount
        else if (account.type === "expense" && account.code === COGS_CODE) sums.cogs -= sign * entry.amount
        else if (account.type === "expense") sums.expenses -= sign * entry.amount
      }
    }
    perRestaurant.set(restaurant, sums)
  }
  const lineValue = (sums: { income: number; returns: number; cogs: number; expenses: number }, key: (typeof PNL_LINES)[number]["key"]) => {
    const net = sums.income - sums.returns
    const values = { income: sums.income, returns: -sums.returns, net, cogs: -sums.cogs, gross: net - sums.cogs, expenses: -sums.expenses, result: net - sums.cogs - sums.expenses }
    return values[key]
  }
  const active = restaurants.filter((restaurant) => Object.values(perRestaurant.get(restaurant) ?? {}).some(Boolean))
  const columns = [col("group", "Статья", "text"), ...active.map((restaurant) => col(`r:${restaurant}`, names.get(restaurant) ?? restaurant, "money")), col("total", "Итого по сети", "money")]
  const all = { income: 0, returns: 0, cogs: 0, expenses: 0 }
  for (const sums of perRestaurant.values()) for (const key of Object.keys(all) as (keyof typeof all)[]) all[key] += sums[key]
  const rows = PNL_LINES.map((line) => ({ key: line.key, cells: { group: line.label, ...Object.fromEntries(active.map((restaurant) => [`r:${restaurant}`, lineValue(perRestaurant.get(restaurant)!, line.key)])), total: lineValue(all, line.key) } }))
  return {
    sourceLabel: "Журнал проводок по ресторанам (как «Прибыли и убытки»), колонка на ресторан",
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "net", label: "Чистая выручка сети", value: lineValue(all, "net"), unit: "money" },
      { key: "gross", label: "Валовая прибыль", value: lineValue(all, "gross"), unit: "money" },
      { key: "result", label: "Финансовый результат", value: lineValue(all, "result"), unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── 04: like-for-like ─────────────────────────────────────────────────────────

type Source = "pos" | "iiko"
const sourceOf = (config: ReportConfig): Source => (config.extra?.source === "iiko" ? "iiko" : "pos")

/** The first business date a restaurant has sales in the source (its opening for LFL). */
async function firstSaleDate(ctx: QueryCtx, restaurant: string, source: Source) {
  if (source === "pos") return (await ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "branch")).first())?.businessDate
  return (await ctx.db.query("iikoOrders").withIndex("by_restaurant_opened", (q) => q.eq("restaurantExternalId", restaurant)).first())?.businessDate
}

const totalsOf = async (ctx: QueryCtx, source: Source, restaurant: string, from: string, to: string, budget: Budget) => sumTotals(await (source === "pos" ? posByDate : iikoByDate)(ctx, restaurant, from, to, budget))

/**
 * chain-04: like-for-like — only the restaurants that had sales before the base period (the same dates a
 * year earlier) began, so a new restaurant never inflates the growth. `extra.source`: pos (default) | iiko.
 */
const likeForLike: Calculator = async (ctx, config, restaurants) => {
  const source = sourceOf(config)
  const base = { dateFrom: shiftYear(config.dateFrom, -1), dateTo: shiftYear(config.dateTo, -1) }
  const columns = [col("group", "Ресторан", "text"), col("baseRevenue", `Выручка ${base.dateFrom} — ${base.dateTo}`, "money"), col("revenue", "Выручка за период", "money"), col("growth", "Рост выручки, %", "percent"), col("baseOrders", "Чеков в базе", "count"), col("orders", "Чеков за период", "count"), col("ordersGrowth", "Рост чеков, %", "percent")]
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const rows = []
  const excluded: string[] = []
  const totals = { baseRevenue: 0, revenue: 0, baseOrders: 0, orders: 0 }
  for (const restaurant of restaurants) {
    const opened = await firstSaleDate(ctx, restaurant, source)
    if (!opened || opened >= base.dateFrom) {
      excluded.push(names.get(restaurant) ?? restaurant)
      continue
    }
    const before = await totalsOf(ctx, source, restaurant, base.dateFrom, base.dateTo, budget)
    const now = await totalsOf(ctx, source, restaurant, config.dateFrom, config.dateTo, budget)
    totals.baseRevenue += before.revenue
    totals.revenue += now.revenue
    totals.baseOrders += before.orders
    totals.orders += now.orders
    rows.push({ key: restaurant, cells: { group: names.get(restaurant) ?? restaurant, baseRevenue: before.revenue, revenue: now.revenue, growth: before.revenue ? percent(now.revenue - before.revenue, before.revenue) : 0, baseOrders: before.orders, orders: now.orders, ordersGrowth: before.orders ? percent(now.orders - before.orders, before.orders) : 0 } })
  }
  rows.sort((a, b) => Number(b.cells.revenue) - Number(a.cells.revenue))
  const label = source === "iiko" ? "заказы iiko (только чтение)" : "касса Sandyq (предагрегат)"
  return {
    sourceLabel: `Сопоставимые рестораны год к году, ${label}${excluded.length ? `; не сопоставимы (открылись позже начала базы): ${excluded.join(", ")}` : ""}`,
    columns,
    rows,
    totals,
    kpis: [
      { key: "growth", label: "Рост LFL", value: totals.baseRevenue ? percent(totals.revenue - totals.baseRevenue, totals.baseRevenue) : 0, unit: "percent" },
      { key: "restaurants", label: "Сопоставимых ресторанов", value: rows.length, unit: "count" },
      { key: "excluded", label: "Исключено", value: excluded.length, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── 05: rating ────────────────────────────────────────────────────────────────

/** Ranks 1…n (1 = best); equal values share the rank. */
function ranks(values: number[], better: "high" | "low") {
  const sorted = [...values].sort((a, b) => (better === "high" ? b - a : a - b))
  return values.map((value) => sorted.indexOf(value) + 1)
}

const rating: Calculator = async (ctx, config, restaurants) => {
  const days = periodDays(config)
  const previous = { dateFrom: shiftDate(config.dateFrom, -days), dateTo: shiftDate(config.dateFrom, -1) }
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const data = []
  for (const restaurant of restaurants) {
    const now = sumTotals(await posByDate(ctx, restaurant, config.dateFrom, config.dateTo, budget))
    if (!now.orders) continue
    const before = sumTotals(await posByDate(ctx, restaurant, previous.dateFrom, previous.dateTo, budget))
    data.push({ restaurant, now, growth: before.revenue ? percent(now.revenue - before.revenue, before.revenue) : 0, foodCost: percent(now.cost, now.revenue) })
  }
  const revenueRank = ranks(data.map((row) => row.now.revenue), "high")
  const checkRank = ranks(data.map((row) => averageCheck(row.now)), "high")
  const ordersRank = ranks(data.map((row) => row.now.orders), "high")
  const foodCostRank = ranks(data.map((row) => row.foodCost), "low")
  const growthRank = ranks(data.map((row) => row.growth), "high")
  const scores = data.map((_, index) => (revenueRank[index] + checkRank[index] + ordersRank[index] + foodCostRank[index] + growthRank[index]) / 5)
  const overall = ranks(scores, "low")
  const columns = [col("place", "Место", "count"), col("group", "Ресторан", "text"), col("revenue", "Выручка", "money"), col("revenueRank", "Место", "count"), col("averageCheck", "Средний чек", "money"), col("checkRank", "Место", "count"), col("orders", "Чеков", "count"), col("ordersRank", "Место", "count"), col("foodCost", "Фудкост, %", "percent"), col("foodCostRank", "Место", "count"), col("growth", "Рост к прошлому периоду, %", "percent"), col("growthRank", "Место", "count"), col("score", "Средний ранг", "count")]
  const rows = data
    .map((row, index) => ({ key: row.restaurant, cells: { place: overall[index], group: names.get(row.restaurant) ?? row.restaurant, revenue: row.now.revenue, revenueRank: revenueRank[index], averageCheck: averageCheck(row.now), checkRank: checkRank[index], orders: row.now.orders, ordersRank: ordersRank[index], foodCost: row.foodCost, foodCostRank: foodCostRank[index], growth: row.growth, growthRank: growthRank[index], score: Math.round(scores[index] * 10) / 10 } }))
    .sort((a, b) => a.cells.place - b.cells.place)
  return { sourceLabel: `Касса Sandyq (предагрегат); рост к ${previous.dateFrom} — ${previous.dateTo}; фудкост: чем ниже, тем выше место`, columns, rows, totals: {}, kpis: [{ key: "restaurants", label: "Ресторанов в рейтинге", value: rows.length, unit: "count" }], truncated: budget.truncated }
}

// ── 06: replication (outbox) ──────────────────────────────────────────────────

const OUTBOX_STATUS = ["pending", "published", "failed"] as const

const replication: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Событие", "text"), col("total", "Событий", "count"), col("pending", "Ожидают", "count"), col("published", "Переданы", "count"), col("failed", "Ошибка", "count"), col("delayMinutes", "Средняя задержка, мин", "minutes"), col("lastError", "Последняя ошибка", "text")]
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  const budget = newBudget()
  const groups = new Map<string, { total: number; pending: number; published: number; failed: number; delay: number; delayed: number; lastError: string }>()
  for (const status of OUTBOX_STATUS) {
    for await (const event of ctx.db.query("outboxEvents").withIndex("by_status_available", (q) => q.eq("status", status).gte("availableAt", dayStart(config.dateFrom)).lte("availableAt", dayEnd(config.dateTo)))) {
      if (!spend(budget)) break
      if (!inScope(event.restaurantExternalId)) continue
      const row = groups.get(event.eventType) ?? { total: 0, pending: 0, published: 0, failed: 0, delay: 0, delayed: 0, lastError: "" }
      row.total += 1
      row[status] += 1
      if (event.publishedAt) {
        row.delay += Math.max(0, event.publishedAt - event.createdAt)
        row.delayed += 1
      }
      if (event.error) row.lastError = event.error
      groups.set(event.eventType, row)
    }
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].total - a[1].total).map(([key, row]) => ({ key, cells: { group: key, total: row.total, pending: row.pending, published: row.published, failed: row.failed, delayMinutes: row.delayed ? Math.round(row.delay / row.delayed / 6_000) / 10 : 0, lastError: row.lastError || "—" } }))
  const sum = (key: "total" | "pending" | "published" | "failed") => [...groups.values()].reduce((total, row) => total + row[key], 0)
  return {
    sourceLabel: "Исходящие события (outbox) за период — очередь передачи во внешние системы",
    columns,
    rows,
    totals: { total: sum("total"), pending: sum("pending"), published: sum("published"), failed: sum("failed") },
    kpis: [
      { key: "total", label: "Событий", value: sum("total"), unit: "count" },
      { key: "pending", label: "Ожидают передачи", value: sum("pending"), unit: "count" },
      { key: "failed", label: "С ошибкой", value: sum("failed"), unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── 07: exchange errors ───────────────────────────────────────────────────────

const exchangeErrors: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Когда", "text"), col("source", "Обмен", "text"), col("operation", "Операция", "text"), col("attempts", "Попыток", "count"), col("status", "Статус", "text"), col("error", "Ошибка", "text")]
  const network = await coversNetwork(ctx, restaurants)
  if (!network) return statusResult("Ошибки обмена — сетевой отчёт: выберите все рестораны сети", columns)
  const budget = newBudget()
  const rows: Result["rows"] = []
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  let jobs = 0
  for await (const job of ctx.db.query("integrationJobs").withIndex("by_created", (q) => q.gte("createdAt", from).lte("createdAt", to))) {
    if (!spend(budget)) break
    if (job.status !== "failed" && job.status !== "dead-letter") continue
    jobs += 1
    rows.push({ key: job.externalId, cells: { group: localDateTime(job.updatedAt), source: job.provider, operation: job.operation, attempts: job.attempts, status: job.status === "dead-letter" ? "Не доставлено" : "Ошибка", error: job.error ?? "—" } })
  }
  let iiko = 0
  for await (const run of ctx.db.query("iikoImportRuns").withIndex("by_external_id")) {
    if (!spend(budget)) break
    if (run.status !== "failed" || run.startedAt < from || run.startedAt > to) continue
    iiko += 1
    rows.push({ key: run.runExternalId, cells: { group: localDateTime(run.startedAt), source: "iiko (чтение)", operation: "Импорт", attempts: 1, status: "Ошибка", error: run.error ?? "—" } })
  }
  for await (const state of ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key")) {
    if (!spend(budget)) break
    if (state.lastStatus !== "error" || state.lastRunAt < from || state.lastRunAt > to) continue
    iiko += 1
    rows.push({ key: `endpoint:${state.endpointKey}`, cells: { group: localDateTime(state.lastRunAt), source: "iiko (чтение)", operation: state.path ?? state.endpointKey, attempts: 1, status: "Ошибка", error: state.message ?? "—" } })
  }
  rows.sort((a, b) => String(b.cells.group).localeCompare(String(a.cells.group)))
  return {
    sourceLabel: "Очередь интеграций (ошибка и не доставлено) и чтение из iiko за период",
    columns,
    rows: rows.slice(0, ROW_LIMIT),
    totals: {},
    kpis: [
      { key: "jobs", label: "Ошибок очереди", value: jobs, unit: "count" },
      { key: "iiko", label: "Ошибок чтения iiko", value: iiko, unit: "count" },
    ],
    truncated: budget.truncated || rows.length > ROW_LIMIT,
  }
}

// ── 08: period locks ──────────────────────────────────────────────────────────

const periodLocks: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Где", "text"), col("module", "Раздел", "text"), col("kind", "Вид", "text"), col("lockedThrough", "Закрыто по", "date"), col("status", "Статус", "text"), col("reason", "Основание", "text"), col("createdBy", "Закрыл", "text"), col("createdAt", "Когда", "text")]
  const names = await restaurantNames(ctx, restaurants)
  const organizations = new Map<string, string>()
  const scopes: { organization: string; restaurant?: string }[] = []
  for (const restaurant of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurant)).unique()
    if (!row) continue
    scopes.push({ organization: row.organizationExternalId, restaurant })
    if (!organizations.has(row.organizationExternalId)) organizations.set(row.organizationExternalId, (await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", row.organizationExternalId)).unique())?.name ?? row.organizationExternalId)
  }
  // An organization-wide lock (no restaurant) covers every restaurant of the organization.
  for (const organization of organizations.keys()) scopes.push({ organization })
  const end = dayEnd(config.dateTo)
  const rows = []
  const latest = new Map<string, number>()
  for (const scope of scopes) {
    const locks = await ctx.db.query("periodLocks").withIndex("by_org_restaurant_active", (q) => q.eq("organizationExternalId", scope.organization).eq("restaurantExternalId", scope.restaurant)).take(200)
    for (const lock of locks) {
      if (lock.createdAt > end) continue
      const where = scope.restaurant ? (names.get(scope.restaurant) ?? scope.restaurant) : `${organizations.get(scope.organization)} · вся организация`
      const through = localDate(lock.lockedThrough)
      if (lock.active) latest.set(where, Math.max(latest.get(where) ?? 0, lock.lockedThrough))
      rows.push({ key: lock.externalId, cells: { group: where, module: lock.moduleId ?? "Все разделы", kind: lock.kind === "final" ? "Окончательная" : "Предварительная", lockedThrough: through, status: lock.active ? "Действует" : `Открыт заново${lock.reopenReason ? `: ${lock.reopenReason}` : ""}`, reason: lock.reason, createdBy: lock.createdBy, createdAt: localDateTime(lock.createdAt) } })
    }
  }
  rows.sort((a, b) => String(b.cells.lockedThrough).localeCompare(String(a.cells.lockedThrough)))
  const lastLock = Math.max(0, ...latest.values())
  return {
    sourceLabel: `Даты блокировки периодов (созданные по ${config.dateTo})`,
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "active", label: "Действующих блокировок", value: rows.filter((row) => row.cells.status === "Действует").length, unit: "count" },
      { key: "reopened", label: "Открыто заново", value: rows.filter((row) => row.cells.status !== "Действует").length, unit: "count" },
      ...(lastLock ? [{ key: "lockedThrough", label: `Закрыто по ${localDate(lastLock)}`, value: latest.size, unit: "count" as const }] : []),
    ],
    truncated: false,
  }
}

// ── 09: centralized menu changes ──────────────────────────────────────────────

const MENU_ACTIONS: Record<string, string> = {
  "price-order.create": "Приказ о ценах создан",
  "price-order.update": "Приказ о ценах изменён",
  "price-order.publish": "Приказ о ценах проведён",
  "price-order.cancel": "Приказ о ценах отменён",
  "price-list.publish": "Прайс-лист опубликован",
  "price-list.save": "Прайс-лист изменён",
  "catalog.price.set": "Цена изменена",
  "catalog.product.create": "Блюдо создано",
  "catalog.product.update": "Блюдо изменено",
  "catalog.category.create": "Категория создана",
  "catalog.category.update": "Категория изменена",
  "catalog.group.save": "Группа меню изменена",
  "catalog.stop-list": "Стоп-лист",
  "recipe.save": "Техкарта изменена",
  "recipe.activate": "Техкарта введена в действие",
  "modifier.save": "Модификатор изменён",
  "modifier-group.save": "Группа модификаторов изменена",
  "modifier.assign": "Модификатор назначен",
  "modifier.unassign": "Модификатор снят",
  "modifier.rules": "Правила модификаторов",
  "size-scale.update": "Шкала размеров изменена",
}

const menuChanges: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Когда", "text"), col("action", "Изменение", "text"), col("summary", "Описание", "text"), col("restaurant", "Где", "text"), col("actor", "Автор", "text")]
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  const names = await restaurantNames(ctx, restaurants)
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  const budget = newBudget()
  const rows = []
  const byAction = new Map<string, number>()
  for await (const event of ctx.db.query("auditEvents").withIndex("by_occurred_at", (q) => q.gte("occurredAt", dayStart(config.dateFrom)).lte("occurredAt", dayEnd(config.dateTo))).order("desc")) {
    if (!spend(budget)) break
    const action = MENU_ACTIONS[event.action]
    if (!action || !inScope(event.restaurantExternalId)) continue
    if (needle && ![event.summary, action].some((text) => text.toLocaleLowerCase("ru").includes(needle))) continue
    byAction.set(action, (byAction.get(action) ?? 0) + 1)
    if (rows.length < ROW_LIMIT) rows.push({ key: String(event._id), cells: { group: localDateTime(event.occurredAt), action, summary: event.summary, restaurant: event.restaurantExternalId ? (names.get(event.restaurantExternalId) ?? event.restaurantExternalId) : "Вся сеть", actor: event.actorKey } })
  }
  const count = (prefix: string) => [...byAction.entries()].filter(([label]) => label.startsWith(prefix)).reduce((sum, [, value]) => sum + value, 0)
  return {
    sourceLabel: "Журнал аудита: изменения каталога, цен, техкарт и модификаторов",
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "changes", label: "Изменений", value: [...byAction.values()].reduce((sum, value) => sum + value, 0), unit: "count" },
      { key: "prices", label: "Приказов о ценах", value: count("Приказ"), unit: "count" },
      { key: "recipes", label: "Изменений техкарт", value: count("Техкарта"), unit: "count" },
    ],
    truncated: budget.truncated || rows.length >= ROW_LIMIT,
  }
}

// ── 10: reference data state (iiko mirror vs local) ────────────────────────────

const CLASSIFICATION: Record<string, string> = { mirrored: "Зеркало", "blocked-one-way": "Только чтение, не импортируется", "query-template": "Запрос-шаблон", unsupported: "Не поддерживается" }
const ENDPOINT_STATUS: Record<string, string> = { ok: "Успешно", error: "Ошибка", unsupported: "Не поддерживается" }

async function countWhile<T>(rows: AsyncIterable<T>, budget: Budget, keep: (row: T) => boolean = () => true) {
  let count = 0
  for await (const row of rows) {
    if (!spend(budget)) break
    if (keep(row)) count += 1
  }
  return count
}

const referenceState: Calculator = async (ctx, _config, restaurants) => {
  const columns = [col("group", "Справочник", "text"), col("domain", "Раздел", "text"), col("mode", "Режим", "text"), col("status", "Последний синк", "text"), col("syncedAt", "Когда", "text"), col("iiko", "Записей iiko", "count"), col("local", "Локально", "count"), col("difference", "Расхождение", "count")]
  if (!(await coversNetwork(ctx, restaurants))) return statusResult("Состояние справочников — сетевой отчёт: выберите все рестораны сети", columns)
  const budget = newBudget()
  // Canonical comparisons first: what iiko has against what Sandyq uses.
  const departments = await countWhile(ctx.db.query("iikoDepartments").withIndex("by_external_id"), budget, (row: Doc<"iikoDepartments">) => row.type === "DEPARTMENT")
  const links = await countWhile(ctx.db.query("restaurantSourceLinks").withIndex("by_restaurant"), budget)
  const iikoEmployees = await countWhile(ctx.db.query("iikoEmployees").withIndex("by_active_and_display_name", (q) => q.eq("active", true)), budget)
  const products = await countWhile(ctx.db.query("products").withIndex("by_iiko_product", (q) => q.gt("iikoProductExternalId", "")), budget)
  const lastImport = await ctx.db.query("iikoImportRuns").withIndex("by_external_id").order("desc").first()
  const rows: Result["rows"] = [
    { key: "departments", cells: { group: "Подразделения → рестораны", domain: "Структура", mode: "Связь подтверждается в офисе", status: "—", syncedAt: "—", iiko: departments, local: links, difference: departments - links } },
    { key: "employees", cells: { group: "Сотрудники (активные)", domain: "Персонал", mode: "Зеркало без ПДн", status: "—", syncedAt: "—", iiko: iikoEmployees, local: iikoEmployees, difference: 0 } },
    { key: "products", cells: { group: "Номенклатура, связанная с iiko", domain: "Каталог", mode: "Проекция", status: "—", syncedAt: "—", iiko: products, local: products, difference: 0 } },
  ]
  for await (const state of ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key")) {
    if (!spend(budget)) break
    rows.push({ key: `endpoint:${state.endpointKey}`, cells: { group: state.path ?? state.endpointKey, domain: state.domain ?? "—", mode: CLASSIFICATION[state.classification ?? ""] ?? "—", status: `${ENDPOINT_STATUS[state.lastStatus]}${state.message && state.lastStatus !== "ok" ? `: ${state.message}` : ""}`, syncedAt: localDateTime(state.lastRunAt), iiko: state.recordCount ?? 0, local: 0, difference: 0 } })
  }
  return {
    sourceLabel: `Зеркало iiko (только чтение) против справочников Sandyq; последний импорт: ${lastImport ? `${localDateTime(lastImport.startedAt)} (${lastImport.status === "completed" ? "успешно" : lastImport.status === "failed" ? "ошибка" : "идёт"})` : "не запускался"}`,
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "unlinked", label: "Подразделений без ресторана", value: Math.max(0, departments - links), unit: "count" },
      { key: "errors", label: "Ошибок синхронизации", value: rows.filter((row) => String(row.cells.status).startsWith("Ошибка")).length, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── 11: network stock ─────────────────────────────────────────────────────────

const networkStock: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Ресторан", "text"), col("warehouses", "Складов", "count"), col("items", "Позиций в остатке", "count"), col("negative", "Отрицательных", "count"), col("inValue", "Приход за период", "money"), col("outValue", "Расход за период", "money"), col("value", "Стоимость на конец", "money")]
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const end = dayEnd(config.dateTo)
  const rows = []
  for (const restaurant of restaurants) {
    const warehouses = await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurant).eq("active", true)).take(50)
    const row = { warehouses: warehouses.length, items: 0, negative: 0, inValue: 0, outValue: 0, value: 0 }
    for await (const { warehouse, item } of stockPairs(ctx, warehouses, { ...config, search: undefined }, budget)) {
      const balance = await balanceAt(ctx, warehouse._id, item._id, end, budget)
      if (balance.quantity > 0) row.items += 1
      if (balance.quantity < 0) row.negative += 1
      row.value += balance.value
    }
    for await (const fact of ctx.db.query("dailyStockFacts").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      row.inValue += fact.inValue
      row.outValue += fact.outValue
    }
    if (!row.warehouses) continue
    rows.push({ key: restaurant, label: names.get(restaurant) ?? restaurant, values: { ...row, inValue: Math.round(row.inValue), outValue: Math.round(row.outValue) } })
  }
  const result = aggregate(rows, columns, "value")
  return { sourceLabel: `Остатки по цепочке движений на ${config.dateTo} и обороты складов (предагрегат) по ресторанам`, columns, ...result, kpis: [{ key: "value", label: "Стоимость остатков сети", value: Math.round(result.totals.value ?? 0), unit: "money" }, { key: "negative", label: "Отрицательных остатков", value: result.totals.negative ?? 0, unit: "count" }], truncated: budget.truncated }
}

// ── 12: transfers between restaurants ─────────────────────────────────────────

const interRestaurantTransfers: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Откуда → куда", "text"), col("documents", "Документов", "count"), col("quantity", "Количество", "quantity"), col("amount", "Сумма", "money")]
  const selected = new Set(restaurants)
  const budget = newBudget()
  const warehouse = new Map<string, Doc<"warehouses"> | null>()
  const warehouseOf = async (id: Doc<"stockDocuments">["sourceWarehouseId"]) => {
    if (!id) return null
    if (!warehouse.has(id)) warehouse.set(id, await ctx.db.get(id))
    return warehouse.get(id) ?? null
  }
  const names = new Map<string, string>()
  const nameOf = async (externalId: string) => {
    if (!names.has(externalId)) names.set(externalId, (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())?.name ?? externalId)
    return names.get(externalId)!
  }
  const rows = []
  for await (const document of ctx.db.query("stockDocuments").withIndex("by_type_status_date", (q) => q.eq("type", "transfer").eq("status", "posted").gte("date", dayStart(config.dateFrom)).lte("date", dayEnd(config.dateTo)))) {
    if (!spend(budget)) break
    const from = (await warehouseOf(document.sourceWarehouseId))?.restaurantExternalId ?? document.restaurantExternalId
    const to = (await warehouseOf(document.destinationWarehouseId))?.restaurantExternalId
    // Only between different restaurants, and one of the two sides in the report's scope.
    if (!to || to === from || (!selected.has(from) && !selected.has(to))) continue
    rows.push({ key: `${from}→${to}`, label: `${await nameOf(from)} → ${await nameOf(to)}`, values: { documents: 1, quantity: document.totalQuantity, amount: document.totalAmount } })
  }
  const result = aggregate(rows, columns, "amount")
  return { sourceLabel: "Проведённые перемещения между складами разных ресторанов", columns, ...result, kpis: [{ key: "amount", label: "Перемещено", value: Math.round(result.totals.amount ?? 0), unit: "money" }, { key: "documents", label: "Документов", value: result.totals.documents ?? 0, unit: "count" }], truncated: budget.truncated }
}

export const CHAIN_CALCULATORS: Record<string, Calculator> = {
  "chain-01": comparison,
  "chain-02": consolidatedSales,
  "chain-03": consolidatedPnl,
  "chain-04": likeForLike,
  "chain-05": rating,
  "chain-06": replication,
  "chain-07": exchangeErrors,
  "chain-08": periodLocks,
  "chain-09": menuChanges,
  "chain-10": referenceState,
  "chain-11": networkStock,
  "chain-12": interRestaurantTransfers,
}
