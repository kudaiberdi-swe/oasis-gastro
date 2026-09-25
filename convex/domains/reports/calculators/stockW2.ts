import type { Doc, Id } from "../../../_generated/dataModel"
import { checkReceiptLinePrice, supplierPriceListAt, verdictFor } from "../../../lib/priceListCheck"
import type { ReportColumn, ReportConfig } from "../../../lib/reportConfig"
import { weightKg } from "../../../lib/recipeMath"
import { averageItemCost, recipeLinesOf, recipeVersionAt } from "../../../lib/recipes"
import type { Calculator } from "../registry"
import { aggregate, col, localDate } from "./_shared"
import {
  abcClasses,
  balanceAt,
  consumption,
  ITEM_KIND_LABEL,
  matches,
  memo,
  MODULE_LABEL,
  needleOf,
  newBudget,
  pairFacts,
  percent,
  periodDates,
  periodEnd,
  periodStart,
  round,
  scopedFacts,
  scopedWarehouses,
  sold,
  spend,
  stockPairs,
  weekOf,
  xyzClass,
  type Budget,
  type QueryCtx,
} from "./stockHelpers"

// The other 22 stock reports (W2-RPT-02). Balances on a date come from the last movement at or before it
// (stockMovements.by_warehouse_item_occurred); flows over a period from dailyStockFacts (W2-RPT-01).

type Result = Awaited<ReturnType<Calculator>>
type Row = { key: string; label: string; values: Record<string, number>; text?: Record<string, string> }

const qty = (key: string, label: string) => col(key, label, "quantity")
const money = (key: string, label: string) => col(key, label, "money")
const text = (key: string, label: string) => col(key, label, "text")
const kpi = (key: string, label: string, value: number, unit: ReportColumn["unit"] = "money") => ({ key, label, value: Math.round(value * 1000) / 1000, unit })

/** aggregate() without totals for the columns that do not add up (prices, shares, averages). */
function build(rows: Row[], columns: ReportColumn[], options: { sort?: string; noTotals?: string[]; order?: (a: Result["rows"][number], b: Result["rows"][number]) => number } = {}) {
  const result = aggregate(rows, columns, options.sort)
  for (const key of options.noTotals ?? []) delete result.totals[key]
  for (const key of Object.keys(result.totals)) result.totals[key] = round(result.totals[key])
  if (options.order) result.rows.sort(options.order)
  return result
}

const byText = (key: string) => (a: Result["rows"][number], b: Result["rows"][number]) => String(a.cells[key] ?? "").localeCompare(String(b.cells[key] ?? ""), "ru")

async function restaurantsReceipts(ctx: QueryCtx, restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Doc<"receipts">[] = []
  for (const restaurant of restaurants) {
    for await (const receipt of ctx.db.query("receipts").withIndex("by_restaurant_status_date", (q) => q.eq("restaurantExternalId", restaurant).eq("status", "posted").gte("date", periodStart(config)).lte("date", periodEnd(config)))) {
      if (!spend(budget)) return rows
      rows.push(receipt)
    }
  }
  return rows.sort((a, b) => a.date - b.date)
}

async function postedDocuments(ctx: QueryCtx, type: Doc<"stockDocuments">["type"], restaurants: string[], config: ReportConfig, budget: Budget) {
  const rows: Doc<"stockDocuments">[] = []
  for (const restaurant of restaurants) {
    for await (const document of ctx.db.query("stockDocuments").withIndex("by_type_restaurant_status_date", (q) => q.eq("type", type).eq("restaurantExternalId", restaurant).eq("status", "posted").gte("date", periodStart(config)).lte("date", periodEnd(config)))) {
      if (!spend(budget)) return rows
      rows.push(document)
    }
  }
  return rows.sort((a, b) => a.date - b.date)
}

// ── 02, 04: balances out of bounds ────────────────────────────────────────────

function balanceBounds(kind: "negative" | "above-maximum"): Calculator {
  return async (ctx, config, restaurants) => {
    const negative = kind === "negative"
    const columns = negative
      ? [text("group", "Номенклатура"), text("warehouse", "Склад"), qty("quantity", "Остаток"), money("averageCost", "Ср. цена"), money("value", "Стоимость")]
      : [text("group", "Номенклатура"), text("warehouse", "Склад"), qty("quantity", "Остаток"), qty("maximum", "Максимум"), qty("excess", "Сверх максимума"), money("averageCost", "Ср. цена"), money("excessValue", "Стоимость излишка")]
    const budget = newBudget()
    const rows: Row[] = []
    for await (const { warehouse, balance, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
      const base = { key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name } }
      if (negative && balance.quantity < 0) rows.push({ ...base, values: { quantity: balance.quantity, averageCost: balance.averageUnitCost, value: Math.round(balance.quantity * balance.averageUnitCost) } })
      if (!negative && item.maximumStock !== undefined && balance.quantity > item.maximumStock) {
        const excess = balance.quantity - item.maximumStock
        rows.push({ ...base, values: { quantity: balance.quantity, maximum: item.maximumStock, excess, averageCost: balance.averageUnitCost, excessValue: Math.round(excess * balance.averageUnitCost) } })
      }
    }
    const result = negative ? build(rows, columns, { noTotals: ["averageCost"], order: (a, b) => Number(a.cells.value) - Number(b.cells.value) }) : build(rows, columns, { sort: "excessValue", noTotals: ["averageCost", "maximum"] })
    const kpis = [kpi("positions", "Позиций", rows.length, "count"), negative ? kpi("value", "Стоимость минуса", result.totals.value ?? 0) : kpi("excessValue", "Стоимость излишка", result.totals.excessValue ?? 0)]
    return { sourceLabel: negative ? "Текущие остатки складов: отрицательные" : "Текущие остатки складов выше максимума позиции", columns, ...result, kpis, truncated: budget.truncated }
  }
}

// ── 05: expired lots ───────────────────────────────────────────────────────────

/**
 * A lot expires at receipt date + the item's shelf life. Lots do not track consumption, so the stock on
 * the date is laid onto the newest lots first (FIFO: the oldest ones were used up first).
 */
const expiredLots: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("warehouse", "Склад"), text("lot", "Партия"), text("received", "Приход"), text("expires", "Годен до"), col("overdueDays", "Просрочено, дней", "count"), qty("quantity", "Остаток партии"), money("value", "Стоимость")]
  const budget = newBudget()
  const at = periodEnd(config)
  const rows: Row[] = []
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    if (!item.shelfLifeHours || item.shelfLifeHours <= 0) continue
    let left = (await balanceAt(ctx, warehouse._id, item._id, at, budget)).quantity
    if (left <= 0) continue
    for await (const lot of ctx.db.query("stockLots").withIndex("by_warehouse_item_received", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id).lte("receivedAt", at)).order("desc")) {
      if (left <= 0 || !spend(budget)) break
      const remaining = Math.min(lot.remainingQuantity, left)
      if (remaining <= 0) continue
      left = round(left - remaining)
      const expiresAt = lot.receivedAt + item.shelfLifeHours * 3_600_000
      if (expiresAt > at) continue
      rows.push({
        key: lot._id,
        label: item.name,
        text: { warehouse: warehouse.name, lot: lot.sourceNumber, received: localDate(lot.receivedAt), expires: localDate(expiresAt) },
        values: { overdueDays: Math.max(0, Math.floor((at - expiresAt) / 86_400_000)), quantity: remaining, value: Math.round(remaining * lot.unitCost) },
      })
    }
  }
  const result = build(rows, columns, { sort: "value", noTotals: ["overdueDays"] })
  return { sourceLabel: `Партии приходов на ${config.dateTo}: срок = дата прихода + срок годности позиции, остаток партии — по FIFO`, columns, ...result, kpis: [kpi("value", "Стоимость просрочки", result.totals.value ?? 0), kpi("lots", "Партий", rows.length, "count")], truncated: budget.truncated }
}

// ── 06, 08, 14, 28: per warehouse × item over the period ──────────────────────

const turnoverSheet: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("warehouse", "Склад"), qty("openingQuantity", "Нач. остаток"), money("openingValue", "Нач. стоимость"), qty("inQuantity", "Приход"), money("inValue", "Приход, сумма"), qty("outQuantity", "Расход"), money("outValue", "Расход, сумма"), qty("closingQuantity", "Кон. остаток"), money("closingValue", "Кон. стоимость")]
  const budget = newBudget()
  const rows: Row[] = []
  let mismatched = 0
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    const opening = await balanceAt(ctx, warehouse._id, item._id, periodStart(config) - 1, budget)
    const closing = await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)
    const flows = { inQuantity: 0, inValue: 0, outQuantity: 0, outValue: 0 }
    for (const fact of await pairFacts(ctx, warehouse._id, item._id, config, budget)) {
      flows.inQuantity += fact.inQuantity
      flows.inValue += fact.inValue
      flows.outQuantity += fact.outQuantity
      flows.outValue += fact.outValue
    }
    if (!opening.quantity && !closing.quantity && !flows.inQuantity && !flows.outQuantity) continue
    if (Math.abs(opening.quantity + flows.inQuantity - flows.outQuantity - closing.quantity) > 0.001) mismatched += 1
    rows.push({ key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name }, values: { openingQuantity: opening.quantity, openingValue: opening.value, ...flows, closingQuantity: closing.quantity, closingValue: closing.value } })
  }
  const result = build(rows, columns, { order: byText("group") })
  const t = result.totals
  const kpis = [kpi("openingValue", "На начало", t.openingValue ?? 0), kpi("inValue", "Приход", t.inValue ?? 0), kpi("outValue", "Расход", t.outValue ?? 0), kpi("closingValue", "На конец", t.closingValue ?? 0), kpi("mismatched", "Позиций с расхождением", mismatched, "count")]
  return { sourceLabel: "Остатки на начало и конец — по движениям; обороты — предагрегат склада за день", columns, ...result, kpis, truncated: budget.truncated }
}

const costChange: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("warehouse", "Склад"), money("startCost", "Ср. цена на начало"), money("endCost", "Ср. цена на конец"), money("delta", "Изменение"), col("deltaPercent", "Изменение, %", "percent"), qty("closingQuantity", "Кон. остаток"), money("revaluation", "Влияние на остаток")]
  const budget = newBudget()
  const rows: Row[] = []
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    const start = await balanceAt(ctx, warehouse._id, item._id, periodStart(config) - 1, budget)
    const end = await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)
    if (!start.averageCost && !end.averageCost) continue
    const delta = end.averageCost - start.averageCost
    rows.push({ key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name }, values: { startCost: round(start.averageCost, 2), endCost: round(end.averageCost, 2), delta: round(delta, 2), deltaPercent: start.averageCost ? percent(delta, start.averageCost) : 0, closingQuantity: end.quantity, revaluation: Math.round(delta * end.quantity) } })
  }
  const result = build(rows, columns, { noTotals: ["startCost", "endCost", "delta", "deltaPercent", "closingQuantity"], order: (a, b) => Math.abs(Number(b.cells.deltaPercent)) - Math.abs(Number(a.cells.deltaPercent)) })
  return { sourceLabel: "Средневзвешенная себестоимость по движениям склада на начало и конец периода", columns, ...result, kpis: [kpi("revaluation", "Влияние на стоимость остатка", result.totals.revaluation ?? 0), kpi("grown", "Подорожало позиций", rows.filter((row) => row.values.delta > 0).length, "count")], truncated: budget.truncated }
}

const unsold: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("warehouse", "Склад"), qty("quantity", "Остаток"), money("value", "Стоимость"), text("lastMovement", "Последнее движение")]
  const budget = newBudget()
  const rows: Row[] = []
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    const closing = await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)
    if (closing.quantity <= 0) continue
    const used = (await pairFacts(ctx, warehouse._id, item._id, config, budget)).reduce((sum, fact) => sum + consumption(fact).quantity, 0)
    if (used > 0) continue
    rows.push({ key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name, lastMovement: closing.lastAt ? localDate(closing.lastAt) : "—" }, values: { quantity: closing.quantity, value: closing.value } })
  }
  const result = build(rows, columns, { sort: "value" })
  return { sourceLabel: "Позиции с остатком на конец периода без расхода (кроме перемещений) за период", columns, ...result, kpis: [kpi("value", "Заморожено в остатках", result.totals.value ?? 0), kpi("positions", "Позиций", rows.length, "count")], truncated: budget.truncated }
}

const turnoverDays: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), qty("averageStock", "Средний запас"), money("averageStockValue", "Средний запас, сумма"), qty("consumption", "Расход за период"), qty("dailyConsumption", "Расход в день"), col("turnoverDays", "Оборачиваемость, дней", "count"), text("note", "Примечание")]
  const budget = newBudget()
  const dates = periodDates(config)
  const perItem = new Map<string, { label: string; averageStock: number; averageStockValue: number; consumption: number; consumptionValue: number }>()
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    const opening = await balanceAt(ctx, warehouse._id, item._id, periodStart(config) - 1, budget)
    const closing = await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)
    const byDate = new Map((await pairFacts(ctx, warehouse._id, item._id, config, budget)).map((fact) => [fact.businessDate, fact]))
    let running = opening.quantity
    let stockDays = 0
    let used = 0
    let usedValue = 0
    for (const date of dates) {
      const fact = byDate.get(date)
      if (fact) {
        running += fact.inQuantity - fact.outQuantity
        const spent = consumption(fact)
        used += spent.quantity
        usedValue += spent.value
      }
      stockDays += Math.max(0, running)
    }
    if (!stockDays && !used) continue
    const row = perItem.get(item._id) ?? { label: item.name, averageStock: 0, averageStockValue: 0, consumption: 0, consumptionValue: 0 }
    const averageStock = stockDays / dates.length
    row.averageStock += averageStock
    row.averageStockValue += averageStock * (closing.averageCost || opening.averageCost)
    row.consumption += used
    row.consumptionValue += usedValue
    perItem.set(item._id, row)
  }
  const rows: Row[] = [...perItem.entries()].map(([key, row]) => {
    const daily = row.consumption / dates.length
    return { key, label: row.label, text: { note: daily > 0 ? "" : "Нет расхода" }, values: { averageStock: round(row.averageStock), averageStockValue: Math.round(row.averageStockValue), consumption: round(row.consumption), dailyConsumption: round(daily), turnoverDays: daily > 0 ? round(row.averageStock / daily, 1) : 0 } }
  })
  const result = build(rows, columns, { noTotals: ["turnoverDays", "dailyConsumption", "averageStock", "consumption"], order: (a, b) => Number(b.cells.turnoverDays) - Number(a.cells.turnoverDays) })
  const totalValue = [...perItem.values()].reduce((sum, row) => sum + row.consumptionValue, 0) / dates.length
  const stockValue = [...perItem.values()].reduce((sum, row) => sum + row.averageStockValue, 0)
  return { sourceLabel: "Средний дневной запас / среднедневной расход (без перемещений) за период", columns, ...result, kpis: [kpi("turnoverDays", "Оборачиваемость запасов, дней", totalValue > 0 ? round(stockValue / totalValue, 1) : 0, "count"), kpi("averageStockValue", "Средний запас", Math.round(stockValue))], truncated: budget.truncated }
}

// ── 11, 12, 13, 19: day facts of the scoped warehouses ─────────────────────────

async function itemFlows(ctx: QueryCtx, config: ReportConfig, restaurants: string[], budget: Budget) {
  const facts = await scopedFacts(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)
  const item = memo<"inventoryItems">(ctx)
  const needle = needleOf(config)
  const kept: { fact: (typeof facts)[number]; item: Doc<"inventoryItems"> }[] = []
  for (const fact of facts) {
    const row = await item(fact.inventoryItemId)
    if (row && matches(needle, row.name)) kept.push({ fact, item: row })
  }
  return kept
}

const abcItems: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), qty("quantity", "Расход"), money("value", "Стоимость расхода"), col("share", "Доля, %", "percent"), col("cumulative", "Накопительно, %", "percent"), text("abc", "Класс")]
  const budget = newBudget()
  const perItem = new Map<string, { label: string; quantity: number; value: number }>()
  for (const { fact, item } of await itemFlows(ctx, config, restaurants, budget)) {
    const spent = consumption(fact)
    const row = perItem.get(item._id) ?? { label: item.name, quantity: 0, value: 0 }
    row.quantity += spent.quantity
    row.value += spent.value
    perItem.set(item._id, row)
  }
  const classes = abcClasses([...perItem.entries()].map(([key, row]) => ({ key, value: Math.round(row.value) })))
  const rows: Row[] = classes.map((row) => ({ key: row.key, label: perItem.get(row.key)!.label, text: { abc: row.abc }, values: { quantity: round(perItem.get(row.key)!.quantity), value: row.value, share: round(row.share, 1), cumulative: round(row.cumulative, 1) } }))
  const result = build(rows, columns, { noTotals: ["share", "cumulative"] })
  const count = (abc: string) => classes.filter((row) => row.abc === abc).length
  return { sourceLabel: "Расход без перемещений за период по стоимости: A — 80 %, B — 15 %, C — 5 %", columns, ...result, kpis: [kpi("a", "Класс A", count("A"), "count"), kpi("b", "Класс B", count("B"), "count"), kpi("c", "Класс C", count("C"), "count"), kpi("value", "Стоимость расхода", result.totals.value ?? 0)], truncated: budget.truncated }
}

const xyzItems: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), qty("quantity", "Расход"), qty("mean", "Среднее в день"), qty("deviation", "Ст. отклонение"), col("variation", "Вариация, %", "percent"), text("xyz", "Класс")]
  const budget = newBudget()
  const dates = periodDates(config)
  const perItem = new Map<string, { label: string; daily: Map<string, number> }>()
  for (const { fact, item } of await itemFlows(ctx, config, restaurants, budget)) {
    const row = perItem.get(item._id) ?? { label: item.name, daily: new Map<string, number>() }
    row.daily.set(fact.businessDate, (row.daily.get(fact.businessDate) ?? 0) + consumption(fact).quantity)
    perItem.set(item._id, row)
  }
  const rows: Row[] = []
  for (const [key, row] of perItem) {
    const daily = dates.map((date) => row.daily.get(date) ?? 0)
    const stats = xyzClass(daily)
    if (!(stats.mean > 0)) continue
    rows.push({ key, label: row.label, text: { xyz: stats.xyz }, values: { quantity: round(daily.reduce((sum, value) => sum + value, 0)), mean: round(stats.mean), deviation: round(stats.deviation), variation: round(stats.variation, 1) } })
  }
  const result = build(rows, columns, { noTotals: ["mean", "deviation", "variation"], order: (a, b) => Number(a.cells.variation) - Number(b.cells.variation) })
  const count = (xyz: string) => rows.filter((row) => row.text?.xyz === xyz).length
  return { sourceLabel: `Вариация дневного расхода за ${dates.length} дн.: X < 10 %, Y 10–25 %, Z > 25 %`, columns, ...result, kpis: [kpi("x", "Класс X", count("X"), "count"), kpi("y", "Класс Y", count("Y"), "count"), kpi("z", "Класс Z", count("Z"), "count")], truncated: budget.truncated }
}

const salesByItem: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), qty("quantity", "Продано"), money("value", "Себестоимость"), money("averageCost", "Ср. цена")]
  const budget = newBudget()
  const perItem = new Map<string, { label: string; quantity: number; value: number }>()
  for (const { fact, item } of await itemFlows(ctx, config, restaurants, budget)) {
    const out = sold(fact)
    if (!out.quantity) continue
    const row = perItem.get(item._id) ?? { label: item.name, quantity: 0, value: 0 }
    row.quantity += out.quantity
    row.value += out.value
    perItem.set(item._id, row)
  }
  const rows: Row[] = [...perItem.entries()].filter(([, row]) => Math.abs(row.quantity) > 0.0005).map(([key, row]) => ({ key, label: row.label, values: { quantity: round(row.quantity), value: Math.round(row.value), averageCost: row.quantity ? round(row.value / row.quantity, 2) : 0 } }))
  const result = build(rows, columns, { sort: "value", noTotals: ["averageCost", "quantity"] })
  return { sourceLabel: "Списания по продажам кассы (предагрегат склада за день), по средней цене расхода дня", columns, ...result, kpis: [kpi("value", "Себестоимость продаж", result.totals.value ?? 0), kpi("positions", "Позиций", rows.length, "count")], truncated: budget.truncated }
}

const KIND_COLUMNS: [keyof Doc<"dailyStockFacts">["byKind"], string][] = [["receipt", "Приходы"], ["sale", "Продажи"], ["writeoff", "Списания"], ["transferIn", "Перемещения +"], ["transferOut", "Перемещения −"], ["inventory", "Инвентаризации"], ["production", "Производство"], ["supplierReturn", "Возвраты поставщикам"], ["outgoingInvoice", "Расходные накладные"], ["other", "Прочее"]]
const OLAP_DIMENSIONS = ["warehouse", "product", "category", "restaurant", "day", "week", "month"] as const
type OlapDimension = (typeof OLAP_DIMENSIONS)[number]
const OLAP_LABEL: Record<OlapDimension, string> = { warehouse: "Склад", product: "Номенклатура", category: "Группа", restaurant: "Ресторан", day: "День", week: "Неделя", month: "Месяц" }
const asDimension = (value: string | undefined): OlapDimension | undefined => (OLAP_DIMENSIONS as readonly string[]).includes(value ?? "") ? (value as OlapDimension) : undefined

/** OLAP over the day facts: rows by groupBy (+ secondaryGroupBy), measures — quantity and value flows and quantities by kind. */
const customStock: Calculator = async (ctx, config, restaurants) => {
  const primary = asDimension(config.groupBy) ?? "warehouse"
  const secondary = asDimension(config.secondaryGroupBy)
  const time = (dimension: OlapDimension | undefined) => dimension === "day" || dimension === "week" || dimension === "month"
  const columns = [col("group", OLAP_LABEL[primary], time(primary) ? "date" : "text"), ...(secondary && secondary !== primary ? [text("secondary", OLAP_LABEL[secondary])] : []), qty("inQuantity", "Приход"), money("inValue", "Приход, сумма"), qty("outQuantity", "Расход"), money("outValue", "Расход, сумма"), qty("net", "Изменение"), col("movements", "Движений", "count"), ...KIND_COLUMNS.map(([key, label]) => qty(key, label))]
  const budget = newBudget()
  const warehouse = memo<"warehouses">(ctx)
  const names = new Map<string, string>()
  const restaurantName = async (externalId: string) => {
    if (!names.has(externalId)) names.set(externalId, (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).first())?.name ?? externalId)
    return names.get(externalId)!
  }
  const dimension = async (kind: OlapDimension, fact: Doc<"dailyStockFacts">, item: Doc<"inventoryItems">): Promise<[string, string]> => {
    if (kind === "warehouse") return [fact.warehouseId, (await warehouse(fact.warehouseId))?.name ?? "—"]
    if (kind === "product") return [item._id, item.name]
    if (kind === "category") return [item.kind ?? "none", ITEM_KIND_LABEL[item.kind ?? ""] ?? "Без группы"]
    if (kind === "restaurant") return [fact.restaurantExternalId, await restaurantName(fact.restaurantExternalId)]
    if (kind === "day") return [fact.businessDate, fact.businessDate]
    if (kind === "week") return [weekOf(fact.businessDate), weekOf(fact.businessDate)]
    return [fact.businessDate.slice(0, 7), fact.businessDate.slice(0, 7)]
  }
  const rows: Row[] = []
  for (const { fact, item } of await itemFlows(ctx, config, restaurants, budget)) {
    const [key, label] = await dimension(primary, fact, item)
    const [secondKey, secondLabel] = secondary && secondary !== primary ? await dimension(secondary, fact, item) : ["", ""]
    rows.push({ key: `${key}|${secondKey}`, label, text: secondKey ? { secondary: secondLabel } : undefined, values: { inQuantity: fact.inQuantity, inValue: fact.inValue, outQuantity: fact.outQuantity, outValue: fact.outValue, net: fact.inQuantity - fact.outQuantity, movements: fact.movementCount, ...fact.byKind } })
  }
  const result = build(rows, columns, time(primary) ? { order: (a, b) => `${a.cells.group}${a.cells.secondary ?? ""}`.localeCompare(`${b.cells.group}${b.cells.secondary ?? ""}`) } : { sort: "outValue" })
  return { sourceLabel: `Предагрегат склада за день: ${OLAP_LABEL[primary]}${secondary && secondary !== primary ? ` × ${OLAP_LABEL[secondary]}` : ""}`, columns, ...result, kpis: [kpi("inValue", "Приход", result.totals.inValue ?? 0), kpi("outValue", "Расход", result.totals.outValue ?? 0)], truncated: budget.truncated }
}

// ── 15: goods report by documents ──────────────────────────────────────────────

const goodsByDocuments: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Документ"), text("type", "Тип"), text("date", "Дата"), qty("inQuantity", "Приход"), money("inValue", "Приход, сумма"), qty("outQuantity", "Расход"), money("outValue", "Расход, сумма")]
  const budget = newBudget()
  const rows: Row[] = []
  let openingValue = 0
  let closingValue = 0
  for await (const { warehouse, item } of stockPairs(ctx, await scopedWarehouses(ctx, restaurants, config), config, budget)) {
    openingValue += (await balanceAt(ctx, warehouse._id, item._id, periodStart(config) - 1, budget)).value
    closingValue += (await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)).value
    for await (const movement of ctx.db.query("stockMovements").withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouse._id).eq("inventoryItemId", item._id).gte("occurredAt", periodStart(config)).lte("occurredAt", periodEnd(config)))) {
      if (!spend(budget)) break
      const reversal = Boolean(movement.reversalOf)
      const value = movement.amount ?? Math.round(Math.abs(movement.quantityDelta) * movement.unitCost)
      const inbound = movement.quantityDelta > 0
      const type = `${MODULE_LABEL[movement.sourceModuleId ?? ""] ?? "Движение"}${reversal ? " (сторно)" : ""}`
      rows.push({
        key: `${movement.sourceExternalId ?? movement._id}${reversal ? ":reversal" : ""}`,
        label: movement.sourceNumber || "Без номера",
        text: { type, date: localDate(movement.occurredAt) },
        values: { inQuantity: inbound ? movement.quantityDelta : 0, inValue: inbound ? value : 0, outQuantity: inbound ? 0 : -movement.quantityDelta, outValue: inbound ? 0 : value },
      })
    }
  }
  const result = build(rows, columns, { order: (a, b) => `${a.cells.date}${a.cells.group}`.localeCompare(`${b.cells.date}${b.cells.group}`) })
  const t = result.totals
  const kpis = [kpi("openingValue", "Остаток на начало", openingValue), kpi("inValue", "Приход", t.inValue ?? 0), kpi("outValue", "Расход", t.outValue ?? 0), kpi("closingValue", "Остаток на конец", closingValue)]
  return { sourceLabel: "Движения склада за период, сгруппированные по документам", columns, ...result, kpis, truncated: budget.truncated }
}

// ── 16: certificates (not kept) ────────────────────────────────────────────────

const certificates: Calculator = async () => ({
  sourceLabel: "Недоступно: учёт сертификатов выключен — у партий нет номера и срока сертификата",
  columns: [text("group", "Номенклатура"), text("lot", "Партия"), text("certificate", "Сертификат"), text("validUntil", "Действует до")],
  rows: [],
  totals: {},
  kpis: [],
  truncated: false,
})

// ── 17, 18: recipes ───────────────────────────────────────────────────────────

const PRODUCT_TYPE: Record<string, string> = { dish: "Блюдо", good: "Товар", preparation: "Заготовка" }

async function lineComponent(ctx: QueryCtx, line: Doc<"recipeLines">, item: ReturnType<typeof memo<"inventoryItems">>, product: ReturnType<typeof memo<"products">>) {
  if (line.kind === "item") {
    const row = await item(line.inventoryItemId)
    return { key: line.inventoryItemId ?? line.name, name: row?.name ?? line.name, externalId: row?.externalId }
  }
  const component = await product(line.componentProductId)
  const stocked = component ? await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", component.externalId)).first() : null
  return { key: stocked?._id ?? line.componentProductId ?? line.name, name: stocked?.name ?? `${component?.name ?? line.name} (заготовка)`, externalId: stocked?.externalId }
}

/** Reverse of the recipes: which dishes and preparations (their recipe in force on dateTo) use an item. */
const itemInDishes: Calculator = async (ctx, config) => {
  const columns = [text("group", "Номенклатура"), text("dish", "Блюдо / заготовка"), text("type", "Тип"), qty("perPortion", "На порцию"), text("unit", "Ед."), qty("grossKg", "Брутто на порцию, кг"), text("version", "Техкарта")]
  const budget = newBudget()
  const at = periodEnd(config)
  const needle = needleOf(config)
  const onlyItem = typeof config.extra?.inventoryItemExternalId === "string" ? config.extra.inventoryItemExternalId : undefined
  const item = memo<"inventoryItems">(ctx)
  const product = memo<"products">(ctx)
  const rows: Row[] = []
  const dishes = new Set<string>()
  for await (const dish of ctx.db.query("products").withIndex("by_enabled_and_name", (q) => q.eq("enabled", true))) {
    if (!spend(budget)) break
    const version = await recipeVersionAt(ctx, dish._id, at)
    if (!version) continue
    const portions = version.batchYield > 0 ? version.batchYield : 1
    for (const line of await recipeLinesOf(ctx, version._id)) {
      const component = await lineComponent(ctx, line, item, product)
      if (!matches(needle, component.name) || (onlyItem && component.externalId !== onlyItem)) continue
      dishes.add(dish._id)
      rows.push({ key: `${component.key}:${dish._id}:${line._id}`, label: component.name, text: { dish: dish.name, type: PRODUCT_TYPE[dish.itemType ?? "dish"] ?? "Блюдо", unit: line.unit, version: `v${version.version} с ${localDate(version.effectiveFrom)}` }, values: { perPortion: round(line.quantity / portions, 4), grossKg: round(weightKg(line) / portions, 4) } })
    }
  }
  const result = build(rows, columns, { noTotals: ["perPortion", "grossKg"], order: (a, b) => `${a.cells.group}\u0000${a.cells.dish}`.localeCompare(`${b.cells.group}\u0000${b.cells.dish}`, "ru") })
  return { sourceLabel: `Техкарты, действующие на ${config.dateTo}: вхождение позиций в блюда и заготовки`, columns, ...result, kpis: [kpi("items", "Позиций", new Set(result.rows.map((row) => row.cells.group)).size, "count"), kpi("dishes", "Блюд и заготовок", dishes.size, "count")], truncated: budget.truncated }
}

/** Dish → ingredients of its recipe and the theoretical consumption for the portions sold in the period. */
const dishesReport: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Блюдо"), text("ingredient", "Ингредиент"), text("unit", "Ед."), qty("perPortion", "На порцию"), qty("sold", "Продано порций"), qty("consumption", "Расход по техкарте"), money("cost", "Себестоимость расхода")]
  const budget = newBudget()
  const needle = needleOf(config)
  const soldBy = new Map<string, { name: string; quantity: number }>()
  for (const restaurant of restaurants) {
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "product").gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) break
      if (!matches(needle, fact.dimensionLabel)) continue
      const row = soldBy.get(fact.dimensionKey) ?? { name: fact.dimensionLabel, quantity: 0 }
      row.quantity += fact.quantity
      soldBy.set(fact.dimensionKey, row)
    }
  }
  const at = periodEnd(config)
  const item = memo<"inventoryItems">(ctx)
  const product = memo<"products">(ctx)
  const costs = new Map<string, number>()
  const rows: Row[] = []
  for (const [externalId, sale] of soldBy) {
    if (!(sale.quantity > 0)) continue
    const dish = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).first()
    const version = dish ? await recipeVersionAt(ctx, dish._id, at) : null
    if (!dish || !version) {
      rows.push({ key: `${externalId}:none`, label: sale.name, text: { ingredient: "Нет техкарты", unit: "" }, values: { perPortion: 0, sold: sale.quantity, consumption: 0, cost: 0 } })
      continue
    }
    const portions = version.batchYield > 0 ? version.batchYield : 1
    for (const line of await recipeLinesOf(ctx, version._id)) {
      const component = await lineComponent(ctx, line, item, product)
      const perPortion = line.quantity / portions
      const itemId = line.kind === "item" ? line.inventoryItemId : (component.key as Id<"inventoryItems">)
      let unitCost = 0
      if (itemId && (line.kind === "item" || component.externalId)) {
        if (!costs.has(itemId)) costs.set(itemId, await averageItemCost(ctx, itemId, restaurants.length === 1 ? restaurants[0] : undefined))
        unitCost = costs.get(itemId)!
      }
      rows.push({ key: `${externalId}:${line._id}`, label: dish.name, text: { ingredient: component.name, unit: line.unit }, values: { perPortion: round(perPortion, 4), sold: sale.quantity, consumption: round(perPortion * sale.quantity), cost: Math.round(perPortion * sale.quantity * unitCost) } })
    }
  }
  const result = build(rows, columns, { noTotals: ["perPortion", "sold", "consumption"], order: (a, b) => `${a.cells.group}\u0000${a.cells.ingredient}`.localeCompare(`${b.cells.group}\u0000${b.cells.ingredient}`, "ru") })
  return { sourceLabel: "Продажи блюд (предагрегат кассы) × техкарта, действующая на конец периода", columns, ...result, kpis: [kpi("dishes", "Блюд продано", [...soldBy.values()].filter((row) => row.quantity > 0).length, "count"), kpi("cost", "Себестоимость по техкартам", result.totals.cost ?? 0)], truncated: budget.truncated }
}

// ── 10, 20, 21: purchase prices ───────────────────────────────────────────────

const VERDICT_LABEL = { ok: "В пределах допуска", warn: "Предупреждение", block: "Превышение" } as const

/** The receipt line price before this one of the item at the warehouse (the previous posted receipt), per stock unit with VAT. */
async function previousReceiptPrice(ctx: QueryCtx, receipt: Doc<"receipts">, line: Doc<"receiptLines">, budget: Budget) {
  for await (const movement of ctx.db.query("stockMovements").withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", receipt.warehouseId).eq("inventoryItemId", line.inventoryItemId).lt("occurredAt", receipt.date)).order("desc")) {
    if (!spend(budget)) return null
    if (movement.kind !== "receipt" || movement.reversalOf || movement.sourceModuleId !== "receipts" || !movement.sourceExternalId) continue
    const previous = await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", movement.sourceExternalId!)).first()
    if (!previous || previous.status !== "posted") continue
    const lineNo = Number(movement.externalId?.split(":").pop())
    const previousLine = Number.isFinite(lineNo) ? await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", previous._id).eq("lineNo", lineNo)).first() : null
    if (previousLine && previousLine.unitCostGross > 0) return { price: previousLine.unitCostGross, number: previous.number }
  }
  return null
}

/** Receipt prices against the supplier's price list in force on the receipt date, else the previous receipt price. */
const purchaseDiscrepancies: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("receipt", "Накладная"), text("date", "Дата"), text("supplier", "Поставщик"), text("basis", "С чем сравнили"), money("price", "Цена"), money("reference", "Эталон"), col("deviationPercent", "Отклонение, %", "percent"), qty("quantity", "Количество"), money("overpayment", "Переплата"), text("verdict", "Итог")]
  const budget = newBudget()
  const needle = needleOf(config)
  const onlyViolations = config.extra?.onlyViolations === true
  const supplier = memo<"suppliers">(ctx)
  const item = memo<"inventoryItems">(ctx)
  const rows: Row[] = []
  for (const receipt of await restaurantsReceipts(ctx, restaurants, config, budget)) {
    const vendor = await supplier(receipt.supplierId)
    if (!vendor) continue
    const list = await supplierPriceListAt(ctx, vendor._id, receipt.date)
    for (const line of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) {
      const stock = await item(line.inventoryItemId)
      if (!matches(needle, stock?.name, vendor.name)) continue
      let reference: number
      let deviationPercent: number
      let verdict: keyof typeof VERDICT_LABEL
      let basis: string
      const listed = await checkReceiptLinePrice(ctx, { supplierId: vendor._id, inventoryItemId: line.inventoryItemId, price: line.unitCostGross, at: receipt.date, list })
      if (listed) {
        reference = listed.expected
        deviationPercent = listed.deviationPercent
        verdict = listed.verdict
        basis = `Прайс-лист ${listed.priceListNumber}`
      } else {
        const previous = await previousReceiptPrice(ctx, receipt, line, budget)
        if (!previous) continue
        reference = previous.price
        deviationPercent = percent(line.unitCostGross - previous.price, previous.price)
        verdict = verdictFor(vendor.priceDeviationPolicy, deviationPercent, vendor.allowedDeviationPercent)
        basis = `Предыдущий приход ${previous.number}`
      }
      if (!deviationPercent || (onlyViolations && verdict === "ok")) continue
      rows.push({
        key: `${receipt._id}:${line.lineNo}`,
        label: stock?.name ?? "—",
        text: { receipt: receipt.number, date: localDate(receipt.date), supplier: vendor.name, basis, verdict: VERDICT_LABEL[verdict] },
        values: { price: round(line.unitCostGross, 2), reference: round(reference, 2), deviationPercent, quantity: line.quantity, overpayment: Math.round((line.unitCostGross - reference) * line.quantity) },
      })
    }
  }
  const result = build(rows, columns, { noTotals: ["price", "reference", "deviationPercent", "quantity"], order: (a, b) => Math.abs(Number(b.cells.deviationPercent)) - Math.abs(Number(a.cells.deviationPercent)) })
  const overpaid = rows.reduce((sum, row) => sum + Math.max(0, row.values.overpayment), 0)
  return { sourceLabel: "Цены проведённых приходов против прайс-листа поставщика на дату прихода (иначе — предыдущей цены прихода)", columns, ...result, kpis: [kpi("violations", "Сверх допуска", rows.filter((row) => row.text?.verdict !== VERDICT_LABEL.ok).length, "count"), kpi("overpayment", "Переплата", overpaid)], truncated: budget.truncated }
}

/** Supplier price lists in force on dateTo for the suppliers serving the scope, against the stock average cost. */
const supplierPriceLists: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("supplier", "Поставщик"), text("list", "Прайс-лист"), text("effectiveFrom", "Действует с"), text("sku", "Артикул"), qty("packageCoefficient", "Ед. в упаковке"), money("packagePrice", "Цена упаковки"), money("unitPrice", "Цена за ед."), money("averageCost", "Ср. себестоимость"), col("deviationPercent", "Отклонение, %", "percent")]
  const budget = newBudget()
  const at = periodEnd(config)
  const needle = needleOf(config)
  const scope = new Set(restaurants)
  const supplier = memo<"suppliers">(ctx)
  const item = memo<"inventoryItems">(ctx)
  const rows: Row[] = []
  for await (const list of ctx.db.query("priceLists").withIndex("by_kind_status", (q) => q.eq("kind", "supplier").eq("status", "published"))) {
    if (!spend(budget)) break
    if (list.effectiveFrom > at) continue
    const vendor = await supplier(list.supplierId)
    if (!vendor || (vendor.restaurantExternalIds.length && !vendor.restaurantExternalIds.some((restaurant) => scope.has(restaurant)))) continue
    for await (const line of ctx.db.query("priceListLines").withIndex("by_list", (q) => q.eq("priceListId", list._id))) {
      if (!spend(budget)) break
      const stock = await item(line.inventoryItemId)
      if (!matches(needle, stock?.name, vendor.name, line.supplierName)) continue
      const unitPrice = line.price / (line.packageCoefficient > 0 ? line.packageCoefficient : 1)
      const averageCost = await averageItemCost(ctx, line.inventoryItemId, restaurants.length === 1 ? restaurants[0] : undefined)
      rows.push({ key: line._id, label: stock?.name ?? line.supplierName, text: { supplier: vendor.name, list: `${list.name} · v${list.version}`, effectiveFrom: localDate(list.effectiveFrom), sku: line.supplierSku }, values: { packageCoefficient: line.packageCoefficient, packagePrice: line.price, unitPrice: round(unitPrice, 2), averageCost: round(averageCost, 2), deviationPercent: averageCost ? percent(unitPrice - averageCost, averageCost) : 0 } })
    }
  }
  const result = build(rows, columns, { noTotals: ["packageCoefficient", "packagePrice", "unitPrice", "averageCost", "deviationPercent"], order: (a, b) => `${a.cells.supplier}\u0000${a.cells.group}`.localeCompare(`${b.cells.supplier}\u0000${b.cells.group}`, "ru") })
  return { sourceLabel: `Опубликованные прайс-листы поставщиков, действующие на ${config.dateTo}`, columns, ...result, kpis: [kpi("lines", "Позиций в прайсах", rows.length, "count"), kpi("suppliers", "Поставщиков", new Set(rows.map((row) => row.text?.supplier)).size, "count")], truncated: budget.truncated }
}

/** Purchase price history of each item from each supplier over the period (posted receipts). */
const purchasePriceDynamics: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Номенклатура"), text("supplier", "Поставщик"), text("firstDate", "Первый приход"), text("lastDate", "Последний приход"), col("receipts", "Приходов", "count"), qty("quantity", "Количество"), money("firstPrice", "Цена первая"), money("lastPrice", "Цена последняя"), money("minPrice", "Мин."), money("maxPrice", "Макс."), money("averagePrice", "Средняя"), col("changePercent", "Изменение, %", "percent")]
  const budget = newBudget()
  const needle = needleOf(config)
  const supplier = memo<"suppliers">(ctx)
  const item = memo<"inventoryItems">(ctx)
  const series = new Map<string, { label: string; supplier: string; points: { date: number; price: number; quantity: number }[] }>()
  for (const receipt of await restaurantsReceipts(ctx, restaurants, config, budget)) {
    const vendor = await supplier(receipt.supplierId)
    for (const line of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) {
      const stock = await item(line.inventoryItemId)
      if (!matches(needle, stock?.name, vendor?.name)) continue
      const key = `${line.inventoryItemId}:${receipt.supplierId}`
      const row = series.get(key) ?? { label: stock?.name ?? "—", supplier: vendor?.name ?? "—", points: [] }
      row.points.push({ date: receipt.date, price: line.unitCostGross, quantity: line.quantity })
      series.set(key, row)
    }
  }
  const rows: Row[] = [...series.entries()].map(([key, row]) => {
    const points = row.points.sort((a, b) => a.date - b.date)
    const first = points[0]
    const last = points[points.length - 1]
    const quantity = points.reduce((sum, point) => sum + point.quantity, 0)
    const prices = points.map((point) => point.price)
    return {
      key,
      label: row.label,
      text: { supplier: row.supplier, firstDate: localDate(first.date), lastDate: localDate(last.date) },
      values: { receipts: points.length, quantity, firstPrice: round(first.price, 2), lastPrice: round(last.price, 2), minPrice: round(Math.min(...prices), 2), maxPrice: round(Math.max(...prices), 2), averagePrice: quantity ? round(points.reduce((sum, point) => sum + point.price * point.quantity, 0) / quantity, 2) : 0, changePercent: percent(last.price - first.price, first.price) },
    }
  })
  const result = build(rows, columns, { noTotals: ["quantity", "firstPrice", "lastPrice", "minPrice", "maxPrice", "averagePrice", "changePercent"], order: (a, b) => Number(b.cells.changePercent) - Number(a.cells.changePercent) })
  return { sourceLabel: "Цены строк проведённых приходов за период (за единицу склада, с НДС)", columns, ...result, kpis: [kpi("grown", "Подорожало", rows.filter((row) => row.values.changePercent > 0).length, "count"), kpi("fell", "Подешевело", rows.filter((row) => row.values.changePercent < 0).length, "count")], truncated: budget.truncated }
}

// ── 22, 23, 26, 27: purchasing and stock documents ─────────────────────────────

const ORDER_STATUS: Record<string, string> = { "pending-approval": "На согласовании", approved: "Согласован", posted: "Проведён", completed: "Исполнен", reversed: "Сторнирован" }

/** Purchase orders of the period against their receipts: ordered, received (only what was ordered), % done. */
const purchaseOrderExecution: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Заказ"), text("date", "Дата"), text("supplier", "Поставщик"), text("status", "Статус"), text("receipt", "Приход"), qty("ordered", "Заказано"), qty("received", "Получено"), col("fulfillment", "Исполнение, %", "percent"), money("orderedAmount", "Сумма заказа"), money("receivedAmount", "Сумма прихода")]
  const budget = newBudget()
  const needle = needleOf(config)
  const supplier = memo<"suppliers">(ctx)
  const rows: Row[] = []
  for (const restaurant of restaurants) {
    for await (const order of ctx.db.query("productionDocuments").withIndex("by_type_restaurant_date", (q) => q.eq("type", "purchase-order").eq("restaurantExternalId", restaurant).gte("date", periodStart(config)).lte("date", periodEnd(config)))) {
      if (!spend(budget)) break
      if (order.status === "draft" || order.status === "cancelled") continue
      const vendor = await supplier(order.supplierId)
      if (!matches(needle, order.number, vendor?.name)) continue
      const ordered = new Map<string, number>()
      for (const line of order.lines) if (line.inventoryItemId) ordered.set(line.inventoryItemId, (ordered.get(line.inventoryItemId) ?? 0) + line.quantity)
      const receipt = order.receiptExternalId ? await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", order.receiptExternalId!)).first() : null
      const got = new Map<string, number>()
      if (receipt?.status === "posted") {
        for (const line of await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id)).take(200)) got.set(line.inventoryItemId, (got.get(line.inventoryItemId) ?? 0) + line.quantity)
      }
      const orderedTotal = [...ordered.values()].reduce((sum, value) => sum + value, 0)
      const received = [...ordered.entries()].reduce((sum, [itemId, quantity]) => sum + Math.min(quantity, got.get(itemId) ?? 0), 0)
      rows.push({
        key: order._id,
        label: order.number,
        text: { date: localDate(order.date), supplier: vendor?.name ?? "—", status: ORDER_STATUS[order.status] ?? order.status, receipt: receipt ? `${receipt.number}${receipt.status === "posted" ? "" : " (не проведён)"}` : "—" },
        values: { ordered: orderedTotal, received, fulfillment: percent(received, orderedTotal), orderedAmount: order.totalAmount, receivedAmount: receipt?.status === "posted" ? receipt.totalGross : 0 },
      })
    }
  }
  const result = build(rows, columns, { noTotals: ["fulfillment"], order: byText("date") })
  const t = result.totals
  return { sourceLabel: "Заказы поставщикам за период и связанные проведённые приходы", columns, ...result, kpis: [kpi("orders", "Заказов", rows.length, "count"), kpi("fulfillment", "Исполнение", percent(t.received ?? 0, t.ordered ?? 0), "percent"), kpi("complete", "Исполнено полностью", rows.filter((row) => row.values.fulfillment >= 100).length, "count")], truncated: budget.truncated }
}

const supplierTurnover: Calculator = async (ctx, config, restaurants) => {
  const columns = [text("group", "Поставщик"), col("receipts", "Приходов", "count"), money("received", "Получено"), col("returns", "Возвратов", "count"), money("returned", "Возвращено"), money("net", "Оборот")]
  const budget = newBudget()
  const needle = needleOf(config)
  const supplier = memo<"suppliers">(ctx)
  const rows: Row[] = []
  for (const receipt of await restaurantsReceipts(ctx, restaurants, config, budget)) {
    const vendor = await supplier(receipt.supplierId)
    if (matches(needle, vendor?.name)) rows.push({ key: receipt.supplierId, label: vendor?.name ?? "—", values: { receipts: 1, received: receipt.totalGross, returns: 0, returned: 0, net: receipt.totalGross } })
  }
  for (const document of await postedDocuments(ctx, "supplier-return", restaurants, config, budget)) {
    const vendor = await supplier(document.supplierId)
    const label = vendor?.name ?? document.counterpartyName ?? "—"
    if (matches(needle, label)) rows.push({ key: document.supplierId ?? `name:${label}`, label, values: { receipts: 0, received: 0, returns: 1, returned: document.totalAmount, net: -document.totalAmount } })
  }
  const result = build(rows, columns, { sort: "net" })
  return { sourceLabel: "Проведённые приходы и возвраты поставщикам за период", columns, ...result, kpis: [kpi("received", "Получено", result.totals.received ?? 0), kpi("returned", "Возвращено", result.totals.returned ?? 0), kpi("net", "Оборот", result.totals.net ?? 0)], truncated: budget.truncated }
}

function documentRegister(type: "transfer" | "supplier-return"): Calculator {
  return async (ctx, config, restaurants) => {
    const transfer = type === "transfer"
    const columns = transfer
      ? [text("group", "Документ"), text("date", "Дата"), text("from", "Откуда"), text("to", "Куда"), qty("quantity", "Количество"), money("amount", "Сумма"), text("comment", "Комментарий")]
      : [text("group", "Документ"), text("date", "Дата"), text("supplier", "Поставщик"), text("receipt", "Основание"), text("reason", "Причина"), qty("quantity", "Количество"), money("amount", "Сумма")]
    const budget = newBudget()
    const needle = needleOf(config)
    const onlyWarehouse = typeof config.extra?.warehouseExternalId === "string" ? config.extra.warehouseExternalId : undefined
    const warehouse = memo<"warehouses">(ctx)
    const supplier = memo<"suppliers">(ctx)
    const rows: Row[] = []
    for (const document of await postedDocuments(ctx, type, restaurants, config, budget)) {
      if (onlyWarehouse && document.sourceWarehouseExternalId !== onlyWarehouse && document.destinationWarehouseExternalId !== onlyWarehouse) continue
      const values = { quantity: document.totalQuantity, amount: document.totalAmount }
      if (transfer) {
        const from = (await warehouse(document.sourceWarehouseId))?.name ?? "—"
        const to = (await warehouse(document.destinationWarehouseId))?.name ?? "—"
        if (matches(needle, document.number, from, to, document.comment)) rows.push({ key: document._id, label: document.number, text: { date: localDate(document.date), from, to, comment: document.comment }, values })
        continue
      }
      const vendor = (await supplier(document.supplierId))?.name ?? document.counterpartyName
      const receipt = document.receiptExternalId ? await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", document.receiptExternalId!)).first() : null
      if (matches(needle, document.number, vendor, document.reason)) rows.push({ key: document._id, label: document.number, text: { date: localDate(document.date), supplier: vendor, receipt: receipt?.number ?? "—", reason: document.reason || "—" }, values })
    }
    const result = build(rows, columns, { order: byText("date") })
    return { sourceLabel: transfer ? "Проведённые перемещения между складами за период" : "Проведённые возвраты поставщикам за период", columns, ...result, kpis: [kpi("documents", "Документов", rows.length, "count"), kpi("amount", "Сумма", result.totals.amount ?? 0)], truncated: budget.truncated }
  }
}

export const STOCK_W2_CALCULATORS: Record<string, Calculator> = {
  "stock-02": balanceBounds("negative"),
  "stock-04": balanceBounds("above-maximum"),
  "stock-05": expiredLots,
  "stock-06": turnoverSheet,
  "stock-08": costChange,
  "stock-10": purchaseDiscrepancies,
  "stock-11": abcItems,
  "stock-12": xyzItems,
  "stock-13": salesByItem,
  "stock-14": unsold,
  "stock-15": goodsByDocuments,
  "stock-16": certificates,
  "stock-17": itemInDishes,
  "stock-18": dishesReport,
  "stock-19": customStock,
  "stock-20": supplierPriceLists,
  "stock-21": purchasePriceDynamics,
  "stock-22": purchaseOrderExecution,
  "stock-23": supplierTurnover,
  "stock-26": documentRegister("transfer"),
  "stock-27": documentRegister("supplier-return"),
  "stock-28": turnoverDays,
}

