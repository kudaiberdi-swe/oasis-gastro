import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { intervalOf, sameWeekdayDates } from "../../convex/lib/forecast"
import { applyCheckoutFacts } from "../../convex/lib/reportFacts"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

// W3-PRD-07/08: one kitchen forecast (lib/forecast.ts) for «План на кухню» and «Ведомость полуфабрикатов».

const modules = import.meta.glob("../../convex/**/*.ts")
const logistics = { queries: api.domains.productionLogistics.queries, mutations: api.domains.productionLogistics.mutations }
const at = (local: string) => Date.parse(`${local}+05:00`)
const TARGET = "2026-09-28" // a Monday

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const almaty = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    const kitchen = await ctx.db.insert("warehouses", { externalId: "kitchen", name: "Кухня", shortName: "Кухня", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "kitchen", allowNegativeStock: true, internalTransfers: true, isSalesDefault: true, active: true, searchText: "кухня" })
    const product = (externalId: string, name: string, extra: { itemType?: "dish" | "preparation"; writeOffMethod?: "finished-product" | "ingredients" } = {}) =>
      ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name.toLocaleLowerCase("ru"), searchText: name.toLocaleLowerCase("ru"), description: "", category: "main", categorySort: 1, basePrice: 2000, popular: false, sku: externalId, baseUnit: "порц.", enabled: true, ...extra })
    const item = (externalId: string, unit: "кг" | "шт", productExternalId?: string) =>
      ctx.db.insert("inventoryItems", { externalId, name: externalId, nameSort: externalId, searchText: externalId, unit, kind: productExternalId ? "preparation" : "ingredient", active: true, ...(productExternalId ? { productExternalId } : {}) })
    const burger = await product("burger", "Бургер", { itemType: "dish" })
    const sauce = await product("sauce", "Соус", { itemType: "preparation", writeOffMethod: "finished-product" })
    const patty = await product("patty", "Котлета", { itemType: "preparation", writeOffMethod: "finished-product" })
    const mince = await product("mince", "Фарш", { itemType: "preparation", writeOffMethod: "finished-product" })
    const meat = await item("meat", "кг")
    const sauceItem = await item("prep-sauce", "кг", "sauce")
    const pattyItem = await item("prep-patty", "шт", "patty")
    await item("prep-mince", "кг", "mince")
    const recipe = async (productId: Id<"products">, batchYield: number, lines: { kind: "item" | "preparation"; id: Id<"inventoryItems"> | Id<"products">; unit: "кг" | "шт"; quantity: number }[]) => {
      const recipeId = await ctx.db.insert("recipes", { productId, createdAt: 1 })
      const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId, version: 1, effectiveFrom: at("2026-08-01T00:00:00"), batchYield, technology: "", status: "active", createdBy: "t", createdAt: 1 })
      for (const [index, line] of lines.entries()) {
        await ctx.db.insert("recipeLines", { versionId, kind: line.kind, ...(line.kind === "item" ? { inventoryItemId: line.id as Id<"inventoryItems"> } : { componentProductId: line.id as Id<"products"> }), name: String(line.id), unit: line.unit, quantity: line.quantity, unitWeightKg: line.unit === "шт" ? 0.1 : 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: index })
      }
    }
    await recipe(burger, 1, [{ kind: "preparation", id: sauce, unit: "кг", quantity: 0.05 }, { kind: "preparation", id: patty, unit: "шт", quantity: 1 }])
    await recipe(patty, 10, [{ kind: "preparation", id: mince, unit: "кг", quantity: 1.2 }])
    await recipe(mince, 1, [{ kind: "item", id: meat, unit: "кг", quantity: 1 }])
    await recipe(sauce, 1, [{ kind: "item", id: meat, unit: "кг", quantity: 0.1 }])
    const stock = (externalId: string, inventoryItemId: Id<"inventoryItems">, quantity: number) => applyStockMovement(ctx, { externalId, kind: "document", sourceModuleId: "test", sourceExternalId: externalId, sourceNumber: "0", warehouseId: kitchen, inventoryItemId, quantityDelta: quantity, unitCost: 1000, occurredAt: at("2026-09-01T10:00:00"), actorEmail: "t" })
    await stock("opening-meat", meat, 20)
    await stock("opening-sauce", sauceItem, 0.1)
    await stock("opening-patty", pattyItem, 1)
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeRoles", { externalId: "chef", name: "Шеф", capabilities: ["office.kitchen-plan.*", "office.semi-finished-sheet.*"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "chef", email: "chef@sandyq.test", name: "Шеф", roleExternalId: "chef", restaurantScopes: ["shymkent"], active: true })
    return { almaty, burger }
  })
  /** A paid order of `quantity` burgers at an Almaty moment, through the same facts the checkout writes. */
  const sell = (local: string, businessDate: string, quantity: number) =>
    t.run(async (ctx) => {
      const paidAt = at(local)
      const orderId = await ctx.db.insert("orders", { number: 1, orderType: "dine-in", status: "paid", discountPercent: 0, subtotal: 2000 * quantity, serviceChargePercent: 0, serviceChargeAmount: 0, total: 2000 * quantity, restaurantId: ids.almaty, createdAt: paidAt - 600_000, paidAt, businessDate, searchText: "" })
      await ctx.db.insert("orderLines", { orderId, productId: ids.burger, productExternalId: "burger", productName: "Бургер", quantity, unitPrice: 2000, modifiers: [] })
      await applyCheckoutFacts(ctx, (await ctx.db.get(orderId))!, 0)
    })
  return { t, sell, admin: t.withIdentity({ email: "admin@sandyq.test" }), chef: t.withIdentity({ email: "chef@sandyq.test" }) }
}

describe("kitchen forecast (W3-PRD-07)", () => {
  it("puts an order paid at 23:30 in Almaty into interval 94, not the server's UTC hour", async () => {
    const { sell, admin } = await setup()
    expect(intervalOf(at("2026-09-21T23:30:00"))).toBe(94)
    await sell("2026-09-21T23:30:00", "2026-09-21", 3)
    const forecast = await admin.query(logistics.queries.forecast, { restaurantExternalId: "almaty", targetDate: TARGET })
    expect(forecast.sourceDates).toEqual(sameWeekdayDates(TARGET))
    expect(forecast).toMatchObject({ weekday: 1, daysWithSales: 1 })
    expect(forecast.intervals[94]).toBe(1)
    expect(forecast.intervals[74]).toBe(0) // 18:30 UTC
    expect(forecast.products).toHaveLength(1)
    expect(forecast.products[0]).toMatchObject({ productExternalId: "burger", name: "Бургер", averageQuantity: 3, recommendedQuantity: 3 })
    expect(forecast.products[0].intervals[94]).toBe(3)
  })

  it("averages the same weekday over the days with sales and rounds the recommendation up", async () => {
    const { sell, admin } = await setup()
    await sell("2026-09-21T12:00:00", "2026-09-21", 5)
    await sell("2026-09-14T12:10:00", "2026-09-14", 2)
    await sell("2026-09-22T12:00:00", "2026-09-22", 40) // a Tuesday
    await sell("2026-08-10T12:00:00", "2026-08-10", 40) // seven weeks back
    const forecast = await admin.query(logistics.queries.forecast, { restaurantExternalId: "almaty", targetDate: TARGET })
    expect(forecast.daysWithSales).toBe(2)
    expect(forecast.products[0]).toMatchObject({ averageQuantity: 3.5, recommendedQuantity: 4 })
    expect(forecast.intervals[48]).toBe(1) // 12:00 and 12:10 — two orders over two days
  })

  it("needs a restaurant in the user's scope", async () => {
    const { chef } = await setup()
    await expect(chef.query(logistics.queries.forecast, { restaurantExternalId: "almaty", targetDate: TARGET })).rejects.toThrow(/Нет доступа к ресторану/)
    await expect(chef.query(logistics.queries.forecast, { restaurantExternalId: "shymkent", targetDate: "2026-02-30" })).rejects.toThrow(/Некорректная дата/)
  })

  it("makes the plan from the forecast in one step, once per day", async () => {
    const { sell, admin } = await setup()
    await expect(admin.mutation(logistics.mutations.createFromForecast, { moduleId: "kitchen-plan", restaurantExternalId: "almaty", targetDate: TARGET })).rejects.toThrow(/прогноз пуст/)
    await sell("2026-09-21T12:00:00", "2026-09-21", 4)
    const created = await admin.mutation(logistics.mutations.createFromForecast, { moduleId: "kitchen-plan", restaurantExternalId: "almaty", targetDate: TARGET })
    expect(created.existing).toBe(false)
    expect(await admin.mutation(logistics.mutations.createFromForecast, { moduleId: "kitchen-plan", restaurantExternalId: "almaty", targetDate: TARGET })).toEqual({ externalId: created.externalId, existing: true })
    const plan = (await admin.query(logistics.queries.getRecord, { externalId: created.externalId }))!
    expect(plan).toMatchObject({ moduleId: "kitchen-plan", status: "draft", businessDate: TARGET, restaurantName: "Алматы" })
    expect(plan.number).toMatch(/^ПК-2026-/)
    expect(plan.lines).toEqual([expect.objectContaining({ productExternalId: "burger", forecastQuantity: 4, plannedQuantity: 4 })])

    await admin.mutation(logistics.mutations.saveRecord, { externalId: plan.externalId, expectedVersion: plan.version, comment: "Праздник", lines: [{ productExternalId: "burger", plannedQuantity: 6 }] })
    await expect(admin.mutation(logistics.mutations.saveRecord, { externalId: plan.externalId, expectedVersion: plan.version, comment: "", lines: [{ productExternalId: "burger", plannedQuantity: 7 }] })).rejects.toThrow(/изменена другим/)
    await admin.mutation(logistics.mutations.transitionRecord, { externalId: plan.externalId, action: "approve", expectedVersion: plan.version + 1 })
    await expect(admin.mutation(logistics.mutations.transitionRecord, { externalId: plan.externalId, action: "post", expectedVersion: plan.version + 2 })).rejects.toThrow(/недоступно для этого раздела/)
    const list = await admin.query(logistics.queries.listRecords, { moduleId: "kitchen-plan", restaurantExternalId: "almaty", paginationOpts: { numItems: 20, cursor: null } })
    expect(list.page.map((row) => [row.number, row.status, row.lines.length, row.comment])).toEqual([[plan.number, "active", 1, "Праздник"]])
  })
})

describe("semi-finished sheet (W3-PRD-08)", () => {
  it("shows the same forecast as the plan panel and nets the need against stock, level by level", async () => {
    const { sell, admin } = await setup()
    await sell("2026-09-21T12:00:00", "2026-09-21", 5)
    await sell("2026-09-14T13:00:00", "2026-09-14", 2)
    const forecast = await admin.query(logistics.queries.forecast, { restaurantExternalId: "almaty", targetDate: TARGET })
    const sheetForecast = await admin.query(logistics.queries.forecast, { restaurantExternalId: "almaty", targetDate: TARGET, section: "semi-finished-sheet" })
    const requirement = await admin.query(logistics.queries.semiFinishedRequirement, { restaurantExternalId: "almaty", targetDate: TARGET })
    expect(requirement.forecast).toEqual(forecast)
    expect(sheetForecast).toEqual(forecast)
    // 4 burgers: sauce 4 × 0.05 = 0.2 kg − 0.1 on hand; patties 4 − 1; mince for the 3 patties still to make.
    expect(requirement.lines.map((line) => [line.productExternalId, line.forecastQuantity, line.onHand, line.plannedQuantity, line.canProduce])).toEqual([
      ["patty", 4, 1, 3, true],
      ["sauce", 0.2, 0.1, 0.1, true],
      ["mince", 0.36, 0, 0.36, true],
    ])
    expect(requirement.lines.find((line) => line.productExternalId === "mince")?.usedBy).toEqual(["Котлета"])
    expect(requirement.warehouses).toEqual([{ externalId: "kitchen", name: "Кухня", kind: "kitchen" }])
    expect(requirement.sheet).toBeNull()
  })

  it("creates production act drafts from the sheet, counts posted acts as the fact and freezes it on posting", async () => {
    const { t, sell, admin } = await setup()
    await sell("2026-09-21T12:00:00", "2026-09-21", 4)
    const { externalId } = await admin.mutation(logistics.mutations.createFromForecast, { moduleId: "semi-finished-sheet", restaurantExternalId: "almaty", targetDate: TARGET })
    const sheet = (await admin.query(logistics.queries.getRecord, { externalId }))!
    expect(sheet.number).toMatch(/^ВП-2026-/)
    expect(sheet.lines.map((line) => [line.productExternalId, line.plannedQuantity, line.actualQuantity])).toEqual([
      ["patty", 3, 0],
      ["sauce", 0.1, 0],
      ["mince", 0.36, 0],
    ])

    const act = await admin.mutation(logistics.mutations.createProductionAct, { externalId, sourceWarehouseExternalId: "kitchen", destinationWarehouseExternalId: "kitchen", productExternalIds: ["patty", "mince"] })
    expect(act).toMatchObject({ lines: 2, skipped: [] })
    const draft = (await admin.query(api.domains.production.documents.getDocument, { externalId: act.externalId }))!
    expect(draft).toMatchObject({ type: "production", status: "draft", restaurantExternalId: "almaty", comment: `По ведомости полуфабрикатов ${sheet.number}` })
    expect(draft.lines.map((line) => [line.productExternalId, line.quantity])).toEqual([["patty", 3], ["mince", 0.36]])
    expect(await t.run(async (ctx) => (await ctx.db.get(sheet._id))?.productionActExternalIds)).toEqual([act.externalId])

    // The act's date is the sheet's business day, so posting it is the sheet's fact.
    await admin.mutation(api.domains.production.documents.postDocument, { externalId: act.externalId, confirmShortage: true })
    const live = (await admin.query(logistics.queries.getRecord, { externalId }))!
    expect(live.lines.map((line) => [line.productExternalId, line.actualQuantity])).toEqual([["patty", 3], ["sauce", 0], ["mince", 0.36]])
    expect(live.acts).toEqual([expect.objectContaining({ externalId: act.externalId, status: "posted", positions: 2 })])
    // What is left is only the sauce.
    const second = await admin.mutation(logistics.mutations.createProductionAct, { externalId, sourceWarehouseExternalId: "kitchen", destinationWarehouseExternalId: "kitchen" })
    const sauceAct = (await admin.query(api.domains.production.documents.getDocument, { externalId: second.externalId }))!
    expect(sauceAct.lines.map((line) => [line.productExternalId, line.quantity])).toEqual([["sauce", 0.1]])

    await admin.mutation(logistics.mutations.transitionRecord, { externalId, action: "post", expectedVersion: (await admin.query(logistics.queries.getRecord, { externalId }))!.version })
    const posted = (await admin.query(logistics.queries.getRecord, { externalId }))!
    expect(posted.status).toBe("posted")
    await admin.mutation(api.domains.production.documents.postDocument, { externalId: second.externalId, confirmShortage: true })
    // Frozen: the sauce act posted after the sheet does not change it.
    const frozen = (await admin.query(logistics.queries.getRecord, { externalId }))!
    expect(frozen.lines.map((line) => line.actualQuantity)).toEqual([3, 0, 0.36])
    const list = await admin.query(logistics.queries.listRecords, { moduleId: "semi-finished-sheet", paginationOpts: { numItems: 20, cursor: null } })
    expect(list.page[0]).toMatchObject({ number: sheet.number, status: "posted", plannedCount: 3, doneCount: 2, unit: null })
    await expect(admin.mutation(logistics.mutations.transitionRecord, { externalId, action: "reverse", expectedVersion: posted.version })).rejects.toThrow(/причину/)
    await admin.mutation(logistics.mutations.transitionRecord, { externalId, action: "reverse", expectedVersion: posted.version, reason: "Пересчёт" })
    expect((await admin.query(logistics.queries.getRecord, { externalId }))?.status).toBe("reversed")
  })

  it("refuses an act for a preparation made from its ingredients on the spot", async () => {
    const { t, sell, admin } = await setup()
    await t.run(async (ctx) => {
      for (const externalId of ["patty", "sauce"]) {
        const product = (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())!
        await ctx.db.patch(product._id, { writeOffMethod: "ingredients" })
      }
    })
    await sell("2026-09-21T12:00:00", "2026-09-21", 4)
    const { externalId } = await admin.mutation(logistics.mutations.createFromForecast, { moduleId: "semi-finished-sheet", restaurantExternalId: "almaty", targetDate: TARGET })
    await expect(admin.mutation(logistics.mutations.createProductionAct, { externalId, sourceWarehouseExternalId: "kitchen", destinationWarehouseExternalId: "kitchen", productExternalIds: ["patty", "sauce"] })).rejects.toThrow(/не выпускаются актом: Котлета, Соус/)
    const act = await admin.mutation(logistics.mutations.createProductionAct, { externalId, sourceWarehouseExternalId: "kitchen", destinationWarehouseExternalId: "kitchen" })
    expect(act.skipped).toEqual(["Котлета", "Соус"])
  })
})
