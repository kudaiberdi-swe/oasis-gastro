import type { Doc } from "../../../_generated/dataModel"
import { accountExternalId, SYSTEM_ACCOUNTS } from "../../../lib/accounts"
import { budgetLinesOf, budgetPeriodOf } from "../../../lib/budgets"
import type { ReportColumn, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { col, dayEnd, dayStart, localDate, SCAN_BUDGET } from "./_shared"

// Finance reports of W2 (docs/08-IMPLEMENTATION-PLAN.md W2-RPT-05). A report is listed here only with a test
// (tests/convex/reportsFinance*.test.ts). finance-02/03/08/18 are W1 and live in operations.ts.
//
// Sources: the double-entry journal (`journalEntries`, read through its restaurant / account indexes with a
// scan budget — there is no `dailyLedgerFacts` pre-aggregate yet), finance records (obligations, payments,
// budgets, the payment calendar), POS payments. There are no opening balances of accounts in the schema:
// balances are cumulative from the first journal line (the budget sets `truncated` when history is longer).

type Ctx = Parameters<Calculator>[0]
type Config = Parameters<Calculator>[1]
type Output = Awaited<ReturnType<Calculator>>
type Row = ReportResult["rows"][number]
type Account = Doc<"accounts">
type Entry = Doc<"journalEntries">
type FinanceRecord = Doc<"financeRecords">
type Range = { from?: string; to: string }

// ── Shared reading helpers ──────────────────────────────────────────────────────────────────────

type Budget = { scanned: number; truncated: boolean; limit: number }
const newBudget = (limit = SCAN_BUDGET): Budget => ({ scanned: 0, truncated: false, limit })

/** Counts one read; false (and `truncated`) once the budget is spent. */
function spend(budget: Budget) {
  if (budget.scanned >= budget.limit) {
    budget.truncated = true
    return false
  }
  budget.scanned += 1
  return true
}

const MONEY_ACCOUNTS = [SYSTEM_ACCOUNTS.cash.externalId, SYSTEM_ACCOUNTS.bank.externalId, SYSTEM_ACCOUNTS.inTransit.externalId]
const DEBIT_NORMAL = new Set<Account["type"]>(["asset", "expense", "contra-income"])
const HISTORY_NOTE = "начальных сальдо в системе нет — нарастающим итогом с первой проводки"

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)
const money = (key: string, label: string) => col(key, label, "money")
const text = (key: string, label: string) => col(key, label, "text")
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

async function accountsMap(ctx: Ctx) {
  return new Map((await ctx.db.query("accounts").withIndex("by_code").take(200)).map((account) => [account.externalId, account]))
}

const accountLabel = (accounts: Map<string, Account>, externalId: string) => {
  const account = accounts.get(externalId)
  return account ? `${account.code} ${account.name}` : externalId
}

/** Account of the report: `extra.accountExternalId` (or `extra.account`), an externalId or a bare code. */
function accountParam(config: Config): string | undefined {
  const raw = config.extra?.accountExternalId ?? config.extra?.account
  if (typeof raw === "number") return accountExternalId(String(raw))
  if (typeof raw !== "string" || !raw.trim()) return undefined
  return /^\d+$/.test(raw.trim()) ? accountExternalId(raw.trim()) : raw.trim()
}

function stringParam(config: Config, key: string) {
  const raw = config.extra?.[key]
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

/** Journal lines of the restaurants in a business-date range (no `from` = from the first line). */
async function* journalByRestaurant(ctx: Ctx, restaurants: string[], range: Range, budget: Budget): AsyncGenerator<Entry> {
  for (const restaurant of restaurants) {
    const lines = ctx.db.query("journalEntries").withIndex("by_restaurant_date", (q) => {
      const byRestaurant = q.eq("restaurantExternalId", restaurant)
      return range.from ? byRestaurant.gte("businessDate", range.from).lte("businessDate", range.to) : byRestaurant.lte("businessDate", range.to)
    })
    for await (const entry of lines) {
      if (!spend(budget)) return
      yield entry
    }
  }
}

/** Journal lines with the account on one side, of the allowed restaurants (the account index spans all). */
async function* accountSide(ctx: Ctx, side: "debit" | "credit", account: string, range: Range, allowed: Set<string>, budget: Budget): AsyncGenerator<Entry> {
  const lines =
    side === "debit"
      ? ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => {
          const byAccount = q.eq("debitAccountExternalId", account)
          return range.from ? byAccount.gte("businessDate", range.from).lte("businessDate", range.to) : byAccount.lte("businessDate", range.to)
        })
      : ctx.db.query("journalEntries").withIndex("by_credit_date", (q) => {
          const byAccount = q.eq("creditAccountExternalId", account)
          return range.from ? byAccount.gte("businessDate", range.from).lte("businessDate", range.to) : byAccount.lte("businessDate", range.to)
        })
  for await (const entry of lines) {
    if (!spend(budget)) return
    if (allowed.has(entry.restaurantExternalId)) yield entry
  }
}

/** Finance records of one module and the restaurants in a business-date range. */
async function* financeRecords(ctx: Ctx, moduleId: FinanceRecord["moduleId"], restaurants: string[], range: Range, budget: Budget): AsyncGenerator<FinanceRecord> {
  for (const restaurant of restaurants) {
    const rows = ctx.db.query("financeRecords").withIndex("by_module_restaurant_date", (q) => {
      const byModule = q.eq("moduleId", moduleId).eq("restaurantExternalId", restaurant)
      return range.from ? byModule.gte("businessDate", range.from).lte("businessDate", range.to) : byModule.lte("businessDate", range.to)
    })
    for await (const row of rows) {
      if (!spend(budget)) return
      yield row
    }
  }
}

/** Cached lookup of finance records (counterparties, cashflow categories, payments) by externalId. */
function recordLookup(ctx: Ctx) {
  const cache = new Map<string, FinanceRecord | null>()
  return async (externalId: string | undefined | null) => {
    if (!externalId) return null
    if (!cache.has(externalId)) cache.set(externalId, await ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())
    return cache.get(externalId) ?? null
  }
}

async function restaurantNames(ctx: Ctx, restaurants: string[]) {
  const names = new Map<string, string>()
  for (const externalId of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    names.set(externalId, row?.name ?? externalId)
  }
  return names
}

function sumTotals(rows: Row[], columns: ReportColumn[]) {
  const totals: Record<string, number> = {}
  for (const column of columns) {
    if (column.unit !== "money" && column.unit !== "count" && column.unit !== "quantity") continue
    totals[column.key] = rows.reduce((sum, row) => sum + (typeof row.cells[column.key] === "number" ? (row.cells[column.key] as number) : 0), 0)
  }
  return totals
}

/** Debit and credit turnover of every account: before `dateFrom` (opening) and within the period. */
async function turnovers(ctx: Ctx, config: Config, restaurants: string[], budget: Budget, withOpening: boolean) {
  const map = new Map<string, { openingDebit: number; openingCredit: number; debit: number; credit: number }>()
  const add = (account: string, side: "debit" | "credit", amount: number, opening: boolean) => {
    const row = map.get(account) ?? { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0 }
    if (opening) row[side === "debit" ? "openingDebit" : "openingCredit"] += amount
    else row[side] += amount
    map.set(account, row)
  }
  for await (const entry of journalByRestaurant(ctx, restaurants, { from: withOpening ? undefined : config.dateFrom, to: config.dateTo }, budget)) {
    const opening = entry.businessDate < config.dateFrom
    add(entry.debitAccountExternalId, "debit", entry.amount, opening)
    add(entry.creditAccountExternalId, "credit", entry.amount, opening)
  }
  return map
}

// ── finance-01 Балансовый отчёт ────────────────────────────────────────────────────────────────

/** Balance of asset, liability and equity accounts on `dateTo`; P&L accounts close into the result, so assets = liabilities + equity + result. */
const balanceSheet: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const budget = newBudget()
  const net = new Map<string, number>() // debit − credit up to dateTo
  for await (const entry of journalByRestaurant(ctx, restaurants, { to: config.dateTo }, budget)) {
    net.set(entry.debitAccountExternalId, (net.get(entry.debitAccountExternalId) ?? 0) + entry.amount)
    net.set(entry.creditAccountExternalId, (net.get(entry.creditAccountExternalId) ?? 0) - entry.amount)
  }
  const lines = [...net.entries()].filter(([, value]) => value !== 0).map(([id, value]) => ({ id, type: accounts.get(id)?.type ?? "asset", code: accounts.get(id)?.code ?? id, value })).sort((a, b) => a.code.localeCompare(b.code))
  const section = (type: Account["type"], sign: 1 | -1) => lines.filter((line) => line.type === type).map((line) => ({ key: line.id, cells: { group: accountLabel(accounts, line.id), amount: sign * line.value } }))
  const assetRows = section("asset", 1)
  const liabilityRows = section("liability", -1)
  const equityRows = section("equity", -1)
  const sum = (rows: Row[]) => rows.reduce((total, row) => total + Number(row.cells.amount), 0)
  const assets = sum(assetRows)
  const liabilities = sum(liabilityRows)
  const equity = sum(equityRows)
  // Income is credit-normal, expenses and returns debit-normal: the result is −Σ(debit − credit) over them.
  const result = -lines.filter((line) => line.type === "income" || line.type === "expense" || line.type === "contra-income").reduce((total, line) => total + line.value, 0)
  const passive = liabilities + equity + result
  const header = (key: string, group: string, amount: number) => ({ key, cells: { group, amount } })
  const rows = [
    header("assets", "АКТИВ", assets),
    ...assetRows,
    header("liabilities", "ОБЯЗАТЕЛЬСТВА", liabilities),
    ...liabilityRows,
    header("equity", "КАПИТАЛ", equity + result),
    ...equityRows,
    { key: "result", cells: { group: "Нераспределённый результат (доходы − расходы)", amount: result } },
    header("passive", "ПАССИВ (обязательства + капитал)", passive),
  ]
  return {
    sourceLabel: `Журнал проводок на ${config.dateTo} (${HISTORY_NOTE})`,
    columns: [text("group", "Статья баланса"), money("amount", "Сумма")],
    rows,
    totals: {},
    kpis: [
      { key: "assets", label: "Актив", value: assets, unit: "money" },
      { key: "passive", label: "Пассив", value: passive, unit: "money" },
      { key: "difference", label: "Расхождение актива и пассива", value: assets - passive, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-04 Кассовая книга ──────────────────────────────────────────────────────────────────

/** Money accounts (cash, bank, in transit) by day: opening, incoming, outgoing, closing. */
const cashBook: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const allowed = new Set(restaurants)
  const selected = accountParam(config)
  const moneyAccounts = selected ? [selected] : MONEY_ACCOUNTS
  const budget = newBudget()
  const rows: Row[] = []
  let openingTotal = 0
  let closingTotal = 0
  for (const account of moneyAccounts) {
    let opening = 0
    const byDay = new Map<string, { incoming: number; outgoing: number }>()
    for (const side of ["debit", "credit"] as const) {
      for await (const entry of accountSide(ctx, side, account, { to: config.dateTo }, allowed, budget)) {
        const signed = side === "debit" ? entry.amount : -entry.amount
        if (entry.businessDate < config.dateFrom) {
          opening += signed
          continue
        }
        const day = byDay.get(entry.businessDate) ?? { incoming: 0, outgoing: 0 }
        if (side === "debit") day.incoming += entry.amount
        else day.outgoing += entry.amount
        byDay.set(entry.businessDate, day)
      }
    }
    openingTotal += opening
    let balance = opening
    for (const [date, day] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const start = balance
      balance += day.incoming - day.outgoing
      rows.push({ key: `${account}:${date}`, cells: { group: date, account: accountLabel(accounts, account), opening: start, incoming: day.incoming, outgoing: day.outgoing, closing: balance } })
    }
    closingTotal += balance
  }
  const columns = [col("group", "Дата", "date"), text("account", "Счёт"), money("opening", "Остаток на начало"), money("incoming", "Приход"), money("outgoing", "Расход"), money("closing", "Остаток на конец")]
  const totals = sumTotals(rows, columns.filter((column) => column.key === "incoming" || column.key === "outgoing"))
  return {
    sourceLabel: `Журнал проводок, счета денежных средств (${HISTORY_NOTE})`,
    columns,
    rows,
    totals,
    kpis: [
      { key: "opening", label: "Остаток на начало", value: openingTotal, unit: "money" },
      { key: "incoming", label: "Приход", value: totals.incoming ?? 0, unit: "money" },
      { key: "outgoing", label: "Расход", value: totals.outgoing ?? 0, unit: "money" },
      { key: "closing", label: "Остаток на конец", value: closingTotal, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-05 План-факт, finance-14 Исполнение бюджета ─────────────────────────────────────────

type BudgetLine = { record: FinanceRecord; key: string; account?: string; category?: string; start: string; end: string; plan: number; fact: number }

/**
 * Approved and posted budget records whose period meets the report period, one report line per budget line
 * (W3-FIN-13 `budgetLines`; a budget saved before them is one line: plan = amount, article =
 * `data.accountExternalId` / debit / credit account or the cashflow category — lib/budgets budgetLinesOf).
 * A version replaced by an agreed newer one is left out. Period = `data.periodStart…periodEnd` (else the
 * month of the record). Fact from the budget start up to min(end, dateTo): account turnover in its normal
 * direction, or posted payments of the category.
 */
async function budgetLines(ctx: Ctx, config: Config, restaurants: string[], budget: Budget) {
  const accounts = await accountsMap(ctx)
  const lookup = recordLookup(ctx)
  const lines: BudgetLine[] = []
  const superseded = new Set<string>()
  for await (const record of financeRecords(ctx, "budgets", restaurants, { to: config.dateTo }, budget)) {
    if (record.status !== "approved" && record.status !== "posted") continue
    if (typeof record.data.previousVersionExternalId === "string") superseded.add(record.data.previousVersionExternalId)
    const { start, end } = budgetPeriodOf(record)
    if (end < config.dateFrom || start > config.dateTo) continue
    const planned = await budgetLinesOf(ctx, record)
    for (const line of planned) {
      lines.push({ record, key: planned.length > 1 ? `${record.externalId}:${line.lineNo}` : record.externalId, account: line.accountExternalId, category: line.cashflowCategoryExternalId, start, end, plan: line.planAmount, fact: 0 })
    }
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) if (superseded.has(lines[index].record.externalId)) lines.splice(index, 1)
  for (const line of lines) {
    const to = line.end < config.dateTo ? line.end : config.dateTo
    const allowed = new Set([line.record.restaurantExternalId])
    if (line.account) {
      const debitNormal = DEBIT_NORMAL.has(accounts.get(line.account)?.type ?? "expense")
      for (const side of ["debit", "credit"] as const) {
        for await (const entry of accountSide(ctx, side, line.account, { from: line.start, to }, allowed, budget)) line.fact += (side === "debit") === debitNormal ? entry.amount : -entry.amount
      }
    } else if (line.category) {
      const outgoing = (await lookup(line.category))?.data.direction === "outgoing"
      for await (const payment of financeRecords(ctx, "payments", [line.record.restaurantExternalId], { from: line.start, to }, budget)) {
        if (payment.status !== "posted" || payment.cashflowCategoryExternalId !== line.category) continue
        line.fact += (payment.data.direction === "outgoing") === outgoing ? payment.amount : -payment.amount
      }
    }
  }
  return { lines, accounts, lookup }
}

async function articleOf(line: BudgetLine, accounts: Map<string, Account>, lookup: ReturnType<typeof recordLookup>) {
  if (line.account) return { key: line.account, label: accountLabel(accounts, line.account) }
  if (line.category) return { key: line.category, label: (await lookup(line.category))?.name ?? line.category }
  return { key: "none", label: "Без статьи" }
}

const planFact: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const { lines, accounts, lookup } = await budgetLines(ctx, config, restaurants, budget)
  const groups = new Map<string, { label: string; plan: number; fact: number }>()
  for (const line of lines) {
    const article = await articleOf(line, accounts, lookup)
    const group = groups.get(article.key) ?? { label: article.label, plan: 0, fact: 0 }
    group.plan += line.plan
    group.fact += line.fact
    groups.set(article.key, group)
  }
  const rows = [...groups.entries()].sort(([, a], [, b]) => b.plan - a.plan).map(([key, group]) => ({ key, cells: { group: group.label, plan: group.plan, fact: group.fact, deviation: group.fact - group.plan, execution: percent(group.fact, group.plan) } }))
  const columns = [text("group", "Статья"), money("plan", "План"), money("fact", "Факт"), money("deviation", "Отклонение"), col("execution", "Исполнение, %", "percent")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Утверждённые бюджеты и журнал проводок / платежи по статьям ДДС",
    columns,
    rows,
    totals,
    kpis: [
      { key: "plan", label: "План", value: totals.plan ?? 0, unit: "money" },
      { key: "fact", label: "Факт", value: totals.fact ?? 0, unit: "money" },
      { key: "execution", label: "Исполнение", value: percent(totals.fact ?? 0, totals.plan ?? 0), unit: "percent" },
    ],
    truncated: budget.truncated,
  }
}

const budgetExecution: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const { lines, accounts, lookup } = await budgetLines(ctx, config, restaurants, budget)
  const names = await restaurantNames(ctx, restaurants)
  const rows: Row[] = []
  for (const line of lines) {
    const article = await articleOf(line, accounts, lookup)
    rows.push({
      key: line.key,
      cells: { group: `${line.record.number} ${line.record.name}`, restaurant: names.get(line.record.restaurantExternalId) ?? line.record.restaurantExternalId, article: article.label, period: `${line.start} — ${line.end}`, plan: line.plan, fact: line.fact, remainder: line.plan - line.fact, execution: percent(line.fact, line.plan), status: line.fact > line.plan ? "Перерасход" : "В пределах" },
    })
  }
  rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
  const columns = [text("group", "Бюджет"), text("restaurant", "Ресторан"), text("article", "Статья"), text("period", "Период"), money("plan", "План"), money("fact", "Факт"), money("remainder", "Остаток"), col("execution", "Исполнение, %", "percent"), text("status", "Оценка")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Утверждённые бюджеты: факт с начала периода бюджета по дату отчёта",
    columns,
    rows,
    totals,
    kpis: [
      { key: "plan", label: "План", value: totals.plan ?? 0, unit: "money" },
      { key: "fact", label: "Факт", value: totals.fact ?? 0, unit: "money" },
      { key: "execution", label: "Исполнение", value: percent(totals.fact ?? 0, totals.plan ?? 0), unit: "percent" },
      { key: "overrun", label: "Статей с перерасходом", value: rows.filter((row) => row.cells.status === "Перерасход").length, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-06 Обороты по счетам, finance-07 Карточка счёта ─────────────────────────────────────

/** Trial balance: opening, debit and credit turnover, closing of every account with movement. */
const accountTurnover: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const budget = newBudget()
  const map = await turnovers(ctx, config, restaurants, budget, true)
  const split = (value: number) => (value >= 0 ? { debit: value, credit: 0 } : { debit: 0, credit: -value })
  const rows = [...map.entries()]
    .sort(([a], [b]) => (accounts.get(a)?.code ?? a).localeCompare(accounts.get(b)?.code ?? b))
    .map(([id, row]) => {
      const opening = split(row.openingDebit - row.openingCredit)
      const closing = split(row.openingDebit - row.openingCredit + row.debit - row.credit)
      return { key: id, cells: { group: accountLabel(accounts, id), openingDebit: opening.debit, openingCredit: opening.credit, debit: row.debit, credit: row.credit, closingDebit: closing.debit, closingCredit: closing.credit } }
    })
  const columns = [text("group", "Счёт"), money("openingDebit", "Сальдо на начало, Дт"), money("openingCredit", "Сальдо на начало, Кт"), money("debit", "Оборот Дт"), money("credit", "Оборот Кт"), money("closingDebit", "Сальдо на конец, Дт"), money("closingCredit", "Сальдо на конец, Кт")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: `Журнал проводок (${HISTORY_NOTE})`,
    columns,
    rows,
    totals,
    kpis: [
      { key: "turnover", label: "Оборот за период", value: totals.debit ?? 0, unit: "money" },
      { key: "accounts", label: "Счетов с движением", value: rows.length, unit: "count" },
    ],
    truncated: budget.truncated,
  }
}

const CARD_LIMIT = 2000

/** Every line of one account (`extra.accountExternalId`, 1010 by default) with the running balance. */
const accountCard: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const account = accountParam(config) ?? SYSTEM_ACCOUNTS.cash.externalId
  const allowed = new Set(restaurants)
  const budget = newBudget()
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  let opening = 0
  const lines: { entry: Entry; debit: number; credit: number; other: string }[] = []
  for (const side of ["debit", "credit"] as const) {
    for await (const entry of accountSide(ctx, side, account, { to: config.dateTo }, allowed, budget)) {
      const amount = side === "debit" ? entry.amount : -entry.amount
      if (entry.businessDate < config.dateFrom) {
        opening += amount
        continue
      }
      if (needle && !`${entry.sourceNumber} ${entry.description}`.toLocaleLowerCase("ru").includes(needle)) continue
      lines.push({ entry, debit: side === "debit" ? entry.amount : 0, credit: side === "credit" ? entry.amount : 0, other: side === "debit" ? entry.creditAccountExternalId : entry.debitAccountExternalId })
    }
  }
  lines.sort((a, b) => a.entry.businessDate.localeCompare(b.entry.businessDate) || a.entry.occurredAt - b.entry.occurredAt)
  const debitNormal = DEBIT_NORMAL.has(accounts.get(account)?.type ?? "asset")
  const sign = debitNormal ? 1 : -1
  let balance = opening
  const rows: Row[] = [{ key: "opening", cells: { group: config.dateFrom, document: "Сальдо на начало", description: "", corresponding: "", debit: 0, credit: 0, balance: sign * opening } }]
  for (const line of lines.slice(0, CARD_LIMIT)) {
    balance += line.debit - line.credit
    rows.push({ key: line.entry.externalId, cells: { group: line.entry.businessDate, document: line.entry.sourceNumber, description: line.entry.description, corresponding: accountLabel(accounts, line.other), debit: line.debit, credit: line.credit, balance: sign * balance } })
  }
  const debit = lines.reduce((sum, line) => sum + line.debit, 0)
  const credit = lines.reduce((sum, line) => sum + line.credit, 0)
  const closing = sign * (opening + debit - credit)
  return {
    sourceLabel: `Карточка счёта ${accountLabel(accounts, account)} (${HISTORY_NOTE})`,
    columns: [col("group", "Дата", "date"), text("document", "Документ"), text("description", "Содержание"), text("corresponding", "Корр. счёт"), money("debit", "Дебет"), money("credit", "Кредит"), money("balance", "Сальдо")],
    rows,
    totals: { debit, credit },
    kpis: [
      { key: "opening", label: "Сальдо на начало", value: sign * opening, unit: "money" },
      { key: "debit", label: "Оборот Дт", value: debit, unit: "money" },
      { key: "credit", label: "Оборот Кт", value: credit, unit: "money" },
      { key: "closing", label: "Сальдо на конец", value: closing, unit: "money" },
    ],
    truncated: budget.truncated || lines.length > CARD_LIMIT,
  }
}

// ── finance-09/10/11/12 Задолженность и расчёты с контрагентами ──────────────────────────────────

/**
 * An obligation or a payment as a movement on the counterparty's settlement account, from our side:
 * debit = they owe us more / we owe them less (receivables, our payments), credit = the other way.
 * Balance = debit − credit: > 0 the counterparty owes us, < 0 we owe it.
 */
function movementOf(record: FinanceRecord) {
  if (record.status !== "posted") return null
  if (record.moduleId === "accounts-payable") {
    const amount = Number(record.data.originalAmount ?? record.amount)
    return record.data.direction === "receivable" ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
  }
  if (record.moduleId === "payments") return record.data.direction === "outgoing" ? { debit: record.amount, credit: 0 } : { debit: 0, credit: record.amount }
  return null
}

/** Open part of an obligation at the end of `date`: original minus allocations applied by then. */
async function openAt(ctx: Ctx, record: FinanceRecord, end: number, budget: Budget) {
  const original = Number(record.data.originalAmount ?? record.amount)
  if (!Number(record.data.allocatedAmount ?? 0)) return original
  let applied = 0
  for await (const allocation of ctx.db.query("paymentAllocations").withIndex("by_obligation", (q) => q.eq("obligationExternalId", record.externalId))) {
    if (!spend(budget)) break
    if (allocation.appliedAt && allocation.appliedAt <= end) applied += allocation.amount
  }
  return original - applied
}

/** finance-09 / finance-10: open obligations on `dateTo` by counterparty, aged by the due date. */
function debts(direction: "receivable" | "payable"): Calculator {
  return async (ctx, config, restaurants) => {
    const budget = newBudget()
    const lookup = recordLookup(ctx)
    const end = dayEnd(config.dateTo)
    const groups = new Map<string, Record<string, number | string>>()
    for await (const record of financeRecords(ctx, "accounts-payable", restaurants, { to: config.dateTo }, budget)) {
      if (record.data.direction !== direction) continue
      // Open on dateTo: posted, or reversed only after it.
      if (!(record.status === "posted" || (record.status === "reversed" && (record.reversedAt ?? 0) > end))) continue
      const open = await openAt(ctx, record, end, budget)
      if (open <= 0) continue
      const due = isDate(record.data.dueDate) ? record.data.dueDate : null
      const overdueDays = due && due < config.dateTo ? daysBetween(due, config.dateTo) : 0
      const bucket = overdueDays === 0 ? "current" : overdueDays <= 30 ? "d30" : overdueDays <= 60 ? "d60" : overdueDays <= 90 ? "d90" : "over90"
      const key = record.counterpartyExternalId ?? "none"
      const group = groups.get(key) ?? { group: (await lookup(record.counterpartyExternalId))?.name ?? "Без контрагента", documents: 0, total: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }
      group.documents = Number(group.documents) + 1
      group.total = Number(group.total) + open
      group[bucket] = Number(group[bucket]) + open
      groups.set(key, group)
    }
    const rows = [...groups.entries()].map(([key, cells]) => ({ key, cells })).sort((a, b) => Number(b.cells.total) - Number(a.cells.total))
    const columns = [text("group", "Контрагент"), col("documents", "Документов", "count"), money("total", "Задолженность"), money("current", "Не просрочено"), money("d30", "Просрочено 1–30 дн."), money("d60", "31–60 дн."), money("d90", "61–90 дн."), money("over90", "Более 90 дн.")]
    const totals = sumTotals(rows, columns)
    const overdue = (totals.total ?? 0) - (totals.current ?? 0)
    return {
      sourceLabel: `${direction === "receivable" ? "Дебиторская" : "Кредиторская"} задолженность на ${config.dateTo} (обязательства и распределённые платежи)`,
      columns,
      rows,
      totals,
      kpis: [
        { key: "total", label: direction === "receivable" ? "Нам должны" : "Мы должны", value: totals.total ?? 0, unit: "money" },
        { key: "overdue", label: "Просрочено", value: overdue, unit: "money" },
        { key: "counterparties", label: "Контрагентов", value: rows.length, unit: "count" },
      ],
      truncated: budget.truncated,
    }
  }
}

/** finance-11: per counterparty — opening balance, accrued, paid, closing (> 0 they owe us, < 0 we owe). */
const counterpartyBalances: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const lookup = recordLookup(ctx)
  const groups = new Map<string, { opening: number; debit: number; credit: number }>()
  for (const moduleId of ["accounts-payable", "payments"] as const) {
    for await (const record of financeRecords(ctx, moduleId, restaurants, { to: config.dateTo }, budget)) {
      const movement = movementOf(record)
      if (!movement) continue
      const key = record.counterpartyExternalId ?? "none"
      const group = groups.get(key) ?? { opening: 0, debit: 0, credit: 0 }
      if (record.businessDate < config.dateFrom) group.opening += movement.debit - movement.credit
      else {
        group.debit += movement.debit
        group.credit += movement.credit
      }
      groups.set(key, group)
    }
  }
  const rows: Row[] = []
  for (const [key, group] of groups) {
    const closing = group.opening + group.debit - group.credit
    rows.push({ key, cells: { group: key === "none" ? "Без контрагента" : ((await lookup(key))?.name ?? key), opening: group.opening, debit: group.debit, credit: group.credit, closing, receivable: Math.max(0, closing), payable: Math.max(0, -closing) } })
  }
  rows.sort((a, b) => Math.abs(Number(b.cells.closing)) - Math.abs(Number(a.cells.closing)))
  const columns = [text("group", "Контрагент"), money("opening", "Сальдо на начало"), money("debit", "Дебет (нам должны больше)"), money("credit", "Кредит (мы должны больше)"), money("closing", "Сальдо на конец"), money("receivable", "Нам должны"), money("payable", "Мы должны")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Обязательства и проведённые платежи по контрагентам (сальдо > 0 — долг контрагента, < 0 — наш долг)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "receivable", label: "Нам должны", value: totals.receivable ?? 0, unit: "money" },
      { key: "payable", label: "Мы должны", value: totals.payable ?? 0, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

/**
 * finance-12: reconciliation statement with one counterparty (`extra.counterpartyExternalId`) for the
 * period — opening balance, documents and payments, closing balance. Without a counterparty it shows the
 * balances of all of them (finance-11) and asks to pick one.
 */
const reconciliation: Calculator = async (ctx, config, restaurants) => {
  const counterpartyId = stringParam(config, "counterpartyExternalId")
  if (!counterpartyId) {
    const all = await counterpartyBalances(ctx, config, restaurants)
    return { ...all, sourceLabel: "Выберите контрагента для акта сверки (extra.counterpartyExternalId); ниже — сальдо всех контрагентов" }
  }
  const counterparty = await recordLookup(ctx)(counterpartyId)
  const allowed = new Set(restaurants)
  const budget = newBudget()
  let opening = 0
  const documents: { record: FinanceRecord; debit: number; credit: number }[] = []
  for (const moduleId of ["accounts-payable", "payments"] as const) {
    for await (const record of ctx.db.query("financeRecords").withIndex("by_counterparty_module", (q) => q.eq("counterpartyExternalId", counterpartyId).eq("moduleId", moduleId))) {
      if (!spend(budget)) break
      if (!allowed.has(record.restaurantExternalId) || record.businessDate > config.dateTo) continue
      const movement = movementOf(record)
      if (!movement) continue
      if (record.businessDate < config.dateFrom) opening += movement.debit - movement.credit
      else documents.push({ record, ...movement })
    }
  }
  documents.sort((a, b) => a.record.businessDate.localeCompare(b.record.businessDate) || a.record.number.localeCompare(b.record.number))
  const debit = documents.reduce((sum, row) => sum + row.debit, 0)
  const credit = documents.reduce((sum, row) => sum + row.credit, 0)
  const closing = opening + debit - credit
  const balanceRow = (key: string, label: string, date: string, value: number) => ({ key, cells: { group: label, date, debit: Math.max(0, value), credit: Math.max(0, -value) } })
  const rows: Row[] = [
    balanceRow("opening", "Сальдо на начало", config.dateFrom, opening),
    ...documents.map(({ record, debit: dr, credit: cr }) => ({
      key: record.externalId,
      cells: { group: `${record.moduleId === "payments" ? (record.data.direction === "outgoing" ? "Оплата" : "Поступление") : typeof record.data.sourceNumber === "string" && record.data.sourceNumber ? record.data.sourceNumber : record.number} · ${record.name}`, date: record.businessDate, debit: dr, credit: cr },
    })),
    balanceRow("closing", "Сальдо на конец", config.dateTo, closing),
  ]
  return {
    sourceLabel: `Акт сверки с «${counterparty?.name ?? counterpartyId}»${counterparty?.bin ? `, БИН ${counterparty.bin}` : ""} за ${config.dateFrom} — ${config.dateTo} (Дт — растёт долг контрагента или уменьшается наш, Кт — растёт наш долг)`,
    columns: [text("group", "Документ"), col("date", "Дата", "date"), money("debit", "Дебет"), money("credit", "Кредит")],
    rows,
    totals: { debit, credit },
    kpis: [
      { key: "opening", label: "Сальдо на начало", value: opening, unit: "money" },
      { key: "closing", label: "Сальдо на конец", value: closing, unit: "money" },
      { key: "ourDebt", label: "Наш долг контрагенту", value: Math.max(0, -closing), unit: "money" },
      { key: "theirDebt", label: "Долг контрагента нам", value: Math.max(0, closing), unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-13 Платёжный календарь ──────────────────────────────────────────────────────────────

const INCOMING = new Set(["incoming", "inflow", "in", "income"])

/**
 * Planned money by day: payment-calendar records (not drafts, not cancelled) on their `data.plannedAt`
 * (else record date) plus open obligations by due date (overdue ones on the first day) that no calendar
 * record refers to; running balance from the money accounts on the eve of the period, gap when < 0.
 */
const paymentCalendar: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const allowed = new Set(restaurants)
  const byDay = new Map<string, { incoming: number; outgoing: number; items: number }>()
  const add = (date: string, incoming: boolean, amount: number) => {
    const day = byDay.get(date) ?? { incoming: 0, outgoing: 0, items: 0 }
    if (incoming) day.incoming += amount
    else day.outgoing += amount
    day.items += 1
    byDay.set(date, day)
  }
  const linked = new Set<string>()
  for await (const record of financeRecords(ctx, "payment-calendar", restaurants, { to: config.dateTo }, budget)) {
    if (typeof record.data.obligationExternalId === "string") linked.add(record.data.obligationExternalId)
    if (!["pending-approval", "approved", "posted"].includes(record.status)) continue
    const planned = isDate(record.data.plannedAt) ? record.data.plannedAt : typeof record.data.plannedAt === "number" ? localDate(record.data.plannedAt) : record.businessDate
    if (planned < config.dateFrom || planned > config.dateTo) continue
    add(planned, INCOMING.has(String(record.data.direction ?? "")), record.amount)
  }
  for await (const record of financeRecords(ctx, "accounts-payable", restaurants, { to: config.dateTo }, budget)) {
    if (record.status !== "posted" || record.amount <= 0 || linked.has(record.externalId)) continue
    const due = isDate(record.data.dueDate) ? record.data.dueDate : null
    if (!due || due > config.dateTo) continue
    add(due < config.dateFrom ? config.dateFrom : due, record.data.direction === "receivable", record.amount)
  }
  let opening = 0
  const eve = shiftDate(config.dateFrom, -1)
  for (const account of MONEY_ACCOUNTS) {
    for (const side of ["debit", "credit"] as const) {
      for await (const entry of accountSide(ctx, side, account, { to: eve }, allowed, budget)) opening += side === "debit" ? entry.amount : -entry.amount
    }
  }
  let balance = opening
  let minimum = opening
  const rows: Row[] = []
  for (const [date, day] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    balance += day.incoming - day.outgoing
    minimum = Math.min(minimum, balance)
    rows.push({ key: date, cells: { group: date, items: day.items, incoming: day.incoming, outgoing: day.outgoing, net: day.incoming - day.outgoing, balance, status: balance < 0 ? "Кассовый разрыв" : "" } })
  }
  const columns = [col("group", "Дата", "date"), col("items", "Платежей", "count"), money("incoming", "Поступления"), money("outgoing", "Платежи"), money("net", "Сальдо дня"), money("balance", "Остаток на конец дня"), text("status", "Статус")]
  const totals = sumTotals(rows, columns.filter((column) => column.key !== "balance"))
  return {
    sourceLabel: `Платёжный календарь и открытые обязательства по сроку оплаты; остаток денег на ${eve} по журналу (${HISTORY_NOTE})`,
    columns,
    rows,
    totals,
    kpis: [
      { key: "incoming", label: "Поступления", value: totals.incoming ?? 0, unit: "money" },
      { key: "outgoing", label: "Платежи", value: totals.outgoing ?? 0, unit: "money" },
      { key: "opening", label: "Остаток на начало", value: opening, unit: "money" },
      { key: "minimum", label: "Минимальный остаток", value: minimum, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-15/16/17 Счета-фактуры и НДС ────────────────────────────────────────────────────────

/** Organizations of the restaurants that are not VAT payers (for the banner). */
async function nonVatPayers(ctx: Ctx, restaurants: string[]) {
  const organizations = new Set<string>()
  for (const externalId of restaurants) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (restaurant) organizations.add(restaurant.organizationExternalId)
  }
  const names: string[] = []
  for (const externalId of organizations) {
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (!organization?.vatPayer) names.push(organization?.legalName ?? organization?.name ?? externalId)
  }
  return names
}

/**
 * VAT by source document from the journal's VAT lines (FIN §3.8): input VAT = Dr/Cr 1420 «НДС к возмещению»
 * (receipts, received services, supplier returns), output VAT = Cr/Dr 3130 «НДС к уплате» (provided services,
 * outgoing invoices). The base is the document's other lines on payables (input) / income (output). POS
 * sales post revenue with VAT inside (no 3130 line yet), so they are not in the output VAT.
 */
function vatReport(kind: "invoices" | "sales" | "purchases"): Calculator {
  return async (ctx, config, restaurants) => {
    const accounts = await accountsMap(ctx)
    const budget = newBudget()
    const vatIn = SYSTEM_ACCOUNTS.vatRecoverable.externalId
    const vatOut = SYSTEM_ACCOUNTS.vatPayable.externalId
    const payables = SYSTEM_ACCOUNTS.payables.externalId
    const receivables = SYSTEM_ACCOUNTS.receivables.externalId
    const isIncome = (id: string) => accounts.get(id)?.type === "income"
    const sources = new Map<string, { date: string; number: string; description: string; module: string; restaurant: string; vatIn: number; vatOut: number; netIn: number; netOut: number }>()
    for await (const entry of journalByRestaurant(ctx, restaurants, { from: config.dateFrom, to: config.dateTo }, budget)) {
      const source = sources.get(entry.sourceExternalId) ?? { date: entry.businessDate, number: entry.sourceNumber, description: "", module: entry.sourceModuleId, restaurant: entry.restaurantExternalId, vatIn: 0, vatOut: 0, netIn: 0, netOut: 0 }
      const { debitAccountExternalId: debit, creditAccountExternalId: credit, amount } = entry
      if (debit === vatIn) source.vatIn += amount
      else if (credit === vatIn) source.vatIn -= amount
      else if (credit === payables) source.netIn += amount
      else if (debit === payables) source.netIn -= amount
      if (credit === vatOut) source.vatOut += amount
      else if (debit === vatOut) source.vatOut -= amount
      else if (debit === receivables && isIncome(credit)) source.netOut += amount
      else if (credit === receivables && isIncome(debit)) source.netOut -= amount
      if (!source.description && debit !== vatIn && credit !== vatOut && !entry.reversalOf) source.description = entry.description
      if (entry.businessDate < source.date) source.date = entry.businessDate
      sources.set(entry.sourceExternalId, source)
    }
    const names = await restaurantNames(ctx, restaurants)
    const rows: Row[] = []
    for (const [key, source] of sources) {
      const legs = [
        { side: "in" as const, vat: source.vatIn, net: source.netIn, label: "Полученный" },
        { side: "out" as const, vat: source.vatOut, net: source.netOut, label: "Выданный" },
      ].filter((leg) => leg.vat !== 0 && (kind === "invoices" || (kind === "purchases") === (leg.side === "in")))
      for (const leg of legs) {
        rows.push({ key: `${key}:${leg.side}`, cells: { group: source.date, document: `${source.number} · ${source.description}`, restaurant: names.get(source.restaurant) ?? source.restaurant, kind: leg.label, net: leg.net, vat: leg.vat, gross: leg.net + leg.vat, rate: percent(leg.vat, leg.net) } })
      }
    }
    rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
    const columns = [col("group", "Дата", "date"), text("document", "Документ"), text("restaurant", "Ресторан"), ...(kind === "invoices" ? [text("kind", "Счёт-фактура")] : []), money("net", "Сумма без НДС"), money("vat", "НДС"), money("gross", "Сумма с НДС"), col("rate", "Ставка, %", "percent")]
    const totals = sumTotals(rows, columns)
    const input = rows.filter((row) => row.cells.kind === "Полученный").reduce((sum, row) => sum + Number(row.cells.vat), 0)
    const output = rows.filter((row) => row.cells.kind === "Выданный").reduce((sum, row) => sum + Number(row.cells.vat), 0)
    const nonPayers = await nonVatPayers(ctx, restaurants)
    const banner = nonPayers.length ? ` · Не плательщик НДС: ${nonPayers.join(", ")} — НДС по его документам не выделяется` : ""
    const kpis: Output["kpis"] =
      kind === "invoices"
        ? [
            { key: "input", label: "НДС к зачёту", value: input, unit: "money" },
            { key: "output", label: "НДС начислен", value: output, unit: "money" },
            { key: "payable", label: "НДС к уплате", value: output - input, unit: "money" },
          ]
        : [{ key: "vat", label: kind === "sales" ? "НДС начислен" : "НДС к зачёту", value: totals.vat ?? 0, unit: "money" }]
    if (nonPayers.length) kpis.push({ key: "nonVatPayers", label: "Организаций — не плательщиков НДС", value: nonPayers.length, unit: "count" })
    return {
      sourceLabel: `Проводки НДС: ${kind === "sales" ? "3130 «НДС к уплате»" : kind === "purchases" ? "1420 «НДС к возмещению»" : "1420 и 3130"}${kind !== "purchases" ? "; продажи кассы — без выделенного НДС" : ""}${banner}`,
      columns,
      rows,
      totals,
      kpis,
      truncated: budget.truncated,
    }
  }
}

// ── finance-19 Распределение выручки ────────────────────────────────────────────────────────────

/** POS payments (sales − refunds) by payment type and the money account they were posted to. */
const revenueDistribution: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const budget = newBudget()
  const accountOfType = new Map<string, string>()
  const groups = new Map<string, { type: string; account: string; sales: number; refunds: number; count: number }>()
  for (const externalId of restaurants) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (!restaurant) continue
    for await (const payment of ctx.db.query("payments").withIndex("by_restaurant_created", (q) => q.eq("restaurantId", restaurant._id).gte("createdAt", dayStart(config.dateFrom)).lte("createdAt", dayEnd(config.dateTo)))) {
      if (!spend(budget)) break
      const typeKey = payment.paymentTypeExternalId ?? payment.method
      // The account a type posts to is looked up once per type from one of its journal lines.
      let account = accountOfType.get(typeKey)
      if (!account && payment.journalEntryId) {
        const entry = await ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", payment.journalEntryId!)).unique()
        if (entry) account = payment.type === "sale" ? entry.debitAccountExternalId : entry.creditAccountExternalId
        if (account) accountOfType.set(typeKey, account)
      }
      const key = `${typeKey}|${account ?? ""}`
      const group = groups.get(key) ?? { type: payment.paymentTypeName ?? payment.method, account: account ? accountLabel(accounts, account) : "Без проводки", sales: 0, refunds: 0, count: 0 }
      if (payment.type === "sale") {
        group.sales += payment.amount
        group.count += 1
      } else group.refunds += payment.amount
      groups.set(key, group)
    }
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.sales - group.refunds, 0)
  const rows = [...groups.entries()]
    .map(([key, group]) => ({ key, cells: { group: group.type, account: group.account, count: group.count, sales: group.sales, refunds: group.refunds, net: group.sales - group.refunds, share: percent(group.sales - group.refunds, total) } }))
    .sort((a, b) => Number(b.cells.net) - Number(a.cells.net))
  const columns = [text("group", "Тип оплаты"), text("account", "Счёт денежных средств"), col("count", "Оплат", "count"), money("sales", "Оплачено"), money("refunds", "Возвраты"), money("net", "Выручка"), col("share", "Доля, %", "percent")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Оплаты кассы по типам оплат и счетам денежных средств (оплата баллами — не деньги, не входит)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "net", label: "Выручка", value: total, unit: "money" },
      { key: "refunds", label: "Возвраты", value: totals.refunds ?? 0, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-20 Доходы и расходы по статьям ДДС ──────────────────────────────────────────────────

/** Posted payments and manual money operations by cashflow category (with its parent). */
const cashflowByCategory: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const lookup = recordLookup(ctx)
  const moneySet = new Set(MONEY_ACCOUNTS)
  const groups = new Map<string, { incoming: number; outgoing: number; count: number }>()
  const add = (category: string | undefined, incoming: number, outgoing: number) => {
    const key = category ?? "none"
    const group = groups.get(key) ?? { incoming: 0, outgoing: 0, count: 0 }
    group.incoming += incoming
    group.outgoing += outgoing
    group.count += 1
    groups.set(key, group)
  }
  for await (const payment of financeRecords(ctx, "payments", restaurants, { from: config.dateFrom, to: config.dateTo }, budget)) {
    if (payment.status !== "posted") continue
    const outgoing = payment.data.direction === "outgoing"
    add(payment.cashflowCategoryExternalId, outgoing ? 0 : payment.amount, outgoing ? payment.amount : 0)
  }
  for await (const operation of financeRecords(ctx, "transactions", restaurants, { from: config.dateFrom, to: config.dateTo }, budget)) {
    if (operation.status !== "posted" || !operation.cashflowCategoryExternalId) continue
    const incoming = moneySet.has(operation.debitAccountExternalId ?? "") && !moneySet.has(operation.creditAccountExternalId ?? "")
    const outgoing = moneySet.has(operation.creditAccountExternalId ?? "") && !moneySet.has(operation.debitAccountExternalId ?? "")
    if (incoming || outgoing) add(operation.cashflowCategoryExternalId, incoming ? operation.amount : 0, outgoing ? operation.amount : 0)
  }
  const ACTIVITY: Record<string, string> = { operating: "Операционная", investing: "Инвестиционная", financing: "Финансовая" }
  const rows: Row[] = []
  for (const [key, group] of groups) {
    const category = key === "none" ? null : await lookup(key)
    const parent = category && typeof category.data.parentExternalId === "string" ? await lookup(category.data.parentExternalId) : null
    rows.push({ key, cells: { group: category ? `${parent ? `${parent.name} / ` : ""}${category.name}` : "Без статьи", activity: ACTIVITY[String(category?.data.activity ?? "")] ?? "", count: group.count, incoming: group.incoming, outgoing: group.outgoing, net: group.incoming - group.outgoing } })
  }
  rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group), "ru"))
  const columns = [text("group", "Статья ДДС"), text("activity", "Деятельность"), col("count", "Операций", "count"), money("incoming", "Доходы (поступления)"), money("outgoing", "Расходы (выплаты)"), money("net", "Сальдо")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Проведённые платежи и ручные денежные операции по статьям ДДС (выручка кассы — в «Распределении выручки»)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "incoming", label: "Поступления", value: totals.incoming ?? 0, unit: "money" },
      { key: "outgoing", label: "Выплаты", value: totals.outgoing ?? 0, unit: "money" },
      { key: "net", label: "Сальдо", value: totals.net ?? 0, unit: "money" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-21 Финансовый результат по ресторанам ───────────────────────────────────────────────

/** Income − returns − cost of sales − other expenses per restaurant, from the journal by account type. */
const resultByRestaurant: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const cogs = SYSTEM_ACCOUNTS.cogs.externalId
  const groups = new Map<string, { revenue: number; returns: number; cogs: number; expenses: number }>()
  for await (const entry of journalByRestaurant(ctx, restaurants, { from: config.dateFrom, to: config.dateTo }, budget)) {
    const group = groups.get(entry.restaurantExternalId) ?? { revenue: 0, returns: 0, cogs: 0, expenses: 0 }
    for (const [id, sign] of [[entry.debitAccountExternalId, 1], [entry.creditAccountExternalId, -1]] as const) {
      const type = accounts.get(id)?.type
      const debitSide = sign * entry.amount // + on the debit side, − on the credit side
      if (type === "income") group.revenue -= debitSide
      else if (type === "contra-income") group.returns += debitSide
      else if (type === "expense" && id === cogs) group.cogs += debitSide
      else if (type === "expense") group.expenses += debitSide
    }
    groups.set(entry.restaurantExternalId, group)
  }
  const rows = [...groups.entries()]
    .map(([key, group]) => {
      const net = group.revenue - group.returns
      const result = net - group.cogs - group.expenses
      return { key, cells: { group: names.get(key) ?? key, revenue: group.revenue, returns: group.returns, net, cogs: group.cogs, gross: net - group.cogs, expenses: group.expenses, result, margin: percent(result, net) } }
    })
    .sort((a, b) => Number(b.cells.result) - Number(a.cells.result))
  const columns = [text("group", "Ресторан"), money("revenue", "Доходы"), money("returns", "Возвраты"), money("net", "Чистая выручка"), money("cogs", "Себестоимость"), money("gross", "Валовая прибыль"), money("expenses", "Прочие расходы"), money("result", "Финансовый результат"), col("margin", "Рентабельность, %", "percent")]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: "Журнал проводок по типам счетов (доходы, возвраты, расходы)",
    columns,
    rows,
    totals,
    kpis: [
      { key: "net", label: "Чистая выручка", value: totals.net ?? 0, unit: "money" },
      { key: "result", label: "Финансовый результат", value: totals.result ?? 0, unit: "money" },
      { key: "margin", label: "Рентабельность", value: percent(totals.result ?? 0, totals.net ?? 0), unit: "percent" },
    ],
    truncated: budget.truncated,
  }
}

// ── finance-olap OLAP-отчёт по проводкам ────────────────────────────────────────────────────────

const OLAP_DIMENSIONS = ["account", "cashflow-category", "restaurant", "day", "month", "source"] as const
type OlapDimension = (typeof OLAP_DIMENSIONS)[number]
const DIMENSION_LABEL: Record<OlapDimension, string> = { account: "Счёт", "cashflow-category": "Статья ДДС", restaurant: "Ресторан", day: "День", month: "Месяц", source: "Источник" }
const SOURCE_LABEL: Record<string, string> = { orders: "Продажи и возвраты", "delivery-orders": "Доставка", "cash-operations": "Внесения и изъятия", "shift-acceptance": "Приёмка смен", transactions: "Ручные операции", "manual-expense": "Расходы", receipts: "Приходные накладные", services: "Акты услуг", payments: "Платежи", payroll: "Зарплата", reservations: "Бронирования" }

/**
 * Free pivot over the journal: one or two groupings of account / cashflow category / restaurant / day /
 * month / source. With an account among the groupings (or `extra.accountExternalId`) every line is split
 * into its debit and credit legs — Dr, Cr, balance and count per group; otherwise Dr ≡ Cr, so it shows one
 * «Сумма» and the number of lines (L-11).
 */
const financeOlap: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsMap(ctx)
  const lookup = recordLookup(ctx)
  const budget = newBudget()
  const names = await restaurantNames(ctx, restaurants)
  const pick = (value: Config["groupBy"], fallback?: OlapDimension) => (value && (OLAP_DIMENSIONS as readonly string[]).includes(value) ? (value as OlapDimension) : fallback)
  const primary = pick(config.groupBy, "account")!
  const secondary = pick(config.secondaryGroupBy)
  const dimensions = secondary && secondary !== primary ? [primary, secondary] : [primary]
  const account = accountParam(config)
  const legs = dimensions.includes("account") || Boolean(account)
  const needle = config.search?.trim().toLocaleLowerCase("ru")
  const categoryOf = async (entry: Entry) => {
    if (entry.sourceModuleId !== "payments" && entry.sourceModuleId !== "transactions") return null
    const record = await lookup(entry.sourceExternalId)
    return record?.cashflowCategoryExternalId ? await lookup(record.cashflowCategoryExternalId) : null
  }
  const value = async (dimension: OlapDimension, entry: Entry, legAccount: string) => {
    switch (dimension) {
      case "account":
        return { key: legAccount, label: accountLabel(accounts, legAccount) }
      case "cashflow-category": {
        const category = await categoryOf(entry)
        return category ? { key: category.externalId, label: category.name } : { key: "none", label: "Без статьи" }
      }
      case "restaurant":
        return { key: entry.restaurantExternalId, label: names.get(entry.restaurantExternalId) ?? entry.restaurantExternalId }
      case "day":
        return { key: entry.businessDate, label: entry.businessDate }
      case "month":
        return { key: entry.businessDate.slice(0, 7), label: entry.businessDate.slice(0, 7) }
      case "source":
        return { key: entry.sourceModuleId, label: SOURCE_LABEL[entry.sourceModuleId] ?? entry.sourceModuleId }
    }
  }
  const groups = new Map<string, { cells: Record<string, string>; debit: number; credit: number; amount: number; count: number }>()
  for await (const entry of journalByRestaurant(ctx, restaurants, { from: config.dateFrom, to: config.dateTo }, budget)) {
    if (needle && !`${entry.sourceNumber} ${entry.description} ${entry.itemName ?? ""}`.toLocaleLowerCase("ru").includes(needle)) continue
    const sides = legs
      ? ([
          { account: entry.debitAccountExternalId, debit: entry.amount, credit: 0 },
          { account: entry.creditAccountExternalId, debit: 0, credit: entry.amount },
        ] as const).filter((side) => !account || side.account === account)
      : [{ account: entry.debitAccountExternalId, debit: 0, credit: 0 }]
    for (const side of sides) {
      const values = await Promise.all(dimensions.map((dimension) => value(dimension, entry, side.account)))
      const key = values.map((item) => item.key).join("|")
      const group = groups.get(key) ?? { cells: Object.fromEntries(values.map((item, index) => [index === 0 ? "group" : "secondary", item.label])), debit: 0, credit: 0, amount: 0, count: 0 }
      group.debit += side.debit
      group.credit += side.credit
      group.amount += entry.amount
      group.count += 1
      groups.set(key, group)
    }
  }
  const dateLike = (dimension: OlapDimension) => dimension === "day" || dimension === "month"
  const rows: Row[] = [...groups.entries()]
    .map(([key, group]): Row => ({ key, cells: legs ? { ...group.cells, debit: group.debit, credit: group.credit, balance: group.debit - group.credit, count: group.count } : { ...group.cells, amount: group.amount, count: group.count } }))
    .sort((a, b) => (dateLike(primary) ? String(a.cells.group).localeCompare(String(b.cells.group)) : legs ? Number(b.cells.debit) + Number(b.cells.credit) - Number(a.cells.debit) - Number(a.cells.credit) : Number(b.cells.amount) - Number(a.cells.amount)))
  const columns = [
    text("group", DIMENSION_LABEL[primary]),
    ...(dimensions.length > 1 ? [text("secondary", DIMENSION_LABEL[dimensions[1]])] : []),
    ...(legs ? [money("debit", "Дебет"), money("credit", "Кредит"), money("balance", "Сальдо (Дт − Кт)")] : [money("amount", "Сумма проводок")]),
    col("count", legs ? "Строк" : "Проводок", "count"),
  ]
  const totals = sumTotals(rows, columns)
  return {
    sourceLabel: `Журнал проводок${account ? ` по счёту ${accountLabel(accounts, account)}` : ""}`,
    columns,
    rows,
    totals,
    kpis: legs
      ? [
          { key: "debit", label: "Оборот Дт", value: totals.debit ?? 0, unit: "money" },
          { key: "credit", label: "Оборот Кт", value: totals.credit ?? 0, unit: "money" },
        ]
      : [
          { key: "turnover", label: "Оборот за период", value: totals.amount ?? 0, unit: "money" },
          { key: "entries", label: "Проводок", value: totals.count ?? 0, unit: "count" },
        ],
    truncated: budget.truncated,
  }
}

export const FINANCE_CALCULATORS: Record<string, Calculator> = {
  "finance-olap": financeOlap,
  "finance-01": balanceSheet,
  "finance-04": cashBook,
  "finance-05": planFact,
  "finance-06": accountTurnover,
  "finance-07": accountCard,
  "finance-09": debts("receivable"),
  "finance-10": debts("payable"),
  "finance-11": counterpartyBalances,
  "finance-12": reconciliation,
  "finance-13": paymentCalendar,
  "finance-14": budgetExecution,
  "finance-15": vatReport("invoices"),
  "finance-16": vatReport("sales"),
  "finance-17": vatReport("purchases"),
  "finance-19": revenueDistribution,
  "finance-20": cashflowByCategory,
  "finance-21": resultByRestaurant,
}
