import type { Doc, Id } from "../../../_generated/dataModel"
import type { ReportColumn, ReportConfig } from "../../../lib/reportConfig"
import { averageItemCost } from "../../../lib/recipes"
import { planRecipeOutput } from "../../../lib/recipeConsumption"
import type { Calculator } from "../registry"
import { percentOf } from "./_facts"
import { forecastFromFacts } from "./_forecast"
import { aggregate, col, dayStart, localDate } from "./_shared"
import { balanceAt, memo, needleOf, matches, newBudget, pairFacts, periodEnd, periodStart, round, scopedWarehouses, spend, stockPairs, type Budget, type QueryCtx } from "./stockHelpers"

// Production reports (W3-RPT-02). Acts come from productionDocuments (by_type_restaurant_date) of the
// restaurants in scope — bahandi read them without a scope (B-23). Quantities and costs are what the
// posting wrote: the act lines and their stock movements (by_source); a recipe norm is always read
// through planRecipeOutput → recipeLinesOf, so an iiko chart's per-branch line variant is respected.
// production-11/12/13 share one forecast (calculators/_forecast.ts, L-14).

type Result = Awaited<ReturnType<Calculator>>
type Row = { key: string; label: string; values: Record<string, number>; text?: Record<string, string> }
type Act = Doc<"productionDocuments">
type ActType = Act["type"]

const qty = (key: string, label: string) => col(key, label, "quantity")
const money = (key: string, label: string) => col(key, label, "money")
const text = (key: string, label: string) => col(key, label, "text")
const kpi = (key: string, label: string, value: number, unit: ReportColumn["unit"] = "money") => ({ key, label, value: round(value), unit })

const STATUS_LABEL: Record<Act["status"], string> = { draft: "Черновик", "pending-approval": "На согласовании", approved: "Согласован", posted: "Проведён", completed: "Выполнен", reversed: "Сторнирован", cancelled: "Отменён" }

/** Acts of one type in the period for the restaurants; `statuses` keeps only those (all but cancelled by default). */
async function actsOf(ctx: QueryCtx, type: ActType, restaurants: string[], config: ReportConfig, budget: Budget, statuses?: Act["status"][]) {
  const rows: Act[] = []
  for (const restaurant of restaurants) {
    for await (const act of ctx.db.query("productionDocuments").withIndex("by_type_restaurant_date", (q) => q.eq("type", type).eq("restaurantExternalId", restaurant).gte("date", periodStart(config)).lte("date", periodEnd(config)))) {
      if (!spend(budget)) return rows
      if (statuses ? statuses.includes(act.status) : act.status !== "cancelled") rows.push(act)
    }
  }
  return rows.sort((a, b) => a.date - b.date)
}

/** The stock movements an act posted (inputs negative, outputs positive), reversals left out. */
async function movementsOf(ctx: QueryCtx, act: Act, budget: Budget) {
  const rows: Doc<"stockMovements">[] = []
  for await (const movement of ctx.db.query("stockMovements").withIndex("by_source", (q) => q.eq("sourceExternalId", act.externalId))) {
    if (!spend(budget)) break
    if (movement.kind !== "reversal" && !movement.reversalOf) rows.push(movement)
  }
  return rows
}

/** The line number of a production act's movement (`<act>:<lineNo>:in-<n>` / `:out`). */
function lineNoOf(act: Act, movement: Doc<"stockMovements">) {
  const rest = movement.externalId?.startsWith(`${act.externalId}:`) ? movement.externalId.slice(act.externalId.length + 1) : ""
  return Number(rest.split(":")[0])
}

const movementValue = (movement: Doc<"stockMovements">) => Math.abs(movement.amount ?? movement.quantityDelta * movement.unitCost)

function build(rows: Row[], columns: ReportColumn[], options: { sort?: string; noTotals?: string[] } = {}) {
  const result = aggregate(rows, columns, options.sort)
  for (const key of options.noTotals ?? []) delete result.totals[key]
  for (const key of Object.keys(result.totals)) result.totals[key] = round(result.totals[key])
  return result
}

const byLabel = (key = "group") => (a: Result["rows"][number], b: Result["rows"][number]) => String(a.cells[key] ?? "").localeCompare(String(b.cells[key] ?? ""), "ru")

function warehouseNames(ctx: QueryCtx) {
  const warehouse = memo<"warehouses">(ctx)
  return async (id: Id<"warehouses"> | undefined) => (await warehouse(id))?.name ?? "—"
}

// ── 01: production acts ────────────────────────────────────────────────────────

const productionActs: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const warehouse = warehouseNames(ctx)
  const all = await actsOf(ctx, "production", restaurants, config, budget)
  const columns = [text("group", "Номер"), col("date", "Дата", "date"), text("from", "Склад списания"), text("to", "Склад выпуска"), text("items", "Заготовки"), qty("output", "Выпуск"), money("cost", "Себестоимость")]
  const rows = []
  for (const act of all) {
    if (act.status !== "posted" || !matches(needle, act.number, ...act.lines.map((line) => line.name))) continue
    rows.push({ key: act.externalId, cells: { group: act.number, date: localDate(act.date), from: await warehouse(act.sourceWarehouseId), to: await warehouse(act.destinationWarehouseId), items: act.lines.map((line) => line.name).join(", "), output: round(act.lines.reduce((sum, line) => sum + line.quantity, 0)), cost: act.totalAmount } })
  }
  const totals = { output: round(rows.reduce((sum, row) => sum + row.cells.output, 0)), cost: rows.reduce((sum, row) => sum + row.cells.cost, 0) }
  return {
    sourceLabel: "Проведённые акты приготовления",
    columns,
    rows,
    totals,
    kpis: [kpi("acts", "Актов проведено", rows.length, "count"), kpi("cost", "Себестоимость выпуска", totals.cost), kpi("drafts", "Черновиков", all.filter((act) => act.status === "draft").length, "count")],
    truncated: budget.truncated,
  }
}

// ── 02: output of preparations ─────────────────────────────────────────────────

const output: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const product = memo<"products">(ctx)
  const columns = [text("group", "Заготовка"), text("unit", "Ед."), qty("quantity", "Выпущено"), money("cost", "Себестоимость"), money("unitCost", "Себестоимость ед."), col("acts", "Актов", "count")]
  const rows: Row[] = []
  for (const act of await actsOf(ctx, "production", restaurants, config, budget, ["posted"])) {
    for (const line of act.lines) {
      if (!matches(needle, line.name)) continue
      const row = await product(line.productId)
      rows.push({ key: line.productId ?? line.name, label: line.name, text: { unit: row?.baseUnit ?? "" }, values: { quantity: line.quantity, cost: line.amount ?? 0, acts: 1 } })
    }
  }
  const result = build(rows, columns, { sort: "cost", noTotals: ["unitCost"] })
  for (const row of result.rows) row.cells.unitCost = Number(row.cells.quantity) ? Math.round(Number(row.cells.cost) / Number(row.cells.quantity)) : 0
  return { sourceLabel: "Строки выпуска проведённых актов приготовления", columns, ...result, kpis: [kpi("cost", "Себестоимость выпуска", result.totals.cost ?? 0), kpi("items", "Заготовок", result.rows.length, "count")], truncated: budget.truncated }
}

// ── 03: ingredient consumption ─────────────────────────────────────────────────

const ingredientUse: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const item = memo<"inventoryItems">(ctx)
  const columns = [text("group", "Ингредиент"), text("unit", "Ед."), qty("quantity", "Израсходовано"), money("value", "Сумма"), col("acts", "Актов", "count")]
  const rows: Row[] = []
  for (const type of ["production", "processing"] as const) {
    for (const act of await actsOf(ctx, type, restaurants, config, budget, ["posted"])) {
      const used = new Map<string, { item: Doc<"inventoryItems">; quantity: number; value: number }>()
      for (const movement of await movementsOf(ctx, act, budget)) {
        if (movement.quantityDelta >= 0) continue
        const row = await item(movement.inventoryItemId)
        if (!row || !matches(needle, row.name)) continue
        const sum = used.get(row._id) ?? { item: row, quantity: 0, value: 0 }
        sum.quantity += -movement.quantityDelta
        sum.value += movementValue(movement)
        used.set(row._id, sum)
      }
      for (const [key, sum] of used) rows.push({ key, label: sum.item.name, text: { unit: sum.item.unit }, values: { quantity: sum.quantity, value: sum.value, acts: 1 } })
    }
  }
  const result = build(rows, columns, { sort: "value" })
  for (const row of result.rows) row.cells.value = Math.round(Number(row.cells.value))
  result.totals.value = Math.round(result.totals.value ?? 0)
  return { sourceLabel: "Списание по проведённым актам приготовления и переработки (движения склада)", columns, ...result, kpis: [kpi("value", "Израсходовано на сумму", result.totals.value), kpi("items", "Ингредиентов", result.rows.length, "count")], truncated: budget.truncated }
}

// ── 04: movement of preparations ───────────────────────────────────────────────

const preparationMovement: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const warehouses = await scopedWarehouses(ctx, restaurants, config)
  const columns = [text("group", "Заготовка"), text("warehouse", "Склад"), text("unit", "Ед."), qty("opening", "Остаток на начало"), qty("produced", "Произведено"), qty("sold", "Продано"), qty("writtenOff", "Списано"), qty("other", "Прочее движение"), qty("closing", "Остаток на конец"), money("closingValue", "Сумма на конец")]
  const rows: Row[] = []
  for await (const { warehouse, item } of stockPairs(ctx, warehouses, config, budget)) {
    if (item.kind !== "preparation") continue
    const opening = await balanceAt(ctx, warehouse._id, item._id, periodStart(config) - 1, budget)
    const closing = await balanceAt(ctx, warehouse._id, item._id, periodEnd(config), budget)
    let produced = 0
    let sold = 0
    let writtenOff = 0
    for (const fact of await pairFacts(ctx, warehouse._id, item._id, config, budget)) {
      produced += fact.byKind.production
      sold += -fact.byKind.sale
      writtenOff += -fact.byKind.writeoff
    }
    if (!opening.quantity && !closing.quantity && !produced && !sold && !writtenOff) continue
    const other = closing.quantity - opening.quantity - produced + sold + writtenOff
    rows.push({ key: `${warehouse._id}:${item._id}`, label: item.name, text: { warehouse: warehouse.name, unit: item.unit }, values: { opening: opening.quantity, produced, sold, writtenOff, other, closing: closing.quantity, closingValue: closing.value } })
  }
  const result = build(rows, columns)
  for (const row of result.rows) for (const key of ["opening", "produced", "sold", "writtenOff", "other", "closing"]) row.cells[key] = round(Number(row.cells[key]))
  result.rows.sort((a, b) => byLabel()(a, b) || byLabel("warehouse")(a, b))
  // Quantities of different preparations do not add up; only the value does.
  for (const key of ["opening", "produced", "sold", "writtenOff", "other", "closing"]) delete result.totals[key]
  return { sourceLabel: "Остатки по цепочке движений и дневные факты склада, заготовки", columns, ...result, kpis: [kpi("closingValue", "Заготовок на сумму", result.totals.closingValue ?? 0), kpi("items", "Позиций", result.rows.length, "count")], truncated: budget.truncated }
}

// ── 05, 06: recipe norm against the act ────────────────────────────────────────

type NormFact = { item: Doc<"inventoryItems">; norm: number; actual: number; actualValue: number; restaurant: string }

/**
 * For each posted production act line: the recipe norm of its output (the version in force at the act
 * date, the restaurant's line variant) and the ingredients its movements actually wrote off.
 */
async function normAndFact(ctx: QueryCtx, config: ReportConfig, restaurants: string[], budget: Budget) {
  const item = memo<"inventoryItems">(ctx)
  const product = memo<"products">(ctx)
  const lines: { act: Act; line: Act["lines"][number]; product: Doc<"products"> | null; components: Map<string, NormFact> }[] = []
  for (const act of await actsOf(ctx, "production", restaurants, config, budget, ["posted"])) {
    const movements = await movementsOf(ctx, act, budget)
    for (const line of act.lines) {
      const row = await product(line.productId)
      const components = new Map<string, NormFact>()
      const add = async (itemId: Id<"inventoryItems">, values: Partial<Pick<NormFact, "norm" | "actual" | "actualValue">>) => {
        const doc = await item(itemId)
        if (!doc) return
        const sum = components.get(itemId) ?? { item: doc, norm: 0, actual: 0, actualValue: 0, restaurant: act.restaurantExternalId }
        sum.norm += values.norm ?? 0
        sum.actual += values.actual ?? 0
        sum.actualValue += values.actualValue ?? 0
        components.set(itemId, sum)
      }
      if (row) for (const component of (await planRecipeOutput(ctx, row, line.quantity, act.date, act.restaurantExternalId)).components) await add(component.inventoryItemId, { norm: component.quantity })
      for (const movement of movements) if (movement.quantityDelta < 0 && lineNoOf(act, movement) === line.lineNo) await add(movement.inventoryItemId, { actual: -movement.quantityDelta, actualValue: movementValue(movement) })
      lines.push({ act, line, product: row, components })
    }
  }
  return lines
}

const outputPlanFact: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const columns = [text("group", "Заготовка"), text("unit", "Ед."), col("acts", "Актов", "count"), qty("actual", "Выпуск по акту"), qty("planned", "Выпуск по техкарте"), qty("deviation", "Отклонение"), col("yield", "Выход, %", "percent")]
  const rows: Row[] = []
  for (const { line, product, components } of await normAndFact(ctx, config, restaurants, budget)) {
    if (!matches(needle, line.name)) continue
    // What the recipe says the ingredients actually written off should have given.
    const norm = [...components.values()].reduce((sum, row) => sum + row.norm, 0)
    const actual = [...components.values()].reduce((sum, row) => sum + row.actual, 0)
    const planned = norm > 0 ? (line.quantity * actual) / norm : 0
    rows.push({ key: line.productId ?? line.name, label: line.name, text: { unit: product?.baseUnit ?? "" }, values: { acts: 1, actual: line.quantity, planned } })
  }
  const result = build(rows, columns, { noTotals: ["actual", "planned", "deviation", "yield"] })
  for (const row of result.rows) {
    row.cells.planned = round(Number(row.cells.planned))
    row.cells.deviation = round(Number(row.cells.actual) - Number(row.cells.planned))
    row.cells.yield = percentOf(Number(row.cells.actual), Number(row.cells.planned))
  }
  result.rows.sort((a, b) => Math.abs(Number(b.cells.deviation)) - Math.abs(Number(a.cells.deviation)) || byLabel()(a, b))
  const off = result.rows.filter((row) => Math.abs(Number(row.cells.deviation)) > 0.001).length
  return { sourceLabel: "Проведённые акты приготовления против техкарты на дату акта", columns, ...result, kpis: [kpi("items", "Заготовок", result.rows.length, "count"), kpi("off", "С отклонением выхода", off, "count")], truncated: budget.truncated }
}

const recipeDeviation: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const columns = [text("group", "Ингредиент"), text("unit", "Ед."), qty("norm", "Норма"), qty("actual", "Факт"), qty("deviation", "Отклонение"), col("deviationPercent", "Отклонение, %", "percent"), money("normValue", "Норма, сумма"), money("actualValue", "Факт, сумма"), money("deviationValue", "Отклонение, сумма")]
  const rows: Row[] = []
  const cost = new Map<string, number>()
  for (const { components } of await normAndFact(ctx, config, restaurants, budget)) {
    for (const [key, row] of components) {
      if (!matches(needle, row.item.name)) continue
      // Unit cost: what the act wrote off, or the average stock cost when nothing was written off.
      let unitCost = row.actual > 0 ? row.actualValue / row.actual : cost.get(`${key}:${row.restaurant}`)
      if (unitCost === undefined) cost.set(`${key}:${row.restaurant}`, (unitCost = await averageItemCost(ctx, row.item._id, row.restaurant)))
      rows.push({ key, label: row.item.name, text: { unit: row.item.unit }, values: { norm: row.norm, actual: row.actual, normValue: row.norm * unitCost, actualValue: row.actualValue } })
    }
  }
  const result = build(rows, columns, { noTotals: ["norm", "actual", "deviation", "deviationPercent"] })
  for (const row of result.rows) {
    row.cells.norm = round(Number(row.cells.norm))
    row.cells.actual = round(Number(row.cells.actual))
    row.cells.deviation = round(Number(row.cells.actual) - Number(row.cells.norm))
    row.cells.deviationPercent = percentOf(Number(row.cells.deviation), Number(row.cells.norm))
    row.cells.normValue = Math.round(Number(row.cells.normValue))
    row.cells.actualValue = Math.round(Number(row.cells.actualValue))
    row.cells.deviationValue = Number(row.cells.actualValue) - Number(row.cells.normValue)
  }
  result.totals.normValue = result.rows.reduce((sum, row) => sum + Number(row.cells.normValue), 0)
  result.totals.actualValue = result.rows.reduce((sum, row) => sum + Number(row.cells.actualValue), 0)
  result.totals.deviationValue = result.totals.actualValue - result.totals.normValue
  result.rows.sort((a, b) => Math.abs(Number(b.cells.deviationValue)) - Math.abs(Number(a.cells.deviationValue)) || byLabel()(a, b))
  return {
    sourceLabel: "Фактическое списание проведённых актов приготовления против нормы техкарты",
    columns,
    ...result,
    kpis: [kpi("normValue", "По норме", result.totals.normValue), kpi("actualValue", "По факту", result.totals.actualValue), kpi("deviationValue", "Отклонение", result.totals.deviationValue), kpi("deviationPercent", "Отклонение, %", percentOf(result.totals.deviationValue, result.totals.normValue), "percent")],
    truncated: budget.truncated,
  }
}

// ── 07: production write-offs ──────────────────────────────────────────────────

const productionWriteoffs: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const item = memo<"inventoryItems">(ctx)
  const warehouse = memo<"warehouses">(ctx)
  const columns = [text("group", "Позиция"), text("reason", "Причина"), text("warehouse", "Склад"), text("unit", "Ед."), qty("quantity", "Количество"), money("value", "Сумма"), col("documents", "Документов", "count")]
  const rows: Row[] = []
  for (const restaurant of restaurants) {
    for await (const document of ctx.db.query("stockDocuments").withIndex("by_type_restaurant_status_date", (q) => q.eq("type", "writeoff").eq("restaurantExternalId", restaurant).eq("status", "posted").gte("date", periodStart(config)).lte("date", periodEnd(config)))) {
      if (!spend(budget)) break
      const source = await warehouse(document.sourceWarehouseId)
      for (const line of await ctx.db.query("stockDocumentLines").withIndex("by_document", (q) => q.eq("documentId", document._id)).take(200)) {
        const row = await item(line.inventoryItemId)
        // A production write-off: from a kitchen (production) warehouse, or of a preparation anywhere.
        if (!row || (source?.kind !== "kitchen" && row.kind !== "preparation")) continue
        const reason = document.reason.trim() || "Без причины"
        if (!matches(needle, row.name, reason)) continue
        rows.push({ key: `${row._id}:${reason}:${source?._id ?? ""}`, label: row.name, text: { reason, warehouse: source?.name ?? "—", unit: row.unit }, values: { quantity: line.quantity, value: line.quantity * line.unitCost, documents: 1 } })
      }
    }
  }
  const result = build(rows, columns, { sort: "value", noTotals: ["quantity"] })
  for (const row of result.rows) row.cells.value = Math.round(Number(row.cells.value))
  result.totals.value = Math.round(result.totals.value ?? 0)
  return { sourceLabel: "Проведённые акты списания: склады кухни и заготовки", columns, ...result, kpis: [kpi("value", "Списано на сумму", result.totals.value), kpi("lines", "Позиций", result.rows.length, "count")], truncated: budget.truncated }
}

// ── 08, 09, 10: processing, assembly and sales acts ────────────────────────────

function actRegister(type: "processing" | "assembly" | "sales", source: string): Calculator {
  return async (ctx, config, restaurants) => {
    const budget = newBudget()
    const needle = needleOf(config)
    const warehouse = warehouseNames(ctx)
    const all = await actsOf(ctx, type, restaurants, config, budget)
    const columns = type === "sales"
      ? [text("group", "Номер"), col("date", "Дата", "date"), text("from", "Склад"), text("items", "Позиции"), qty("input", "Количество"), money("cost", "Себестоимость"), text("comment", "Комментарий")]
      : [text("group", "Номер"), col("date", "Дата", "date"), text("from", "Склад списания"), text("to", "Склад выпуска"), text("inputs", "Вход"), qty("input", "Вход, кол-во"), text("outputs", "Выход"), qty("output", "Выход, кол-во"), money("cost", "Себестоимость")]
    const rows: Result["rows"] = []
    for (const act of all) {
      if (act.status !== "posted" || !matches(needle, act.number, act.comment, ...act.lines.map((line) => line.name))) continue
      const inputs = act.lines.filter((line) => line.direction === "input")
      const outputs = act.lines.filter((line) => line.direction === "output")
      const sum = (lines: Act["lines"]) => round(lines.reduce((total, line) => total + line.quantity, 0))
      rows.push({
        key: act.externalId,
        cells: type === "sales"
          ? { group: act.number, date: localDate(act.date), from: await warehouse(act.sourceWarehouseId), items: inputs.map((line) => line.name).join(", "), input: sum(inputs), cost: act.totalAmount, comment: act.comment }
          : { group: act.number, date: localDate(act.date), from: await warehouse(act.sourceWarehouseId), to: await warehouse(act.destinationWarehouseId), inputs: inputs.map((line) => line.name).join(", "), input: sum(inputs), outputs: outputs.map((line) => line.name).join(", "), output: sum(outputs), cost: act.totalAmount },
      })
    }
    const totals: Record<string, number> = { cost: rows.reduce((total, row) => total + Number(row.cells.cost), 0) }
    return {
      sourceLabel: source,
      columns,
      rows,
      totals,
      kpis: [kpi("acts", "Актов проведено", rows.length, "count"), kpi("cost", "Себестоимость", totals.cost), kpi("drafts", "Черновиков", all.filter((act) => act.status === "draft").length, "count")],
      truncated: budget.truncated,
    }
  }
}

// ── 11, 12, 13: forecast, kitchen plan and requirements ────────────────────────

/** `extra.targetDate` (YYYY-MM-DD) or the end of the report period. */
const targetDateOf = (config: ReportConfig) => (typeof config.extra?.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(config.extra.targetDate) ? config.extra.targetDate : config.dateTo)

type Need = { item: Doc<"inventoryItems">; quantity: number }

/** Inventory quantities of `quantity` units of a product: its stock item when written off as a whole, else its recipe. */
async function componentsOf(ctx: QueryCtx, product: Doc<"products">, quantity: number, at: number, restaurant: string) {
  if (product.writeOffMethod === "finished-product") {
    const item = await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first()
    return item ? [{ inventoryItemId: item._id, quantity }] : []
  }
  return (await planRecipeOutput(ctx, product, quantity, at, restaurant)).components
}

async function onHand(ctx: QueryCtx, restaurant: string, itemId: Id<"inventoryItems">) {
  const balances = await ctx.db.query("stockBalances").withIndex("by_restaurant_item", (q) => q.eq("restaurantExternalId", restaurant).eq("inventoryItemId", itemId)).take(20)
  return balances.reduce((sum, balance) => sum + Math.max(0, balance.quantity), 0)
}

/**
 * The day plan of one restaurant: the forecast dishes expanded by their recipes (at noon of the target
 * date), the stocked preparations they need, what is on hand, and what is left to produce.
 */
async function dayPlan(ctx: QueryCtx, restaurant: string, targetDate: string) {
  const at = dayStart(targetDate) + 12 * 3_600_000
  const item = memo<"inventoryItems">(ctx)
  const forecast = await forecastFromFacts(ctx, { restaurantExternalId: restaurant, targetDate })
  const preparations = new Map<string, Need>()
  const ingredients = new Map<string, Need>()
  const add = (target: Map<string, Need>, doc: Doc<"inventoryItems">, quantity: number) => {
    const row = target.get(doc._id) ?? { item: doc, quantity: 0 }
    row.quantity += quantity
    target.set(doc._id, row)
  }
  for (const line of forecast) {
    const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
    if (!product) continue
    for (const component of await componentsOf(ctx, product, line.recommended, at, restaurant)) {
      const doc = await item(component.inventoryItemId)
      if (doc) add(doc.kind === "preparation" ? preparations : ingredients, doc, component.quantity)
    }
  }
  const sheet: (Need & { onHand: number; plan: number })[] = []
  for (const need of preparations.values()) {
    const stock = await onHand(ctx, restaurant, need.item._id)
    const plan = Math.max(0, need.quantity - stock)
    sheet.push({ ...need, onHand: stock, plan })
    // What is left to produce needs its own ingredients (production-13).
    const product = need.item.productExternalId ? await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", need.item.productExternalId!)).unique() : null
    if (product && plan > 0) {
      for (const component of (await planRecipeOutput(ctx, product, plan, at, restaurant)).components) {
        const doc = await item(component.inventoryItemId)
        if (doc) add(ingredients, doc, component.quantity)
      }
    }
  }
  return { forecast, sheet, ingredients: [...ingredients.values()] }
}

const semiFinishedSheet: Calculator = async (ctx, config, restaurants) => {
  const needle = needleOf(config)
  const targetDate = targetDateOf(config)
  const columns = [text("group", "Заготовка"), text("unit", "Ед."), qty("need", "Потребность"), qty("onHand", "Остаток"), qty("plan", "План"), qty("fact", "Факт"), qty("deviation", "Отклонение")]
  const budget = newBudget()
  const rows: Row[] = []
  for (const restaurant of restaurants) {
    const { sheet } = await dayPlan(ctx, restaurant, targetDate)
    for (const row of sheet) if (matches(needle, row.item.name)) rows.push({ key: row.item._id, label: row.item.name, text: { unit: row.item.unit }, values: { need: row.quantity, onHand: row.onHand, plan: row.plan } })
    // «Факт»: what the posted production acts of the target date produced.
    const day = { ...config, dateFrom: targetDate, dateTo: targetDate }
    for (const act of await actsOf(ctx, "production", [restaurant], day, budget, ["posted"])) {
      for (const line of act.lines) {
        const product = line.productId ? await ctx.db.get(line.productId) : null
        const stock = product ? await ctx.db.query("inventoryItems").withIndex("by_product", (q) => q.eq("productExternalId", product.externalId)).first() : null
        if (stock && matches(needle, stock.name)) rows.push({ key: stock._id, label: stock.name, text: { unit: stock.unit }, values: { fact: line.quantity } })
      }
    }
  }
  const result = build(rows, columns, { noTotals: ["need", "onHand", "plan", "fact", "deviation"] })
  for (const row of result.rows) {
    for (const key of ["need", "onHand", "plan", "fact"]) row.cells[key] = round(Number(row.cells[key]))
    row.cells.deviation = round(Number(row.cells.fact) - Number(row.cells.plan))
  }
  result.rows.sort((a, b) => Number(b.cells.plan) - Number(a.cells.plan) || byLabel()(a, b))
  return {
    sourceLabel: `Прогноз кухни на ${targetDate} (средний спрос за 6 недель) × техкарты, минус остаток`,
    columns,
    ...result,
    kpis: [kpi("items", "Заготовок в плане", result.rows.filter((row) => Number(row.cells.plan) > 0).length, "count"), kpi("done", "Выполнено позиций", result.rows.filter((row) => Number(row.cells.plan) > 0 && Number(row.cells.fact) >= Number(row.cells.plan)).length, "count")],
    truncated: budget.truncated,
  }
}

const kitchenPlan: Calculator = async (ctx, config, restaurants) => {
  const needle = needleOf(config)
  const targetDate = targetDateOf(config)
  const columns = [text("group", "Блюдо"), qty("recommended", "Рекомендуется"), qty("sold", "Продано"), qty("deviation", "Отклонение")]
  const rows: Row[] = []
  for (const restaurant of restaurants) {
    for (const line of await forecastFromFacts(ctx, { restaurantExternalId: restaurant, targetDate })) if (matches(needle, line.name)) rows.push({ key: line.productExternalId, label: line.name, values: { recommended: line.recommended } })
    // «Продано»: the target date's own sales, when the day has already happened.
    for await (const fact of ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", restaurant).eq("factType", "product").eq("businessDate", targetDate))) {
      if (matches(needle, fact.dimensionLabel)) rows.push({ key: fact.dimensionKey, label: fact.dimensionLabel, values: { sold: fact.quantity } })
    }
  }
  const result = build(rows, columns)
  for (const row of result.rows) row.cells.deviation = round(Number(row.cells.sold) - Number(row.cells.recommended))
  result.totals.deviation = round((result.totals.sold ?? 0) - (result.totals.recommended ?? 0))
  result.rows.sort((a, b) => Number(b.cells.recommended) - Number(a.cells.recommended) || byLabel()(a, b))
  return {
    sourceLabel: `Прогноз кухни на ${targetDate}: средний спрос в тот же день недели за 6 недель`,
    columns,
    ...result,
    kpis: [kpi("recommended", "Порций по прогнозу", result.totals.recommended ?? 0, "quantity"), kpi("dishes", "Блюд в плане", result.rows.filter((row) => Number(row.cells.recommended) > 0).length, "count")],
    truncated: false,
  }
}

const ingredientNeeds: Calculator = async (ctx, config, restaurants) => {
  const needle = needleOf(config)
  const targetDate = targetDateOf(config)
  const columns = [text("group", "Позиция"), text("unit", "Ед."), qty("need", "Потребность"), qty("onHand", "Остаток"), qty("shortage", "Не хватает"), money("shortageValue", "Закупить на сумму")]
  const rows: Row[] = []
  for (const restaurant of restaurants) {
    const { ingredients } = await dayPlan(ctx, restaurant, targetDate)
    for (const need of ingredients) {
      if (!matches(needle, need.item.name)) continue
      const stock = await onHand(ctx, restaurant, need.item._id)
      const shortage = Math.max(0, need.quantity - stock)
      rows.push({ key: need.item._id, label: need.item.name, text: { unit: need.item.unit }, values: { need: need.quantity, onHand: stock, shortage, shortageValue: shortage > 0 ? shortage * (await averageItemCost(ctx, need.item._id, restaurant)) : 0 } })
    }
  }
  const result = build(rows, columns, { sort: "shortageValue", noTotals: ["need", "onHand", "shortage"] })
  for (const row of result.rows) {
    for (const key of ["need", "onHand", "shortage"]) row.cells[key] = round(Number(row.cells[key]))
    row.cells.shortageValue = Math.round(Number(row.cells.shortageValue))
  }
  result.totals.shortageValue = result.rows.reduce((sum, row) => sum + Number(row.cells.shortageValue), 0)
  return {
    sourceLabel: `План кухни на ${targetDate} и план заготовок, раскрытые по техкартам`,
    columns,
    ...result,
    kpis: [kpi("items", "Позиций", result.rows.length, "count"), kpi("short", "Не хватает позиций", result.rows.filter((row) => Number(row.cells.shortage) > 0).length, "count"), kpi("shortageValue", "Закупить на сумму", result.totals.shortageValue)],
    truncated: false,
  }
}

// ── 14, 15: internal and purchase orders ───────────────────────────────────────

const internalOrders: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const warehouse = memo<"warehouses">(ctx)
  const name = async (id: Id<"warehouses"> | undefined) => {
    const row = await warehouse(id)
    return row ? `${row.name} (${row.restaurantExternalId})` : "—"
  }
  const all = await actsOf(ctx, "internal-order", restaurants, config, budget)
  const columns = [text("group", "Номер"), col("date", "Дата", "date"), text("from", "Откуда"), text("to", "Куда"), col("lines", "Позиций", "count"), qty("quantity", "Количество"), money("amount", "Сумма"), text("status", "Статус")]
  const rows = []
  for (const act of all) {
    if (!matches(needle, act.number, act.comment, ...act.lines.map((line) => line.name))) continue
    rows.push({ key: act.externalId, cells: { group: act.number, date: localDate(act.date), from: await name(act.sourceWarehouseId), to: await name(act.destinationWarehouseId), lines: act.lines.length, quantity: round(act.lines.reduce((sum, line) => sum + line.quantity, 0)), amount: act.totalAmount, status: STATUS_LABEL[act.status] } })
  }
  const totals = { lines: rows.reduce((sum, row) => sum + row.cells.lines, 0), amount: rows.reduce((sum, row) => sum + row.cells.amount, 0) }
  const count = (statuses: Act["status"][]) => all.filter((act) => statuses.includes(act.status)).length
  return {
    sourceLabel: "Внутренние заказы (сумма — себестоимость проведённого перемещения)",
    columns,
    rows,
    totals,
    kpis: [kpi("open", "На согласовании", count(["draft", "pending-approval"]), "count"), kpi("approved", "Согласовано, ждут отгрузки", count(["approved"]), "count"), kpi("posted", "Выполнено", count(["posted"]), "count"), kpi("amount", "Перемещено на сумму", totals.amount)],
    truncated: budget.truncated,
  }
}

const purchaseOrders: Calculator = async (ctx, config, restaurants) => {
  const budget = newBudget()
  const needle = needleOf(config)
  const supplier = memo<"suppliers">(ctx)
  const all = await actsOf(ctx, "purchase-order", restaurants, config, budget)
  const columns = [text("group", "Номер"), col("date", "Дата", "date"), text("supplier", "Поставщик"), col("expected", "Ожидается", "date"), money("ordered", "Сумма заказа"), money("received", "Получено"), col("fulfilment", "Исполнение, %", "percent"), text("status", "Статус"), text("late", "Просрочен")]
  const today = localDate(Date.now())
  const rows = []
  for (const order of all) {
    const vendor = (await supplier(order.supplierId))?.name ?? "—"
    if (!matches(needle, order.number, vendor, ...order.lines.map((line) => line.name))) continue
    const receipt = order.receiptExternalId ? await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", order.receiptExternalId!)).unique() : null
    const received = receipt?.status === "posted" ? receipt.totalGross : 0
    const expected = order.expectedDate !== undefined ? localDate(order.expectedDate) : ""
    const late = expected !== "" && expected < today && order.status !== "completed"
    rows.push({ key: order.externalId, cells: { group: order.number, date: localDate(order.date), supplier: vendor, expected, ordered: order.totalAmount, received, fulfilment: percentOf(received, order.totalAmount), status: STATUS_LABEL[order.status], late: late ? "Да" : "" } })
  }
  const totals = { ordered: rows.reduce((sum, row) => sum + row.cells.ordered, 0), received: rows.reduce((sum, row) => sum + row.cells.received, 0) }
  return {
    sourceLabel: "Заказы поставщикам и приходные накладные по ним",
    columns,
    rows,
    totals,
    kpis: [kpi("ordered", "Заказано на сумму", totals.ordered), kpi("received", "Получено на сумму", totals.received), kpi("fulfilment", "Исполнение", percentOf(totals.received, totals.ordered), "percent"), kpi("late", "Просрочено", rows.filter((row) => row.cells.late).length, "count")],
    truncated: budget.truncated,
  }
}

export const PRODUCTION_CALCULATORS: Record<string, Calculator> = {
  "production-01": productionActs,
  "production-02": output,
  "production-03": ingredientUse,
  "production-04": preparationMovement,
  "production-05": outputPlanFact,
  "production-06": recipeDeviation,
  "production-07": productionWriteoffs,
  "production-08": actRegister("processing", "Проведённые акты переработки"),
  "production-09": actRegister("assembly", "Проведённые акты разбора"),
  "production-10": actRegister("sales", "Проведённые акты реализации"),
  "production-11": semiFinishedSheet,
  "production-12": kitchenPlan,
  "production-13": ingredientNeeds,
  "production-14": internalOrders,
  "production-15": purchaseOrders,
}
