import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { SYSTEM_ACCOUNTS } from "../../convex/lib/accounts"
import { consumeOrderStock, reverseOrderConsumption } from "../../convex/lib/recipeConsumption"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const now = Date.parse("2026-09-24T12:00:00+05:00")


async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const warehouse = await ctx.db.insert("warehouses", { externalId: "main", name: "Склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
    const item = (externalId: string, kind: "ingredient" | "preparation", productExternalId?: string) =>
      ctx.db.insert("inventoryItems", { externalId, name: externalId, nameSort: externalId, searchText: externalId, unit: "кг", kind, active: true, ...(productExternalId ? { productExternalId } : {}) })
    const meat = await item("meat", "ingredient")
    const cheese = await item("cheese", "ingredient")
    const brothStock = await item("broth-stock", "preparation", "broth")
    for (const [id, cost] of [[meat, 4000], [cheese, 3000], [brothStock, 500]] as const) {
      await applyStockMovement(ctx, { externalId: `open-${id}`, kind: "document", sourceModuleId: "receipts", sourceExternalId: "open", sourceNumber: "0", warehouseId: warehouse, inventoryItemId: id, quantityDelta: 100, unitCost: cost, occurredAt: almatyDayStart("2026-09-01") })
    }
    return { warehouse, meat, cheese, brothStock }
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return { t, ids }
}

async function product(t: TestConvex<typeof schema>, externalId: string, extra: Record<string, unknown> = {}) {
  return t.run(async (ctx) => {
    let category = await ctx.db.query("categories").withIndex("by_external_id", (q) => q.eq("externalId", "hot")).unique()
    if (!category) await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
    return ctx.db.insert("products", { externalId, name: externalId, nameKk: externalId, nameSort: externalId, searchText: externalId, description: "", category: "hot", categorySort: 1, basePrice: 5000, popular: false, sku: externalId, baseUnit: "порц.", enabled: true, writeOffMethod: "ingredients", ...extra })
  })
}

async function recipe(t: TestConvex<typeof schema>, productId: Id<"products">, batchYield: number, lines: Array<{ inventoryItemId?: Id<"inventoryItems">; componentProductId?: Id<"products">; quantity: number; coldLossPercent?: number }>) {
  await t.run(async (ctx) => {
    const recipeId = await ctx.db.insert("recipes", { productId, createdAt: 1 })
    const versionId = await ctx.db.insert("recipeVersions", { recipeId, productId, version: 1, effectiveFrom: almatyDayStart("2026-09-01"), batchYield, technology: "", status: "active", createdBy: "t", createdAt: 1 })
    for (const [index, line] of lines.entries()) {
      await ctx.db.insert("recipeLines", { versionId, kind: line.componentProductId ? "preparation" : "item", ...(line.inventoryItemId ? { inventoryItemId: line.inventoryItemId } : {}), ...(line.componentProductId ? { componentProductId: line.componentProductId } : {}), name: "x", unit: "кг", quantity: line.quantity, unitWeightKg: 1, coldLossPercent: line.coldLossPercent ?? 0, hotLossPercent: 0, sortOrder: index })
    }
  })
}

async function sell(t: TestConvex<typeof schema>, lines: Array<{ productId: Id<"products">; quantity: number; sizeOptionId?: Id<"sizeOptions">; modifierSelections?: { externalId: string; name: string; quantity: number; unitPrice: number }[] }>, key = "k1") {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", { number: 7, orderType: "dine-in", status: "paid", discountPercent: 0, subtotal: 0, serviceChargePercent: 0, serviceChargeAmount: 0, total: 0, createdAt: now, updatedAt: now, searchText: "7", comment: "" } as never)
    for (const line of lines) await ctx.db.insert("orderLines", { orderId, productId: line.productId, productName: "x", quantity: line.quantity, unitPrice: 0, modifiers: [], ...(line.sizeOptionId ? { sizeOptionId: line.sizeOptionId } : {}), ...(line.modifierSelections ? { modifierSelections: line.modifierSelections } : {}) })
    const order = (await ctx.db.get(orderId))!
    const orderLines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", orderId)).collect()
    const result = await consumeOrderStock(ctx, { order, lines: orderLines, restaurantExternalId: "almaty", terminal: null, idempotencyKey: key, occurredAt: now })
    return { order, orderLines, ...result }
  })
}

const moved = (t: TestConvex<typeof schema>, orderId: Id<"orders">) => t.run((ctx) => ctx.db.query("stockMovements").withIndex("by_source", (q) => q.eq("sourceExternalId", String(orderId))).collect())

describe("sale write-off (W1-RCP-03)", () => {
  it("writes off the gross quantity for 2 portions and posts COGS equal to the movements", async () => {
    const { t, ids } = await setup()
    const beshbarmak = await product(t, "beshbarmak")
    await recipe(t, beshbarmak, 1, [{ inventoryItemId: ids.meat, quantity: 0.35, coldLossPercent: 30 }])
    const sale = await sell(t, [{ productId: beshbarmak, quantity: 2 }])
    const movements = await moved(t, sale.order._id)
    expect(movements.map((row) => row.quantityDelta)).toEqual([-0.7])
    expect(sale.cost).toBe(2800)
    const [cogs] = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", String(sale.order._id))).collect())
    expect(cogs).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.cogs.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.rawMaterials.externalId, amount: 2800 })
    await t.run(async (ctx) => consumeOrderStock(ctx, { order: sale.order, lines: sale.orderLines, restaurantExternalId: "almaty", terminal: null, idempotencyKey: "k1", occurredAt: now }))
    expect(await moved(t, sale.order._id)).toHaveLength(1)
  })

  it("scales by the size's write-off coefficient and adds modifier ingredients", async () => {
    const { t, ids } = await setup()
    const dish = await product(t, "plov")
    await recipe(t, dish, 1, [{ inventoryItemId: ids.meat, quantity: 0.2 }])
    const size = await t.run(async (ctx) => {
      const scaleId = await ctx.db.insert("sizeScales", { externalId: "s", name: "s", nameSort: "s", searchText: "s", sortOrder: 1 })
      return ctx.db.insert("sizeOptions", { externalId: "big", scaleId, label: "Большой", kitchenLabel: "Б", coefficient: 1.4, writeOffCoefficient: 1.5, sortOrder: 1, isDefault: false, available: true })
    })
    await t.run(async (ctx) => {
      const groupId = await ctx.db.insert("modifierGroups", { externalId: "g", name: "Добавки", nameSort: "добавки", searchText: "добавки", sortOrder: 1, active: true })
      await ctx.db.insert("modifiers", { externalId: "cheese-mod", groupId, name: "Сыр", nameSort: "сыр", searchText: "сыр", price: 400, ingredientInventoryItemId: ids.cheese, ingredientName: "Сыр", ingredientQuantity: 0.03, unit: "кг", available: true, sortOrder: 1 })
    })
    const sale = await sell(t, [{ productId: dish, quantity: 1, sizeOptionId: size, modifierSelections: [{ externalId: "cheese-mod", name: "Сыр", quantity: 2, unitPrice: 400 }] }])
    const movements = await moved(t, sale.order._id)
    expect(movements.map((row) => [row.inventoryItemId, row.quantityDelta])).toEqual([
      [ids.meat, -0.3],
      [ids.cheese, -0.06],
    ])
  })

  it("takes a finished-product preparation from its own stock, never its ingredients too", async () => {
    const { t, ids } = await setup()
    const broth = await product(t, "broth", { itemType: "preparation", writeOffMethod: "finished-product" })
    await recipe(t, broth, 10, [{ inventoryItemId: ids.meat, quantity: 2 }])
    const soup = await product(t, "sorpa")
    await recipe(t, soup, 1, [{ componentProductId: broth, quantity: 0.3 }])
    const sale = await sell(t, [{ productId: soup, quantity: 1 }])
    const movements = await moved(t, sale.order._id)
    expect(movements.map((row) => [row.inventoryItemId, row.quantityDelta])).toEqual([[ids.brothStock, -0.3]])
  })

  it("records a dish without a recipe instead of failing the sale", async () => {
    const { t } = await setup()
    const tea = await product(t, "tea")
    const sale = await sell(t, [{ productId: tea, quantity: 1 }])
    expect(sale.cost).toBe(0)
    const warnings = await t.run((ctx) => ctx.db.query("salesWithoutRecipe").withIndex("by_order", (q) => q.eq("orderId", sale.order._id)).collect())
    expect(warnings.map((row) => row.code)).toEqual(["no-recipe"])
  })

  it("a 50 % refund reverses half of the stock and half of the cost", async () => {
    const { t, ids } = await setup()
    const dish = await product(t, "beshbarmak")
    await recipe(t, dish, 1, [{ inventoryItemId: ids.meat, quantity: 0.5 }])
    const sale = await sell(t, [{ productId: dish, quantity: 2 }])
    await t.run((ctx) => reverseOrderConsumption(ctx, { order: sale.order, refundKey: "refund-1", share: 0.5, occurredAt: now + 1000 }))
    const movements = await moved(t, sale.order._id)
    expect(movements.map((row) => row.quantityDelta)).toEqual([-1, 0.5])
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", String(sale.order._id))).collect())
    expect(entries.map((row) => row.amount)).toEqual([4000, 2000])
  })
})
