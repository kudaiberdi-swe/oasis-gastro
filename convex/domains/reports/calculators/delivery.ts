import type { Doc } from "../../../_generated/dataModel"
import { getOfficeAuthEmail, hasNetworkScope, requireOfficeCapability } from "../../../lib/officeAccess"
import { maskPhone } from "../../../lib/pii"
import type { ReportColumn, ReportConfig } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { percentOf, restaurantDocs, round1 } from "./_facts"
import { aggregate, ALMATY_OFFSET_MS, col, localDate } from "./_shared"
import { matches, needleOf, newBudget, periodEnd, periodStart, spend, type Budget, type QueryCtx } from "./stockHelpers"

// Delivery and call-center reports (W3-RPT-03). Orders are read over deliveryOrders.by_restaurant_created
// for the restaurants in scope, under one scan budget (no pre-aggregate). The courier app is out of
// scope, so courier times come from the office's own marks: assignedAt (courier assigned), pickedUpAt
// (on the way) and actualDeliveredAt — never GPS. Cooking time is the KDS ticket's readyAt − createdAt,
// not the planned predictedCookingCompleteAt. Telephony may not be connected yet (no provider chosen):
// the call reports then say «Телефония не подключена» instead of showing zeros. delivery-10 (corporate
// clients) is switched off by the owner (Г-11) and is marked `mechanicDisabled` in the catalog.

type Result = Awaited<ReturnType<Calculator>>
type Order = Doc<"deliveryOrders">
type Call = Doc<"telephonyCalls">
type Row = { key: string; label: string; values: Record<string, number>; text?: Record<string, string> }

const money = (key: string, label: string) => col(key, label, "money")
const count = (key: string, label: string) => col(key, label, "count")
const minutes = (key: string, label: string) => col(key, label, "minutes")
const text = (key: string, label: string) => col(key, label, "text")
const kpi = (key: string, label: string, value: number, unit: ReportColumn["unit"] = "count") => ({ key, label, value, unit })

const DONE = new Set<Order["status"]>(["delivered", "closed"])
const STATUS_LABEL: Record<Order["status"], string> = {
  unprocessed: "Новый", unconfirmed: "Не подтверждён", waiting: "Ожидает", "ready-to-cook": "К приготовлению", cooking: "Готовится", cooked: "Приготовлен",
  "awaiting-dispatch": "Ждёт отправки", "on-way": "В пути", delivered: "Доставлен", closed: "Закрыт", cancelled: "Отменён",
}
const STATUS_ORDER = Object.keys(STATUS_LABEL) as Order["status"][]
const CHANNEL_LABEL: Record<Doc<"deliverySources">["kind"], string> = { phone: "Телефон", website: "Сайт", app: "Приложение", aggregator: "Агрегатор", office: "Офис" }

const clock = (at: number) => new Date(at + ALMATY_OFFSET_MS).toISOString().slice(11, 16)
const minutesBetween = (from: number, to: number) => Math.max(0, (to - from) / 60_000)
const digits = (phone: string) => phone.replace(/\D/g, "")
const isLate = (order: Order) => DONE.has(order.status) && order.actualDeliveredAt !== undefined && order.actualDeliveredAt > order.expectedAt

/** Delivery orders created in the period, by restaurant (the index), under the budget. */
async function deliveriesIn(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Order[] = []
  for (const restaurant of restaurants) {
    for await (const order of ctx.db.query("deliveryOrders").withIndex("by_restaurant_created", (q) => q.eq("restaurantExternalId", restaurant).gte("createdAt", periodStart(config)).lte("createdAt", periodEnd(config)))) {
      if (!spend(budget)) return rows
      rows.push(order)
    }
  }
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

/** Reference rows by externalId, memoized (sources, zones, couriers). */
function cached<T>(load: (externalId: string) => Promise<T | null>) {
  const cache = new Map<string, T | null>()
  return async (externalId: string | undefined): Promise<T | null> => {
    if (!externalId) return null
    if (!cache.has(externalId)) cache.set(externalId, await load(externalId))
    return cache.get(externalId) ?? null
  }
}

const LOOKUPS = {
  deliverySources: (ctx: QueryCtx) => cached((id) => ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()),
  deliveryZones: (ctx: QueryCtx) => cached((id) => ctx.db.query("deliveryZones").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()),
  couriers: (ctx: QueryCtx) => cached((id) => ctx.db.query("couriers").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()),
}
const lookup = <T extends keyof typeof LOOKUPS>(ctx: QueryCtx, table: T) => LOOKUPS[table](ctx) as ReturnType<(typeof LOOKUPS)[T]>

/** Office users' names by the email kept in operatorKey. */
function operatorNames(ctx: QueryCtx) {
  const cache = new Map<string, string>()
  return async (email: string | undefined) => {
    if (!email) return "Без оператора"
    if (!cache.has(email)) cache.set(email, (await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique())?.name ?? email)
    return cache.get(email)!
  }
}

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

/** Orders counted in a summary row: all, delivered, cancelled, revenue of the delivered ones, late. */
function orderValues(order: Order): Record<string, number> {
  const done = DONE.has(order.status)
  return { orders: 1, done: done ? 1 : 0, cancelled: order.status === "cancelled" ? 1 : 0, revenue: done ? order.total : 0, deliveryFee: done ? order.deliveryFee : 0, late: isLate(order) ? 1 : 0 }
}

const SUMMARY_COLUMNS = [count("orders", "Заказов"), count("done", "Доставлено"), count("cancelled", "Отменено"), money("revenue", "Выручка"), money("averageCheck", "Средний чек"), money("deliveryFee", "Доставка"), count("late", "Опозданий"), col("latePercent", "Опозданий, %", "percent")]

/** Finishes a summary: average check and late share per row, totals without the ratios, KPIs. */
function summary(rows: Row[], columns: ReportColumn[], sourceLabel: string, truncated: boolean, options: { sort?: string; order?: (a: Result["rows"][number], b: Result["rows"][number]) => number } = {}): Result {
  const result = aggregate(rows, columns, options.sort ?? "revenue")
  for (const row of result.rows) {
    row.cells.averageCheck = Number(row.cells.done) ? Math.round(Number(row.cells.revenue) / Number(row.cells.done)) : 0
    row.cells.latePercent = percentOf(Number(row.cells.late), Number(row.cells.done))
  }
  if (options.order) result.rows.sort(options.order)
  const t = result.totals
  delete t.averageCheck
  delete t.latePercent
  return {
    sourceLabel,
    columns,
    ...result,
    kpis: [kpi("orders", "Заказов", t.orders ?? 0), kpi("revenue", "Выручка доставок", t.revenue ?? 0, "money"), kpi("averageCheck", "Средний чек", t.done ? Math.round((t.revenue ?? 0) / t.done) : 0, "money"), kpi("latePercent", "Опозданий", percentOf(t.late ?? 0, t.done ?? 0), "percent")],
    truncated,
  }
}

function summaryBy(dimension: string, keyOf: (ctx: QueryCtx) => (order: Order) => Promise<{ key: string; label: string }>, sourceLabel = "Заказы доставки, созданные за период"): Calculator {
  return async (ctx, config, restaurants) => {
    const budget = newBudget()
    const needle = needleOf(config)
    const key = keyOf(ctx)
    const rows: Row[] = []
    for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
      const group = await key(order)
      if (matches(needle, group.label)) rows.push({ ...group, values: orderValues(order) })
    }
    return summary(rows, [text("group", dimension), ...SUMMARY_COLUMNS], sourceLabel, budget.truncated)
  }
}

// ── 01–09: summaries ───────────────────────────────────────────────────────────

const overall: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const rows: Row[] = []
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    const date = localDate(order.createdAt)
    rows.push({ key: date, label: date, values: { ...orderValues(order), open: !DONE.has(order.status) && order.status !== "cancelled" ? 1 : 0 } })
  }
  const columns = [col("group", "Дата", "date"), count("orders", "Заказов"), count("done", "Доставлено"), count("cancelled", "Отменено"), count("open", "В работе"), money("revenue", "Выручка"), money("averageCheck", "Средний чек"), money("deliveryFee", "Доставка"), count("late", "Опозданий"), col("latePercent", "Опозданий, %", "percent")]
  return summary(rows, columns, "Заказы доставки, созданные за период", budget.truncated, { order: (a, b) => String(a.cells.group).localeCompare(String(b.cells.group)) })
}

const byRestaurant: Calculator = async (ctx, config, restaurants) => {
  const names = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row.name]))
  return summaryBy("Ресторан", () => async (order) => ({ key: order.restaurantExternalId, label: names.get(order.restaurantExternalId) ?? order.restaurantExternalId }))(ctx, config, restaurants)
}

const bySource = summaryBy("Источник", (ctx) => {
  const source = lookup(ctx, "deliverySources")
  return async (order) => ({ key: order.sourceExternalId, label: (await source(order.sourceExternalId))?.name ?? order.sourceExternalId })
})

const byChannel = summaryBy("Канал", (ctx) => {
  const source = lookup(ctx, "deliverySources")
  return async (order) => {
    const kind = (await source(order.sourceExternalId))?.kind
    return { key: kind ?? "unknown", label: kind ? CHANNEL_LABEL[kind] : "Не указан" }
  }
})

const byStatus: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const rows: Row[] = []
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) rows.push({ key: order.status, label: STATUS_LABEL[order.status], values: { orders: 1, amount: order.total } })
  const columns = [text("group", "Статус"), count("orders", "Заказов"), money("amount", "Сумма"), col("share", "Доля, %", "percent")]
  const result = aggregate(rows, columns)
  for (const row of result.rows) row.cells.share = percentOf(Number(row.cells.orders), result.totals.orders ?? 0)
  delete result.totals.share
  result.rows.sort((a, b) => STATUS_ORDER.indexOf(a.key as Order["status"]) - STATUS_ORDER.indexOf(b.key as Order["status"]))
  const open = result.rows.filter((row) => !DONE.has(row.key as Order["status"]) && row.key !== "cancelled").reduce((sum, row) => sum + Number(row.cells.orders), 0)
  return { sourceLabel: "Текущий статус заказов доставки, созданных за период", columns, ...result, kpis: [kpi("orders", "Заказов", result.totals.orders ?? 0), kpi("open", "В работе", open)], truncated: budget.truncated }
}

const byZone = summaryBy("Зона", (ctx) => {
  const zone = lookup(ctx, "deliveryZones")
  return async (order) => ({ key: order.zoneExternalId ?? "none", label: (await zone(order.zoneExternalId))?.name ?? "Вне зон" })
})

const byOperator = summaryBy("Оператор", (ctx) => {
  const name = operatorNames(ctx)
  return async (order) => ({ key: order.operatorKey ?? "none", label: order.operatorKey ? await name(order.operatorKey) : "Без оператора (сайт, агрегатор, офис)" })
}, "Заказы доставки за период; оператор — сотрудник колл-центра, принявший заказ")

const byCourier: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const courier = lookup(ctx, "couriers")
  const rows: Row[] = []
  const transit = new Map<string, number[]>()
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    const label = order.courierExternalId ? ((await courier(order.courierExternalId))?.name ?? order.courierExternalId) : "Не назначен"
    if (!matches(needle, label)) continue
    const key = order.courierExternalId ?? "none"
    if (DONE.has(order.status) && order.pickedUpAt !== undefined && order.actualDeliveredAt !== undefined) transit.set(key, [...(transit.get(key) ?? []), minutesBetween(order.pickedUpAt, order.actualDeliveredAt)])
    rows.push({ key, label, values: orderValues(order) })
  }
  const columns = [text("group", "Курьер"), count("orders", "Заказов"), count("done", "Доставлено"), count("cancelled", "Отменено"), money("revenue", "Выручка"), money("averageCheck", "Средний чек"), count("late", "Опозданий"), col("latePercent", "Опозданий, %", "percent"), minutes("transit", "В пути в среднем")]
  const result = summary(rows, columns, "Заказы доставки по курьеру, назначенному в офисе (без GPS)", budget.truncated)
  for (const row of result.rows) {
    const times = transit.get(row.key) ?? []
    row.cells.transit = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0
  }
  delete result.totals.transit
  return result
}

const byClient: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const pii = await canSeePii(ctx)
  const rows: Row[] = []
  const last = new Map<string, number>()
  const keys = new Map<string, string>()
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    const phone = pii ? order.phone : (maskPhone(order.phone) ?? "")
    // Search by phone only with the right to see it.
    if (!matches(needle, order.customerName, ...(pii ? [order.phone] : []))) continue
    // The row key never carries the phone: a guest by id, otherwise a number per distinct phone.
    const client = order.guestId ?? digits(order.phone)
    if (!keys.has(client)) keys.set(client, `client-${keys.size + 1}`)
    const key = keys.get(client)!
    last.set(key, Math.max(last.get(key) ?? 0, order.createdAt))
    rows.push({ key, label: order.customerName, text: { phone }, values: orderValues(order) })
  }
  const columns = [text("group", "Клиент"), text("phone", "Телефон"), count("orders", "Заказов"), count("done", "Доставлено"), count("cancelled", "Отменено"), money("revenue", "Выручка"), money("averageCheck", "Средний чек"), col("lastOrder", "Последний заказ", "date")]
  const result = summary(rows, columns, pii ? "Заказы доставки по клиентам" : "Заказы доставки по клиентам (телефон скрыт — нет права на персональные данные)", budget.truncated)
  for (const row of result.rows) {
    row.cells.lastOrder = localDate(last.get(row.key) ?? 0)
    delete row.cells.deliveryFee
    delete row.cells.late
    delete row.cells.latePercent
  }
  delete result.totals.deliveryFee
  delete result.totals.late
  result.kpis = [kpi("clients", "Клиентов", result.rows.length), kpi("repeat", "Заказывали повторно", result.rows.filter((row) => Number(row.cells.orders) > 1).length), result.kpis[1], result.kpis[2]]
  return result
}

// ── 11, 12: cancellations ──────────────────────────────────────────────────────

const cancelled: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const source = lookup(ctx, "deliverySources")
  const names = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row.name]))
  const columns = [text("group", "Номер"), col("date", "Дата", "date"), text("restaurant", "Ресторан"), text("source", "Источник"), money("amount", "Сумма"), text("reason", "Причина")]
  const all = await deliveriesIn(ctx, restaurants, config, budget)
  const rows = []
  for (const order of all) {
    if (order.status !== "cancelled") continue
    const reason = order.cancelReason?.trim() || "Без причины"
    if (!matches(needle, order.number, reason)) continue
    rows.push({ key: order.externalId, cells: { group: order.number, date: localDate(order.createdAt), restaurant: names.get(order.restaurantExternalId) ?? order.restaurantExternalId, source: (await source(order.sourceExternalId))?.name ?? order.sourceExternalId, amount: order.total, reason } })
  }
  const amount = rows.reduce((sum, row) => sum + row.cells.amount, 0)
  return { sourceLabel: "Отменённые заказы доставки, созданные за период", columns, rows, totals: { amount }, kpis: [kpi("cancelled", "Отменено", rows.length), kpi("share", "Доля отмен", percentOf(rows.length, all.length), "percent"), kpi("amount", "Сумма отмен", amount, "money")], truncated: budget.truncated }
}

const cancelReasons: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const rows: Row[] = []
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (order.status !== "cancelled") continue
    const reason = order.cancelReason?.trim() || "Без причины"
    if (matches(needle, reason)) rows.push({ key: reason.toLocaleLowerCase("ru"), label: reason, values: { cancelled: 1, amount: order.total } })
  }
  const columns = [text("group", "Причина"), count("cancelled", "Отмен"), money("amount", "Сумма"), col("share", "Доля, %", "percent")]
  const result = aggregate(rows, columns, "cancelled")
  for (const row of result.rows) row.cells.share = percentOf(Number(row.cells.cancelled), result.totals.cancelled ?? 0)
  delete result.totals.share
  return { sourceLabel: "Причины отмены заказов доставки", columns, ...result, kpis: [kpi("cancelled", "Отмен", result.totals.cancelled ?? 0), kpi("reasons", "Причин", result.rows.length), kpi("amount", "Сумма отмен", result.totals.amount ?? 0, "money")], truncated: budget.truncated }
}

// ── 13–17: times ───────────────────────────────────────────────────────────────

const lateness: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const courier = lookup(ctx, "couriers")
  const names = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row.name]))
  const columns = [text("group", "Номер"), col("date", "Дата", "date"), text("restaurant", "Ресторан"), text("courier", "Курьер"), text("promised", "Обещано к"), text("delivered", "Доставлен в"), minutes("lateMinutes", "Опоздание")]
  const all = await deliveriesIn(ctx, restaurants, config, budget)
  const done = all.filter((order) => DONE.has(order.status) && order.actualDeliveredAt !== undefined)
  const rows = []
  for (const order of done) {
    if (!isLate(order)) continue
    const courierName = order.courierExternalId ? ((await courier(order.courierExternalId))?.name ?? "") : ""
    if (!matches(needle, order.number, courierName)) continue
    rows.push({ key: order.externalId, cells: { group: order.number, date: localDate(order.createdAt), restaurant: names.get(order.restaurantExternalId) ?? order.restaurantExternalId, courier: courierName || "—", promised: clock(order.expectedAt), delivered: clock(order.actualDeliveredAt!), lateMinutes: Math.round(minutesBetween(order.expectedAt, order.actualDeliveredAt!)) } })
  }
  rows.sort((a, b) => b.cells.lateMinutes - a.cells.lateMinutes)
  const total = rows.reduce((sum, row) => sum + row.cells.lateMinutes, 0)
  return {
    sourceLabel: "Доставленные заказы: фактическое время доставки позже обещанного",
    columns,
    rows,
    totals: { lateMinutes: total },
    kpis: [kpi("delivered", "Доставлено", done.length), kpi("late", "С опозданием", rows.length), kpi("share", "Доля опозданий", percentOf(rows.length, done.length), "percent"), kpi("average", "Среднее опоздание", rows.length ? Math.round(total / rows.length) : 0, "minutes")],
    truncated: budget.truncated,
  }
}

/** Duration statistics of a group of orders: count, average, maximum and the share within a norm. */
function durations(rows: { key: string; label: string; minutes: number; norm?: number }[], dimension: ReportColumn, sourceLabel: string, truncated: boolean, extraKpis: Result["kpis"] = []): Result {
  const groups = new Map<string, { label: string; values: number[]; norms: number[]; within: number }>()
  for (const row of rows) {
    const group = groups.get(row.key) ?? { label: row.label, values: [], norms: [], within: 0 }
    group.values.push(row.minutes)
    if (row.norm !== undefined) {
      group.norms.push(row.norm)
      if (row.minutes <= row.norm) group.within += 1
    }
    groups.set(row.key, group)
  }
  const withNorm = rows.some((row) => row.norm !== undefined)
  const columns = [dimension, count("orders", "Заказов"), minutes("average", "Среднее"), minutes("maximum", "Максимум"), ...(withNorm ? [minutes("norm", "Норматив"), col("withinPercent", "В нормативе, %", "percent")] : [])]
  const average = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0)
  const out = [...groups.entries()].map(([key, group]) => ({
    key,
    cells: { group: group.label, orders: group.values.length, average: average(group.values), maximum: Math.round(Math.max(...group.values)), ...(withNorm ? { norm: average(group.norms), withinPercent: percentOf(group.within, group.norms.length) } : {}) } as Record<string, number | string>,
  }))
  out.sort((a, b) => (dimension.unit === "date" ? String(a.cells.group).localeCompare(String(b.cells.group)) : Number(b.cells.orders) - Number(a.cells.orders)))
  const all = rows.map((row) => row.minutes)
  const normed = rows.filter((row) => row.norm !== undefined)
  return {
    sourceLabel,
    columns,
    rows: out,
    totals: { orders: rows.length },
    kpis: [kpi("orders", "Заказов", rows.length), kpi("average", "Среднее время", average(all), "minutes"), ...(withNorm ? [kpi("within", "В нормативе", percentOf(normed.filter((row) => row.minutes <= row.norm!).length, normed.length), "percent")] : []), ...extraKpis],
    truncated,
  }
}

const cookingTime: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const zone = lookup(ctx, "deliveryZones")
  const rows = []
  let withoutKitchen = 0
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (order.status === "cancelled" || !order.orderId) continue
    const all = await ctx.db.query("kitchenTickets").withIndex("by_order", (q) => q.eq("orderId", order.orderId!)).take(20)
    const tickets = all.filter((ticket) => ticket.status !== "cancelled")
    const ready = tickets.filter((ticket) => ticket.readyAt !== undefined)
    if (!tickets.length || ready.length < tickets.length) {
      withoutKitchen += 1
      continue
    }
    const start = Math.min(...tickets.map((ticket) => ticket.createdAt))
    const end = Math.max(...ready.map((ticket) => ticket.readyAt!))
    const norm = (await zone(order.zoneExternalId))?.cookingMinutes
    const date = localDate(order.createdAt)
    rows.push({ key: date, label: date, minutes: Math.round(minutesBetween(start, end)), ...(norm ? { norm } : {}) })
  }
  return durations(rows, col("group", "Дата", "date"), "Кухня (KDS): от создания тикета до «Готово»", budget.truncated, [kpi("withoutKitchen", "Без данных кухни", withoutKitchen)])
}

const courierWait: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const courier = lookup(ctx, "couriers")
  const rows = []
  let unmarked = 0
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (!order.courierExternalId || order.status === "cancelled") continue
    if (order.assignedAt === undefined || order.pickedUpAt === undefined) {
      if (DONE.has(order.status) || order.status === "on-way") unmarked += 1
      continue
    }
    rows.push({ key: order.courierExternalId, label: (await courier(order.courierExternalId))?.name ?? order.courierExternalId, minutes: Math.round(minutesBetween(order.assignedAt, order.pickedUpAt)) })
  }
  return durations(rows, text("group", "Курьер"), "От назначения курьера до выезда (отметки офиса)", budget.truncated, [kpi("unmarked", "Без отметок времени", unmarked)])
}

const transitTime: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const courier = lookup(ctx, "couriers")
  const zone = lookup(ctx, "deliveryZones")
  const rows = []
  let unmarked = 0
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (!DONE.has(order.status)) continue
    if (order.pickedUpAt === undefined || order.actualDeliveredAt === undefined) {
      unmarked += 1
      continue
    }
    const norm = (await zone(order.zoneExternalId))?.deliveryMinutes
    rows.push({ key: order.courierExternalId ?? "none", label: order.courierExternalId ? ((await courier(order.courierExternalId))?.name ?? order.courierExternalId) : "Не назначен", minutes: Math.round(minutesBetween(order.pickedUpAt, order.actualDeliveredAt)), ...(norm ? { norm } : {}) })
  }
  return durations(rows, text("group", "Курьер"), "От выезда до доставки (отметки офиса, без GPS)", budget.truncated, [kpi("unmarked", "Без отметок времени", unmarked)])
}

const standard: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const zone = lookup(ctx, "deliveryZones")
  const rows = []
  let withoutZone = 0
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (!DONE.has(order.status) || order.actualDeliveredAt === undefined) continue
    const row = await zone(order.zoneExternalId)
    if (!row || !(row.cookingMinutes + row.deliveryMinutes > 0)) {
      withoutZone += 1
      continue
    }
    // A pre-order is measured from its planned cooking start, not from when it was taken.
    const start = Math.max(order.createdAt, order.cookingStartAt ?? order.createdAt)
    rows.push({ key: row.externalId, label: row.name, minutes: Math.round(minutesBetween(start, order.actualDeliveredAt)), norm: row.cookingMinutes + row.deliveryMinutes })
  }
  return durations(rows, text("group", "Зона"), "Доставленные заказы: норматив зоны (приготовление + доставка) против факта", budget.truncated, [kpi("withoutZone", "Без зоны или норматива", withoutZone)])
}

// ── 18, 19: money ──────────────────────────────────────────────────────────────

const costAndRevenue: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const source = lookup(ctx, "deliverySources")
  const rows: Row[] = []
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (!DONE.has(order.status)) continue
    const label = (await source(order.sourceExternalId))?.name ?? order.sourceExternalId
    if (!matches(needle, label)) continue
    const commission = order.commissionAmount ?? 0
    rows.push({ key: order.sourceExternalId, label, values: { orders: 1, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, commission, net: order.total - commission } })
  }
  const columns = [text("group", "Источник"), count("orders", "Доставлено"), money("subtotal", "Блюда"), money("deliveryFee", "Доставка"), money("total", "Выручка"), money("commission", "Комиссия агрегатора"), money("net", "За вычетом комиссии"), col("commissionPercent", "Комиссия, %", "percent")]
  const result = aggregate(rows, columns, "total")
  for (const row of result.rows) row.cells.commissionPercent = percentOf(Number(row.cells.commission), Number(row.cells.total))
  delete result.totals.commissionPercent
  const t = result.totals
  return {
    sourceLabel: "Доставленные заказы: суммы заказа, стоимость доставки и комиссия агрегатора",
    columns,
    ...result,
    kpis: [kpi("total", "Выручка", t.total ?? 0, "money"), kpi("deliveryFee", "Доставка", t.deliveryFee ?? 0, "money"), kpi("commission", "Комиссия", t.commission ?? 0, "money"), kpi("net", "За вычетом комиссии", t.net ?? 0, "money")],
    truncated: budget.truncated,
  }
}

const paymentTypes: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const rows: Row[] = []
  let unpaid = 0
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (order.paymentStatus === "unpaid" || !order.orderId) {
      if (DONE.has(order.status)) unpaid += 1
      continue
    }
    for (const payment of await ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order.orderId!)).take(50)) {
      if (!spend(budget)) break
      const label = payment.paymentTypeName ?? payment.method
      if (!matches(needle, label)) continue
      const sale = payment.type === "sale"
      rows.push({ key: payment.paymentTypeExternalId ?? payment.method, label, values: sale ? { payments: 1, amount: payment.amount, net: payment.amount } : { refunds: 1, refundAmount: payment.amount, net: -payment.amount } })
    }
  }
  const columns = [text("group", "Тип оплаты"), count("payments", "Оплат"), money("amount", "Оплачено"), count("refunds", "Возвратов"), money("refundAmount", "Возвращено"), money("net", "Итого"), col("share", "Доля, %", "percent")]
  const result = aggregate(rows, columns, "net")
  for (const row of result.rows) row.cells.share = percentOf(Number(row.cells.net), result.totals.net ?? 0)
  delete result.totals.share
  return { sourceLabel: "Оплаты заказов доставки на кассе доставки", columns, ...result, kpis: [kpi("net", "Оплачено за вычетом возвратов", result.totals.net ?? 0, "money"), kpi("payments", "Оплат", result.totals.payments ?? 0), kpi("unpaid", "Доставлено без оплаты", unpaid)], truncated: budget.truncated }
}

// ── 20–23: telephony ───────────────────────────────────────────────────────────

const NOT_CONNECTED = { title: "Телефония не подключена", description: "Провайдер телефонии ещё не выбран, в журнале нет ни одного звонка. Отчёт начнёт считаться с первыми звонками от провайдера — нули вместо данных мы не показываем." }

const answered = (call: Call) => call.status === "answered" || call.status === "completed" || call.answeredAt !== undefined
const talkMinutes = (call: Call) => (call.answeredAt !== undefined && call.endedAt !== undefined ? minutesBetween(call.answeredAt, call.endedAt) : 0)

/**
 * Calls of the period for the restaurants: a call counts for its own restaurant, or for the restaurant
 * of the delivery it is linked to; a call with neither (a central line) only for a network-wide user.
 * `null` when no call was ever recorded — telephony is not connected.
 */
async function callsIn(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  if (!(await ctx.db.query("telephonyCalls").withIndex("by_started").first())) return null
  const email = await getOfficeAuthEmail(ctx)
  const user = email ? await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique() : null
  const network = user ? hasNetworkScope(user) : false
  const allowed = new Set(restaurants)
  const deliveryRestaurant = new Map<string, string | undefined>()
  const rows: Call[] = []
  for await (const call of ctx.db.query("telephonyCalls").withIndex("by_started", (q) => q.gte("startedAt", periodStart(config)).lte("startedAt", periodEnd(config)))) {
    if (!spend(budget)) break
    let restaurant = call.restaurantExternalId
    if (!restaurant && call.deliveryExternalId) {
      if (!deliveryRestaurant.has(call.deliveryExternalId)) deliveryRestaurant.set(call.deliveryExternalId, (await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", call.deliveryExternalId!)).unique())?.restaurantExternalId)
      restaurant = deliveryRestaurant.get(call.deliveryExternalId)
    }
    if (restaurant ? allowed.has(restaurant) : network) rows.push(call)
  }
  return rows
}

function notConnected(columns: ReportColumn[]): Result {
  return { sourceLabel: "Журнал звонков телефонии", columns, rows: [], totals: {}, kpis: [], truncated: false, unavailable: NOT_CONNECTED }
}

const callsByDay: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const columns = [col("group", "Дата", "date"), count("calls", "Звонков"), count("inbound", "Входящих"), count("outbound", "Исходящих"), count("answered", "Отвечено"), count("missed", "Пропущено"), col("talkMinutes", "Разговор, мин", "minutes"), col("averageTalk", "Средний разговор, мин", "quantity")]
  const calls = await callsIn(ctx, restaurants, config, budget)
  if (!calls) return notConnected(columns)
  const rows: Row[] = calls.map((call) => {
    const date = localDate(call.startedAt)
    return { key: date, label: date, values: { calls: 1, inbound: call.direction === "inbound" ? 1 : 0, outbound: call.direction === "outbound" ? 1 : 0, answered: answered(call) ? 1 : 0, missed: call.status === "missed" ? 1 : 0, talkMinutes: talkMinutes(call) } }
  })
  const result = aggregate(rows, columns)
  for (const row of result.rows) {
    row.cells.averageTalk = Number(row.cells.answered) ? round1(Number(row.cells.talkMinutes) / Number(row.cells.answered)) : 0
    row.cells.talkMinutes = Math.round(Number(row.cells.talkMinutes))
  }
  result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
  const t = result.totals
  t.talkMinutes = Math.round(t.talkMinutes ?? 0)
  delete t.averageTalk
  return { sourceLabel: "Журнал звонков телефонии", columns, ...result, kpis: [kpi("calls", "Звонков", t.calls ?? 0), kpi("answered", "Отвечено", percentOf(t.answered ?? 0, t.calls ?? 0), "percent"), kpi("missed", "Пропущено", t.missed ?? 0), kpi("talk", "Разговор, мин", t.talkMinutes, "minutes")], truncated: budget.truncated }
}

const missedCalls: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const columns = [col("date", "Дата", "date"), text("time", "Время"), text("phone", "Телефон"), text("restaurant", "Ресторан"), text("calledBack", "Перезвонили"), minutes("callbackMinutes", "Через")]
  const calls = await callsIn(ctx, restaurants, config, budget)
  if (!calls) return notConnected(columns)
  const pii = await canSeePii(ctx)
  const names = new Map((await restaurantDocs(ctx, restaurants)).map((row) => [row.externalId, row.name]))
  const rows = []
  for (const call of calls) {
    if (call.direction !== "inbound" || call.status !== "missed") continue
    // Called back: a later answered call with the same number within a day (by_phone_started).
    const later = await ctx.db.query("telephonyCalls").withIndex("by_phone_started", (q) => q.eq("phone", call.phone).gt("startedAt", call.startedAt).lte("startedAt", call.startedAt + 86_400_000)).take(20)
    const callback = later.find((row) => row.direction === "outbound" || answered(row))
    rows.push({ key: call.externalId, cells: { date: localDate(call.startedAt), time: clock(call.startedAt), phone: pii ? call.phone : (maskPhone(call.phone) ?? ""), restaurant: call.restaurantExternalId ? (names.get(call.restaurantExternalId) ?? call.restaurantExternalId) : "Общая линия", calledBack: callback ? "Да" : "Нет", callbackMinutes: callback ? Math.round(minutesBetween(call.startedAt, callback.startedAt)) : 0 } })
  }
  const back = rows.filter((row) => row.cells.calledBack === "Да")
  return {
    sourceLabel: pii ? "Пропущенные входящие звонки" : "Пропущенные входящие звонки (телефон скрыт — нет права на персональные данные)",
    columns,
    rows,
    totals: {},
    kpis: [kpi("missed", "Пропущено", rows.length), kpi("calledBack", "Перезвонили", back.length), kpi("share", "Перезвонили, %", percentOf(back.length, rows.length), "percent"), kpi("average", "Перезвон в среднем через", back.length ? Math.round(back.reduce((sum, row) => sum + row.cells.callbackMinutes, 0) / back.length) : 0, "minutes")],
    truncated: budget.truncated,
  }
}

/** A delivery order taken from a call: linked explicitly, or the same number ordering within an hour after the call. */
const ORDER_WINDOW_MS = 3_600_000

async function callOrders(ctx: QueryCtx, calls: Call[], restaurants: string[], config: ReportConfig, budget: Budget) {
  // Orders up to an hour after the period still belong to its last calls.
  const window = { ...config, dateTo: localDate(periodEnd(config) + ORDER_WINDOW_MS) }
  const orders = await deliveriesIn(ctx, restaurants, window, budget)
  const byId = new Map(orders.map((order) => [order.externalId, order]))
  const byPhone = new Map<string, Order[]>()
  for (const order of orders) byPhone.set(digits(order.phone), [...(byPhone.get(digits(order.phone)) ?? []), order])
  const orderOf = new Map<string, Order | null>()
  for (const call of calls) {
    const linked = call.deliveryExternalId ? (byId.get(call.deliveryExternalId) ?? (await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", call.deliveryExternalId!)).unique())) : null
    orderOf.set(call.externalId, linked ?? (byPhone.get(digits(call.phone)) ?? []).find((order) => order.createdAt >= call.startedAt && order.createdAt <= call.startedAt + ORDER_WINDOW_MS) ?? null)
  }
  return orderOf
}

const conversion: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const columns = [col("group", "Дата", "date"), count("inbound", "Входящих"), count("answered", "Отвечено"), count("withOrder", "С заказом"), col("conversion", "Конверсия, %", "percent"), money("revenue", "Сумма заказов")]
  const calls = await callsIn(ctx, restaurants, config, budget)
  if (!calls) return notConnected(columns)
  const inbound = calls.filter((call) => call.direction === "inbound")
  const orderOf = await callOrders(ctx, inbound, restaurants, config, budget)
  const counted = new Set<string>()
  const rows: Row[] = inbound.map((call) => {
    const date = localDate(call.startedAt)
    const order = orderOf.get(call.externalId)
    // One order is converted once even when the guest called twice.
    const fresh = order && !counted.has(order.externalId)
    if (order) counted.add(order.externalId)
    return { key: date, label: date, values: { inbound: 1, answered: answered(call) ? 1 : 0, withOrder: fresh ? 1 : 0, revenue: fresh ? order.total : 0 } }
  })
  const result = aggregate(rows, columns)
  for (const row of result.rows) row.cells.conversion = percentOf(Number(row.cells.withOrder), Number(row.cells.answered))
  result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
  const t = result.totals
  delete t.conversion
  return { sourceLabel: "Входящие звонки и заказы доставки: связанные со звонком или с того же номера в течение часа", columns, ...result, kpis: [kpi("answered", "Отвечено", t.answered ?? 0), kpi("withOrder", "С заказом", t.withOrder ?? 0), kpi("conversion", "Конверсия отвеченных", percentOf(t.withOrder ?? 0, t.answered ?? 0), "percent")], truncated: budget.truncated }
}

const operatorLoad: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const name = operatorNames(ctx)
  const columns = [text("group", "Оператор"), count("calls", "Звонков"), count("answered", "Отвечено"), col("talkMinutes", "Разговор, мин", "minutes"), col("averageTalk", "Средний разговор, мин", "quantity"), count("orders", "Принято заказов"), col("ordersPerCall", "Заказов на отвеченный звонок", "quantity")]
  const calls = await callsIn(ctx, restaurants, config, budget)
  if (!calls) return notConnected(columns)
  const rows: Row[] = []
  for (const call of calls) {
    if (!call.operatorKey) continue
    const label = await name(call.operatorKey)
    if (matches(needle, label)) rows.push({ key: call.operatorKey, label, values: { calls: 1, answered: answered(call) ? 1 : 0, talkMinutes: talkMinutes(call) } })
  }
  for (const order of await deliveriesIn(ctx, restaurants, config, budget)) {
    if (!order.operatorKey) continue
    const label = await name(order.operatorKey)
    if (matches(needle, label)) rows.push({ key: order.operatorKey, label, values: { orders: 1 } })
  }
  const result = aggregate(rows, columns, "calls")
  for (const row of result.rows) {
    row.cells.averageTalk = Number(row.cells.answered) ? round1(Number(row.cells.talkMinutes) / Number(row.cells.answered)) : 0
    row.cells.ordersPerCall = Number(row.cells.answered) ? Math.round((Number(row.cells.orders) / Number(row.cells.answered)) * 100) / 100 : 0
    row.cells.talkMinutes = Math.round(Number(row.cells.talkMinutes))
  }
  const t = result.totals
  t.talkMinutes = Math.round(t.talkMinutes ?? 0)
  delete t.averageTalk
  delete t.ordersPerCall
  return { sourceLabel: "Звонки с оператором и заказы, принятые в колл-центре", columns, ...result, kpis: [kpi("operators", "Операторов", result.rows.length), kpi("calls", "Звонков", t.calls ?? 0), kpi("talk", "Разговор, мин", t.talkMinutes, "minutes"), kpi("orders", "Принято заказов", t.orders ?? 0)], truncated: budget.truncated }
}

export const DELIVERY_CALCULATORS: Record<string, Calculator> = {
  "delivery-01": overall,
  "delivery-02": byRestaurant,
  "delivery-03": bySource,
  "delivery-04": byChannel,
  "delivery-05": byStatus,
  "delivery-06": byZone,
  "delivery-07": byOperator,
  "delivery-08": byCourier,
  "delivery-09": byClient,
  "delivery-11": cancelled,
  "delivery-12": cancelReasons,
  "delivery-13": lateness,
  "delivery-14": cookingTime,
  "delivery-15": courierWait,
  "delivery-16": transitTime,
  "delivery-17": standard,
  "delivery-18": costAndRevenue,
  "delivery-19": paymentTypes,
  "delivery-20": callsByDay,
  "delivery-21": missedCalls,
  "delivery-22": conversion,
  "delivery-23": operatorLoad,
}
