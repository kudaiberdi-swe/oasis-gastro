import type { Doc, Id } from "../../../_generated/dataModel"
import type { ReportConfig } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { dayEnd, dayStart, SCAN_BUDGET } from "./_shared"

// Helpers of the W2 stock reports (W2-RPT-02). Every read is an index range; streamed ranges spend one
// shared budget and the report says `truncated` once it runs out.

export type QueryCtx = Parameters<Calculator>[0]
export type Fact = Doc<"dailyStockFacts">

export type Budget = { left: number; truncated: boolean }
export const newBudget = (limit = SCAN_BUDGET): Budget => ({ left: limit, truncated: false })

/** Spends one read; false (and truncated) once the budget is gone. */
export function spend(budget: Budget) {
  if (budget.left <= 0) {
    budget.truncated = true
    return false
  }
  budget.left -= 1
  return true
}

export const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits
export const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)

export function needleOf(config: ReportConfig) {
  return config.search?.trim().toLocaleLowerCase("ru") || undefined
}

export function matches(needle: string | undefined, ...labels: (string | undefined)[]) {
  return !needle || labels.some((label) => label?.toLocaleLowerCase("ru").includes(needle))
}

const extraString = (config: ReportConfig, key: string) => {
  const value = config.extra?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Active warehouses of the restaurants in scope; `extra.warehouseExternalId` narrows to one. */
export async function scopedWarehouses(ctx: QueryCtx, restaurants: string[], config: ReportConfig) {
  const only = extraString(config, "warehouseExternalId")
  const rows: Doc<"warehouses">[] = []
  for (const restaurant of restaurants) {
    for (const warehouse of await ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurant).eq("active", true)).take(50)) {
      if (!only || warehouse.externalId === only) rows.push(warehouse)
    }
  }
  return rows
}

/** Memoized ctx.db.get for reference rows read many times. */
export function memo<T extends "inventoryItems" | "suppliers" | "warehouses" | "products">(ctx: QueryCtx) {
  const cache = new Map<string, Doc<T> | null>()
  return async (id: Id<T> | undefined) => {
    if (!id) return null
    if (!cache.has(id)) cache.set(id, (await ctx.db.get(id)) as Doc<T> | null)
    return cache.get(id) ?? null
  }
}

/** The period's business dates, from → to. */
export function periodDates(config: ReportConfig) {
  const dates: string[] = []
  for (let at = Date.parse(`${config.dateFrom}T00:00:00Z`); at <= Date.parse(`${config.dateTo}T00:00:00Z`); at += 86_400_000) dates.push(new Date(at).toISOString().slice(0, 10))
  return dates
}

export const periodStart = (config: ReportConfig) => dayStart(config.dateFrom)
export const periodEnd = (config: ReportConfig) => dayEnd(config.dateTo)

/** Quantity, average cost and value of a warehouse × item right after the last movement at or before `at`. */
export async function balanceAt(ctx: QueryCtx, warehouseId: Id<"warehouses">, inventoryItemId: Id<"inventoryItems">, at: number, budget?: Budget) {
  if (budget) spend(budget) // a point read, counted so that wide scopes truncate instead of hitting the read limit
  const last = await ctx.db
    .query("stockMovements")
    .withIndex("by_warehouse_item_occurred", (q) => q.eq("warehouseId", warehouseId).eq("inventoryItemId", inventoryItemId).lte("occurredAt", at))
    .order("desc")
    .first()
  const quantity = last?.balanceAfter ?? 0
  const averageCost = last?.averageUnitCostAfter ?? 0
  return { quantity, averageCost, value: Math.round(quantity * averageCost), lastAt: last?.occurredAt }
}

/** Every warehouse × item of the warehouses (from stockBalances), with the item; search filters by item name. */
export async function* stockPairs(ctx: QueryCtx, warehouses: Doc<"warehouses">[], config: ReportConfig, budget: Budget) {
  const item = memo<"inventoryItems">(ctx)
  const needle = needleOf(config)
  for (const warehouse of warehouses) {
    for await (const balance of ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id))) {
      if (!spend(budget)) return
      const row = await item(balance.inventoryItemId)
      if (!row || !matches(needle, row.name)) continue
      yield { warehouse, balance, item: row }
    }
  }
}

/** Day facts of one warehouse × item over the period. */
export async function pairFacts(ctx: QueryCtx, warehouseId: Id<"warehouses">, inventoryItemId: Id<"inventoryItems">, config: ReportConfig, budget: Budget) {
  const rows: Fact[] = []
  for await (const fact of ctx.db.query("dailyStockFacts").withIndex("by_warehouse_item_date", (q) => q.eq("warehouseId", warehouseId).eq("inventoryItemId", inventoryItemId).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
    if (!spend(budget)) break
    rows.push(fact)
  }
  return rows
}

/** Day facts of the scoped warehouses over the period (by restaurant, then kept for the warehouses in scope). */
export async function scopedFacts(ctx: QueryCtx, warehouses: Doc<"warehouses">[], config: ReportConfig, budget: Budget) {
  const allowed = new Set<string>(warehouses.map((warehouse) => warehouse._id))
  const rows: Fact[] = []
  for (const restaurant of new Set(warehouses.map((warehouse) => warehouse.restaurantExternalId))) {
    for await (const fact of ctx.db.query("dailyStockFacts").withIndex("by_restaurant_date", (q) => q.eq("restaurantExternalId", restaurant).gte("businessDate", config.dateFrom).lte("businessDate", config.dateTo))) {
      if (!spend(budget)) return rows
      if (allowed.has(fact.warehouseId)) rows.push(fact)
    }
  }
  return rows
}

/**
 * Consumption of a day fact: outflows except transfers between own warehouses (sales, write-offs,
 * production, returns, invoices…). Its value takes the day's average outflow cost.
 */
export function consumption(fact: Fact) {
  const quantity = fact.outQuantity + fact.byKind.transferOut // transferOut is signed (−)
  const value = fact.outQuantity > 0 ? (fact.outValue * quantity) / fact.outQuantity : 0
  return { quantity: round(quantity), value }
}

/** Sold quantity and its cost (the day's average outflow cost) of a day fact. */
export function sold(fact: Fact) {
  const quantity = -fact.byKind.sale
  const value = fact.outQuantity > 0 ? (fact.outValue * quantity) / fact.outQuantity : 0
  return { quantity: round(quantity), value }
}

/** ABC by value: A while the running share before the row is under 80 %, B under 95 %, else C. */
export function abcClasses(values: { key: string; value: number }[]) {
  const ordered = [...values].filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  const total = ordered.reduce((sum, row) => sum + row.value, 0)
  let running = 0
  return ordered.map((row) => {
    const before = total ? (running / total) * 100 : 0
    running += row.value
    const share = total ? (row.value / total) * 100 : 0
    return { ...row, share, cumulative: total ? (running / total) * 100 : 0, abc: before < 80 ? "A" : before < 95 ? "B" : "C" }
  })
}

/** XYZ by the coefficient of variation of daily quantities (zero days included): X < 10 %, Y ≤ 25 %, Z > 25 %. */
export function xyzClass(daily: number[]) {
  const days = daily.length || 1
  const mean = daily.reduce((sum, value) => sum + value, 0) / days
  const deviation = Math.sqrt(daily.reduce((sum, value) => sum + (value - mean) ** 2, 0) / days)
  const variation = mean > 0 ? (deviation / mean) * 100 : 0
  return { mean, deviation, variation, xyz: variation < 10 ? "X" : variation <= 25 ? "Y" : "Z" }
}

export const MODULE_LABEL: Record<string, string> = {
  receipts: "Приходная накладная",
  orders: "Продажа",
  "sales-acts": "Акт реализации",
  production: "Акт приготовления",
  "processing-acts": "Акт переработки",
  "assembly-acts": "Акт сборки",
  writeoffs: "Акт списания",
  inventories: "Инвентаризация",
  transfers: "Перемещение",
  "internal-orders": "Внутренний заказ",
  "supplier-returns": "Возврат поставщику",
  "outgoing-invoices": "Расходная накладная",
}

export const ITEM_KIND_LABEL: Record<string, string> = { ingredient: "Ингредиенты", preparation: "Заготовки", good: "Товары", service: "Услуги", modifier: "Модификаторы" }

/** Monday of the date's week. */
export function weekOf(date: string) {
  const at = Date.parse(`${date}T00:00:00Z`)
  const shift = (new Date(at).getUTCDay() + 6) % 7
  return new Date(at - shift * 86_400_000).toISOString().slice(0, 10)
}
