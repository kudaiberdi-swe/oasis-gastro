import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { abcClasses, xyzClass } from "../../convex/domains/reports/calculators/menu"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

// W2-RPT-04: the other 12 menu reports on a known sales distribution (product facts written directly).

const modules = import.meta.glob("../../convex/**/*.ts")
type T = TestConvex<typeof schema>
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]
const period = { dateFrom: DAYS[0], dateTo: DAYS[3], restaurantExternalIds: [] }

/**
 * Four dishes over four days (net / cost / daily portions):
 *   p1 Плов       50 000 / 20 000 / 10 10 10 10  → A, X; 750 ₸ a portion, popular → star
 *   p2 Манты      30 000 /  6 000 /  8 12  8 12  → A, Y (CV 20 %); 600 ₸ → plowhorse
 *   p3 Бешбармак  15 000 /  3 000 /  0  0  0 10  → B, Z; 1 200 ₸, rare → puzzle
 *   p4 Лагман      5 000 /  4 500 /  1  1  1  1  → C, X; 125 ₸, rare → dog
 * p5 has no sales, p6 has no sales and is on the stop list, p7 is disabled.
 */
const SALES: Record<string, { name: string; net: number; cost: number; daily: number[] }> = {
  p1: { name: "Плов", net: 50_000, cost: 20_000, daily: [10, 10, 10, 10] },
  p2: { name: "Манты", net: 30_000, cost: 6_000, daily: [8, 12, 8, 12] },
  p3: { name: "Бешбармак", net: 15_000, cost: 3_000, daily: [0, 0, 0, 10] },
  p4: { name: "Лагман", net: 5_000, cost: 4_500, daily: [1, 1, 1, 1] },
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    const ids: Record<string, Id<"products">> = {}
    const names: Record<string, string> = { ...Object.fromEntries(Object.entries(SALES).map(([key, row]) => [key, row.name])), p5: "Сорпа", p6: "Куырдак", p7: "Архивное блюдо" }
    for (const [externalId, name] of Object.entries(names)) {
      ids[externalId] = await ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name.toLocaleLowerCase("ru"), searchText: name, description: "", category: "hot", categorySort: 1, basePrice: 1000, popular: false, sku: externalId, baseUnit: "порц.", enabled: externalId !== "p7", itemType: "dish" })
    }
    await ctx.db.insert("productAvailability", { productId: ids.p6, restaurantExternalId: "almaty", available: false, reason: "Нет мяса", updatedBy: "test", updatedAt: 0 })
    for (const [key, sale] of Object.entries(SALES)) {
      const quantity = sale.daily.reduce((sum, value) => sum + value, 0)
      for (const [index, portions] of sale.daily.entries()) {
        if (!portions) continue
        const share = portions / quantity
        await ctx.db.insert("dailySalesFacts", { restaurantExternalId: "almaty", businessDate: DAYS[index], factType: "product", dimensionKey: key, dimensionLabel: sale.name, orderCount: portions, guestCount: 0, quantity: portions, grossAmount: sale.net * share, discountAmount: 0, serviceChargeAmount: 0, netAmount: sale.net * share, costAmount: sale.cost * share, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 })
      }
    }
    return ids
  })
  return { t, ids, admin: t.withIdentity({ email: "admin@sandyq.test" }) }
}

type Admin = Awaited<ReturnType<typeof setup>>["admin"]
const run = (admin: Admin, reportId: string, extra?: Record<string, string | number | boolean>, config: Partial<typeof period> & { search?: string } = {}) =>
  admin.query(api.domains.reports.queries.execute, { reportId, config: { ...period, ...config, ...(extra ? { extra } : {}) } })
const column = (rows: { key: string; cells: Record<string, number | string> }[], cell: string) => Object.fromEntries(rows.map((row) => [row.key, row.cells[cell]]))

describe("menu analysis (W2-RPT-04)", () => {
  it("ABC and XYZ class a known distribution", async () => {
    expect([...abcClasses([{ key: "a", value: 50 }, { key: "b", value: 30 }, { key: "c", value: 15 }, { key: "d", value: 5 }]).values()].map((row) => row.abc)).toEqual(["A", "A", "B", "C"])
    expect(abcClasses([{ key: "lead", value: 90 }, { key: "x", value: 10 }]).get("lead")?.abc).toBe("A") // the leader is A even above 80 %
    expect(xyzClass([10, 10, 10, 10])).toEqual({ xyz: "X", variation: 0 })
    expect(xyzClass([8, 12, 8, 12])).toEqual({ xyz: "Y", variation: 20 })
    expect(xyzClass([0, 0, 0, 10]).xyz).toBe("Z")

    const { admin } = await setup()
    const abc = await run(admin, "menu-01")
    expect(column(abc.rows, "abc")).toEqual({ p1: "A", p2: "A", p3: "B", p4: "C" })
    expect(column(abc.rows, "cumulative")).toEqual({ p1: 50, p2: 80, p3: 95, p4: 100 })
    expect(abc.kpis.map((kpi) => kpi.value)).toEqual([2, 1, 1])
    const byMargin = await run(admin, "menu-01", { abcBy: "margin" }) // margins 30 000 / 24 000 / 12 000 / 500
    expect(column(byMargin.rows, "cumulative")).toEqual({ p1: 45.1, p2: 81.2, p3: 99.2, p4: 100 })
    expect(column(byMargin.rows, "abc")).toEqual({ p1: "A", p2: "A", p3: "B", p4: "C" })
    expect(byMargin.sourceLabel).toMatch(/валовой прибыли/)

    const xyz = await run(admin, "menu-02")
    expect(column(xyz.rows, "xyz")).toEqual({ p1: "X", p2: "Y", p3: "Z", p4: "X" })
    expect(column(xyz.rows, "variation")).toMatchObject({ p1: 0, p2: 20 })
    expect(column(xyz.rows, "averagePerDay")).toMatchObject({ p1: 10, p3: 2.5 })

    const matrix = await run(admin, "menu-03")
    expect(matrix.rows.map((row) => [row.key, row.cells.X, row.cells.Y, row.cells.Z])).toEqual([["A", 1, 1, 0], ["B", 0, 0, 1], ["C", 1, 0, 0]])
    expect(matrix.rows[0].cells.dishesY).toBe("Манты")
    expect(matrix.totals).toMatchObject({ X: 2, Y: 1, Z: 1, total: 4 })
  })

  it("menu-04 sorts the dishes into stars, plowhorses, puzzles and dogs; menu-10 shares the gross profit", async () => {
    const { admin } = await setup()
    const engineering = await run(admin, "menu-04")
    expect(column(engineering.rows, "segment")).toEqual({ p1: "Звезда", p2: "Лошадка", p3: "Загадка", p4: "Собака" })
    expect(column(engineering.rows, "marginPerPortion")).toEqual({ p1: 750, p2: 600, p3: 1200, p4: 125 })
    expect(String(engineering.rows.find((row) => row.key === "p4")?.cells.advice)).toMatch(/вывести из меню/)
    expect(engineering.kpis.find((kpi) => kpi.key === "averageMargin")?.value).toBe(Math.round(66_500 / 94))

    const contribution = await run(admin, "menu-10")
    expect(contribution.rows.map((row) => row.key)).toEqual(["p1", "p2", "p3", "p4"])
    expect(column(contribution.rows, "share")).toEqual({ p1: 45.1, p2: 36.1, p3: 18, p4: 0.8 })
    expect(contribution.rows.at(-1)?.cells.cumulative).toBe(100)
    expect(contribution.totals.margin).toBe(66_500)
  })

  it("menu-06 «what if» recalculates margin deterministically, without writing", async () => {
    const { t, admin } = await setup()
    const before = await t.run((ctx) => ctx.db.query("dailySalesFacts").take(100))
    const scenario = await run(admin, "menu-06", { productExternalId: "p1", priceChangePercent: 10, costChangePercent: -10 })
    // Плов: 40 portions at 1 250 → 1 375 ₸, cost 500 → 450 ₸: revenue 55 000, margin 55 000 − 18 000.
    expect(scenario.rows.find((row) => row.key === "p1")?.cells).toMatchObject({ price: 1250, newPrice: 1375, portionCost: 500, newPortionCost: 450, newNetAmount: 55_000, newMargin: 37_000, marginDelta: 7_000 })
    expect(scenario.rows.find((row) => row.key === "p2")?.cells.marginDelta).toBe(0)
    expect(scenario.kpis.find((kpi) => kpi.key === "marginDelta")?.value).toBe(7_000)
    expect(await run(admin, "menu-06", { productExternalId: "p1", priceChangePercent: 10, costChangePercent: -10 })).toMatchObject({ rows: scenario.rows, totals: scenario.totals, kpis: scenario.kpis })

    const newPrice = await run(admin, "menu-06", { productExternalId: "p1", newPrice: 1500 })
    expect(newPrice.rows.find((row) => row.key === "p1")?.cells).toMatchObject({ newNetAmount: 60_000, newMargin: 40_000, marginDelta: 10_000 })
    const everything = await run(admin, "menu-06", { costChangePercent: 10 })
    expect(everything.kpis.find((kpi) => kpi.key === "marginDelta")?.value).toBe(-(20_000 + 6_000 + 3_000 + 4_500) / 10)
    await expect(run(admin, "menu-06", { newPrice: 1500 })).rejects.toThrow(/одного блюда/)
    await expect(run(admin, "menu-06", { productExternalId: "p5", newPrice: 1500 })).rejects.toThrow(/нет продаж/)
    expect(await t.run((ctx) => ctx.db.query("dailySalesFacts").take(100))).toEqual(before)
  })

  it("menu-15 lists enabled dishes without sales that are not on the stop list", async () => {
    const { admin } = await setup()
    const report = await run(admin, "menu-15")
    expect(report.rows.map((row) => [row.cells.group, row.cells.restaurant, row.cells.category])).toEqual([["Сорпа", "Алматы", "Горячее"]])
  })
})

describe("menu prices and recipes (W2-RPT-04)", () => {
  async function withCatalog(t: T, ids: Record<string, Id<"products">>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("productPrices", { productId: ids.p1, restaurantExternalId: "almaty", priceKzt: 1200 })
      const order = await ctx.db.insert("priceOrders", { externalId: "po-1", number: "ЦЕН-2026-00001", name: "Осень", nameSort: "осень", searchText: "осень", effectiveFrom: almatyDayStart("2026-09-02"), effectiveTo: almatyDayStart("2026-09-04"), status: "expired", comment: "", posName: "Осень", replacesPreviousMenu: false, restaurantExternalIds: [], organizationExternalId: "sandyq", createdBy: "test", updatedAt: 0 })
      await ctx.db.insert("priceOrderLines", { orderId: order, productId: ids.p1, productExternalId: "p1", included: true, previousPrice: 1200, newPrice: 1400, costAtSave: 400, productName: "Плов" })
      const meat = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Мясо", nameSort: "мясо", searchText: "мясо", unit: "кг", active: true })
      await ctx.db.insert("stockBalances", { restaurantExternalId: "almaty", inventoryItemId: meat, quantity: 10, averageUnitCost: 4000, updatedAt: 0 })
      const version = async (productId: Id<"products">, number: number, effectiveFrom: number, status: "draft" | "active" | "superseded") => {
        const recipe = (await ctx.db.query("recipes").withIndex("by_product", (q) => q.eq("productId", productId)).unique())?._id ?? (await ctx.db.insert("recipes", { productId, createdAt: 0 }))
        const versionId = await ctx.db.insert("recipeVersions", { recipeId: recipe, productId, version: number, effectiveFrom, batchYield: 1, technology: "", status, createdBy: "test", createdAt: 0 })
        await ctx.db.insert("recipeLines", { versionId, kind: "item", inventoryItemId: meat, name: "Мясо", unit: "кг", quantity: 0.1, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 1 })
      }
      await version(ids.p1, 1, 0, "active") // 0.1 кг × 4 000 ₸ = 400 ₸ a portion
      await version(ids.p2, 1, almatyDayStart("2026-08-01"), "superseded")
      await version(ids.p2, 2, almatyDayStart("2026-09-03"), "active")
      await version(ids.p2, 3, Date.now() + 10 * 86_400_000, "active")
      await version(ids.p2, 4, almatyDayStart("2026-09-02"), "draft")
    })
  }

  it("menu-05 follows the price orders; menu-09 is (price − recipe cost) / recipe cost; menu-12 dates the versions", async () => {
    const { t, ids, admin } = await setup()
    await withCatalog(t, ids)
    const prices = await run(admin, "menu-05")
    expect(prices.rows.map((row) => [row.cells.group, row.cells.date, row.cells.price, row.cells.change, row.cells.source, row.cells.priceOrder])).toEqual([
      ["Плов", "2026-09-01", 1200, 0, "Цена филиала", ""],
      ["Плов", "2026-09-02", 1400, 200, "Приказ о ценах", "ЦЕН-2026-00001"],
      ["Плов", "2026-09-04", 1200, -200, "Цена филиала", ""],
    ])
    expect(prices.rows[1].cells.changePercent).toBe(16.7)

    const markup = await run(admin, "menu-09", undefined, { search: "плов" })
    expect(markup.rows[0].cells).toMatchObject({ group: "Плов", price: 1200, recipeCost: 400, markupAmount: 800, markupPercent: 200, foodCost: 33.3, status: "Версия 1" })
    expect((await run(admin, "menu-09")).rows.find((row) => row.cells.group === "Лагман")?.cells.status).toBe("Нет техкарты")

    const versions = await run(admin, "menu-12", undefined, { search: "манты" })
    expect(versions.rows.map((row) => [row.cells.version, row.cells.from, row.cells.to, row.cells.status])).toEqual([
      [1, "2026-08-01", "2026-09-02", "Истекла"],
      [2, "2026-09-03", expect.any(String), "Действует"],
      [3, expect.any(String), "бессрочно", "Будущая"],
    ])
    expect((await run(admin, "menu-12", { includeDrafts: true }, { search: "манты" })).rows.some((row) => row.cells.status === "Черновик")).toBe(true)
  })

  it("menu-13 prices the sizes sold; menu-14 counts paid, free and removed modifiers", async () => {
    const { t, admin } = await setup()
    await t.run(async (ctx) => {
      const scale = await ctx.db.insert("sizeScales", { externalId: "portions", name: "Порции", nameSort: "порции", searchText: "порции", sortOrder: 1 })
      await ctx.db.insert("sizeOptions", { externalId: "size-l", scaleId: scale, label: "Большой", kitchenLabel: "L", coefficient: 1.5, sortOrder: 2, isDefault: false, available: true })
      const group = await ctx.db.insert("modifierGroups", { externalId: "extras", name: "Добавки", nameSort: "добавки", searchText: "добавки", sortOrder: 1, active: true })
      await ctx.db.insert("modifiers", { externalId: "cheese", groupId: group, name: "Сыр", nameSort: "сыр", searchText: "сыр", price: 300, ingredientName: "Сыр", ingredientQuantity: 0.02, unit: "кг", available: true, sortOrder: 1 })
      const fact = { restaurantExternalId: "almaty", businessDate: "2026-09-02", guestCount: 0, discountAmount: 0, serviceChargeAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 }
      await ctx.db.insert("dailySalesFacts", { ...fact, factType: "size", dimensionKey: "size-l", dimensionLabel: "Большой", orderCount: 2, quantity: 3, grossAmount: 4500, netAmount: 4400 })
      await ctx.db.insert("dailySalesFacts", { ...fact, factType: "size", dimensionKey: "Малый", dimensionLabel: "Малый", orderCount: 1, quantity: 1, grossAmount: 800, netAmount: 800 })
      await ctx.db.insert("dailySalesFacts", { ...fact, factType: "modifier", dimensionKey: "cheese", dimensionLabel: "Сыр", orderCount: 3, quantity: 4, grossAmount: 600, netAmount: 0 })
      await ctx.db.insert("dailySalesFacts", { ...fact, factType: "modifier", dimensionKey: "without:onion", dimensionLabel: "БЕЗ ЛУКА", orderCount: 2, quantity: 2, grossAmount: 0, netAmount: 0 })
    })
    const sizes = await run(admin, "menu-13")
    expect(sizes.rows.map((row) => [row.cells.group, row.cells.scale, row.cells.coefficient, row.cells.quantity, row.cells.averagePrice, row.cells.share])).toEqual([
      ["Большой", "Порции", 1.5, 3, 1500, 75],
      ["Малый", "—", 0, 1, 800, 25],
    ])
    const modifiers = await run(admin, "menu-14")
    expect(modifiers.rows.map((row) => [row.cells.group, row.cells.modifierGroup, row.cells.kind, row.cells.orderCount, row.cells.paidQuantity, row.cells.freeQuantity, row.cells.grossAmount])).toEqual([
      ["Сыр", "Добавки", "Платный, часть бесплатно", 3, 2, 2, 600],
      ["БЕЗ ЛУКА", "—", "Удаление («БЕЗ»)", 2, 0, 0, 0],
    ])
    expect(modifiers.kpis.find((kpi) => kpi.key === "removals")?.value).toBe(2)
  })
})
