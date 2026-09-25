import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import { applyStockMovement, reverseSourceMovements } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (date: string) => Date.parse(`${date}T12:00:00+05:00`)

describe("daily stock facts (W2-RPT-01)", () => {
  it("day flows add up to the balance; a reversal reduces its kind on its own day; M-9 skips counted movements", async () => {
    const t = convexTest(schema, modules)
    const { balance, facts } = await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
      const main = await ctx.db.insert("warehouses", { externalId: "main", name: "Основной", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
      const kitchen = await ctx.db.insert("warehouses", { externalId: "kitchen", name: "Кухня", shortName: "Кухня", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "kitchen", allowNegativeStock: false, internalTransfers: true, isSalesDefault: false, active: true, searchText: "кухня" })
      const meat = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", kind: "ingredient", active: true })
      const base = { inventoryItemId: meat, actorEmail: "t" }
      await applyStockMovement(ctx, { ...base, externalId: "r1", kind: "receipt", sourceModuleId: "receipts", sourceExternalId: "r1", sourceNumber: "ПН-1", warehouseId: main, quantityDelta: 10, unitCost: 4000, occurredAt: at("2026-09-01") })
      await applyStockMovement(ctx, { ...base, externalId: "w1", kind: "document", sourceModuleId: "writeoffs", sourceExternalId: "w1", sourceNumber: "СП-1", warehouseId: main, quantityDelta: -3, occurredAt: at("2026-09-10") })
      await applyStockMovement(ctx, { ...base, externalId: "t1:out", kind: "document", sourceModuleId: "transfers", sourceExternalId: "t1", sourceNumber: "ПРМ-1", warehouseId: main, quantityDelta: -2, occurredAt: at("2026-09-10") })
      await applyStockMovement(ctx, { ...base, externalId: "t1:in", kind: "document", sourceModuleId: "transfers", sourceExternalId: "t1", sourceNumber: "ПРМ-1", warehouseId: kitchen, quantityDelta: 2, unitCost: 4000, occurredAt: at("2026-09-10") })
      await reverseSourceMovements(ctx, { sourceExternalId: "w1", occurredAt: at("2026-09-11"), reversalKey: "reverse" })
      const balance = (await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", main).eq("inventoryItemId", meat)).unique())!
      const facts = await ctx.db.query("dailyStockFacts").withIndex("by_warehouse_item_date", (q) => q.eq("warehouseId", main).eq("inventoryItemId", meat)).collect()
      return { balance, facts }
    })
    expect(balance.quantity).toBe(8)
    expect(facts.reduce((sum, row) => sum + row.inQuantity - row.outQuantity, 0)).toBe(8)
    expect(facts.reduce((sum, row) => sum + row.inValue - row.outValue, 0)).toBe(8 * 4000)
    const day = (date: string) => facts.find((row) => row.businessDate === date)!
    expect(day("2026-09-10")).toMatchObject({ outQuantity: 5, byKind: expect.objectContaining({ writeoff: -3, transferOut: -2 }) })
    expect(day("2026-09-11")).toMatchObject({ inQuantity: 0, outQuantity: -3, byKind: expect.objectContaining({ writeoff: 3 }) })
    expect(await t.mutation(internal.migrations.m9DailyStockFacts.backfill, { paginationOpts: { numItems: 100, cursor: null } })).toMatchObject({ applied: 0 })
  })
})
