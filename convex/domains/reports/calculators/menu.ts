import { ConvexError } from "convex/values"

import type { Doc } from "../../../_generated/dataModel"
import { stopListActive, stopListRow } from "../../../lib/availability"
import { resolvePrices, type ResolvedPrice } from "../../../lib/pricing"
import { costRecipe, recipeVersionAt } from "../../../lib/recipes"
import type { ReportConfig, ReportResult } from "../../../lib/reportConfig"
import type { Calculator } from "../registry"
import { facts, matcher, percentOf, restaurantDocs, round1 } from "./_facts"
import { aggregate, col, dayEnd, dayStart, localDate, SCAN_BUDGET } from "./_shared"

// Menu reports of W2 (docs/08-IMPLEMENTATION-PLAN.md W2-RPT-04). A report is listed here only with a test
// (tests/convex/reportsMenu.test.ts). Sales come from the daily product facts; prices from the one
// price rule (lib/pricing.ts), costs from the recipe versions (lib/recipes.ts). Nothing is written.

type Ctx = Parameters<Calculator>[0]
type Cells = Record<string, number | string>
type Dish = { key: string; label: string; quantity: number; grossAmount: number; netAmount: number; costAmount: number; margin: number; byDay: Map<string, number> }

/** Product facts of the period summed per dish (margin = revenue − actual recipe write-off), with daily quantities. */
async function dishes(ctx: Ctx, config: ReportConfig, restaurants: string[]) {
  const { rows, truncated } = await facts(ctx, "product", config, restaurants)
  const matches = matcher(config)
  const byKey = new Map<string, Dish>()
  for (const fact of rows) {
    if (!matches(fact.dimensionLabel)) continue
    const dish = byKey.get(fact.dimensionKey) ?? { key: fact.dimensionKey, label: fact.dimensionLabel, quantity: 0, grossAmount: 0, netAmount: 0, costAmount: 0, margin: 0, byDay: new Map<string, number>() }
    dish.quantity += fact.quantity
    dish.grossAmount += fact.grossAmount
    dish.netAmount += fact.netAmount
    dish.costAmount += fact.costAmount
    dish.margin += fact.netAmount - fact.costAmount
    dish.byDay.set(fact.businessDate, (dish.byDay.get(fact.businessDate) ?? 0) + fact.quantity)
    byKey.set(fact.dimensionKey, dish)
  }
  return { dishes: [...byKey.values()], truncated }
}

const sum = <T extends Record<K, number>, K extends string>(rows: T[], key: K) => rows.reduce((total, row) => total + row[key], 0)

const numberParam = (config: ReportConfig, key: string, fallback: number) => {
  const raw = config.extra?.[key]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new ConvexError(`Параметр «${key}» должен быть числом`)
  return value
}

export type AbcClass = "A" | "B" | "C"
export type XyzClass = "X" | "Y" | "Z"

/**
 * ABC by a value: sorted descending, a dish is A while the share of the dishes above it is below `a` %,
 * B below `b` %, else C (the leader is always A); a zero or negative value is C.
 */
export function abcClasses(items: { key: string; value: number }[], a = 80, b = 95) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  const classes = new Map<string, { abc: AbcClass; share: number; cumulative: number }>()
  let before = 0
  for (const item of [...items].sort((x, y) => y.value - x.value || x.key.localeCompare(y.key))) {
    const shareBefore = total ? (before / total) * 100 : 100
    const abc: AbcClass = item.value <= 0 ? "C" : shareBefore < a ? "A" : shareBefore < b ? "B" : "C"
    before += Math.max(0, item.value)
    classes.set(item.key, { abc, share: percentOf(Math.max(0, item.value), total), cumulative: total ? round1((before / total) * 100) : 0 })
  }
  return classes
}

/** Days of the period, inclusive. */
function periodDays(config: ReportConfig) {
  const days: string[] = []
  for (let at = Date.parse(`${config.dateFrom}T00:00:00Z`); at <= Date.parse(`${config.dateTo}T00:00:00Z`); at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10))
  return days
}

/** XYZ by the coefficient of variation of daily quantities over every day of the period (0 on days without sales). */
export function xyzClass(daily: number[], x = 10, y = 25): { xyz: XyzClass; variation: number } {
  const mean = daily.reduce((sum, value) => sum + value, 0) / (daily.length || 1)
  if (mean <= 0) return { xyz: "Z", variation: 0 }
  const variance = daily.reduce((sum, value) => sum + (value - mean) ** 2, 0) / daily.length
  const variation = round1((Math.sqrt(variance) / mean) * 100)
  return { xyz: variation <= x ? "X" : variation <= y ? "Y" : "Z", variation }
}

async function classified(ctx: Ctx, config: ReportConfig, restaurants: string[]) {
  const { dishes: list, truncated } = await dishes(ctx, config, restaurants)
  const byMargin = config.extra?.abcBy === "margin"
  const abc = abcClasses(list.map((dish) => ({ key: dish.key, value: byMargin ? dish.margin : dish.netAmount })), numberParam(config, "a", 80), numberParam(config, "b", 95))
  const days = periodDays(config)
  const xThreshold = numberParam(config, "x", 10)
  const yThreshold = numberParam(config, "y", 25)
  return {
    byMargin,
    truncated,
    dishes: list.map((dish) => ({ ...dish, ...abc.get(dish.key)!, ...xyzClass(days.map((day) => dish.byDay.get(day) ?? 0), xThreshold, yThreshold) })),
  }
}

/** menu-01: ABC of dishes by revenue (default) or by gross profit (`extra.abcBy = "margin"`). */
const abcAnalysis: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, byMargin, truncated } = await classified(ctx, config, restaurants)
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("netAmount", "Выручка", "money"), col("margin", "Валовая прибыль", "money"), col("share", "Доля, %", "percent"), col("cumulative", "Нарастающим итогом, %", "percent"), col("abc", "Класс", "text")]
  const sorted = [...list].sort((a, b) => a.cumulative - b.cumulative)
  const rows = sorted.map((dish) => ({ key: dish.key, cells: { group: dish.label, quantity: dish.quantity, netAmount: dish.netAmount, margin: dish.margin, share: dish.share, cumulative: dish.cumulative, abc: dish.abc } as Cells }))
  const totals = { quantity: sum(list, "quantity"), netAmount: sum(list, "netAmount"), margin: sum(list, "margin") }
  const classCount = (abc: AbcClass) => list.filter((dish) => dish.abc === abc).length
  return { sourceLabel: `ABC по ${byMargin ? "валовой прибыли" : "выручке"} (продажи за период)`, columns, rows, totals, kpis: (["A", "B", "C"] as const).map((abc) => ({ key: abc, label: `Класс ${abc}`, value: classCount(abc), unit: "count" as const })), truncated }
}

/** menu-02: XYZ of dishes — stability of daily sales (coefficient of variation, %). */
const xyzAnalysis: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, truncated } = await classified(ctx, config, restaurants)
  const days = periodDays(config).length
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("averagePerDay", "В среднем в день", "quantity"), col("variation", "Коэффициент вариации, %", "percent"), col("xyz", "Класс", "text")]
  const rows = [...list].sort((a, b) => a.variation - b.variation || b.quantity - a.quantity).map((dish) => ({ key: dish.key, cells: { group: dish.label, quantity: dish.quantity, averagePerDay: Math.round((dish.quantity / days) * 100) / 100, variation: dish.variation, xyz: dish.xyz } as Cells }))
  const classCount = (xyz: XyzClass) => list.filter((dish) => dish.xyz === xyz).length
  return { sourceLabel: `XYZ по дневным продажам (${days} дн.)`, columns, rows, totals: { quantity: sum(list, "quantity") }, kpis: (["X", "Y", "Z"] as const).map((xyz) => ({ key: xyz, label: `Класс ${xyz}`, value: classCount(xyz), unit: "count" as const })), truncated }
}

/** menu-03: the ABC × XYZ matrix — number of dishes per cell and the dishes themselves (the drill-down list). */
const abcXyzMatrix: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, byMargin, truncated } = await classified(ctx, config, restaurants)
  const columns = [col("group", "ABC", "text"), col("X", "X", "count"), col("Y", "Y", "count"), col("Z", "Z", "count"), col("total", "Всего", "count"), col("dishesX", "Блюда X", "text"), col("dishesY", "Блюда Y", "text"), col("dishesZ", "Блюда Z", "text")]
  const rows = (["A", "B", "C"] as const).map((abc) => {
    const cells: Cells = { group: abc, total: 0 }
    for (const xyz of ["X", "Y", "Z"] as const) {
      const cell = list.filter((dish) => dish.abc === abc && dish.xyz === xyz).sort((a, b) => a.cumulative - b.cumulative)
      cells[xyz] = cell.length
      cells[`dishes${xyz}`] = cell.map((dish) => dish.label).join(", ")
      cells.total = Number(cells.total) + cell.length
    }
    return { key: abc, cells }
  })
  const totals: Record<string, number> = { total: list.length }
  for (const xyz of ["X", "Y", "Z"]) totals[xyz] = rows.reduce((total, row) => total + Number(row.cells[xyz]), 0)
  return { sourceLabel: `ABC (${byMargin ? "валовая прибыль" : "выручка"}) × XYZ (стабильность спроса)`, columns, rows, totals, kpis: [{ key: "AX", label: "Ядро меню (AX)", value: Number(rows[0].cells.X), unit: "count" }, { key: "CZ", label: "Кандидаты на вывод (CZ)", value: Number(rows[2].cells.Z), unit: "count" }], truncated }
}

const ENGINEERING = {
  star: { label: "Звезда", advice: "Сохранить: держать качество, видное место в меню и цену" },
  plowhorse: { label: "Лошадка", advice: "Популярно, но маржа ниже средней: поднять цену или снизить себестоимость техкарты" },
  puzzle: { label: "Загадка", advice: "Маржинально, но продаётся мало: продвигать — место в меню, рекомендация официантов, фото" },
  dog: { label: "Собака", advice: "Мало продаж и низкая маржа: пересмотреть рецептуру или вывести из меню" },
} as const

/**
 * menu-04: menu engineering (Kasavana–Smith). Popular = share of portions ≥ 70 % of an equal share;
 * profitable = gross profit per portion ≥ the menu's weighted average.
 */
const menuRecommendations: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, truncated } = await dishes(ctx, config, restaurants)
  const sold = list.filter((dish) => dish.quantity > 0)
  const totalQuantity = sum(sold, "quantity")
  const averageMargin = totalQuantity ? sum(sold, "margin") / totalQuantity : 0
  const popularShare = sold.length ? (0.7 / sold.length) * 100 : 0
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("popularity", "Доля продаж, %", "percent"), col("marginPerPortion", "Прибыль на порцию", "money"), col("margin", "Валовая прибыль", "money"), col("segment", "Группа", "text"), col("advice", "Рекомендация", "text")]
  const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 }
  const rows = sold
    .map((dish) => {
      const popularity = percentOf(dish.quantity, totalQuantity)
      const marginPerPortion = Math.round(dish.margin / dish.quantity)
      const popular = popularity >= popularShare
      const profitable = dish.margin / dish.quantity >= averageMargin
      const segment = popular && profitable ? "star" : popular ? "plowhorse" : profitable ? "puzzle" : "dog"
      counts[segment] += 1
      return { key: dish.key, cells: { group: dish.label, quantity: dish.quantity, popularity, marginPerPortion, margin: dish.margin, segment: ENGINEERING[segment].label, advice: ENGINEERING[segment].advice } as Cells }
    })
    .sort((a, b) => Number(b.cells.margin) - Number(a.cells.margin))
  const kpis: ReportResult["kpis"] = (Object.keys(counts) as (keyof typeof counts)[]).map((segment) => ({ key: segment, label: ENGINEERING[segment].label, value: counts[segment], unit: "count" }))
  kpis.push({ key: "averageMargin", label: "Средняя прибыль на порцию", value: Math.round(averageMargin), unit: "money" })
  return { sourceLabel: "Меню-инжиниринг по продажам и списанию за период", columns, rows, totals: { quantity: totalQuantity, margin: sum(sold, "margin") }, kpis, truncated }
}

const SOURCE_LABEL: Record<ResolvedPrice["source"], string> = { overlay: "Цена iiko", "price-order": "Приказ о ценах", branch: "Цена филиала", base: "Базовая цена" }
const MAX_MOMENTS = 60
const MAX_PRODUCTS = 200

/**
 * menu-05: price history of the dishes in the price orders touching the period, per restaurant: the
 * price by the one rule (lib/pricing.ts) at the period start and at every start/end of an order.
 * Branch prices have no history of their own, so they only show as the price between orders.
 */
const priceDynamics: Calculator = async (ctx, config, restaurants) => {
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  const orders: Doc<"priceOrders">[] = []
  for (const status of ["active", "scheduled", "expired"] as const) {
    const rows = await ctx.db.query("priceOrders").withIndex("by_status_start", (q) => q.eq("status", status).lte("effectiveFrom", to)).order("desc").take(200)
    for (const order of rows) if (order.effectiveTo === undefined || order.effectiveTo > from) orders.push(order)
  }
  const lines = new Map<string, Doc<"priceOrderLines">[]>()
  for (const order of orders) lines.set(order.externalId, await ctx.db.query("priceOrderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200))
  const numbers = new Map(orders.map((order) => [order.externalId, order.number]))
  const matches = matcher(config)
  const columns = [col("group", "Блюдо", "text"), col("restaurant", "Ресторан", "text"), col("date", "С даты", "date"), col("price", "Цена", "money"), col("previous", "Была", "money"), col("change", "Изменение", "money"), col("changePercent", "Изменение, %", "percent"), col("source", "Источник", "text"), col("priceOrder", "Приказ", "text")]
  const rows: { key: string; cells: Cells }[] = []
  let truncated = false
  for (const restaurant of await restaurantDocs(ctx, restaurants)) {
    const own = orders.filter((order) => order.restaurantExternalIds.length === 0 || order.restaurantExternalIds.includes(restaurant.externalId))
    const moments = [...new Set([from, ...own.flatMap((order) => [order.effectiveFrom, order.effectiveTo ?? Infinity]).filter((at) => at > from && at <= to)])].sort((a, b) => a - b)
    if (moments.length > MAX_MOMENTS) truncated = true
    const productKeys = [...new Set(own.flatMap((order) => (lines.get(order.externalId) ?? []).filter((line) => line.included).map((line) => line.productExternalId)))]
    const products: Doc<"products">[] = []
    for (const key of productKeys) {
      if (products.length >= MAX_PRODUCTS) {
        truncated = true
        break
      }
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", key)).unique()
      if (product && matches(product.name)) products.push(product)
    }
    if (!products.length) continue
    const last = new Map<string, number>()
    for (const at of moments.slice(0, MAX_MOMENTS)) {
      const prices = await resolvePrices(ctx, products, restaurant.externalId, at)
      prices.forEach((resolved, index) => {
        const product = products[index]
        const previous = last.get(product.externalId)
        last.set(product.externalId, resolved.price)
        if (previous === resolved.price) return
        rows.push({
          key: `${restaurant.externalId}:${product.externalId}:${at}`,
          cells: { group: product.name, restaurant: restaurant.name, date: localDate(at), price: resolved.price, previous: previous ?? resolved.price, change: previous === undefined ? 0 : resolved.price - previous, changePercent: previous ? percentOf(resolved.price - previous, previous) : 0, source: SOURCE_LABEL[resolved.source], priceOrder: resolved.priceOrderId ? (numbers.get(resolved.priceOrderId) ?? "") : "" },
        })
      })
    }
  }
  rows.sort((a, b) => String(a.cells.restaurant).localeCompare(String(b.cells.restaurant), "ru") || String(a.cells.group).localeCompare(String(b.cells.group), "ru") || String(a.cells.date).localeCompare(String(b.cells.date)))
  const changes = rows.filter((row) => row.cells.change !== 0)
  return { sourceLabel: "Приказы о ценах, цены филиалов и базовые цены", columns, rows, totals: {}, kpis: [{ key: "changes", label: "Изменений цен", value: changes.length, unit: "count" }, { key: "dishes", label: "Блюд с изменениями", value: new Set(changes.map((row) => row.cells.group)).size, unit: "count" }], truncated }
}

/**
 * menu-06: «what if» — the dishes' current volume at a new price and/or cost: `extra.newPrice` (₸, with
 * `extra.productExternalId`) or `extra.priceChangePercent`, and `extra.costChangePercent`. Only one dish
 * changes when `productExternalId` is set; nothing is written.
 */
const whatIf: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, truncated } = await dishes(ctx, config, restaurants)
  const target = typeof config.extra?.productExternalId === "string" && config.extra.productExternalId ? config.extra.productExternalId : null
  const newPrice = config.extra?.newPrice === undefined || config.extra.newPrice === "" ? null : numberParam(config, "newPrice", 0)
  if (newPrice !== null && (!target || newPrice <= 0)) throw new ConvexError("Новая цена задаётся для одного блюда и больше нуля")
  const priceChange = numberParam(config, "priceChangePercent", 0)
  const costChange = numberParam(config, "costChangePercent", 0)
  if (priceChange <= -100 || costChange <= -100) throw new ConvexError("Изменение не может быть −100 % и меньше")
  const columns = [
    col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("price", "Цена сейчас", "money"), col("newPrice", "Цена в сценарии", "money"),
    col("portionCost", "Себестоимость порции", "money"), col("newPortionCost", "Себестоимость в сценарии", "money"),
    col("netAmount", "Выручка", "money"), col("newNetAmount", "Выручка в сценарии", "money"), col("margin", "Маржа", "money"), col("newMargin", "Маржа в сценарии", "money"), col("marginDelta", "Изменение маржи", "money"),
  ]
  const rows = list
    .filter((dish) => dish.quantity > 0)
    .map((dish) => {
      const applies = !target || dish.key === target
      const price = dish.netAmount / dish.quantity
      const portionCost = dish.costAmount / dish.quantity
      const scenarioPrice = applies ? (newPrice ?? price * (1 + priceChange / 100)) : price
      const scenarioCost = applies ? portionCost * (1 + costChange / 100) : portionCost
      const newNetAmount = Math.round(scenarioPrice * dish.quantity)
      const newMargin = newNetAmount - Math.round(scenarioCost * dish.quantity)
      return { key: dish.key, label: dish.label, values: { quantity: dish.quantity, price: Math.round(price), newPrice: Math.round(scenarioPrice), portionCost: Math.round(portionCost), newPortionCost: Math.round(scenarioCost), netAmount: dish.netAmount, newNetAmount, margin: dish.margin, newMargin, marginDelta: newMargin - dish.margin } }
    })
  const result = aggregate(rows, columns, "marginDelta")
  for (const key of ["price", "newPrice", "portionCost", "newPortionCost"]) delete result.totals[key]
  if (target && !result.rows.some((row) => row.key === target)) throw new ConvexError("У блюда нет продаж за период — сценарий не на чем посчитать")
  return {
    sourceLabel: "Сценарий на объёме продаж периода (без записи)",
    columns,
    ...result,
    kpis: [
      { key: "netDelta", label: "Изменение выручки", value: (result.totals.newNetAmount ?? 0) - (result.totals.netAmount ?? 0), unit: "money" },
      { key: "marginDelta", label: "Изменение маржи", value: result.totals.marginDelta ?? 0, unit: "money" },
      { key: "newMarginPercent", label: "Маржа в сценарии, %", value: percentOf(result.totals.newMargin ?? 0, result.totals.newNetAmount ?? 0), unit: "percent" },
    ],
    truncated,
  }
}

/** menu-09: markup of the dishes sold — (menu price − recipe cost) / recipe cost (L-19), per restaurant. */
const markup: Calculator = async (ctx, config, restaurants) => {
  const at = Math.min(Date.now(), dayEnd(config.dateTo))
  const columns = [col("group", "Блюдо", "text"), col("restaurant", "Ресторан", "text"), col("price", "Цена", "money"), col("recipeCost", "Себестоимость по техкарте", "money"), col("markupAmount", "Наценка", "money"), col("markupPercent", "Наценка, %", "percent"), col("foodCost", "Фудкост, %", "percent"), col("status", "Техкарта", "text")]
  const rows: { key: string; cells: Cells }[] = []
  let truncated = false
  for (const restaurant of await restaurantDocs(ctx, restaurants)) {
    const sold = await dishes(ctx, config, [restaurant.externalId])
    truncated ||= sold.truncated
    const products: Doc<"products">[] = []
    for (const dish of sold.dishes.sort((a, b) => b.netAmount - a.netAmount).slice(0, MAX_PRODUCTS)) {
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", dish.key)).unique()
      if (product) products.push(product)
    }
    if (sold.dishes.length > MAX_PRODUCTS) truncated = true
    const prices = await resolvePrices(ctx, products, restaurant.externalId, at)
    for (const [index, product] of products.entries()) {
      const price = prices[index].price
      const version = await recipeVersionAt(ctx, product._id, at)
      const recipeCost = version ? Math.round((await costRecipe(ctx, version, at, restaurant.externalId)).summary.costPerPortion) : 0
      const markupAmount = price - recipeCost
      rows.push({ key: `${restaurant.externalId}:${product.externalId}`, cells: { group: product.name, restaurant: restaurant.name, price, recipeCost, markupAmount, markupPercent: recipeCost ? percentOf(markupAmount, recipeCost) : 0, foodCost: price ? percentOf(recipeCost, price) : 0, status: !version ? "Нет техкарты" : recipeCost ? `Версия ${version.version}` : "Нет себестоимости" } })
    }
  }
  rows.sort((a, b) => Number(a.cells.markupPercent) - Number(b.cells.markupPercent))
  const costed = rows.filter((row) => Number(row.cells.recipeCost) > 0)
  const priceTotal = costed.reduce((total, row) => total + Number(row.cells.price), 0)
  const costTotal = costed.reduce((total, row) => total + Number(row.cells.recipeCost), 0)
  return { sourceLabel: "Цены по правилу цен и себестоимость по техкартам", columns, rows, totals: {}, kpis: [{ key: "averageMarkup", label: "Средняя наценка", value: costTotal ? percentOf(priceTotal - costTotal, costTotal) : 0, unit: "percent" }, { key: "withoutRecipe", label: "Блюд без техкарты", value: rows.filter((row) => row.cells.status === "Нет техкарты").length, unit: "count" }], truncated }
}

/** menu-10: contribution of each dish to the gross profit (revenue − actual cost) of the period. */
const profitContribution: Calculator = async (ctx, config, restaurants) => {
  const { dishes: list, truncated } = await dishes(ctx, config, restaurants)
  const total = list.reduce((sum, dish) => sum + dish.margin, 0)
  const columns = [col("group", "Блюдо", "text"), col("quantity", "Продано", "quantity"), col("netAmount", "Выручка", "money"), col("costAmount", "Себестоимость", "money"), col("margin", "Валовая прибыль", "money"), col("share", "Доля в валовой прибыли, %", "percent"), col("cumulative", "Нарастающим итогом, %", "percent")]
  let running = 0
  const rows = [...list]
    .sort((a, b) => b.margin - a.margin || a.key.localeCompare(b.key))
    .map((dish) => {
      running += dish.margin
      return { key: dish.key, cells: { group: dish.label, quantity: dish.quantity, netAmount: dish.netAmount, costAmount: dish.costAmount, margin: dish.margin, share: percentOf(dish.margin, total), cumulative: percentOf(running, total) } as Cells }
    })
  return { sourceLabel: "Продажи и списание по техкартам", columns, rows, totals: { quantity: sum(list, "quantity"), netAmount: sum(list, "netAmount"), costAmount: sum(list, "costAmount"), margin: total }, kpis: [{ key: "margin", label: "Валовая прибыль", value: total, unit: "money" }, { key: "top", label: "Доля лидера", value: Number(rows[0]?.cells.share ?? 0), unit: "percent" }], truncated }
}

/**
 * menu-12: recipe versions by their validity — a version runs from its effectiveFrom to the next
 * non-draft version's; shown when it overlaps the period or starts in the future. Drafts with `extra.includeDrafts`.
 */
const recipeValidity: Calculator = async (ctx, config) => {
  const from = dayStart(config.dateFrom)
  const to = dayEnd(config.dateTo)
  const now = Date.now()
  const includeDrafts = config.extra?.includeDrafts === true
  const matches = matcher(config)
  const columns = [col("group", "Блюдо", "text"), col("version", "Версия", "count"), col("from", "Действует с", "date"), col("to", "Действует по", "text"), col("batchYield", "Выход, порций", "quantity"), col("status", "Статус", "text")]
  const rows: { key: string; cells: Cells }[] = []
  let scanned = 0
  let truncated = false
  let withoutRecipe = 0
  for await (const product of ctx.db.query("products").withIndex("by_enabled_and_name", (q) => q.eq("enabled", true))) {
    if ((scanned += 1) > SCAN_BUDGET) {
      truncated = true
      break
    }
    if (product.itemType === "good" || !matches(product.name)) continue
    const versions = await ctx.db.query("recipeVersions").withIndex("by_product_effective", (q) => q.eq("productId", product._id)).take(100)
    const released = versions.filter((version) => version.status !== "draft")
    if (!released.length && product.itemType !== "preparation") withoutRecipe += 1
    released.forEach((version, index) => {
      const until = released[index + 1]?.effectiveFrom
      const status = version.effectiveFrom > now ? "Будущая" : until === undefined || until > now ? "Действует" : "Истекла"
      if (!(version.effectiveFrom > now || (version.effectiveFrom <= to && (until === undefined || until > from)))) return
      rows.push({ key: String(version._id), cells: { group: product.name, version: version.version, from: localDate(version.effectiveFrom), to: until === undefined ? "бессрочно" : localDate(until - 1), batchYield: version.batchYield, status } })
    })
    if (includeDrafts) for (const version of versions.filter((row) => row.status === "draft")) rows.push({ key: String(version._id), cells: { group: product.name, version: version.version, from: localDate(version.effectiveFrom), to: "—", batchYield: version.batchYield, status: "Черновик" } })
  }
  rows.sort((a, b) => String(a.cells.group).localeCompare(String(b.cells.group), "ru") || Number(a.cells.version) - Number(b.cells.version))
  const count = (status: string) => rows.filter((row) => row.cells.status === status).length
  return { sourceLabel: "Версии технологических карт", columns, rows, totals: {}, kpis: [{ key: "active", label: "Действуют", value: count("Действует"), unit: "count" }, { key: "future", label: "Будущие", value: count("Будущая"), unit: "count" }, { key: "withoutRecipe", label: "Блюд без техкарты", value: withoutRecipe, unit: "count" }], truncated }
}

/** menu-13: sizes sold — quantity, revenue, average price of the size and its price coefficient. */
const sizesAndPrices: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "size", config, restaurants)
  const matches = matcher(config)
  const columns = [col("group", "Размер", "text"), col("scale", "Шкала", "text"), col("coefficient", "Коэффициент цены", "quantity"), col("quantity", "Продано", "quantity"), col("grossAmount", "По меню", "money"), col("netAmount", "Выручка", "money"), col("averagePrice", "Средняя цена", "money"), col("share", "Доля продаж, %", "percent")]
  const input = []
  const options = new Map<string, { scale: string; coefficient: number } | null>()
  for (const fact of rows) {
    if (!matches(fact.dimensionLabel)) continue
    if (!options.has(fact.dimensionKey)) {
      const option = await ctx.db.query("sizeOptions").withIndex("by_external_id", (q) => q.eq("externalId", fact.dimensionKey)).unique()
      const scale = option ? await ctx.db.get(option.scaleId) : null
      options.set(fact.dimensionKey, option ? { scale: scale?.name ?? "", coefficient: option.coefficient } : null)
    }
    const option = options.get(fact.dimensionKey)
    input.push({ key: fact.dimensionKey, label: fact.dimensionLabel, text: { scale: option?.scale ?? "—" }, values: { quantity: fact.quantity, grossAmount: fact.grossAmount, netAmount: fact.netAmount } })
  }
  const result = aggregate(input, columns, "quantity")
  const total = result.totals.quantity ?? 0
  for (const row of result.rows) {
    const quantity = Number(row.cells.quantity) || 0
    row.cells.coefficient = options.get(row.key)?.coefficient ?? 0
    row.cells.averagePrice = quantity ? Math.round(Number(row.cells.grossAmount) / quantity) : 0
    row.cells.share = percentOf(quantity, total)
  }
  for (const key of ["coefficient", "averagePrice", "share"]) delete result.totals[key]
  return { sourceLabel: "Продажи по размерам (предагрегат за день)", columns, ...result, kpis: [{ key: "sizes", label: "Размеров", value: result.rows.length, unit: "count" }, { key: "quantity", label: "Продано порций", value: total, unit: "quantity" }], truncated }
}

/**
 * menu-14: modifier use — times chosen (lines), quantity, paid and free portions (the paid part is the
 * revenue over the modifier's price), revenue; removed defaults («БЕЗ X») are listed on their own.
 */
const modifierUse: Calculator = async (ctx, config, restaurants) => {
  const { rows, truncated } = await facts(ctx, "modifier", config, restaurants)
  const matches = matcher(config)
  const columns = [col("group", "Модификатор", "text"), col("modifierGroup", "Группа", "text"), col("kind", "Тип", "text"), col("orderCount", "Раз выбран", "count"), col("quantity", "Количество", "quantity"), col("paidQuantity", "Платно", "quantity"), col("freeQuantity", "Бесплатно", "quantity"), col("grossAmount", "Выручка", "money")]
  const known = new Map<string, { group: string; price: number } | null>()
  const input = []
  for (const fact of rows) {
    const removal = fact.dimensionKey.startsWith("without:")
    const externalId = removal ? fact.dimensionKey.slice("without:".length) : fact.dimensionKey
    if (!known.has(externalId)) {
      const modifier = await ctx.db.query("modifiers").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
      const group = modifier ? await ctx.db.get(modifier.groupId) : null
      known.set(externalId, modifier ? { group: group?.name ?? "", price: modifier.price } : null)
    }
    const info = known.get(externalId)
    if (!matches(fact.dimensionLabel, info?.group ?? "")) continue
    input.push({ key: fact.dimensionKey, label: fact.dimensionLabel, text: { modifierGroup: info?.group ?? "—", removal: removal ? "1" : "" }, values: { orderCount: fact.orderCount, quantity: fact.quantity, grossAmount: fact.grossAmount } })
  }
  const result = aggregate(input, columns, "quantity")
  for (const row of result.rows) {
    const quantity = Number(row.cells.quantity) || 0
    const price = known.get(row.key.replace(/^without:/, ""))?.price ?? 0
    if (row.cells.removal) {
      row.cells.kind = "Удаление («БЕЗ»)"
      row.cells.paidQuantity = 0
      row.cells.freeQuantity = 0
    } else {
      const paid = price > 0 ? Math.min(quantity, Math.round(Number(row.cells.grossAmount) / price)) : 0
      row.cells.paidQuantity = paid
      row.cells.freeQuantity = quantity - paid
      row.cells.kind = price === 0 ? "Бесплатный" : paid === 0 ? "Бесплатно по правилу" : paid < quantity ? "Платный, часть бесплатно" : "Платный"
    }
    delete row.cells.removal
  }
  result.totals.paidQuantity = result.rows.reduce((total, row) => total + Number(row.cells.paidQuantity), 0)
  result.totals.freeQuantity = result.rows.reduce((total, row) => total + Number(row.cells.freeQuantity), 0)
  const removals = result.rows.filter((row) => row.key.startsWith("without:"))
  return { sourceLabel: "Модификаторы строк заказов (предагрегат за день)", columns, ...result, kpis: [{ key: "revenue", label: "Выручка модификаторов", value: result.totals.grossAmount ?? 0, unit: "money" }, { key: "removals", label: "Удалений «БЕЗ»", value: removals.reduce((total, row) => total + Number(row.cells.orderCount), 0), unit: "count" }], truncated }
}

/** menu-15: enabled dishes not on the branch's stop list with no sales in the period, per restaurant. */
const dishesWithoutSales: Calculator = async (ctx, config, restaurants) => {
  const now = Date.now()
  const matches = matcher(config)
  const columns = [col("group", "Блюдо", "text"), col("restaurant", "Ресторан", "text"), col("category", "Категория", "text"), col("basePrice", "Базовая цена", "money")]
  const docs = await restaurantDocs(ctx, restaurants)
  const sold = new Map<string, Set<string>>()
  let truncated = false
  for (const restaurant of docs) {
    const { rows, truncated: cut } = await facts(ctx, "product", config, [restaurant.externalId])
    truncated ||= cut
    sold.set(restaurant.externalId, new Set(rows.map((fact) => fact.dimensionKey)))
  }
  const categories = new Map<string, string>()
  const rows: { key: string; cells: Cells }[] = []
  let scanned = 0
  for await (const product of ctx.db.query("products").withIndex("by_enabled_and_name", (q) => q.eq("enabled", true))) {
    if ((scanned += 1) > SCAN_BUDGET) {
      truncated = true
      break
    }
    if (product.itemType === "preparation" || product.sourceDeleted || !matches(product.name)) continue
    if (!categories.has(product.category)) categories.set(product.category, (await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", product.category)).unique())?.label ?? product.category)
    for (const restaurant of docs) {
      const own = sold.get(restaurant.externalId)!
      if (own.has(product.externalId) || own.has(String(product._id))) continue
      if (stopListActive(await stopListRow(ctx, product._id, restaurant.externalId), now)) continue
      rows.push({ key: `${restaurant.externalId}:${product.externalId}`, cells: { group: product.name, restaurant: restaurant.name, category: categories.get(product.category)!, basePrice: product.basePrice } })
    }
  }
  rows.sort((a, b) => String(a.cells.restaurant).localeCompare(String(b.cells.restaurant), "ru") || String(a.cells.category).localeCompare(String(b.cells.category), "ru") || String(a.cells.group).localeCompare(String(b.cells.group), "ru"))
  return { sourceLabel: "Активные блюда без продаж (без блюд в стоп-листе филиала)", columns, rows, totals: {}, kpis: [{ key: "dishes", label: "Блюд без продаж", value: new Set(rows.map((row) => row.cells.group)).size, unit: "count" }], truncated }
}

export const MENU_CALCULATORS: Record<string, Calculator> = {
  "menu-01": abcAnalysis,
  "menu-02": xyzAnalysis,
  "menu-03": abcXyzMatrix,
  "menu-04": menuRecommendations,
  "menu-05": priceDynamics,
  "menu-06": whatIf,
  "menu-09": markup,
  "menu-10": profitContribution,
  "menu-12": recipeValidity,
  "menu-13": sizesAndPrices,
  "menu-14": modifierUse,
  "menu-15": dishesWithoutSales,
}
