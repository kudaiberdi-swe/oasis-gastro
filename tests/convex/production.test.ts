import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const docs = api.domains.production.documents
const at = (local: string) => Date.parse(`${local}+05:00`)
const DATE = at("2026-09-20T10:00:00")

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
    const item = (externalId: string) => ctx.db.insert("inventoryItems", { externalId, name: externalId, nameSort: externalId, searchText: externalId, unit: "кг", kind: "ingredient", active: true })
    const meat = await item("meat")
    await item("fillet")
    await item("bones")
    const broth = await ctx.db.insert("products", { externalId: "broth", name: "Бульон", nameKk: "Сорпа", nameSort: "бульон", searchText: "бульон", description: "", category: "prep", categorySort: 1, basePrice: 0, popular: false, sku: "B", baseUnit: "кг", enabled: true })
    const recipeId = await ctx.db.insert("recipes", { productId: broth, createdAt: 1 })
    const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId: broth, version: 1, effectiveFrom: at("2026-09-01T00:00:00"), batchYield: 10, technology: "", status: "active", createdBy: "t", createdAt: 1 })
    await ctx.db.insert("recipeLines", { versionId, kind: "item", inventoryItemId: meat, name: "meat", unit: "кг", quantity: 4, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, sortOrder: 0 })
    await applyStockMovement(ctx, { externalId: "opening", kind: "document", sourceModuleId: "test", sourceExternalId: "opening", sourceNumber: "0", warehouseId: main, inventoryItemId: meat, quantityDelta: 10, unitCost: 4000, occurredAt: at("2026-09-01T10:00:00"), actorEmail: "t" })
    await ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "123456789012", supplierType: "external", vatPayer: false, priceDeviationPolicy: "ignore", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной партнёр", minimumOrder: 100000 })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    return { main, kitchen, meat }
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), ...ids }
}

const balanceOf = (t: TestConvex<typeof schema>, warehouse: string, item: string) =>
  t.run(async (ctx) => {
    const w = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", warehouse)).unique())!
    const i = (await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", item)).unique())!
    return ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", w._id).eq("inventoryItemId", i._id as Id<"inventoryItems">)).unique()
  })
const journal = (t: TestConvex<typeof schema>, source: string) => t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", source)).collect())

describe("production acts (W2-PRD-01/02)", () => {
  it("asks to confirm shortages, then produces at the ingredients' cost and reverses", async () => {
    const { t, admin } = await setup()
    await expect(admin.mutation(docs.saveDocument, { type: "production", restaurantExternalId: "almaty", date: DATE, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", comment: "", lines: [{ productExternalId: "broth", quantity: 5 }] })).rejects.toThrow(/только заготовку/)
    const prep = await admin.mutation(api.domains.production.preparations.savePreparation, { productExternalId: "broth", unit: "кг", writeOffMethod: "finished-product" })
    expect(prep).toBe("prep-broth")

    const big = await admin.mutation(docs.saveDocument, { type: "production", restaurantExternalId: "almaty", date: DATE, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", comment: "", lines: [{ productExternalId: "broth", quantity: 50 }] })
    expect(await admin.mutation(docs.postDocument, { externalId: big.externalId })).toEqual({ kind: "shortage-confirmation", shortages: [{ inventoryItemExternalId: "meat", name: "meat", needed: 20, onHand: 10 }] })
    await admin.mutation(docs.transitionDocument, { externalId: big.externalId, action: "cancel", reason: "Много" })

    const { externalId } = await admin.mutation(docs.saveDocument, { type: "production", restaurantExternalId: "almaty", date: DATE, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", comment: "Утро", lines: [{ productExternalId: "broth", quantity: 5 }] })
    expect(await admin.mutation(docs.postDocument, { externalId })).toEqual({ kind: "posted", totalAmount: 8000 })
    expect(await balanceOf(t, "main", "meat")).toMatchObject({ quantity: 8 })
    expect(await balanceOf(t, "kitchen", "prep-broth")).toMatchObject({ quantity: 5, averageUnitCost: 1600 })
    const [entry] = await journal(t, externalId)
    expect(entry).toMatchObject({ debitAccountExternalId: "acc-1320", amount: 8000 })

    await admin.mutation(docs.reverseDocument, { externalId, reason: "Ошибка" })
    expect(await balanceOf(t, "main", "meat")).toMatchObject({ quantity: 10 })
    expect(await balanceOf(t, "kitchen", "prep-broth")).toMatchObject({ quantity: 0 })
    expect((await journal(t, externalId)).reduce((sum, row) => sum + (row.reversalOf ? -row.amount : row.amount), 0)).toBe(0)
  })

  it("splits a processing act's cost by share", async () => {
    const { t, admin } = await setup()
    const { externalId } = await admin.mutation(docs.saveDocument, {
      type: "processing", restaurantExternalId: "almaty", date: DATE, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", comment: "",
      lines: [{ inventoryItemExternalId: "meat", quantity: 2, direction: "input" }, { inventoryItemExternalId: "fillet", quantity: 1.5, direction: "output", costShare: 3 }, { inventoryItemExternalId: "bones", quantity: 0.5, direction: "output", costShare: 1 }],
    })
    expect(await admin.mutation(docs.postDocument, { externalId })).toMatchObject({ totalAmount: 8000 })
    expect(await balanceOf(t, "kitchen", "fillet")).toMatchObject({ quantity: 1.5, averageUnitCost: 4000 })
    expect(await balanceOf(t, "kitchen", "bones")).toMatchObject({ quantity: 0.5, averageUnitCost: 4000 })
  })
})

describe("internal and purchase orders (W2-PRD-05/06)", () => {
  it("moves stock between restaurants at the source's cost through the inter-branch account", async () => {
    const { t, admin } = await setup()
    const { externalId } = await admin.mutation(docs.saveDocument, { type: "internal-order", restaurantExternalId: "almaty", date: DATE, sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "sh-main", comment: "", lines: [{ inventoryItemExternalId: "meat", quantity: 3 }] })
    await expect(admin.mutation(docs.postDocument, { externalId })).rejects.toThrow(/согласованный/)
    await admin.mutation(docs.transitionDocument, { externalId, action: "submit" })
    await admin.mutation(docs.transitionDocument, { externalId, action: "approve" })
    expect(await admin.mutation(docs.postDocument, { externalId })).toMatchObject({ totalAmount: 12000 })
    expect(await balanceOf(t, "sh-main", "meat")).toMatchObject({ quantity: 3, averageUnitCost: 4000 })
    const entries = await journal(t, externalId)
    expect(entries.map((row) => [row.restaurantExternalId, row.debitAccountExternalId, row.creditAccountExternalId, row.amount]).sort()).toEqual([
      ["almaty", "acc-1280", "acc-1310", 12000],
      ["shymkent", "acc-1310", "acc-1280", 12000],
    ])
  })

  it("turns an approved purchase order into a receipt and completes it on posting", async () => {
    const { t, admin } = await setup()
    const saved = await admin.mutation(docs.saveDocument, { type: "purchase-order", restaurantExternalId: "almaty", date: DATE, destinationWarehouseExternalId: "main", supplierExternalId: "partner", expectedDate: at("2026-09-22T10:00:00"), comment: "", lines: [{ inventoryItemExternalId: "meat", quantity: 5, expectedUnitCost: 4200 }] })
    expect(saved.warnings).toEqual(["Минимальный заказ поставщика — 100000 ₸"])
    await expect(admin.mutation(docs.createReceiptFromPurchaseOrder, { externalId: saved.externalId })).rejects.toThrow(/согласованному/)
    await admin.mutation(docs.transitionDocument, { externalId: saved.externalId, action: "submit" })
    await admin.mutation(docs.transitionDocument, { externalId: saved.externalId, action: "approve" })
    const receipt = await admin.mutation(docs.createReceiptFromPurchaseOrder, { externalId: saved.externalId })
    expect(await admin.mutation(docs.createReceiptFromPurchaseOrder, { externalId: saved.externalId })).toBe(receipt)
    await admin.mutation(api.domains.purchasing.receipts.postReceipt, { externalId: receipt })
    expect(await balanceOf(t, "main", "meat")).toMatchObject({ quantity: 15 })
    expect((await admin.query(docs.getDocument, { externalId: saved.externalId }))?.status).toBe("completed")
    await admin.mutation(api.domains.purchasing.receipts.reverseReceipt, { externalId: receipt, reason: "Брак" })
    expect((await admin.query(docs.getDocument, { externalId: saved.externalId }))?.status).toBe("approved")
  })
})
