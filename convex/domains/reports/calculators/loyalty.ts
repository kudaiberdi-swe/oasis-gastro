import type { Doc } from "../../../_generated/dataModel"
import { maskPhone } from "../../../lib/pii"
import type { ReportConfig, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { aggregate, col, dayEnd, dayStart, localDate } from "./_shared"
import { canSeeGuestPii, coversNetwork, lookup, scopeOf, statusResult } from "./_scope"
import { newBudget, percent, spend, type Budget } from "./stockHelpers"

// Guest and loyalty reports of W3 (docs/IMPLEMENTATION-PLAN.md W3-RPT-04). Visits come from the `guest`
// facts of dailySalesFacts (orders with a guest only), balances from the account transactions, consents
// from the append-only journal, mailings from the messaging jobs. Personal data only with
// office.guests.pii (Г-2): without it the phone is masked, as in the office guest list. Coupons and the
// referral program are not run by the business (Г-11) — «Недоступно: механика выключена».

type QueryCtx = Parameters<Calculator>[0]
type Result = Omit<ReportResult, "reportId" | "generatedAt">
type Visits = { visits: number; revenue: number; first: string; last: string }

const ROW_LIMIT = 2000
const extraNumber = (config: ReportConfig, key: string, fallback: number) => (typeof config.extra?.[key] === "number" && Number(config.extra[key]) > 0 ? Number(config.extra[key]) : fallback)
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Visits and revenue (net of refunds) per guest in the period, from the guest facts of the restaurants. */
async function guestVisits(ctx: QueryCtx, config: Pick<ReportConfig, "dateFrom" | "dateTo">, restaurants: string[], budget: Budget) {
  const byGuest = new Map<string, Visits>()
  for (const restaurant of restaurants) {
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "guest").gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return byGuest
      const row = byGuest.get(fact.dimensionKey) ?? { visits: 0, revenue: 0, first: fact.businessDate, last: fact.businessDate }
      row.visits += fact.orderCount
      row.revenue += fact.netAmount - fact.refundAmount
      if (fact.businessDate < row.first) row.first = fact.businessDate
      if (fact.businessDate > row.last) row.last = fact.businessDate
      byGuest.set(fact.dimensionKey, row)
    }
  }
  return byGuest
}

/** Name and phone of a guest for a report row: the phone is masked without the pii right. */
function guestLabel(guest: Doc<"guests"> | null, pii: boolean) {
  if (!guest) return { name: "Гость удалён", phone: "" }
  return { name: guest.name?.trim() || "Без имени", phone: (pii ? guest.phone : maskPhone(guest.phone)) ?? "" }
}

/** Guests of the report's scope: home restaurant in the restaurants, or none with the whole network. */
async function* scopedGuests(ctx: QueryCtx, restaurants: string[], budget: Budget) {
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  for (const status of ["active", "inactive", undefined] as const) {
    for await (const guest of ctx.db.query("guests").withIndex("by_status_last_visit", (q) => q.eq("status", status))) {
      if (!spend(budget)) return
      if (inScope(guest.restaurantExternalId)) yield guest
    }
  }
}

// ── 01: activity ─────────────────────────────────────────────────────────────

const activity: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Гость", "text"), col("phone", "Телефон", "text"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("firstVisit", "Первый визит", "date"), col("lastVisit", "Последний визит", "date")]
  const budget = newBudget()
  const visits = await guestVisits(ctx, config, restaurants, budget)
  const guest = lookup(ctx, "guests")
  const pii = await canSeeGuestPii(ctx)
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  const ordered = [...visits.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
  const rows = []
  const totals = { visits: 0, revenue: 0 }
  for (const [guestId, row] of ordered) {
    const label = guestLabel(await guest(guestId), pii)
    if (needle && !label.name.toLocaleLowerCase("ru").includes(needle)) continue
    totals.visits += row.visits
    totals.revenue += row.revenue
    if (rows.length < ROW_LIMIT) rows.push({ key: guestId, cells: { group: label.name, phone: label.phone, visits: row.visits, revenue: row.revenue, averageCheck: row.visits ? Math.round(row.revenue / row.visits) : 0, firstVisit: row.first, lastVisit: row.last } })
  }
  const guests = needle ? rows.length : visits.size
  return {
    sourceLabel: "Визиты гостей по чекам кассы (предагрегат за день)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "guests", label: "Гостей с визитами", value: guests, unit: "count" },
      { key: "visits", label: "Визитов", value: totals.visits, unit: "count" },
      { key: "revenue", label: "Выручка гостей", value: totals.revenue, unit: "money" },
      { key: "visitsPerGuest", label: "Визитов на гостя", value: guests ? Math.round((totals.visits / guests) * 10) / 10 : 0, unit: "count" },
    ],
    truncated: budget.truncated || rows.length >= ROW_LIMIT,
  }
}

// ── 02: new and returning ─────────────────────────────────────────────────────

/** A guest is returning when they visited one of the restaurants before the period. */
async function visitedBefore(ctx: QueryCtx, guestId: string, restaurants: string[], before: string, budget: Budget) {
  for (const restaurant of restaurants) {
    spend(budget)
    const earlier = await ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_key_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "guest").eq("dimensionKey", guestId).lt("businessDate", before)).first()
    if (earlier) return true
  }
  return false
}

const newAndReturning: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Гости", "text"), col("guests", "Гостей", "count"), col("share", "Доля гостей, %", "percent"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money")]
  const budget = newBudget()
  const visits = await guestVisits(ctx, config, restaurants, budget)
  const rows = []
  for (const [guestId, row] of visits) {
    const returning = await visitedBefore(ctx, guestId, restaurants, config.dateFrom, budget)
    rows.push({ key: returning ? "returning" : "new", label: returning ? "Вернувшиеся" : "Новые", values: { guests: 1, visits: row.visits, revenue: row.revenue } })
  }
  const result = aggregate(rows, columns)
  const order = ["new", "returning"]
  result.rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  for (const row of result.rows) {
    row.cells.share = percent(Number(row.cells.guests), visits.size)
    row.cells.averageCheck = Number(row.cells.visits) ? Math.round(Number(row.cells.revenue) / Number(row.cells.visits)) : 0
  }
  delete result.totals.share
  delete result.totals.averageCheck
  const count = (key: string) => Number(result.rows.find((row) => row.key === key)?.cells.guests ?? 0)
  return {
    sourceLabel: "Первый визит гостя в выбранных ресторанах: до периода — вернувшийся, в периоде — новый",
    columns,
    ...result,
    kpis: [
      { key: "new", label: "Новых гостей", value: count("new"), unit: "count" },
      { key: "returning", label: "Вернувшихся", value: count("returning"), unit: "count" },
      { key: "returningShare", label: "Доля вернувшихся", value: percent(count("returning"), visits.size), unit: "percent" },
    ],
    truncated: budget.truncated,
  }
}

// ── 03: visit frequency ───────────────────────────────────────────────────────

const FREQUENCY_BUCKETS = [
  { key: "1", label: "1 визит", min: 1, max: 1 },
  { key: "2", label: "2 визита", min: 2, max: 2 },
  { key: "3-4", label: "3–4 визита", min: 3, max: 4 },
  { key: "5-9", label: "5–9 визитов", min: 5, max: 9 },
  { key: "10+", label: "10 и более", min: 10, max: Number.POSITIVE_INFINITY },
]

const frequency: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Частота", "text"), col("guests", "Гостей", "count"), col("share", "Доля гостей, %", "percent"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money")]
  const budget = newBudget()
  const visits = await guestVisits(ctx, config, restaurants, budget)
  const rows = FREQUENCY_BUCKETS.map((bucket) => ({ key: bucket.key, cells: { group: bucket.label, guests: 0, share: 0, visits: 0, revenue: 0 } as Record<string, number | string> }))
  for (const row of visits.values()) {
    const index = FREQUENCY_BUCKETS.findIndex((bucket) => row.visits >= bucket.min && row.visits <= bucket.max)
    if (index < 0) continue // a guest whose visits were all refunded away has 0 orders left
    const cells = rows[index].cells
    cells.guests = Number(cells.guests) + 1
    cells.visits = Number(cells.visits) + row.visits
    cells.revenue = Number(cells.revenue) + row.revenue
  }
  for (const row of rows) row.cells.share = percent(Number(row.cells.guests), visits.size)
  const totalVisits = [...visits.values()].reduce((sum, row) => sum + row.visits, 0)
  const totalRevenue = [...visits.values()].reduce((sum, row) => sum + row.revenue, 0)
  return {
    sourceLabel: "Визиты гостей за период, распределение по числу визитов",
    columns,
    rows,
    totals: { guests: visits.size, visits: totalVisits, revenue: totalRevenue },
    kpis: [
      { key: "guests", label: "Гостей", value: visits.size, unit: "count" },
      { key: "visitsPerGuest", label: "Визитов на гостя", value: visits.size ? Math.round((totalVisits / visits.size) * 10) / 10 : 0, unit: "count" },
      { key: "repeatShare", label: "Пришли больше одного раза", value: percent(visits.size - Number(rows[0].cells.guests), visits.size), unit: "percent" },
    ],
    truncated: budget.truncated,
  }
}

// ── 04: RFM ───────────────────────────────────────────────────────────────────

/**
 * Quintile scores 1…5 (5 = best): values ordered from worst to best, the rank's fifth is the score and
 * equal values share the score of the first of them. `better: "low"` for recency (fewer days is better).
 */
export function quintileScores(values: number[], better: "high" | "low") {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => (better === "high" ? a.value - b.value : b.value - a.value))
  const scores = new Array<number>(values.length)
  let previous: { value: number; score: number } | undefined
  order.forEach((entry, rank) => {
    const score = previous && previous.value === entry.value ? previous.score : Math.floor((rank * 5) / values.length) + 1
    scores[entry.index] = score
    previous = { value: entry.value, score }
  })
  return scores
}

const SEGMENTS = ["Чемпионы", "Лояльные", "Новые", "Требуют внимания", "Под угрозой ухода", "Спящие"] as const

export function rfmSegment(r: number, f: number) {
  if (r >= 4 && f >= 4) return "Чемпионы"
  if (r >= 3 && f >= 3) return "Лояльные"
  if (r >= 4) return "Новые"
  if (r <= 2 && f >= 3) return "Под угрозой ухода"
  if (r <= 2) return "Спящие"
  return "Требуют внимания"
}

const rfm: Calculator = async (ctx, config, restaurants) => {
  const detail = config.extra?.detail === true
  const budget = newBudget()
  const visits = [...(await guestVisits(ctx, config, restaurants, budget)).entries()].filter(([, row]) => row.visits > 0)
  const recency = quintileScores(visits.map(([, row]) => daysBetween(row.last, config.dateTo)), "low")
  const frequencyScores = quintileScores(visits.map(([, row]) => row.visits), "high")
  const monetary = quintileScores(visits.map(([, row]) => row.revenue), "high")
  const scored = visits.map(([guestId, row], index) => ({ guestId, row, r: recency[index], f: frequencyScores[index], m: monetary[index], segment: rfmSegment(recency[index], frequencyScores[index]) }))
  const bySegment = new Map<string, number>()
  for (const entry of scored) bySegment.set(entry.segment, (bySegment.get(entry.segment) ?? 0) + 1)
  const kpis: Result["kpis"] = [{ key: "guests", label: "Гостей в сегментации", value: scored.length, unit: "count" }, ...SEGMENTS.slice(0, 3).map((segment, index) => ({ key: `segment${index}`, label: segment, value: bySegment.get(segment) ?? 0, unit: "count" as const }))]
  const sourceLabel = `RFM по визитам за период: давность до ${config.dateTo}, частота и сумма — квинтили 1…5`

  if (detail) {
    const columns = [col("group", "Гость", "text"), col("phone", "Телефон", "text"), col("recencyDays", "Дней с визита", "count"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money"), col("r", "R", "count"), col("f", "F", "count"), col("m", "M", "count"), col("code", "RFM", "text"), col("segment", "Сегмент", "text")]
    const guest = lookup(ctx, "guests")
    const pii = await canSeeGuestPii(ctx)
    const rows = []
    for (const entry of scored.sort((a, b) => b.r + b.f + b.m - (a.r + a.f + a.m) || b.row.revenue - a.row.revenue).slice(0, ROW_LIMIT)) {
      const label = guestLabel(await guest(entry.guestId), pii)
      rows.push({ key: entry.guestId, cells: { group: label.name, phone: label.phone, recencyDays: daysBetween(entry.row.last, config.dateTo), visits: entry.row.visits, revenue: entry.row.revenue, r: entry.r, f: entry.f, m: entry.m, code: `${entry.r}${entry.f}${entry.m}`, segment: entry.segment } })
    }
    return { sourceLabel, columns, rows, totals: { guests: scored.length, visits: scored.reduce((sum, e) => sum + e.row.visits, 0), revenue: scored.reduce((sum, e) => sum + e.row.revenue, 0) }, kpis, truncated: budget.truncated || scored.length > ROW_LIMIT }
  }

  const columns = [col("group", "Сегмент", "text"), col("guests", "Гостей", "count"), col("share", "Доля гостей, %", "percent"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money"), col("r", "Средний R", "count"), col("f", "Средний F", "count"), col("m", "Средний M", "count")]
  const rows = SEGMENTS.flatMap((segment) => {
    const members = scored.filter((entry) => entry.segment === segment)
    if (!members.length) return []
    const avg = (pick: (entry: (typeof members)[number]) => number) => Math.round((members.reduce((sum, entry) => sum + pick(entry), 0) / members.length) * 10) / 10
    return [{ key: segment, cells: { group: segment, guests: members.length, share: percent(members.length, scored.length), visits: members.reduce((sum, entry) => sum + entry.row.visits, 0), revenue: members.reduce((sum, entry) => sum + entry.row.revenue, 0), r: avg((entry) => entry.r), f: avg((entry) => entry.f), m: avg((entry) => entry.m) } }]
  })
  return { sourceLabel, columns, rows, totals: { guests: scored.length, visits: scored.reduce((sum, e) => sum + e.row.visits, 0), revenue: scored.reduce((sum, e) => sum + e.row.revenue, 0) }, kpis, truncated: budget.truncated }
}

// ── 05, 08: accounts ──────────────────────────────────────────────────────────

/** Balance of an account right after its last transaction at or before `at`; an account without any transaction keeps its stored balance. */
async function accountBalanceAt(ctx: QueryCtx, account: Doc<"loyaltyAccounts">, at: number, budget: Budget) {
  spend(budget)
  const last = await ctx.db.query("loyaltyTransactions").withIndex("by_account_occurred", (q) => q.eq("accountId", account._id).lte("occurredAt", at)).order("desc").first()
  if (last) return last.balanceAfter
  const any = await ctx.db.query("loyaltyTransactions").withIndex("by_account_occurred", (q) => q.eq("accountId", account._id)).first()
  return any ? 0 : account.balance
}

async function* scopedAccounts(ctx: QueryCtx, restaurants: string[], budget: Budget, kind?: "bonus" | "deposit") {
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  const guest = lookup(ctx, "guests")
  const programs = [...(await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "published")).take(100)), ...(await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "inactive")).take(100)), ...(await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority", (q) => q.eq("status", "draft")).take(100))]
  for (const program of programs) {
    if (kind && program.programKind !== kind) continue
    for await (const account of ctx.db.query("loyaltyAccounts").withIndex("by_program", (q) => q.eq("programExternalId", program.externalId))) {
      if (!spend(budget)) return
      const owner = await guest(account.guestId)
      if (!owner || !inScope(owner.restaurantExternalId)) continue
      yield { account, program, guest: owner }
    }
  }
}

const accountBalances: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Гость", "text"), col("phone", "Телефон", "text"), col("program", "Программа", "text"), col("kind", "Счёт", "text"), col("opening", "На начало", "bonus"), col("change", "Изменение", "bonus"), col("closing", "На конец", "bonus"), col("reserved", "В резерве сейчас", "bonus")]
  const budget = newBudget()
  const pii = await canSeeGuestPii(ctx)
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  const rows = []
  const totals = { opening: 0, change: 0, closing: 0, reserved: 0 }
  const byKind = { bonus: 0, deposit: 0 }
  for await (const { account, program, guest } of scopedAccounts(ctx, restaurants, budget)) {
    const label = guestLabel(guest, pii)
    if (needle && ![label.name, program.name].some((text) => text.toLocaleLowerCase("ru").includes(needle))) continue
    const opening = await accountBalanceAt(ctx, account, dayStart(config.dateFrom) - 1, budget)
    const closing = await accountBalanceAt(ctx, account, dayEnd(config.dateTo), budget)
    if (!opening && !closing && !account.reserved) continue
    totals.opening += opening
    totals.closing += closing
    totals.change += closing - opening
    totals.reserved += account.reserved
    byKind[account.kind] += closing
    rows.push({ key: account.externalId, cells: { group: label.name, phone: label.phone, program: program.name, kind: account.kind === "deposit" ? "Депозитный" : "Бонусный", opening, change: closing - opening, closing, reserved: account.reserved } })
  }
  rows.sort((a, b) => Number(b.cells.closing) - Number(a.cells.closing))
  return {
    sourceLabel: "Счета гостей: баланс по последней операции на дату (гости ресторанов отчёта)",
    columns,
    rows: rows.slice(0, ROW_LIMIT),
    totals,
    kpis: [
      { key: "bonus", label: "Бонусов на счетах", value: byKind.bonus, unit: "bonus" },
      { key: "deposit", label: "Депозитов на счетах", value: byKind.deposit, unit: "money" },
      { key: "accounts", label: "Счетов с остатком", value: rows.length, unit: "count" },
    ],
    truncated: budget.truncated || rows.length > ROW_LIMIT,
  }
}

const DEPOSIT_OPERATION: Partial<Record<Doc<"loyaltyTransactions">["kind"], string>> = { accrual: "Пополнение", redemption: "Оплата депозитом", adjustment: "Корректировка", reversal: "Сторно", expiration: "Сгорание" }

const depositOperations: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Операция", "text"), col("count", "Операций", "count"), col("incoming", "Пополнено", "money"), col("outgoing", "Списано", "money"), col("net", "Сальдо", "money")]
  const budget = newBudget()
  const rows = []
  let accounts = 0
  let closing = 0
  for await (const { account } of scopedAccounts(ctx, restaurants, budget, "deposit")) {
    accounts += 1
    closing += await accountBalanceAt(ctx, account, dayEnd(config.dateTo), budget)
    for await (const tx of ctx.db.query("loyaltyTransactions").withIndex("by_account_occurred", (q) => q.eq("accountId", account._id).gte("occurredAt", dayStart(config.dateFrom)).lte("occurredAt", dayEnd(config.dateTo)))) {
      if (!spend(budget)) break
      const label = DEPOSIT_OPERATION[tx.kind]
      if (!label) continue // a reservation only holds money for an open check
      rows.push({ key: tx.kind, label, values: { count: 1, incoming: Math.max(0, tx.points), outgoing: Math.max(0, -tx.points), net: tx.points } })
    }
  }
  if (!accounts) return statusResult("Депозитных счетов нет: операции появятся после запуска депозитной программы", columns)
  const result = aggregate(rows, columns, "count")
  return {
    sourceLabel: "Операции депозитных счетов гостей",
    columns,
    ...result,
    kpis: [
      { key: "incoming", label: "Пополнено", value: result.totals.incoming ?? 0, unit: "money" },
      { key: "outgoing", label: "Списано", value: result.totals.outgoing ?? 0, unit: "money" },
      { key: "closing", label: "Остаток на конец", value: closing, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── 09: program effectiveness ─────────────────────────────────────────────────

/** Branch totals (orders, revenue net of refunds) of the period — the base the participants are cut from. */
async function branchTotals(ctx: QueryCtx, config: ReportConfig, restaurants: string[], budget: Budget) {
  const totals = { orders: 0, revenue: 0 }
  for (const restaurant of restaurants) {
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "branch").gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return totals
      totals.orders += fact.orderCount
      totals.revenue += fact.netAmount - fact.refundAmount
    }
  }
  return totals
}

const NO_PROGRAM = "no-program"

const programEffectiveness: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Программа", "text"), col("participants", "Гостей с визитами", "count"), col("orders", "Заказов", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money"), col("accrued", "Начислено", "bonus"), col("redeemed", "Списано", "bonus"), col("bonusCost", "Стоимость бонусов, % выручки", "percent")]
  const budget = newBudget()
  const visits = await guestVisits(ctx, config, restaurants, budget)
  const programs = new Map((await ctx.db.query("loyaltyPrograms").withIndex("by_status_priority").take(200)).map((program) => [program.externalId, program]))
  const groups = new Map<string, { label: string; participants: number; orders: number; revenue: number; accrued: number; redeemed: number }>()
  const group = (key: string) => {
    const existing = groups.get(key)
    if (existing) return existing
    const created = { label: key === NO_PROGRAM ? "Гости без счёта в программе" : (programs.get(key)?.name ?? key), participants: 0, orders: 0, revenue: 0, accrued: 0, redeemed: 0 }
    groups.set(key, created)
    return created
  }
  // A guest counts in one program: the bonus program of their accounts with the highest priority.
  for (const [guestId, row] of visits) {
    const id = ctx.db.normalizeId("guests", guestId)
    spend(budget)
    const accounts = id ? await ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", id)).take(20) : []
    const primary = accounts.filter((account) => account.kind === "bonus").sort((a, b) => (programs.get(a.programExternalId)?.priority ?? 999) - (programs.get(b.programExternalId)?.priority ?? 999))[0]
    const target = group(primary?.programExternalId ?? NO_PROGRAM)
    target.participants += 1
    target.orders += row.visits
    target.revenue += row.revenue
  }
  // Points accrued and redeemed on the orders of the restaurants in the period, by the program of the transaction.
  const restaurantIds = new Set<string>()
  for (const restaurant of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurant)).unique()
    if (row) restaurantIds.add(row._id)
  }
  const orderOf = new Map<string, Doc<"orders"> | null>()
  for await (const tx of ctx.db.query("loyaltyTransactions").withIndex("by_occurred_at", (q) => q.gte("occurredAt", dayStart(config.dateFrom)).lte("occurredAt", dayEnd(config.dateTo)))) {
    if (!spend(budget)) break
    if ((tx.kind !== "accrual" && tx.kind !== "redemption") || !tx.orderId) continue
    if (!orderOf.has(tx.orderId)) orderOf.set(tx.orderId, await ctx.db.get(tx.orderId))
    const order = orderOf.get(tx.orderId)
    if (!order?.restaurantId || !restaurantIds.has(order.restaurantId)) continue
    const target = group(tx.programExternalId ?? order.loyaltyProgramExternalId ?? NO_PROGRAM)
    if (tx.kind === "accrual") target.accrued += tx.points
    else target.redeemed += Math.abs(tx.points)
  }
  const base = await branchTotals(ctx, config, restaurants, budget)
  const participants = [...groups.values()].reduce((sum, row) => ({ orders: sum.orders + row.orders, revenue: sum.revenue + row.revenue }), { orders: 0, revenue: 0 })
  const others = { orders: Math.max(0, base.orders - participants.orders), revenue: base.revenue - participants.revenue }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([key, row]) => ({ key, cells: { group: row.label, participants: row.participants, orders: row.orders, revenue: row.revenue, averageCheck: row.orders ? Math.round(row.revenue / row.orders) : 0, accrued: row.accrued, redeemed: row.redeemed, bonusCost: percent(row.redeemed, row.revenue) } }))
  rows.push({ key: "non-participants", cells: { group: "Чеки без гостя (не участники)", participants: 0, orders: others.orders, revenue: others.revenue, averageCheck: others.orders ? Math.round(others.revenue / others.orders) : 0, accrued: 0, redeemed: 0, bonusCost: 0 } })
  const redeemed = [...groups.values()].reduce((sum, row) => sum + row.redeemed, 0)
  const accrued = [...groups.values()].reduce((sum, row) => sum + row.accrued, 0)
  return {
    sourceLabel: "Визиты гостей и чеки без гостя (предагрегат), операции программ лояльности",
    columns,
    rows,
    totals: { participants: visits.size, orders: base.orders, revenue: base.revenue, accrued, redeemed },
    kpis: [
      { key: "participantCheck", label: "Средний чек участника", value: participants.orders ? Math.round(participants.revenue / participants.orders) : 0, unit: "money" },
      { key: "otherCheck", label: "Средний чек без гостя", value: others.orders ? Math.round(others.revenue / others.orders) : 0, unit: "money" },
      { key: "participantShare", label: "Доля выручки участников", value: percent(participants.revenue, base.revenue), unit: "percent" },
      { key: "bonusCost", label: "Стоимость бонусов", value: percent(redeemed, participants.revenue), unit: "percent" },
    ],
    truncated: budget.truncated,
  }
}

// ── 10, 15, 16: messaging jobs ────────────────────────────────────────────────

/** Campaign sends of the messaging adapter (W3-LOY-08 / W3-INT-06 contract): provider "messaging", payload {campaignExternalId, guestId, channel, restaurantExternalId?}. */
export const MESSAGING_PROVIDER = "messaging"
type Payload = { campaignExternalId?: string; campaignName?: string; guestId?: string; channel?: string; restaurantExternalId?: string }
const payloadOf = (job: Doc<"integrationJobs">): Payload => (job.payload && typeof job.payload === "object" ? (job.payload as Payload) : {})

async function* messagingJobs(ctx: QueryCtx, config: ReportConfig, restaurants: string[], budget: Budget, channel?: "sms" | "email") {
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  for await (const job of ctx.db.query("integrationJobs").withIndex("by_provider_created", (q) => q.eq("provider", MESSAGING_PROVIDER).gte("createdAt", dayStart(config.dateFrom)).lte("createdAt", dayEnd(config.dateTo)))) {
    if (!spend(budget)) return
    const payload = payloadOf(job)
    if (channel && payload.channel !== channel) continue
    if (!inScope(payload.restaurantExternalId)) continue
    yield { job, payload }
  }
}

const SENT = new Set(["completed"])
const FAILED = new Set(["failed", "dead-letter"])

const campaignEffectiveness: Calculator = async (ctx, config, restaurants) => {
  const window = extraNumber(config, "windowDays", 7)
  const columns = [col("group", "Кампания", "text"), col("channel", "Канал", "text"), col("sent", "Отправлено", "count"), col("failed", "Не отправлено", "count"), col("converted", "Пришли в окне", "count"), col("conversion", "Конверсия, %", "percent"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money")]
  const budget = newBudget()
  const campaigns = new Map<string, { label: string; channel: string; sent: number; failed: number; converted: number; visits: number; revenue: number }>()
  for await (const { job, payload } of messagingJobs(ctx, config, restaurants, budget)) {
    if (job.operation !== "send-campaign" && !job.idempotencyKey.startsWith("campaign:")) continue
    const key = payload.campaignExternalId ?? job.sourceExternalId ?? "campaign"
    const row = campaigns.get(key) ?? { label: payload.campaignName ?? key, channel: payload.channel === "email" ? "Email" : "SMS", sent: 0, failed: 0, converted: 0, visits: 0, revenue: 0 }
    campaigns.set(key, row)
    if (FAILED.has(job.status)) row.failed += 1
    if (!SENT.has(job.status) || !payload.guestId) continue
    row.sent += 1
    // Attribution: visits of the guest from the day of the send through `window` days after it.
    const from = localDate(job.updatedAt)
    const visits = await guestVisits(ctx, { dateFrom: from, dateTo: shiftDate(from, window) }, restaurants, budget)
    const hit = visits.get(payload.guestId)
    if (hit && hit.visits > 0) {
      row.converted += 1
      row.visits += hit.visits
      row.revenue += hit.revenue
    }
  }
  const rows = [...campaigns.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([key, row]) => ({ key, cells: { group: row.label, channel: row.channel, sent: row.sent, failed: row.failed, converted: row.converted, conversion: percent(row.converted, row.sent), visits: row.visits, revenue: row.revenue } }))
  const sum = (pick: (row: (typeof rows)[number]["cells"]) => number) => rows.reduce((total, row) => total + pick(row.cells), 0)
  const totals = { sent: sum((c) => Number(c.sent)), failed: sum((c) => Number(c.failed)), converted: sum((c) => Number(c.converted)), visits: sum((c) => Number(c.visits)), revenue: sum((c) => Number(c.revenue)) }
  return {
    sourceLabel: `Рассылки кампаний за период; визит засчитывается в течение ${window} дн. после отправки`,
    columns,
    rows,
    totals,
    kpis: [
      { key: "sent", label: "Отправлено", value: totals.sent, unit: "count" },
      { key: "conversion", label: "Конверсия в визит", value: percent(totals.converted, totals.sent), unit: "percent" },
      { key: "revenue", label: "Выручка после рассылок", value: totals.revenue, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

function mailings(channel: "sms" | "email"): Calculator {
  return async (ctx, config, restaurants) => {
    const columns = [col("group", "Дата", "date"), col("total", "Сообщений", "count"), col("sent", "Отправлено", "count"), col("pending", "В очереди", "count"), col("failed", "Ошибок", "count"), col("cancelled", "Отменено", "count"), col("delivery", "Отправлено, %", "percent")]
    const budget = newBudget()
    const rows = []
    let lastError: string | undefined
    for await (const { job } of messagingJobs(ctx, config, restaurants, budget, channel)) {
      const date = localDate(job.createdAt)
      if (FAILED.has(job.status) && job.error) lastError = job.error
      rows.push({ key: date, label: date, values: { total: 1, sent: SENT.has(job.status) ? 1 : 0, pending: ["queued", "processing", "retrying"].includes(job.status) ? 1 : 0, failed: FAILED.has(job.status) ? 1 : 0, cancelled: job.status === "cancelled" ? 1 : 0 } })
    }
    const result = aggregate(rows, columns)
    result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
    for (const row of result.rows) row.cells.delivery = percent(Number(row.cells.sent), Number(row.cells.total))
    delete result.totals.delivery
    const t = result.totals
    const noun = channel === "sms" ? "SMS" : "Email"
    return {
      // The recipient never appears: a job carries the guest id only, and the report shows counts.
      sourceLabel: lastError && !t.sent ? `Задания рассылки ${noun}: ни одно не отправлено — ${lastError}` : `Задания рассылки ${noun} (очередь интеграций)`,
      columns,
      ...result,
      kpis: [
        { key: "total", label: "Сообщений", value: t.total ?? 0, unit: "count" },
        { key: "sent", label: "Отправлено", value: t.sent ?? 0, unit: "count" },
        { key: "failed", label: "Ошибок", value: t.failed ?? 0, unit: "count" },
        { key: "delivery", label: "Отправлено", value: percent(t.sent ?? 0, t.total ?? 0), unit: "percent" },
      ],
      truncated: budget.truncated,
    }
  }
}

// ── 11, 12: mechanics the business does not run (Г-11) ─────────────────────────

const coupons: Calculator = async () => statusResult("Недоступно: механика выключена — купоны не используются (решение Г-11)", [col("group", "Купон", "text"), col("issued", "Выдано", "count"), col("used", "Погашено", "count"), col("discount", "Скидка", "money")])
const referrals: Calculator = async () => statusResult("Недоступно: механика выключена — реферальная программа не используется (решение Г-11)", [col("group", "Пригласивший", "text"), col("invited", "Приглашено", "count"), col("visited", "Пришли", "count"), col("bonus", "Бонусы", "bonus")])

// ── 13: guest categories ──────────────────────────────────────────────────────

const categories: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Категория", "text"), col("assignment", "Назначение", "text"), col("guests", "Гостей", "count"), col("active", "С визитами в периоде", "count"), col("visits", "Визитов", "count"), col("revenue", "Выручка", "money"), col("averageCheck", "Средний чек", "money")]
  const budget = newBudget()
  const visits = await guestVisits(ctx, config, restaurants, budget)
  const catalog = new Map((await ctx.db.query("guestCategories").withIndex("by_external_id").take(200)).map((category) => [category.externalId, category]))
  const ASSIGNMENT: Record<string, string> = { manual: "Вручную", automatic: "Автоматически", default: "По умолчанию" }
  const rows = []
  let guests = 0
  let active = 0
  for await (const guest of scopedGuests(ctx, restaurants, budget)) {
    const visit = visits.get(guest._id)
    guests += 1
    if (visit && visit.visits > 0) active += 1
    const keys = guest.categoryExternalIds?.length ? guest.categoryExternalIds : ["none"]
    for (const key of keys) {
      const category = catalog.get(key)
      rows.push({ key, label: category?.name ?? (key === "none" ? "Без категории" : key), text: { assignment: category ? ASSIGNMENT[category.assignment] : "—" }, values: { guests: 1, active: visit && visit.visits > 0 ? 1 : 0, visits: visit?.visits ?? 0, revenue: visit?.revenue ?? 0 } })
    }
  }
  const result = aggregate(rows, columns, "guests")
  for (const row of result.rows) row.cells.averageCheck = Number(row.cells.visits) ? Math.round(Number(row.cells.revenue) / Number(row.cells.visits)) : 0
  delete result.totals.averageCheck
  // A guest in two categories counts in both rows, so the totals are by guest.
  result.totals.guests = guests
  result.totals.active = active
  return { sourceLabel: "Гости ресторанов отчёта по категориям (гость в нескольких категориях — в каждой)", columns, ...result, kpis: [{ key: "guests", label: "Гостей", value: guests, unit: "count" }, { key: "categories", label: "Категорий с гостями", value: result.rows.filter((row) => row.key !== "none").length, unit: "count" }], truncated: budget.truncated }
}

// ── 14: consents ──────────────────────────────────────────────────────────────

const CHANNELS = [
  { key: "personal-data", label: "Обработка ПДн" },
  { key: "cross-border", label: "Трансграничная передача" },
  { key: "sms", label: "SMS-рассылки" },
  { key: "email", label: "Email-рассылки" },
] as const

const consents: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Согласие", "text"), col("granted", "Действует", "count"), col("withdrawn", "Отозвано", "count"), col("expired", "Истекло", "count"), col("missing", "Нет записи", "count"), col("grantedShare", "Действует, %", "percent")]
  const budget = newBudget()
  const end = dayEnd(config.dateTo)
  const counts = new Map<string, { granted: number; withdrawn: number; expired: number; missing: number }>(CHANNELS.map((channel) => [channel.key, { granted: 0, withdrawn: 0, expired: 0, missing: 0 }]))
  let guests = 0
  let unknown = 0
  for await (const guest of scopedGuests(ctx, restaurants, budget)) {
    if (guest.createdAt > end) continue
    guests += 1
    if ((guest.consentState ?? "unknown") === "unknown") unknown += 1
    for (const channel of CHANNELS) {
      spend(budget)
      const last = await ctx.db.query("guestConsents").withIndex("by_guest_channel_recorded", (q) => q.eq("guestId", guest._id).eq("channel", channel.key).lte("recordedAt", end)).order("desc").first()
      const row = counts.get(channel.key)!
      if (!last) row.missing += 1
      else if (!last.granted) row.withdrawn += 1
      else if (last.validUntil !== undefined && last.validUntil < end) row.expired += 1
      else row.granted += 1
    }
  }
  const rows = CHANNELS.map((channel) => {
    const row = counts.get(channel.key)!
    return { key: channel.key, cells: { group: channel.label, ...row, grantedShare: percent(row.granted, guests) } }
  })
  const sms = counts.get("sms")!.granted
  const email = counts.get("email")!.granted
  return {
    sourceLabel: `Журнал согласий: последнее событие по каналу на ${config.dateTo}`,
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "guests", label: "Гостей", value: guests, unit: "count" },
      { key: "sms", label: "Можно писать SMS", value: sms, unit: "count" },
      { key: "email", label: "Можно писать email", value: email, unit: "count" },
      { key: "unknown", label: "Согласие не получено (с кассы)", value: unknown, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

export const LOYALTY_CALCULATORS: Record<string, Calculator> = {
  "loyalty-01": activity,
  "loyalty-02": newAndReturning,
  "loyalty-03": frequency,
  "loyalty-04": rfm,
  "loyalty-05": accountBalances,
  "loyalty-08": depositOperations,
  "loyalty-09": programEffectiveness,
  "loyalty-10": campaignEffectiveness,
  "loyalty-11": coupons,
  "loyalty-12": referrals,
  "loyalty-13": categories,
  "loyalty-14": consents,
  "loyalty-15": mailings("sms"),
  "loyalty-16": mailings("email"),
}
