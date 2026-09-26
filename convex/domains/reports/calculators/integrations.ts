import type { Doc } from "../../../_generated/dataModel"
import type { ReportConfig, ReportResult } from "../../../lib/reportConfig"
import { CLOUD_API_PROVIDER } from "../../integrations/adapters/cloudApiWebhook"
import type { EquipmentType } from "../../platform/modules"
import type { Calculator } from "../registry"
import { matcher } from "./_facts"
import { aggregate, col, dayEnd, dayStart } from "./_shared"
import { coversNetwork, localDateTime, restaurantNames, scopeOf, statusResult } from "./_scope"
import { newBudget, percent, spend, type Budget } from "./stockHelpers"

// Integration and control reports of W3 (docs/IMPLEMENTATION-PLAN.md W3-RPT-06). The queue is
// integrationJobs (never an iiko write), bank reconciliation the bank-statement records of FIN, fiscal
// status the non-fiscal receipts (D6), the EGAIS family «Не применяется в РК» (D4) — a status, not an
// error. A job's payload is never shown: it can carry an address or a one-time code.

type QueryCtx = Parameters<Calculator>[0]
type Result = Omit<ReportResult, "reportId" | "generatedAt">
type Job = Doc<"integrationJobs">

const ROW_LIMIT = 2000
const STATUS_LABEL: Record<Job["status"], string> = { queued: "В очереди", processing: "В работе", retrying: "Повтор", completed: "Выполнено", failed: "Ошибка", "dead-letter": "Не доставлено", cancelled: "Отменено" }
const BACKLOG = ["queued", "processing", "retrying"] as const
const FAILED = new Set<Job["status"]>(["failed", "dead-letter"])
const payloadRestaurant = (job: Job) => (job.payload && typeof job.payload === "object" && typeof (job.payload as { restaurantExternalId?: unknown }).restaurantExternalId === "string" ? (job.payload as { restaurantExternalId: string }).restaurantExternalId : undefined)

/** Jobs created in the period that the report's scope sees (a job without a restaurant is network-level). */
async function* periodJobs(ctx: QueryCtx, config: ReportConfig, restaurants: string[], budget: Budget, provider?: string) {
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  const range = provider
    ? ctx.db.query("integrationJobs").withIndex("by_provider_created", (q) => q.eq("provider", provider).gte("createdAt", from).lte("createdAt", to))
    : ctx.db.query("integrationJobs").withIndex("by_created", (q) => q.gte("createdAt", from).lte("createdAt", to))
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  for await (const job of range) {
    if (!spend(budget)) return
    if (!inScope(payloadRestaurant(job))) continue
    if (needle && ![job.provider, job.operation, job.error ?? ""].some((text) => text.toLocaleLowerCase("ru").includes(needle))) continue
    yield job
  }
}

const jobColumns = [col("group", "Когда", "text"), col("provider", "Провайдер", "text"), col("operation", "Операция", "text"), col("attempts", "Попыток", "count"), col("status", "Статус", "text"), col("error", "Ошибка", "text")]
const jobRow = (job: Job) => ({ key: job.externalId, cells: { group: localDateTime(job.createdAt), provider: job.provider, operation: job.operation, attempts: job.attempts, status: STATUS_LABEL[job.status], error: job.error ?? "—" } })

// ── 01: queue ─────────────────────────────────────────────────────────────────

const queue: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Провайдер · операция", "text"), col("total", "Заданий", "count"), col("queued", "В очереди", "count"), col("processing", "В работе", "count"), col("retrying", "Повтор", "count"), col("completed", "Выполнено", "count"), col("failed", "Ошибка", "count"), col("cancelled", "Отменено", "count"), col("successRate", "Выполнено, %", "percent")]
  const budget = newBudget()
  const rows = []
  for await (const job of periodJobs(ctx, config, restaurants, budget)) {
    const status = FAILED.has(job.status) ? "failed" : job.status
    rows.push({ key: `${job.provider}:${job.operation}`, label: `${job.provider} · ${job.operation}`, values: { total: 1, [status]: 1 } })
  }
  const result = aggregate(rows, columns, "total")
  for (const row of result.rows) row.cells.successRate = percent(Number(row.cells.completed), Number(row.cells.total))
  delete result.totals.successRate
  // The backlog right now, whatever the period: what still waits for its adapter.
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  let backlog = 0
  let oldest = Number.POSITIVE_INFINITY
  for (const status of BACKLOG) {
    for await (const job of ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", status))) {
      if (!spend(budget)) break
      if (!inScope(payloadRestaurant(job))) continue
      backlog += 1
      oldest = Math.min(oldest, job.createdAt)
    }
  }
  return {
    sourceLabel: "Очередь интеграций: задания, созданные за период, по провайдерам и операциям",
    columns,
    ...result,
    kpis: [
      { key: "total", label: "Заданий за период", value: result.totals.total ?? 0, unit: "count" },
      { key: "backlog", label: "Ждут отправки сейчас", value: backlog, unit: "count" },
      { key: "failed", label: "С ошибкой", value: result.totals.failed ?? 0, unit: "count" },
      ...(backlog ? [{ key: "oldest", label: `Самое старое с ${localDateTime(oldest)}`, value: backlog, unit: "count" as const }] : []),
    ],
    truncated: budget.truncated,
  }
}

// ── 02, 03: errors and retries ────────────────────────────────────────────────

const errors: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const rows = []
  const byProvider = new Map<string, number>()
  for await (const job of periodJobs(ctx, config, restaurants, budget)) {
    if (!FAILED.has(job.status)) continue
    byProvider.set(job.provider, (byProvider.get(job.provider) ?? 0) + 1)
    if (rows.length < ROW_LIMIT) rows.push(jobRow(job))
  }
  rows.sort((a, b) => b.cells.group.localeCompare(a.cells.group))
  const top = [...byProvider.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    sourceLabel: "Задания очереди со статусом «Ошибка» или «Не доставлено» за период",
    columns: jobColumns,
    rows,
    totals: {},
    kpis: [{ key: "errors", label: "Ошибок", value: rows.length, unit: "count" }, ...(top ? [{ key: "top", label: `Больше всего: ${top[0]}`, value: top[1], unit: "count" as const }] : [])],
    truncated: budget.truncated || rows.length >= ROW_LIMIT,
  }
}

const retries: Calculator = async (ctx, config, restaurants) => {
  const columns = [...jobColumns, col("nextAttempt", "Следующая попытка", "text")]
  const budget = newBudget()
  const rows = []
  let recovered = 0
  for await (const job of periodJobs(ctx, config, restaurants, budget)) {
    if (job.attempts <= 1) continue
    if (job.status === "completed") recovered += 1
    if (rows.length < ROW_LIMIT) rows.push({ key: job.externalId, cells: { ...jobRow(job).cells, nextAttempt: job.status === "retrying" || job.status === "queued" ? localDateTime(job.nextAttemptAt) : "—" } })
  }
  rows.sort((a, b) => b.cells.attempts - a.cells.attempts)
  return {
    sourceLabel: "Задания очереди, отправленные повторно (больше одной попытки), за период",
    columns,
    rows,
    totals: { attempts: rows.reduce((sum, row) => sum + row.cells.attempts, 0) },
    kpis: [
      { key: "retried", label: "Повторных отправок", value: rows.length, unit: "count" },
      { key: "recovered", label: "Выполнены после повтора", value: recovered, unit: "count" },
      { key: "recoveredShare", label: "Доля восстановленных", value: percent(recovered, rows.length), unit: "percent" },
    ],
    truncated: budget.truncated || rows.length >= ROW_LIMIT,
  }
}

// ── 04, 06: 1C and EDI — queue of a provider, honest while it is not connected ──────

function providerReport(provider: string, title: string): Calculator {
  return async (ctx, config, restaurants) => {
    const columns = [col("group", "Операция", "text"), col("total", "Документов", "count"), col("completed", "Передано", "count"), col("pending", "В очереди", "count"), col("failed", "Ошибка", "count"), col("lastError", "Последняя ошибка", "text")]
    const budget = newBudget()
    const rows = []
    let lastError = ""
    for await (const job of periodJobs(ctx, config, restaurants, budget, provider)) {
      if (job.error) lastError = job.error
      rows.push({ key: job.operation, label: job.operation, text: { lastError: job.error ?? "—" }, values: { total: 1, completed: job.status === "completed" ? 1 : 0, pending: (BACKLOG as readonly string[]).includes(job.status) ? 1 : 0, failed: FAILED.has(job.status) ? 1 : 0 } })
    }
    const result = aggregate(rows, columns, "total")
    const t = result.totals
    const connected = (t.completed ?? 0) > 0
    return {
      sourceLabel: connected ? `${title}: задания очереди интеграций за период` : `Не подключено: провайдер «${title}» не выбран — документы ждут в очереди или уходят в «Не доставлено»${lastError ? ` (${lastError})` : ""}`,
      columns,
      ...result,
      kpis: [
        { key: "total", label: "Документов", value: t.total ?? 0, unit: "count" },
        { key: "completed", label: "Передано", value: t.completed ?? 0, unit: "count" },
        { key: "failed", label: "Ошибок", value: t.failed ?? 0, unit: "count" },
      ],
      truncated: budget.truncated,
    }
  }
}

// ── 05: bank reconciliation ───────────────────────────────────────────────────

const MATCH_LABEL: Record<string, string> = { unmatched: "Не сопоставлено", suggested: "Предложено", matched: "Сопоставлено", posted: "Проведено" }

/** Bank-statement lines (W3-FIN-11 data contract) against the bank payments of FIN. */
const bankReconciliation: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Дата", "date"), col("number", "Выписка", "text"), col("counterparty", "Контрагент", "text"), col("direction", "Направление", "text"), col("amount", "Сумма", "money"), col("match", "Сопоставление", "text"), col("payment", "Платёж", "text")]
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const rows: Result["rows"] = []
  const matchedPayments = new Set<string>()
  const counts = { lines: 0, matched: 0, matchedAmount: 0, unmatchedAmount: 0 }
  for (const restaurant of restaurants) {
    for await (const line of ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "bank-statements").eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      if (line.status === "cancelled" || line.status === "reversed") continue
      const status = typeof line.data.matchStatus === "string" ? line.data.matchStatus : "unmatched"
      const paymentId = typeof line.data.matchedPaymentExternalId === "string" ? line.data.matchedPaymentExternalId : undefined
      const payment = paymentId ? await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", paymentId)).unique() : null
      const matched = Boolean(payment) && (status === "matched" || status === "posted")
      if (payment) matchedPayments.add(payment.externalId)
      counts.lines += 1
      if (matched) {
        counts.matched += 1
        counts.matchedAmount += line.amount
      } else counts.unmatchedAmount += line.amount
      rows.push({ key: line.externalId, cells: { group: line.businessDate, number: line.number, counterparty: typeof line.data.counterparty === "string" ? line.data.counterparty : "—", direction: line.data.direction === "outgoing" ? "Расход" : "Приход", amount: line.amount, match: MATCH_LABEL[status] ?? status, payment: payment ? `${payment.number} · ${names.get(payment.restaurantExternalId) ?? payment.restaurantExternalId}` : "—" } })
    }
  }
  // Posted bank payments of the period that no statement line confirms.
  let unconfirmed = 0
  let unconfirmedAmount = 0
  for (const restaurant of restaurants) {
    for await (const payment of ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "payments").eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      if (payment.status !== "posted" || payment.data.method !== "bank" || matchedPayments.has(payment.externalId)) continue
      unconfirmed += 1
      unconfirmedAmount += payment.amount
      rows.push({ key: `payment:${payment.externalId}`, cells: { group: payment.businessDate, number: "—", counterparty: payment.name, direction: payment.data.direction === "outgoing" ? "Расход" : "Приход", amount: payment.amount, match: "Нет в выписке", payment: payment.number } })
    }
  }
  rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
  return {
    sourceLabel: counts.lines ? "Строки банковских выписок против банковских платежей за период" : "Выписки за период не загружены — показаны банковские платежи без подтверждения выпиской",
    columns,
    rows: rows.slice(0, ROW_LIMIT),
    totals: {},
    kpis: [
      { key: "matched", label: "Сопоставлено строк", value: counts.matched, unit: "count" },
      { key: "unmatched", label: "Не сопоставлено", value: counts.lines - counts.matched, unit: "count" },
      { key: "unmatchedAmount", label: "Сумма без сопоставления", value: counts.unmatchedAmount, unit: "money" },
      { key: "unconfirmed", label: "Платежей нет в выписке", value: unconfirmed, unit: "count" },
      { key: "unconfirmedAmount", label: "На сумму", value: unconfirmedAmount, unit: "money" },
    ],
    truncated: budget.truncated || rows.length > ROW_LIMIT,
  }
}

// ── 07: fiscal documents (D6: not connected, every receipt is non-fiscal) ─────────

const fiscalStatus: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Ресторан", "text"), col("receipts", "Чеков", "count"), col("amount", "Сумма чеков", "money"), col("refunds", "Возвратов", "count"), col("fiscal", "Фискализировано", "count"), col("nonFiscal", "Нефискальных", "count"), col("zReports", "Z-отчётов (нефискальных)", "count")]
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const rows = []
  for (const restaurant of restaurants) {
    const row = { receipts: 0, amount: 0, refunds: 0, fiscal: 0, nonFiscal: 0, zReports: 0 }
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "branch").gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      row.receipts += fact.orderCount
      row.amount += fact.netAmount
      row.refunds += fact.refundCount
    }
    const doc = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurant)).unique()
    if (doc) {
      for await (const report of ctx.db.query("zReports").withIndex("by_restaurant_date", (q) => q.eq("restaurantId", doc._id).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
        if (!spend(budget)) break
        if (report.nonFiscal) row.zReports += 1
      }
    }
    // Every sale and refund receipt is non-fiscal until a fiscal provider is connected (D6).
    row.nonFiscal = row.receipts + row.refunds
    if (row.receipts || row.zReports) rows.push({ key: restaurant, label: names.get(restaurant) ?? restaurant, values: row })
  }
  const result = aggregate(rows, columns, "receipts")
  let fiscalJobs = 0
  for await (const job of periodJobs(ctx, config, restaurants, budget, "fiscal")) if (job.status === "completed") fiscalJobs += 1
  return {
    sourceLabel: fiscalJobs ? "Чеки кассы и задания фискального провайдера" : "Фискализация не подключена (D6): все чеки и Z-отчёты кассы нефискальные",
    columns,
    ...result,
    kpis: [
      { key: "nonFiscal", label: "Нефискальных чеков", value: result.totals.nonFiscal ?? 0, unit: "count" },
      { key: "fiscal", label: "Фискализировано", value: fiscalJobs, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── 08, 09, 10: EGAIS family — not applicable in Kazakhstan (D4) ─────────────────

function notApplicableKz(what: string): Calculator {
  return async () => statusResult(`Не применяется в РК: ${what} — механика российской системы ЕГАИС, в Казахстане не ведётся`, [col("group", "Документ", "text"), col("date", "Дата", "date"), col("status", "Статус", "text")])
}

// ── 11: Cloud API and webhooks ────────────────────────────────────────────────

/**
 * What came and went through the Cloud API (W3-INT-03): the delivery orders the website sent (they carry
 * the channel's own id, deliveryOrders.sourceOrderId), the inbound webhooks and the website's outgoing
 * webhooks (provider «cloud-api») of the integration queue.
 */
const cloudApi: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Источник", "text"), col("kind", "Тип", "text"), col("total", "Всего", "count"), col("completed", "Принято / выполнено", "count"), col("pending", "В очереди", "count"), col("failed", "Ошибок", "count"), col("cancelled", "Отменено", "count"), col("amount", "Сумма заказов", "money"), col("last", "Последний", "text")]
  const budget = newBudget()
  const matches = matcher(config)
  const groups = new Map<string, { label: string; kind: string; total: number; completed: number; pending: number; failed: number; cancelled: number; amount: number; last: number }>()
  const add = (key: string, label: string, kind: string, at: number, outcome: "completed" | "pending" | "failed" | "cancelled", amount = 0) => {
    const row = groups.get(key) ?? { label, kind, total: 0, completed: 0, pending: 0, failed: 0, cancelled: 0, amount: 0, last: 0 }
    row.total += 1
    row[outcome] += 1
    row.amount += amount
    row.last = Math.max(row.last, at)
    groups.set(key, row)
  }
  const sources = new Map<string, string>()
  const sourceName = async (externalId: string) => {
    if (!sources.has(externalId)) sources.set(externalId, (await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())?.name ?? externalId)
    return sources.get(externalId)!
  }
  let orders = 0
  for (const restaurant of restaurants) {
    for await (const order of ctx.db.query("deliveryOrders").withIndex("by_restaurant_created", (q) => q.eq("restaurantExternalId", restaurant).gte("createdAt", dayStart(config.dateFrom)).lte("createdAt", dayEnd(config.dateTo)))) {
      if (!spend(budget)) break
      if (!order.sourceOrderId) continue
      const name = await sourceName(order.sourceExternalId)
      if (!matches(name, order.number, order.sourceOrderId)) continue
      orders += 1
      const cancelled = order.status === "cancelled"
      add(`orders:${order.sourceExternalId}`, name, "Заказы через Cloud API", order.createdAt, cancelled ? "cancelled" : "completed", cancelled ? 0 : order.total)
    }
  }
  const outcomeOf = (job: Job) => (job.status === "completed" ? "completed" : FAILED.has(job.status) ? "failed" : job.status === "cancelled" ? "cancelled" : "pending")
  for await (const job of periodJobs(ctx, config, restaurants, budget)) {
    if (job.direction === "inbound") add(`webhook-in:${job.provider}`, job.provider, "Входящий вебхук", job.createdAt, outcomeOf(job))
    else if (job.provider === CLOUD_API_PROVIDER) add(`webhook-out:${job.operation}`, "Сайт (Cloud API)", `Исходящий вебхук · ${job.operation}`, job.createdAt, outcomeOf(job))
  }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, row]) => ({ key, cells: { group: row.label, kind: row.kind, total: row.total, completed: row.completed, pending: row.pending, failed: row.failed, cancelled: row.cancelled, amount: row.amount, last: localDateTime(row.last) } }))
  const sum = (key: "total" | "completed" | "pending" | "failed" | "cancelled" | "amount") => rows.reduce((total, row) => total + row.cells[key], 0)
  return {
    sourceLabel: rows.length ? "Заказы доставки, принятые через Cloud API, и вебхуки очереди интеграций (входящие и исходящие сайту)" : "Заказов через Cloud API и вебхуков за период нет",
    columns,
    rows,
    totals: { total: sum("total"), completed: sum("completed"), pending: sum("pending"), failed: sum("failed"), cancelled: sum("cancelled"), amount: sum("amount") },
    kpis: [
      { key: "orders", label: "Заказов через API", value: orders, unit: "count" },
      { key: "amount", label: "Сумма заказов", value: sum("amount"), unit: "money" },
      { key: "webhooks", label: "Вебхуков", value: sum("total") - orders, unit: "count" },
      { key: "failed", label: "Ошибок", value: sum("failed"), unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── 12: external menu publication ─────────────────────────────────────────────

const CHANNEL_LABEL: Record<Doc<"externalMenus">["channel"], string> = { website: "Сайт", "mobile-app": "Мобильное приложение", aggregators: "Агрегаторы", all: "Все каналы" }
const MENU_STATUS: Record<Doc<"externalMenus">["status"], string> = { draft: "Черновик", published: "Опубликовано", inactive: "Снято с публикации" }
const MENU_RECORDS_LIMIT = 200

/**
 * The external menu (W3-INT-04): every snapshot published in the period for the report's restaurants
 * (the version is the content hash — an unchanged catalog adds no row), with its channel record. A record
 * in mode «живое меню» has no snapshots: the API serves the current catalog, counted in the KPIs.
 */
const externalMenu: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Когда", "text"), col("menu", "Публикация", "text"), col("channel", "Канал", "text"), col("restaurant", "Ресторан", "text"), col("version", "Версия", "text"), col("items", "Позиций", "count"), col("author", "Опубликовал", "text"), col("status", "Статус записи", "text")]
  const names = await restaurantNames(ctx, restaurants)
  const selected = new Set(restaurants)
  const matches = matcher(config)
  const records = await ctx.db.query("externalMenus").withIndex("by_creation_time").order("desc").take(MENU_RECORDS_LIMIT)
  const rows = []
  let menus = 0
  let live = 0
  let versionsTruncated = false
  for (const record of records) {
    const covered = record.restaurantExternalIds.includes("*") ? restaurants : record.restaurantExternalIds.filter((id) => selected.has(id))
    if (!covered.length) continue
    menus += 1
    if (record.mode === "live" && record.status === "published") live += 1
    for (const restaurant of covered) {
      const versions = await ctx.db.query("externalMenuVersions").withIndex("by_record_restaurant_published", (q) => q.eq("recordExternalId", record.externalId).eq("restaurantExternalId", restaurant).gte("publishedAt", dayStart(config.dateFrom)).lte("publishedAt", dayEnd(config.dateTo))).take(100)
      if (versions.length === 100) versionsTruncated = true
      for (const version of versions) {
        if (!matches(record.name, record.number, names.get(restaurant) ?? restaurant)) continue
        rows.push({ key: String(version._id), cells: { group: localDateTime(version.publishedAt), menu: `${record.number} «${record.name}»`, channel: CHANNEL_LABEL[record.channel], restaurant: names.get(restaurant) ?? restaurant, version: version.version.slice(0, 8), items: version.itemCount, author: version.publishedBy, status: MENU_STATUS[record.status] } })
      }
    }
  }
  rows.sort((a, b) => b.cells.group.localeCompare(a.cells.group))
  return {
    sourceLabel: menus ? "Снимки внешнего меню по ресторанам, опубликованные за период (версия — хеш содержимого)" : "Не подключено: внешнее меню не настроено — создайте публикацию в разделе «Внешнее меню»",
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "publications", label: "Снимков меню", value: rows.length, unit: "count" },
      { key: "menus", label: "Публикаций (каналов)", value: menus, unit: "count" },
      { key: "live", label: "В режиме «живое меню»", value: live, unit: "count" },
    ],
    truncated: records.length === MENU_RECORDS_LIMIT || versionsTruncated,
  }
}

// ── 13: equipment ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { pos: "Касса", kds: "Экран кухни", office: "Офис", delivery: "Касса доставки" }
const EQUIPMENT_LABEL: Record<EquipmentType, string> = { "receipt-printer": "Принтер чеков", "kitchen-printer": "Кухонный принтер", "fiscal-register": "ККМ", scale: "Весы", kds: "Экран кухни", "payment-terminal": "Платёжный терминал" }
const SILENT_MS = 24 * 3_600_000
const STATE_LABEL = { online: "На связи", silent: "Нет отклика больше суток", off: "Отключено", unknown: "Нет данных об отклике" } as const
const dataText = (data: Doc<"platformRecords">["data"], key: string) => (typeof data[key] === "string" && (data[key] as string).trim() ? (data[key] as string).trim() : "")

/**
 * The POS terminals and the equipment register of W3-ADM-11 (platformRecords «equipment»: printers, fiscal
 * registers, scales, kitchen screens, payment terminals). A terminal answers by its last session activity
 * or sign-in; a device bound to a terminal answers by that terminal — a free-standing one has no signal.
 */
const equipment: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Устройство", "text"), col("restaurant", "Ресторан", "text"), col("kind", "Тип", "text"), col("serial", "Серийный №", "text"), col("connection", "Подключение", "text"), col("terminal", "Терминал", "text"), col("lastSeen", "Последний отклик", "text"), col("state", "Состояние", "text")]
  const names = await restaurantNames(ctx, restaurants)
  const matches = matcher(config)
  const at = Math.min(Date.now(), dayEnd(config.dateTo))
  const rows: { key: string; cells: Record<string, string> }[] = []
  const states = { online: 0, silent: 0, off: 0, unknown: 0 }
  let truncated = false
  const push = (key: string, cells: Record<string, string>, state: keyof typeof STATE_LABEL, lastSeen: number) => {
    if (!matches(cells.group, cells.kind, cells.serial)) return
    states[state] += 1
    rows.push({ key, cells: { ...cells, lastSeen: lastSeen ? localDateTime(lastSeen) : "Нет данных", state: STATE_LABEL[state] } })
  }
  for (const restaurant of restaurants) {
    const doc = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurant)).unique()
    if (!doc) continue
    const restaurantName = names.get(restaurant) ?? restaurant
    const terminals = new Map<string, { name: string; active: boolean; lastSeen: number }>()
    for (const terminal of await ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", doc._id)).take(100)) {
      const session = await ctx.db.query("posSessions").withIndex("by_terminal_created", (q) => q.eq("terminalId", terminal._id).lte("createdAt", at)).order("desc").first()
      const lastSeen = Math.max(session ? Math.min(session.lastActivityAt, at) : 0, terminal.lastLoginAt && terminal.lastLoginAt <= at ? terminal.lastLoginAt : 0)
      terminals.set(terminal.externalId, { name: terminal.name, active: terminal.active, lastSeen })
      const state = !terminal.active ? "off" : lastSeen && at - lastSeen <= SILENT_MS ? "online" : "silent"
      push(terminal.externalId, { group: `${terminal.name} №${terminal.terminalNumber}`, restaurant: restaurantName, kind: KIND_LABEL[terminal.kind ?? "pos"] ?? "Касса", serial: "—", connection: terminal.appVersion ? `Версия ${terminal.appVersion}` : "—", terminal: "—" }, state, lastSeen)
    }
    const devices = await ctx.db.query("platformRecords").withIndex("by_module_restaurant_date", (q) => q.eq("moduleId", "equipment").eq("restaurantExternalId", restaurant)).take(200)
    if (devices.length === 200) truncated = true
    for (const device of devices.sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
      const type = dataText(device.data, "type") as EquipmentType
      const bound = terminals.get(dataText(device.data, "terminalExternalId"))
      const lastSeen = bound?.active ? bound.lastSeen : 0
      const state = device.status !== "active" ? "off" : !bound ? "unknown" : !bound.active ? "off" : lastSeen && at - lastSeen <= SILENT_MS ? "online" : "silent"
      const connection = [dataText(device.data, "driver"), dataText(device.data, "endpoint")].filter(Boolean).join(" · ") || "—"
      push(device.externalId, { group: device.name, restaurant: restaurantName, kind: EQUIPMENT_LABEL[type] ?? type, serial: dataText(device.data, "serial") || "—", connection, terminal: bound?.name ?? "—" }, state, lastSeen)
    }
  }
  return {
    sourceLabel: "Кассовые терминалы и реестр оборудования (принтеры, ККМ, весы, экраны кухни, эквайринг); отклик устройства — по привязанному терминалу",
    columns,
    rows,
    totals: {},
    kpis: [
      { key: "online", label: "На связи", value: states.online, unit: "count" },
      { key: "silent", label: "Без отклика > 24 ч", value: states.silent, unit: "count" },
      { key: "off", label: "Отключено", value: states.off, unit: "count" },
      { key: "unknown", label: "Без привязки к терминалу", value: states.unknown, unit: "count" },
    ],
    truncated,
  }
}


// ── 14: system events ─────────────────────────────────────────────────────────

const systemEvents: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Когда", "text"), col("action", "Действие", "text"), col("summary", "Описание", "text"), col("resource", "Объект", "text"), col("restaurant", "Ресторан", "text"), col("actor", "Кто", "text")]
  const inScope = scopeOf(restaurants, await coversNetwork(ctx, restaurants))
  const names = await restaurantNames(ctx, restaurants)
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  const budget = newBudget()
  const rows = []
  const actions = new Set<string>()
  for await (const event of ctx.db.query("auditEvents").withIndex("by_occurred_at", (q) => q.gte("occurredAt", dayStart(config.dateFrom)).lte("occurredAt", dayEnd(config.dateTo))).order("desc")) {
    if (!spend(budget)) break
    if (!inScope(event.restaurantExternalId)) continue
    if (needle && !(event.searchText ?? `${event.action} ${event.summary}`).includes(needle)) continue
    actions.add(event.action)
    rows.push({ key: String(event._id), cells: { group: localDateTime(event.occurredAt), action: event.action, summary: event.summary, resource: `${event.resourceType} ${event.resourceExternalId}`, restaurant: event.restaurantExternalId ? (names.get(event.restaurantExternalId) ?? event.restaurantExternalId) : "Сеть", actor: event.actorKey } })
    if (rows.length >= ROW_LIMIT) break
  }
  return { sourceLabel: "Журнал аудита (кассы и офиса) за период, новые сверху", columns, rows, totals: {}, kpis: [{ key: "events", label: "Событий", value: rows.length, unit: "count" }, { key: "actions", label: "Видов действий", value: actions.size, unit: "count" }], truncated: budget.truncated || rows.length >= ROW_LIMIT }
}

// ── 15: cash reports (X / Z) ──────────────────────────────────────────────────

const cashReports: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Отчёт", "text"), col("kind", "Вид", "text"), col("date", "Дата", "date"), col("terminal", "Касса", "text"), col("shift", "Смена", "count"), col("author", "Сформировал", "text"), col("netSales", "Выручка", "money"), col("expectedCash", "Наличные в кассе", "money")]
  const names = await restaurantNames(ctx, restaurants)
  const budget = newBudget()
  const rows = []
  let x = 0
  let z = 0
  for (const restaurant of restaurants) {
    const doc = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurant)).unique()
    if (!doc) continue
    const terminals = new Map<string, string>()
    for (const terminal of await ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", doc._id)).take(100)) {
      terminals.set(terminal._id, terminal.name)
      for await (const report of ctx.db.query("xReports").withIndex("by_terminal_generated", (q) => q.eq("terminalId", terminal._id).gte("generatedAt", dayStart(config.dateFrom)).lte("generatedAt", dayEnd(config.dateTo)))) {
        if (!spend(budget)) break
        x += 1
        rows.push({ key: `x:${report._id}`, cells: { group: report.reportNumber, kind: "X-отчёт", date: report.businessDate, terminal: report.terminalName, shift: report.shiftNumber, author: report.generatedByName, netSales: report.netSales, expectedCash: report.expectedCash } })
      }
    }
    for await (const report of ctx.db.query("zReports").withIndex("by_restaurant_date", (q) => q.eq("restaurantId", doc._id).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      z += 1
      rows.push({ key: `z:${report._id}`, cells: { group: report.number, kind: "Z-отчёт", date: report.businessDate, terminal: terminals.get(report.terminalId) ?? names.get(restaurant) ?? "Касса", shift: report.shiftNumber, author: report.closedByName, netSales: report.snapshot.netSales, expectedCash: report.snapshot.expectedCash } })
    }
  }
  rows.sort((a, b) => `${a.cells.date}${a.cells.group}`.localeCompare(`${b.cells.date}${b.cells.group}`))
  return {
    // Prechecks are printed by the POS without a stored record, so the register has X and Z reports only.
    sourceLabel: "Реестр X- и Z-отчётов касс (нефискальные); предчеки кассой не регистрируются",
    columns,
    rows,
    totals: { netSales: rows.filter((row) => row.cells.kind === "Z-отчёт").reduce((sum, row) => sum + Number(row.cells.netSales), 0) },
    kpis: [
      { key: "x", label: "X-отчётов", value: x, unit: "count" },
      { key: "z", label: "Z-отчётов", value: z, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

export const INTEGRATION_CALCULATORS: Record<string, Calculator> = {
  "integrations-01": queue,
  "integrations-02": errors,
  "integrations-03": retries,
  "integrations-04": providerReport("1c", "1С"),
  "integrations-05": bankReconciliation,
  "integrations-06": providerReport("edi", "EDI"),
  "integrations-07": fiscalStatus,
  "integrations-08": notApplicableKz("алкогольная декларация"),
  "integrations-09": notApplicableKz("журнал розничных продаж алкоголя"),
  "integrations-10": notApplicableKz("документы ЕГАИС"),
  "integrations-11": cloudApi,
  "integrations-12": externalMenu,
  "integrations-13": equipment,
  "integrations-14": systemEvents,
  "integrations-15": cashReports,
}
