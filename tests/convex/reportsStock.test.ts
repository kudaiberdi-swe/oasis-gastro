import { convexTest } from "convex-test"
import { beforeAll, describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { abcClasses, xyzClass } from "../../convex/domains/reports/calculators/stockHelpers"
import { REPORT_REGISTRY } from "../../convex/domains/reports/registry"
import type { ReportConfig } from "../../convex/lib/reportConfig"
import { applyStockMovement, type StockMovementInput } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

// W2-RPT-02: the 22 stock reports on one fixture — 2 warehouses, 5 items, ~30 days of movements in
// September 2026, one lot with a shelf life.

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+05:00`)
const sep = (day: number) => `2026-09-${String(day).padStart(2, "0")}`
const SEPTEMBER: ReportConfig = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] }

type T = ReturnType<typeof convexTest>

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const warehouse = (externalId: string, name: string, kind: "storage" | "kitchen", allowNegativeStock: boolean) =>
      ctx.db.insert("warehouses", { externalId, name, shortName: name, restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind, allowNegativeStock, internalTransfers: true, isSalesDefault: kind === "storage", active: true, searchText: name.toLocaleLowerCase("ru") })
    const main = await warehouse("main", "Основной склад", "storage", false)
    const kitchen = await warehouse("kitchen", "Кухня", "kitchen", true)
    const item = (externalId: string, name: string, unit: "кг" | "л", extra: { maximumStock?: number; shelfLifeHours?: number } = {}) =>
      ctx.db.insert("inventoryItems", { externalId, name, nameSort: name.toLocaleLowerCase("ru"), searchText: name.toLocaleLowerCase("ru"), unit, kind: "ingredient", active: true, ...extra })
    const meat = await item("meat", "Конина", "кг", { shelfLifeHours: 240 })
    const flour = await item("flour", "Мука", "кг")
    const milk = await item("milk", "Молоко", "л", { maximumStock: 5 })
    const salt = await item("salt", "Соль", "кг")
    const sugar = await item("sugar", "Сахар", "кг")
    const supplier = await ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "", supplierType: "external", vatPayer: false, priceDeviationPolicy: "warn", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной партнёр" })

    const movements: StockMovementInput[] = []
    const receipts: { externalId: string; number: string; date: number; warehouseId: Id<"warehouses">; lines: { inventoryItemId: Id<"inventoryItems">; quantity: number; price: number }[] }[] = [
      { externalId: "r0", number: "ПН-0", date: at("2026-08-25"), warehouseId: main, lines: [{ inventoryItemId: meat, quantity: 10, price: 4000 }] },
      { externalId: "r-sugar", number: "ПН-С", date: at("2026-08-20"), warehouseId: main, lines: [{ inventoryItemId: sugar, quantity: 5, price: 200 }] },
      { externalId: "r1", number: "ПН-1", date: at(sep(1), 9), warehouseId: main, lines: [{ inventoryItemId: flour, quantity: 40, price: 500 }] },
      { externalId: "r1b", number: "ПН-1К", date: at(sep(1), 9), warehouseId: kitchen, lines: [{ inventoryItemId: salt, quantity: 1, price: 100 }] },
      { externalId: "r2", number: "ПН-2", date: at(sep(2), 9), warehouseId: main, lines: [{ inventoryItemId: milk, quantity: 30, price: 300 }] },
      { externalId: "r3", number: "ПН-3", date: at(sep(15), 9), warehouseId: main, lines: [{ inventoryItemId: meat, quantity: 5, price: 5000 }] },
      { externalId: "r4", number: "ПН-4", date: at(sep(20), 9), warehouseId: main, lines: [{ inventoryItemId: flour, quantity: 10, price: 550 }] },
    ]
    for (const receipt of receipts) {
      const gross = receipt.lines.reduce((sum, line) => sum + line.quantity * line.price, 0)
      const receiptId = await ctx.db.insert("receipts", { externalId: receipt.externalId, number: receipt.number, date: receipt.date, supplierId: supplier, warehouseId: receipt.warehouseId, restaurantExternalId: "almaty", organizationExternalId: "sandyq", invoiceNumber: "", status: "posted", totalGross: gross, totalVat: 0, totalNet: gross, searchText: receipt.number, createdAt: receipt.date, updatedAt: receipt.date })
      for (const [index, line] of receipt.lines.entries()) {
        await ctx.db.insert("receiptLines", { receiptId, lineNo: index + 1, inventoryItemId: line.inventoryItemId, quantity: line.quantity, unitCostGross: line.price, vatRate: 0, amountGross: line.quantity * line.price })
        await ctx.db.insert("stockLots", { externalId: `${receipt.externalId}:${index + 1}`, inventoryItemId: line.inventoryItemId, warehouseId: receipt.warehouseId, quantity: line.quantity, remainingQuantity: line.quantity, unitCost: line.price, sourceModuleId: "receipts", sourceExternalId: receipt.externalId, sourceNumber: receipt.number, receivedAt: receipt.date })
        movements.push({ externalId: `${receipt.externalId}:${index + 1}`, kind: "receipt", sourceModuleId: "receipts", sourceExternalId: receipt.externalId, sourceNumber: receipt.number, warehouseId: receipt.warehouseId, inventoryItemId: line.inventoryItemId, quantityDelta: line.quantity, unitCost: line.price, occurredAt: receipt.date })
      }
    }
    const sale = (key: string, warehouseId: Id<"warehouses">, inventoryItemId: Id<"inventoryItems">, quantity: number, occurredAt: number): StockMovementInput => ({ externalId: key, kind: "sale", sourceModuleId: "orders", sourceExternalId: key, sourceNumber: key, warehouseId, inventoryItemId, quantityDelta: -quantity, occurredAt })
    for (let day = 1; day <= 8; day += 1) movements.push(sale(`meat-${day}`, main, meat, 1, at(sep(day))))
    movements.push(sale("meat-20", main, meat, 2, at(sep(20))))
    for (let day = 1; day <= 30; day += 1) movements.push(sale(`flour-${day}`, main, flour, 1, at(sep(day))))
    movements.push(sale("salt-3", kitchen, salt, 3, at(sep(3))))
    movements.push({ externalId: "w1", kind: "document", sourceModuleId: "writeoffs", sourceExternalId: "w1", sourceNumber: "СП-1", warehouseId: main, inventoryItemId: milk, quantityDelta: -20, occurredAt: at(sep(5)) })
    movements.push({ externalId: "t1:out", kind: "document", sourceModuleId: "transfers", sourceExternalId: "t1", sourceNumber: "ПРМ-1", warehouseId: main, inventoryItemId: meat, quantityDelta: -1, occurredAt: at(sep(10)) })
    movements.push({ externalId: "t1:in", kind: "document", sourceModuleId: "transfers", sourceExternalId: "t1", sourceNumber: "ПРМ-1", warehouseId: kitchen, inventoryItemId: meat, quantityDelta: 1, unitCost: 4000, occurredAt: at(sep(10)) })
    movements.push({ externalId: "sr1", kind: "document", sourceModuleId: "supplier-returns", sourceExternalId: "sr1", sourceNumber: "ВП-1", warehouseId: main, inventoryItemId: milk, quantityDelta: -3, occurredAt: at(sep(25)) })
    movements.sort((a, b) => a.occurredAt - b.occurredAt)
    for (const movement of movements) await applyStockMovement(ctx, { actorEmail: "t", ...movement })

    const document = { organizationExternalId: "sandyq", restaurantExternalId: "almaty", status: "posted" as const, comment: "", searchText: "", createdAt: 1, updatedAt: 1 }
    await ctx.db.insert("stockDocuments", { ...document, externalId: "t1", type: "transfer", number: "ПРМ-1", date: at(sep(10)), sourceWarehouseId: main, destinationWarehouseId: kitchen, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", counterpartyName: "", reason: "", totalQuantity: 1, totalAmount: 4000 })
    await ctx.db.insert("stockDocuments", { ...document, externalId: "sr1", type: "supplier-return", number: "ВП-1", date: at(sep(25)), sourceWarehouseId: main, sourceWarehouseExternalId: "main", supplierId: supplier, counterpartyName: "Мясной партнёр", receiptExternalId: "r2", reason: "Кислое", totalQuantity: 3, totalAmount: 900 })
    await ctx.db.insert("productionDocuments", { externalId: "po1", type: "purchase-order", number: "ЗП-1", date: at(sep(18)), status: "completed", organizationExternalId: "sandyq", restaurantExternalId: "almaty", destinationWarehouseId: main, supplierId: supplier, comment: "", lines: [{ lineNo: 1, inventoryItemId: flour, name: "Мука", quantity: 20, direction: "output", expectedUnitCost: 500 }], totalAmount: 10000, receiptExternalId: "r4", searchText: "зп-1", version: 1, createdBy: "t", createdAt: 1, updatedAt: 1 })
    const list = await ctx.db.insert("priceLists", { externalId: "pl1", seriesExternalId: "pl", version: 1, name: "Прайс партнёра", kind: "supplier", supplierId: supplier, effectiveFrom: at("2026-08-01"), status: "published", deviationPolicy: "warn", deviationPercent: 10, lineCount: 1, searchText: "прайс", createdBy: "t", createdAt: 1, updatedAt: 1 })
    await ctx.db.insert("priceListLines", { priceListId: list, lineNo: 1, inventoryItemId: flour, supplierSku: "F-10", supplierName: "Мука в/с 10 кг", packageCoefficient: 10, price: 4500 })

    const product = (externalId: string, name: string) => ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name.toLocaleLowerCase("ru"), searchText: name.toLocaleLowerCase("ru"), description: "", category: "hot", categorySort: 1, basePrice: 5000, popular: false, sku: externalId, baseUnit: "порц.", enabled: true, itemType: "dish", writeOffMethod: "ingredients" })
    const recipe = async (productId: Id<"products">, batchYield: number, lines: { inventoryItemId: Id<"inventoryItems">; quantity: number }[]) => {
      const recipeId = await ctx.db.insert("recipes", { productId, createdAt: 1 })
      const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId, version: 1, effectiveFrom: at("2026-08-01"), batchYield, technology: "", status: "active", createdBy: "t", createdAt: 1 })
      for (const [index, line] of lines.entries()) await ctx.db.insert("recipeLines", { versionId, kind: "item", inventoryItemId: line.inventoryItemId, name: "x", unit: "кг", quantity: line.quantity, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: index })
    }
    await recipe(await product("beshbarmak", "Бешбармак"), 2, [{ inventoryItemId: meat, quantity: 0.6 }, { inventoryItemId: flour, quantity: 0.2 }])
    await recipe(await product("lepeshka", "Лепёшка"), 1, [{ inventoryItemId: flour, quantity: 0.1 }])
    const zero = { orderCount: 0, guestCount: 0, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 1 }
    await ctx.db.insert("dailySalesFacts", { ...zero, restaurantExternalId: "almaty", businessDate: sep(5), factType: "product", dimensionKey: "beshbarmak", dimensionLabel: "Бешбармак", quantity: 6, netAmount: 30000 })
    await ctx.db.insert("dailySalesFacts", { ...zero, restaurantExternalId: "almaty", businessDate: sep(6), factType: "product", dimensionKey: "beshbarmak", dimensionLabel: "Бешбармак", quantity: 4, netAmount: 20000 })
    return { main, kitchen, meat, flour, milk, salt, sugar }
  })
  return { t, ...ids }
}

const run = (t: T, reportId: string, config: Partial<ReportConfig> = {}) => t.run((ctx) => REPORT_REGISTRY[reportId].calculator(ctx, { ...SEPTEMBER, ...config }, ["almaty"]))
const row = (result: Awaited<ReturnType<typeof run>>, group: string, extra: Record<string, string> = {}) => result.rows.find((r) => r.cells.group === group && Object.entries(extra).every(([key, value]) => r.cells[key] === value))

describe("ABC / XYZ classification (W2-RPT-02)", () => {
  it("ABC: A while the running share is under 80 %, B under 95 %, C after", () => {
    const classes = abcClasses([{ key: "a", value: 70 }, { key: "b", value: 12 }, { key: "c", value: 10 }, { key: "d", value: 5 }, { key: "e", value: 3 }, { key: "zero", value: 0 }])
    expect(classes.map((row) => [row.key, row.abc])).toEqual([["a", "A"], ["b", "A"], ["c", "B"], ["d", "B"], ["e", "C"]])
  })
  it("XYZ by the coefficient of variation", () => {
    expect(xyzClass([5, 5, 5, 5]).xyz).toBe("X")
    expect(xyzClass([4, 5, 6, 5]).xyz).toBe("Y") // 14 %
    expect(xyzClass([0, 10, 0, 10]).xyz).toBe("Z")
  })
})

describe("stock reports W2 (W2-RPT-02)", () => {
  let fx: Awaited<ReturnType<typeof fixture>>
  beforeAll(async () => {
    fx = await fixture()
  })

  it("all 22 are registered; 16 certificates is honestly unavailable", async () => {
    for (const id of ["02", "04", "05", "06", "08", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "26", "27", "28"]) {
      expect(REPORT_REGISTRY[`stock-${id}`], id).toBeDefined()
      const result = await run(fx.t, `stock-${id}`)
      expect(result.columns.length, id).toBeGreaterThan(0)
      expect(result.truncated, id).toBe(false)
    }
    const certificates = await run(fx.t, "stock-16")
    expect(certificates.sourceLabel).toMatch(/^Недоступно: учёт сертификатов выключен/)
    expect(certificates.rows).toEqual([])
  })

  it("02 negative and 04 above-maximum balances", async () => {
    const negative = await run(fx.t, "stock-02")
    expect(negative.rows).toHaveLength(1)
    expect(negative.rows[0].cells).toMatchObject({ group: "Соль", warehouse: "Кухня", quantity: -2, value: -200 })
    const above = await run(fx.t, "stock-04")
    expect(above.rows).toHaveLength(1)
    expect(above.rows[0].cells).toMatchObject({ group: "Молоко", quantity: 7, maximum: 5, excess: 2, excessValue: 600 })
  })

  it("05 expired: the stock sits on the newest lot (FIFO), expired once receipt date + shelf life passed", async () => {
    const expired = await run(fx.t, "stock-05")
    expect(expired.rows).toHaveLength(1)
    expect(expired.rows[0].cells).toMatchObject({ group: "Конина", warehouse: "Основной склад", lot: "ПН-3", received: "2026-09-15", expires: "2026-09-25", overdueDays: 5, quantity: 4, value: 20000 })
    expect((await run(fx.t, "stock-05", { dateTo: "2026-09-20" })).rows).toEqual([])
  })

  it("06 turnover sheet adds up and closes on the stock balances", async () => {
    const sheet = await run(fx.t, "stock-06")
    const balances = await fx.t.run((ctx) => ctx.db.query("stockBalances").withIndex("by_restaurant", (q) => q.eq("restaurantExternalId", "almaty")).collect())
    expect(sheet.rows).toHaveLength(balances.length)
    for (const balance of balances) {
      const line = sheet.rows.find((r) => r.key === `${balance.warehouseId}:${balance.inventoryItemId}`)!
      const c = line.cells as Record<string, number>
      expect(c.openingQuantity + c.inQuantity - c.outQuantity).toBeCloseTo(c.closingQuantity, 6)
      expect(c.closingQuantity).toBeCloseTo(balance.quantity, 6)
      expect(c.closingValue).toBe(Math.round(balance.quantity * balance.averageUnitCost))
    }
    expect(row(sheet, "Конина", { warehouse: "Основной склад" })!.cells).toMatchObject({ openingQuantity: 10, openingValue: 40000, inQuantity: 5, inValue: 25000, outQuantity: 11, closingQuantity: 4 })
    expect(sheet.kpis.find((k) => k.key === "mismatched")!.value).toBe(0)
    const t = sheet.totals
    expect(t.openingValue + t.inValue - t.outValue).toBeCloseTo(t.closingValue, -1)
  })

  it("08 cost change: the weighted average of meat went 4000 → 4833.33", async () => {
    const change = await run(fx.t, "stock-08")
    expect(row(change, "Конина", { warehouse: "Основной склад" })!.cells).toMatchObject({ startCost: 4000, endCost: 4833.33, deltaPercent: 20.8 })
  })

  it("10 purchase discrepancies: price list first, else the previous receipt price", async () => {
    const report = await run(fx.t, "stock-10")
    expect(report.rows).toHaveLength(3)
    expect(row(report, "Мука", { receipt: "ПН-1" })!.cells).toMatchObject({ reference: 450, deviationPercent: 11.1, overpayment: 2000, verdict: "Предупреждение" })
    expect(String(row(report, "Мука", { receipt: "ПН-1" })!.cells.basis)).toMatch(/Прайс-лист/)
    expect(row(report, "Конина")!.cells).toMatchObject({ receipt: "ПН-3", basis: "Предыдущий приход ПН-0", reference: 4000, deviationPercent: 25, overpayment: 5000 })
    expect(report.kpis.find((k) => k.key === "overpayment")!.value).toBe(8000)
  })

  it("11 ABC and 12 XYZ on known consumption", async () => {
    const abc = await run(fx.t, "stock-11")
    expect(abc.rows.map((r) => [r.cells.group, r.cells.abc])).toEqual([["Конина", "A"], ["Мука", "A"], ["Молоко", "B"], ["Соль", "C"]])
    expect(row(abc, "Конина")!.cells.value).toBe(41667) // 8 × 4000 + 2 × 4833.33; the transfer is not consumption
    expect(row(abc, "Молоко")!.cells.value).toBe(6900) // write-off 20 + return 3 at 300
    const xyz = await run(fx.t, "stock-12")
    expect(row(xyz, "Мука")!.cells).toMatchObject({ xyz: "X", mean: 1, variation: 0 })
    expect(row(xyz, "Конина")!.cells.xyz).toBe("Z")
  })

  it("13 sales and 14 unsold", async () => {
    const sales = await run(fx.t, "stock-13")
    expect(row(sales, "Конина")!.cells).toMatchObject({ quantity: 10, value: 41667 })
    expect(row(sales, "Мука")!.cells.quantity).toBe(30)
    expect(row(sales, "Молоко")).toBeUndefined()
    const unsold = await run(fx.t, "stock-14")
    expect(unsold.rows.map((r) => `${r.cells.group} · ${r.cells.warehouse}`).sort()).toEqual(["Конина · Кухня", "Сахар · Основной склад"])
    expect(row(unsold, "Сахар")!.cells).toMatchObject({ quantity: 5, value: 1000, lastMovement: "2026-08-20" })
  })

  it("15 goods report groups the movements by document", async () => {
    const goods = await run(fx.t, "stock-15")
    expect(row(goods, "ПН-3")!.cells).toMatchObject({ type: "Приходная накладная", date: "2026-09-15", inQuantity: 5, inValue: 25000, outQuantity: 0 })
    expect(row(goods, "ПРМ-1")!.cells).toMatchObject({ type: "Перемещение", inQuantity: 1, outQuantity: 1 })
    const k = Object.fromEntries(goods.kpis.map((kpi) => [kpi.key, kpi.value]))
    const sheet = await run(fx.t, "stock-06")
    expect(k.inValue).toBe(sheet.totals.inValue)
    expect(k.outValue).toBe(sheet.totals.outValue)
    expect(k.closingValue).toBe(sheet.totals.closingValue)
  })

  it("17 item in dishes and 18 dishes with theoretical consumption", async () => {
    const usage = await run(fx.t, "stock-17", { search: "мука" })
    expect(usage.rows.map((r) => [r.cells.dish, r.cells.perPortion])).toEqual([["Бешбармак", 0.1], ["Лепёшка", 0.1]])
    const dishes = await run(fx.t, "stock-18")
    expect(row(dishes, "Бешбармак", { ingredient: "Конина" })!.cells).toMatchObject({ perPortion: 0.3, sold: 10, consumption: 3 })
    expect(row(dishes, "Бешбармак", { ingredient: "Мука" })!.cells.consumption).toBe(1)
  })

  it("19 custom OLAP by warehouse and by day × item", async () => {
    const byWarehouse = await run(fx.t, "stock-19", { groupBy: "warehouse" })
    expect(byWarehouse.rows).toHaveLength(2)
    expect(row(byWarehouse, "Кухня")!.cells).toMatchObject({ transferIn: 1, inQuantity: 2, outQuantity: 3, sale: -3 })
    const sheet = await run(fx.t, "stock-06")
    expect(byWarehouse.totals.inValue).toBe(sheet.totals.inValue)
    const byDay = await run(fx.t, "stock-19", { groupBy: "day", secondaryGroupBy: "product" })
    expect(byDay.rows[0].cells.group).toBe("2026-09-01")
    expect(row(byDay, "2026-09-10", { secondary: "Конина" })!.cells).toMatchObject({ transferIn: 1, transferOut: -1, net: 0 })
  })

  it("20 supplier price lists and 21 purchase price dynamics", async () => {
    const lists = await run(fx.t, "stock-20")
    expect(lists.rows).toHaveLength(1)
    expect(lists.rows[0].cells).toMatchObject({ group: "Мука", supplier: "Мясной партнёр", packagePrice: 4500, unitPrice: 450, sku: "F-10" })
    const dynamics = await run(fx.t, "stock-21")
    expect(row(dynamics, "Мука")!.cells).toMatchObject({ receipts: 2, firstPrice: 500, lastPrice: 550, changePercent: 10, quantity: 50 })
  })

  it("22 purchase orders, 23 supplier turnover, 26 transfers, 27 supplier returns", async () => {
    const orders = await run(fx.t, "stock-22")
    expect(orders.rows[0].cells).toMatchObject({ group: "ЗП-1", receipt: "ПН-4", ordered: 20, received: 10, fulfillment: 50, receivedAmount: 5500 })
    const turnover = await run(fx.t, "stock-23")
    expect(row(turnover, "Мясной партнёр")!.cells).toMatchObject({ receipts: 5, received: 20000 + 100 + 9000 + 25000 + 5500, returns: 1, returned: 900, net: 59600 - 900 })
    const transfers = await run(fx.t, "stock-26")
    expect(transfers.rows[0].cells).toMatchObject({ group: "ПРМ-1", from: "Основной склад", to: "Кухня", quantity: 1, amount: 4000 })
    const returns = await run(fx.t, "stock-27")
    expect(returns.rows[0].cells).toMatchObject({ group: "ВП-1", supplier: "Мясной партнёр", receipt: "ПН-2", reason: "Кислое", amount: 900 })
  })

  it("28 turnover days: average stock / average daily consumption", async () => {
    const turnover = await run(fx.t, "stock-28")
    expect(row(turnover, "Мука")!.cells).toMatchObject({ averageStock: 28.167, dailyConsumption: 1, turnoverDays: 28.2 })
    expect(row(turnover, "Сахар")!.cells).toMatchObject({ averageStock: 5, turnoverDays: 0, note: "Нет расхода" })
  })

  it("runs through the office query with the scope of the user", async () => {
    await fx.t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    })
    const admin = fx.t.withIdentity({ email: "admin@sandyq.test" })
    const result = await admin.query(api.domains.reports.queries.execute, { reportId: "stock-02", config: SEPTEMBER })
    expect(result.rows).toHaveLength(1)
    const other = await admin.query(api.domains.reports.queries.execute, { reportId: "stock-02", config: { ...SEPTEMBER, extra: { warehouseExternalId: "main" } } })
    expect(other.rows).toEqual([])
  })
})
