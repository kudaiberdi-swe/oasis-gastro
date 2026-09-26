import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { forecastFromFacts } from "../../convex/domains/reports/calculators/_forecast"
import { REPORT_REGISTRY } from "../../convex/domains/reports/registry"
import type { ReportConfig } from "../../convex/lib/reportConfig"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

// W3-RPT-02: production reports over real postings — a broth preparation (4 kg of meat per 10 kg),
// production, processing and sales acts, a kitchen write-off, internal and purchase orders, and a dish
// that uses the broth for the kitchen forecast (production-11/12/13 share one forecast, L-14).

const modules = import.meta.glob("../../convex/**/*.ts")
const docs = api.domains.production.documents
const at = (local: string) => Date.parse(`${local}+05:00`)
const SEPTEMBER: ReportConfig = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] }

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const [externalId, name] of [["almaty", "Алматы"], ["shymkent", "Шымкент"]]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name, address: "—", timezone: "Asia/Almaty", active: true })
    const warehouse = (externalId: string, restaurantExternalId: string, kind: "storage" | "kitchen") => ctx.db.insert("warehouses", { externalId, name: externalId, shortName: externalId, restaurantExternalId, organizationExternalId: "sandyq", kind, allowNegativeStock: false, internalTransfers: true, isSalesDefault: kind === "storage", active: true, searchText: externalId })
    const main = await warehouse("main", "almaty", "storage")
    const kitchen = await warehouse("kitchen", "almaty", "kitchen")
    await warehouse("sh-main", "shymkent", "storage")
    const item = (externalId: string, name: string) => ctx.db.insert("inventoryItems", { externalId, name, nameSort: name, searchText: name, unit: "кг", kind: "ingredient", active: true })
    const meat = await item("meat", "Говядина")
    const fillet = await item("fillet", "Филе")
    const bones = await item("bones", "Кости")
    const product = (externalId: string, name: string, itemType?: "preparation" | "dish") => ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name, searchText: name, description: "", category: "prep", categorySort: 1, basePrice: 0, popular: false, sku: externalId, baseUnit: "кг", enabled: true, ...(itemType ? { itemType } : {}) })
    const broth = await product("broth", "Бульон")
    const recipe = async (productId: typeof broth, batchYield: number) => {
      const recipeId = await ctx.db.insert("recipes", { productId, createdAt: 1 })
      return ctx.db.insert("recipeVersions", { recipeId, productId, version: 1, effectiveFrom: at("2026-09-01T00:00:00"), batchYield, technology: "", status: "active", createdBy: "t", createdAt: 1 })
    }
    const brothVersion = await recipe(broth, 10)
    const meatLine = await ctx.db.insert("recipeLines", { versionId: brothVersion, kind: "item", inventoryItemId: meat, name: "meat", unit: "кг", quantity: 4, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 0 })
    const dish = await product("beshbarmak", "Бешбармак", "dish")
    const dishVersion = await recipe(dish, 1)
    await ctx.db.insert("recipeLines", { versionId: dishVersion, kind: "preparation", componentProductId: broth, name: "Бульон", unit: "кг", quantity: 0.5, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 0 })
    await ctx.db.insert("recipeLines", { versionId: dishVersion, kind: "item", inventoryItemId: meat, name: "meat", unit: "кг", quantity: 0.2, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 1 })
    await applyStockMovement(ctx, { externalId: "opening", kind: "document", sourceModuleId: "test", sourceExternalId: "opening", sourceNumber: "0", warehouseId: main, inventoryItemId: meat, quantityDelta: 20, unitCost: 4000, occurredAt: at("2026-09-01T10:00:00"), actorEmail: "t" })
    await ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "123456789012", supplierType: "external", vatPayer: false, priceDeviationPolicy: "ignore", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной партнёр" })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    return { main, kitchen, meat, fillet, bones, brothVersion, meatLine }
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  await admin.mutation(api.domains.production.preparations.savePreparation, { productExternalId: "broth", unit: "кг", writeOffMethod: "finished-product" })
  const run = (reportId: string, restaurants = ["almaty"], config: ReportConfig = SEPTEMBER) => t.run((ctx) => REPORT_REGISTRY[reportId].calculator(ctx, config, restaurants))
  const act = async (type: "production" | "processing" | "sales", date: string, lines: { productExternalId?: string; inventoryItemExternalId?: string; quantity: number; direction?: "input" | "output" }[], destination = "kitchen") => {
    const { externalId } = await admin.mutation(docs.saveDocument, { type, restaurantExternalId: "almaty", date: at(date), sourceWarehouseExternalId: "main", ...(type === "sales" ? {} : { destinationWarehouseExternalId: destination }), comment: "", lines })
    await admin.mutation(docs.postDocument, { externalId })
    return externalId
  }
  return { t, admin, run, act, ...ids }
}

const cellsOf = (result: { rows: { key: string; cells: Record<string, number | string> }[] }) => Object.fromEntries(result.rows.map((row) => [String(row.cells.group), row.cells]))

describe("production reports (W3-RPT-02)", () => {
  it("an act by the recipe feeds 01–04; 05 and 06 compare it with the norm read through recipeLinesOf", async () => {
    const { t, run, act, brothVersion, meatLine, bones } = await setup()
    await act("production", "2026-09-20T10:00:00", [{ productExternalId: "broth", quantity: 5 }]) // 2 kg of meat at 4 000 ₸

    const acts = await run("production-01")
    expect(acts.rows.map((row) => [row.cells.from, row.cells.to, row.cells.items, row.cells.output, row.cells.cost])).toEqual([["main", "kitchen", "Бульон", 5, 8000]])
    expect((await run("production-01", ["shymkent"])).rows).toEqual([]) // acts keep to the restaurant scope (B-23)
    expect(cellsOf(await run("production-02"))["Бульон"]).toMatchObject({ unit: "кг", quantity: 5, cost: 8000, unitCost: 1600, acts: 1 })
    expect(cellsOf(await run("production-03"))["Говядина"]).toMatchObject({ quantity: 2, value: 8000, acts: 1 })
    expect(cellsOf(await run("production-04"))["Бульон"]).toMatchObject({ warehouse: "kitchen", opening: 0, produced: 5, sold: 0, closing: 5, closingValue: 8000 })

    // As posted, the act matches its recipe.
    expect(cellsOf(await run("production-06"))["Говядина"]).toMatchObject({ norm: 2, actual: 2, deviation: 0, deviationValue: 0 })
    expect(cellsOf(await run("production-05"))["Бульон"]).toMatchObject({ actual: 5, planned: 5, yield: 100 })

    // The chart is corrected afterwards (5 kg of meat per batch) and gains a line for another branch only.
    await t.run(async (ctx) => {
      await ctx.db.patch(meatLine, { quantity: 5, iikoDepartmentExternalIds: undefined })
      await ctx.db.insert("recipeLines", { versionId: brothVersion, kind: "item", inventoryItemId: bones, name: "bones", unit: "кг", quantity: 3, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 1, iikoDepartmentExternalIds: ["dept-shymkent"] })
      await ctx.db.insert("restaurantSourceLinks", { restaurantExternalId: "almaty", iikoDepartmentExternalId: "dept-almaty", confirmedBy: "t", confirmedAt: 0 })
    })
    const deviation = cellsOf(await run("production-06"))
    expect(deviation["Говядина"]).toMatchObject({ norm: 2.5, actual: 2, deviation: -0.5, deviationPercent: -20, normValue: 10_000, actualValue: 8000, deviationValue: -2000 })
    expect(deviation["Кости"]).toBeUndefined() // Шымкент's line variant is not Алматы's norm
    expect(cellsOf(await run("production-05"))["Бульон"]).toMatchObject({ actual: 5, planned: 4, deviation: 1, yield: 125 })
  })

  it("07 kitchen write-offs, 08 and 10 act registers, 14 internal and 15 purchase orders", async () => {
    const { t, admin, run, act, kitchen, meat } = await setup()
    await act("processing", "2026-09-10T10:00:00", [{ inventoryItemExternalId: "meat", quantity: 2, direction: "input" }, { inventoryItemExternalId: "fillet", quantity: 1.5, direction: "output" }, { inventoryItemExternalId: "bones", quantity: 0.5, direction: "output" }])
    await act("sales", "2026-09-11T10:00:00", [{ inventoryItemExternalId: "meat", quantity: 1 }])
    const processing = await run("production-08")
    expect(processing.rows[0].cells).toMatchObject({ inputs: "Говядина", input: 2, outputs: "Филе, Кости", output: 2, cost: 8000 })
    expect(await run("production-09")).toMatchObject({ rows: [] })
    expect((await run("production-10")).rows[0].cells).toMatchObject({ items: "Говядина", input: 1, cost: 4000 })
    expect(cellsOf(await run("production-03"))["Говядина"]).toMatchObject({ quantity: 2, value: 8000 }) // processing inputs count, sales acts do not

    await t.run(async (ctx) => {
      const documentId = await ctx.db.insert("stockDocuments", { externalId: "wo-1", type: "writeoff", number: "АС-1", date: at("2026-09-12T10:00:00"), status: "posted", organizationExternalId: "sandyq", restaurantExternalId: "almaty", sourceWarehouseId: kitchen, counterpartyName: "", reason: "Порча", comment: "", totalQuantity: 1, totalAmount: 4000, searchText: "", createdAt: 0, updatedAt: 0 })
      await ctx.db.insert("stockDocumentLines", { documentId, lineNo: 1, inventoryItemId: meat, quantity: 1, unitCost: 4000, vatRate: 0 })
    })
    expect((await run("production-07")).rows.map((row) => [row.cells.group, row.cells.reason, row.cells.warehouse, row.cells.quantity, row.cells.value])).toEqual([["Говядина", "Порча", "kitchen", 1, 4000]])

    const { externalId: transfer } = await admin.mutation(docs.saveDocument, { type: "internal-order", restaurantExternalId: "almaty", date: at("2026-09-13T10:00:00"), sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "sh-main", comment: "", lines: [{ inventoryItemExternalId: "meat", quantity: 3 }] })
    await admin.mutation(docs.transitionDocument, { externalId: transfer, action: "submit" })
    const internalOrders = await run("production-14")
    expect(internalOrders.rows[0].cells).toMatchObject({ from: "main (almaty)", to: "sh-main (shymkent)", lines: 1, quantity: 3, status: "На согласовании" })
    expect(internalOrders.kpis.find((kpi) => kpi.key === "open")?.value).toBe(1)

    const { externalId: order } = await admin.mutation(docs.saveDocument, { type: "purchase-order", restaurantExternalId: "almaty", date: at("2026-09-14T10:00:00"), destinationWarehouseExternalId: "main", supplierExternalId: "partner", expectedDate: at("2026-09-15T10:00:00"), comment: "", lines: [{ inventoryItemExternalId: "meat", quantity: 5, expectedUnitCost: 4000 }] })
    const purchase = await run("production-15")
    expect(purchase.rows[0].cells).toMatchObject({ supplier: "Мясной партнёр", expected: "2026-09-15", ordered: 20_000, received: 0, fulfilment: 0, status: "Черновик", late: "Да" })
    await admin.mutation(docs.transitionDocument, { externalId: order, action: "cancel", reason: "Не нужен" })
    expect((await run("production-15")).rows).toEqual([])
  })

  it("11 sheet, 12 kitchen plan and 13 needs come from one forecast (L-14)", async () => {
    const { t, run, act } = await setup()
    // Same weekday (Wednesday) over six weeks before 30.09: 12 + 12 + 6 + 6 + 0 + 0 = 36 → 6 a day.
    await t.run(async (ctx) => {
      for (const [date, quantity] of [["2026-09-23", 12], ["2026-09-16", 12], ["2026-09-09", 6], ["2026-09-02", 6], ["2026-09-29", 40], ["2026-09-30", 5]] as const) {
        await ctx.db.insert("dailySalesFacts", { restaurantExternalId: "almaty", businessDate: date, factType: "product", dimensionKey: "beshbarmak", dimensionLabel: "Бешбармак", orderCount: quantity, guestCount: 0, quantity, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, netAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 })
      }
    })
    const forecast = await t.run((ctx) => forecastFromFacts(ctx, { restaurantExternalId: "almaty", targetDate: "2026-09-30" }))
    expect(forecast).toEqual([{ productExternalId: "beshbarmak", name: "Бешбармак", recommended: 6 }])

    const plan = await run("production-12")
    expect(plan.rows.map((row) => [row.cells.group, row.cells.recommended, row.cells.sold, row.cells.deviation])).toEqual([["Бешбармак", 6, 5, -1]])

    const sheet = cellsOf(await run("production-11"))
    expect(sheet["Бульон"]).toMatchObject({ need: forecast[0].recommended * 0.5, onHand: 0, plan: 3, fact: 0 })
    // 13: the dish's own meat (6 × 0.2) plus the broth still to make (3 kg × 0.4).
    expect(cellsOf(await run("production-13"))["Говядина"]).toMatchObject({ need: 2.4, onHand: 20, shortage: 0 })

    await act("production", "2026-09-30T08:00:00", [{ productExternalId: "broth", quantity: 2 }])
    expect(cellsOf(await run("production-11"))["Бульон"]).toMatchObject({ need: 3, onHand: 2, plan: 1, fact: 2 })
    expect((await run("production-12", ["almaty"], { ...SEPTEMBER, extra: { targetDate: "2026-10-07" } })).rows.map((row) => [row.cells.recommended, row.cells.sold])).toEqual([[7, 0]]) // (5 + 12 + 12 + 6 + 6 + 0) / 6
  })
})
