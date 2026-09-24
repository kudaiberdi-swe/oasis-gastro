import type { Doc } from "../../../_generated/dataModel"
import type { Calculator } from "../registry"
import { aggregate, col, dayEnd, dayStart, localDate, SCAN_BUDGET } from "./_shared"

// Menu, finance, shift, staff and loyalty reports of W1 (W1-RPT-06/08).

async function restaurantDocs(ctx: Parameters<Calculator>[0], restaurants: string[]) {
  const docs: Doc<"restaurants">[] = []
  for (const externalId of restaurants) {
    const row = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    if (row) docs.push(row)
  }
  return docs
}

async function productFacts(ctx: Parameters<Calculator>[0], config: Parameters<Calculator>[1], restaurants: string[]) {
  const rows = []
  for (const restaurant of restaurants) {
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "product").gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) rows.push(fact)
  }
  return rows
}

/** menu-07: cost of dishes from the actual recipe write-off of their sales (not price / markup — B-23). */
const dishCost: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("netAmount", "Выручка", "money"), col("costAmount", "Себестоимость", "money"), col("portionCost", "Себестоимость порции", "money"), col("foodCost", "Фудкост, %", "percent")]
  const result = aggregate((await productFacts(ctx, config, restaurants)).map((fact) => ({ key: fact.dimensionKey, label: fact.dimensionLabel, values: { quantity: fact.quantity, netAmount: fact.netAmount, costAmount: fact.costAmount } })), columns, "costAmount")
  for (const row of result.rows) {
    const quantity = Number(row.cells.quantity) || 0
    const net = Number(row.cells.netAmount) || 0
    row.cells.portionCost = quantity ? Math.round(Number(row.cells.costAmount) / quantity) : 0
    row.cells.foodCost = net ? Math.round((Number(row.cells.costAmount) / net) * 1000) / 10 : 0
  }
  return { sourceLabel: "Продажи и списание по техкартам", columns, ...result, kpis: [{ key: "foodCost", label: "Фудкост", value: result.totals.netAmount ? Math.round(((result.totals.costAmount ?? 0) / result.totals.netAmount) * 1000) / 10 : 0, unit: "percent" }], truncated: false }
}

/** menu-08: margin of dishes (revenue − actual cost). */
const dishMargin: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("netAmount", "Выручка", "money"), col("costAmount", "Себестоимость", "money"), col("margin", "Маржа", "money"), col("marginPercent", "Маржа, %", "percent")]
  const result = aggregate((await productFacts(ctx, config, restaurants)).map((fact) => ({ key: fact.dimensionKey, label: fact.dimensionLabel, values: { quantity: fact.quantity, netAmount: fact.netAmount, costAmount: fact.costAmount, margin: fact.netAmount - fact.costAmount } })), columns, "margin")
  for (const row of result.rows) row.cells.marginPercent = Number(row.cells.netAmount) ? Math.round((Number(row.cells.margin) / Number(row.cells.netAmount)) * 1000) / 10 : 0
  return { sourceLabel: "Продажи и списание по техкартам", columns, ...result, kpis: [{ key: "margin", label: "Маржа", value: result.totals.margin ?? 0, unit: "money" }], truncated: false }
}

async function* journalLines(ctx: Parameters<Calculator>[0], config: Parameters<Calculator>[1], restaurants: string[]) {
  let scanned = 0
  for (const restaurant of restaurants) {
    for await (const entry of ctx.db.query("journalEntries").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if ((scanned += 1) > SCAN_BUDGET) return
      yield entry
    }
  }
}

async function accountsById(ctx: Parameters<Calculator>[0]) {
  return new Map((await ctx.db.query("accounts").withIndex("by_code").take(200)).map((account) => [account.externalId, account]))
}

/** finance-02: profit and loss from the journal by account type (no regex over account names — B-23). */
const profitAndLoss: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsById(ctx)
  const columns = [col("group", "Статья", "text"), col("amount", "Сумма", "money")]
  const byAccount = new Map<string, number>()
  for await (const entry of journalLines(ctx, config, restaurants)) {
    for (const [externalId, sign] of [[entry.creditAccountExternalId, 1], [entry.debitAccountExternalId, -1]] as const) {
      const account = accounts.get(externalId)
      if (!account || !["income", "expense", "contra-income"].includes(account.type)) continue
      // Income grows on the credit side, expenses and returns on the debit side.
      const value = account.type === "income" ? sign * entry.amount : -sign * entry.amount
      byAccount.set(externalId, (byAccount.get(externalId) ?? 0) + value)
    }
  }
  const line = (externalId: string) => ({ account: accounts.get(externalId)!, amount: byAccount.get(externalId) ?? 0 })
  const lines = [...byAccount.keys()].map(line).sort((a, b) => a.account.code.localeCompare(b.account.code))
  const income = lines.filter((row) => row.account.type === "income").reduce((sum, row) => sum + row.amount, 0)
  const returns = lines.filter((row) => row.account.type === "contra-income").reduce((sum, row) => sum + row.amount, 0)
  const cogs = lines.filter((row) => row.account.code === "7010").reduce((sum, row) => sum + row.amount, 0)
  const expenses = lines.filter((row) => row.account.type === "expense" && row.account.code !== "7010").reduce((sum, row) => sum + row.amount, 0)
  const rows = [
    ...lines.filter((row) => row.account.type === "income").map((row) => ({ key: row.account.externalId, cells: { group: `${row.account.code} ${row.account.name}`, amount: row.amount } })),
    ...lines.filter((row) => row.account.type === "contra-income").map((row) => ({ key: row.account.externalId, cells: { group: `${row.account.code} ${row.account.name}`, amount: -row.amount } })),
    { key: "net-revenue", cells: { group: "Чистая выручка", amount: income - returns } },
    { key: "cogs", cells: { group: "Себестоимость", amount: -cogs } },
    { key: "gross", cells: { group: "Валовая прибыль", amount: income - returns - cogs } },
    ...lines.filter((row) => row.account.type === "expense" && row.account.code !== "7010").map((row) => ({ key: row.account.externalId, cells: { group: `${row.account.code} ${row.account.name}`, amount: -row.amount } })),
    { key: "result", cells: { group: "Финансовый результат", amount: income - returns - cogs - expenses } },
  ]
  return { sourceLabel: "Журнал проводок", columns, rows, totals: { amount: income - returns - cogs - expenses }, kpis: [{ key: "revenue", label: "Чистая выручка", value: income - returns, unit: "money" }, { key: "result", label: "Финансовый результат", value: income - returns - cogs - expenses, unit: "money" }], truncated: false }
}

const MONEY_ACCOUNTS = new Set(["acc-1010", "acc-1030", "acc-1060"])

/** finance-03: cash flow — movements of cash, bank and in-transit accounts by source. */
const cashFlow: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Источник", "text"), col("incoming", "Поступления", "money"), col("outgoing", "Выплаты", "money"), col("net", "Сальдо", "money")]
  const rows = []
  for await (const entry of journalLines(ctx, config, restaurants)) {
    const incoming = MONEY_ACCOUNTS.has(entry.debitAccountExternalId) && !MONEY_ACCOUNTS.has(entry.creditAccountExternalId) ? entry.amount : 0
    const outgoing = MONEY_ACCOUNTS.has(entry.creditAccountExternalId) && !MONEY_ACCOUNTS.has(entry.debitAccountExternalId) ? entry.amount : 0
    if (!incoming && !outgoing) continue
    rows.push({ key: entry.sourceModuleId, label: SOURCE_LABEL[entry.sourceModuleId] ?? entry.sourceModuleId, values: { incoming, outgoing, net: incoming - outgoing } })
  }
  return { sourceLabel: "Журнал проводок (денежные счета)", columns, ...aggregate(rows, columns, "incoming"), kpis: [], truncated: false }
}

const SOURCE_LABEL: Record<string, string> = { orders: "Продажи и возвраты", "cash-operations": "Внесения и изъятия", "shift-acceptance": "Приёмка смен", transactions: "Ручные операции", "manual-expense": "Расходы", stock: "Закупки", receipts: "Приходные накладные" }

/** finance-08: journal lines of the period. */
const journal: Calculator = async (ctx, config, restaurants) => {
  const accounts = await accountsById(ctx)
  const columns = [col("group", "Дата", "date"), col("debit", "Дебет", "text"), col("credit", "Кредит", "text"), col("source", "Источник", "text"), col("description", "Содержание", "text"), col("amount", "Сумма", "money")]
  const rows = []
  let total = 0
  for await (const entry of journalLines(ctx, config, restaurants)) {
    total += entry.amount
    rows.push({ key: entry.externalId, cells: { group: entry.businessDate, debit: accounts.get(entry.debitAccountExternalId)?.code ?? "", credit: accounts.get(entry.creditAccountExternalId)?.code ?? "", source: SOURCE_LABEL[entry.sourceModuleId] ?? entry.sourceModuleId, description: entry.description, amount: entry.amount } })
    if (rows.length >= 2000) break
  }
  return { sourceLabel: "Журнал проводок", columns, rows, totals: { amount: total }, kpis: [{ key: "entries", label: "Проводок", value: rows.length, unit: "count" }], truncated: rows.length >= 2000 }
}

/** finance-18 and sales-27: closed shifts with their cash and acceptance. */
function shifts(acceptedOnly: boolean): Calculator {
  return async (ctx, config, restaurants) => {
    const columns = [col("group", "Смена", "text"), col("restaurant", "Ресторан", "text"), col("date", "Дата", "date"), col("expected", "Ожидалось", "money"), col("counted", "Пересчитано", "money"), col("variance", "Расхождение", "money"), col("status", "Статус", "text")]
    const rows = []
    for (const restaurant of await restaurantDocs(ctx, restaurants)) {
      for await (const shift of ctx.db.query("shifts").withIndex("by_restaurant_opened", (q) => q.eq("restaurantId", restaurant._id).gte("openedAt", dayStart(config.dateFrom)).lte("openedAt", dayEnd(config.dateTo)))) {
        const acceptance = (await ctx.db.query("cashShiftAcceptances").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(10)).find((row) => !row.reversedAt)
        if (acceptedOnly && !acceptance) continue
        const counted = acceptance?.recountedCash ?? shift.countedCash ?? 0
        const expected = shift.expectedCash ?? 0
        rows.push({ key: String(shift._id), label: `№${shift.number}${shift.zReportNumber ? ` · ${shift.zReportNumber}` : ""}`, text: { restaurant: restaurant.name, date: shift.businessDate, status: acceptance ? "Принята" : shift.status === "open" ? "Открыта" : "Закрыта" }, values: { expected, counted, variance: shift.status === "open" ? 0 : counted - expected } })
      }
    }
    return { sourceLabel: acceptedOnly ? "Приёмка кассовых смен" : "Кассовые смены", columns, ...aggregate(rows, columns), kpis: [], truncated: false }
  }
}

/** sales-28: cash in / out by operation type. */
const cashOperations: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Операция", "text"), col("count", "Операций", "count"), col("cashIn", "Внесено", "money"), col("cashOut", "Изъято", "money")]
  const allowed = new Set((await restaurantDocs(ctx, restaurants)).map((row) => row._id))
  const rows = []
  for (const type of ["cash-in", "cash-out"] as const) {
    for await (const event of ctx.db.query("shiftEvents").withIndex("by_type_created", (q) => q.eq("type", type).gte("createdAt", dayStart(config.dateFrom)).lte("createdAt", dayEnd(config.dateTo)))) {
      const shift = await ctx.db.get(event.shiftId)
      if (!shift || !allowed.has(shift.restaurantId)) continue
      rows.push({ key: event.cashOperationTypeExternalId ?? type, label: event.cashOperationTypeName ?? (type === "cash-in" ? "Внесение" : "Изъятие"), values: { count: 1, cashIn: type === "cash-in" ? event.amount : 0, cashOut: type === "cash-out" ? event.amount : 0 } })
    }
  }
  return { sourceLabel: "Кассовые операции смен", columns, ...aggregate(rows, columns), kpis: [], truncated: false }
}

/** employees-03: hours worked per employee from approved and completed attendance. */
const timesheet: Calculator = async (ctx, config, restaurants) => {
  const columns = [col("group", "Сотрудник", "text"), col("days", "Смен", "count"), col("hours", "Часов", "hours")]
  const rows = []
  for (const restaurant of restaurants) {
    for await (const record of ctx.db.query("attendanceRecords").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (record.status !== "approved" && record.status !== "completed") continue
      rows.push({ key: String(record.employeeId), label: record.employeeName, values: { days: 1, hours: record.hours ?? 0 } })
    }
  }
  return { sourceLabel: "Журнал явки (согласованные и завершённые)", columns, ...aggregate(rows, columns, "hours"), kpis: [], truncated: false }
}

/** loyalty-06 / loyalty-07: points accrued or redeemed on orders of the restaurants, by day. */
function loyaltyByDay(kind: "accrual" | "redemption"): Calculator {
  return async (ctx, config, restaurants) => {
    const columns = [col("group", "Дата", "date"), col("orders", "Заказов", "count"), col("points", kind === "accrual" ? "Начислено" : "Списано", "bonus")]
    const allowed = new Set((await restaurantDocs(ctx, restaurants)).map((row) => row._id))
    const rows = []
    for await (const row of ctx.db.query("loyaltyTransactions").withIndex("by_occurred_at", (q) => q.gte("occurredAt", dayStart(config.dateFrom)).lte("occurredAt", dayEnd(config.dateTo)))) {
      if (row.kind !== kind || !row.orderId) continue
      const order = await ctx.db.get(row.orderId)
      if (!order?.restaurantId || !allowed.has(order.restaurantId)) continue
      const date = localDate(row.occurredAt)
      rows.push({ key: date, label: date, values: { orders: 1, points: Math.abs(row.points) } })
    }
    const result = aggregate(rows, columns)
    result.rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group)))
    return { sourceLabel: "Операции программы лояльности", columns, ...result, kpis: [{ key: "points", label: kind === "accrual" ? "Начислено баллов" : "Списано баллов", value: result.totals.points ?? 0, unit: "bonus" }], truncated: false }
  }
}

export const OPERATION_CALCULATORS: Record<string, Calculator> = {
  "menu-07": dishCost,
  "menu-08": dishMargin,
  "finance-02": profitAndLoss,
  "finance-03": cashFlow,
  "finance-08": journal,
  "finance-18": shifts(true),
  "sales-27": shifts(false),
  "sales-28": cashOperations,
  "employees-03": timesheet,
  "loyalty-06": loyaltyByDay("accrual"),
  "loyalty-07": loyaltyByDay("redemption"),
}
