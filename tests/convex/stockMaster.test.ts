import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const stock = api.domains.stock.master
const at = (local: string) => Date.parse(`${local}+05:00`)

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["almaty", "shymkent"]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "store", name: "Склад Алматы", capabilities: ["office.stock.view", "office.warehouses.view", "office.warehouses.edit", "office.units.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "store", email: "store@sandyq.test", name: "Кладовщик", roleExternalId: "store", restaurantScopes: ["almaty"], warehouseScopes: ["*"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), store: t.withIdentity({ email: "store@sandyq.test" }) }
}

const warehouse = (overrides: Record<string, unknown> = {}) => ({ name: "Кухня", shortName: "Кухня", restaurantExternalId: "almaty", kind: "kitchen" as const, allowNegativeStock: false, internalTransfers: true, isSalesDefault: false, active: true, ...overrides })

describe("units (W1-STK-03)", () => {
  it("checks coefficients, dimensions and cycles, and freezes a used unit", async () => {
    const { t, admin, store } = await setup()
    const kg = await admin.mutation(stock.saveUnit, { name: "Килограмм", shortName: "кг", dimension: "mass", precision: 3, coefficient: 1, active: true })
    await expect(admin.mutation(stock.saveUnit, { name: "Грамм", shortName: "г", dimension: "mass", precision: 0, coefficient: 0, baseUnitExternalId: kg, active: true })).rejects.toThrow(/больше нуля/)
    await expect(admin.mutation(stock.saveUnit, { name: "Мл", shortName: "мл", dimension: "volume", precision: 0, coefficient: 0.001, baseUnitExternalId: kg, active: true })).rejects.toThrow(/той же размерности/)
    await expect(admin.mutation(stock.saveUnit, { externalId: kg, name: "Килограмм", shortName: "кг", dimension: "mass", precision: 3, coefficient: 1, baseUnitExternalId: kg, active: true })).rejects.toThrow(/сама для себя/)
    await expect(store.mutation(stock.saveUnit, { name: "Упаковка", shortName: "уп", dimension: "count", precision: 0, coefficient: 10, active: true })).rejects.toThrow(/Недостаточно прав/)
    await admin.mutation(stock.saveInventoryItem, { name: "Конина", kind: "ingredient", unitExternalId: kg, active: true })
    await expect(admin.mutation(stock.saveUnit, { externalId: kg, name: "Килограмм", shortName: "кг", dimension: "mass", precision: 3, coefficient: 2, active: true })).rejects.toThrow(/уже используется/)
    const item = await t.run(async (ctx) => (await ctx.db.query("inventoryItems").collect())[0])
    expect(item).toMatchObject({ unit: "кг", unitExternalId: kg, kind: "ingredient" })
  })
})

describe("warehouses (W1-STK-04)", () => {
  it("keeps one sales warehouse per restaurant, the scope, and no deactivation with stock", async () => {
    const { t, admin, store } = await setup()
    const first = await store.mutation(stock.saveWarehouse, warehouse({ name: "Склад", kind: "storage", isSalesDefault: true }))
    const second = await store.mutation(stock.saveWarehouse, warehouse({ isSalesDefault: true }))
    const list = await store.query(stock.listWarehouses, { restaurantExternalId: "almaty" })
    expect(list.filter((row) => row.isSalesDefault).map((row) => row.externalId)).toEqual([second])
    await expect(store.mutation(stock.saveWarehouse, warehouse({ restaurantExternalId: "shymkent" }))).rejects.toThrow(/Нет доступа/)

    const kg = await admin.mutation(stock.saveUnit, { name: "Килограмм", shortName: "кг", dimension: "mass", precision: 3, coefficient: 1, active: true })
    const itemExternalId = await admin.mutation(stock.saveInventoryItem, { name: "Мука", kind: "ingredient", unitExternalId: kg, minimumStock: 5, active: true })
    await t.run(async (ctx) => {
      const warehouseRow = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", first)).unique())!
      const item = (await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", itemExternalId)).unique())!
      await applyStockMovement(ctx, { externalId: "r1", kind: "document", sourceModuleId: "receipts", sourceExternalId: "r", sourceNumber: "1", warehouseId: warehouseRow._id, inventoryItemId: item._id, quantityDelta: 3, unitCost: 300, occurredAt: at("2026-09-10T10:00:00") })
      await applyStockMovement(ctx, { externalId: "r2", kind: "document", sourceModuleId: "receipts", sourceExternalId: "r", sourceNumber: "1", warehouseId: warehouseRow._id, inventoryItemId: item._id, quantityDelta: 4, unitCost: 300, occurredAt: at("2026-09-20T10:00:00") })
    })
    await expect(store.mutation(stock.saveWarehouse, warehouse({ externalId: first, name: "Склад", kind: "storage", active: false }))).rejects.toThrow(/есть остатки/)
    await expect(admin.mutation(stock.saveInventoryItem, { externalId: itemExternalId, name: "Мука", kind: "ingredient", unitExternalId: kg, active: false })).rejects.toThrow(/есть остаток/)

    const now = await store.query(stock.listBalances, { paginationOpts: { numItems: 50, cursor: null } })
    expect(now.page[0]).toMatchObject({ quantity: 7, amount: 2100, belowMinimum: false })
    const past = await store.query(stock.listBalances, { at: at("2026-09-15T00:00:00"), filter: "belowMinimum", paginationOpts: { numItems: 50, cursor: null } })
    expect(past.page.map((row) => row.quantity)).toEqual([3])
  })
})

describe("suppliers (W1-STK-05)", () => {
  it("validates the BIN, keeps it unique and limits restaurants to the scope", async () => {
    const { admin, store } = await setup()
    const supplier = { name: "Мясной партнёр", bin: "123456789012", supplierType: "external" as const, vatPayer: true, priceDeviationPolicy: "warn" as const, allowedDeviationPercent: 5, restaurantExternalIds: ["almaty"], active: true }
    await expect(admin.mutation(stock.saveSupplier, { ...supplier, bin: "12345678901" })).rejects.toThrow(/12 цифр/)
    await expect(admin.mutation(stock.saveSupplier, { ...supplier, email: "not-an-email" })).rejects.toThrow(/email/)
    await admin.mutation(stock.saveSupplier, supplier)
    await expect(admin.mutation(stock.saveSupplier, { ...supplier, name: "Другой" })).rejects.toThrow(/таким БИН/)
    await expect(admin.mutation(stock.saveSupplier, { ...supplier, bin: "999999999999", restaurantExternalIds: ["nowhere"] })).resolves.toBeDefined()
    await expect(store.mutation(stock.saveSupplier, { ...supplier, bin: "111111111111" })).rejects.toThrow(/Недостаточно прав/)
  })
})
