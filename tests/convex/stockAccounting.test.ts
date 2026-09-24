import { convexTest, type TestConvex } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { applyStockMovement, reverseSourceMovements, type StockMovementInput } from "../../convex/lib/stockAccounting"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (local: string) => Date.parse(`${local}+05:00`)

afterEach(() => vi.useRealTimers())

async function setup(allowNegativeStock = false) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const warehouseId = await ctx.db.insert("warehouses", { externalId: "almaty-main", name: "Алматы · склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
    const itemId = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", active: true })
    return { warehouseId, itemId }
  })
  return { t, ...ids }
}

const move = (ids: { warehouseId: Id<"warehouses">; itemId: Id<"inventoryItems"> }, overrides: Partial<StockMovementInput>): StockMovementInput => ({
  externalId: crypto.randomUUID(),
  kind: "document",
  sourceModuleId: "receipts",
  sourceExternalId: "doc-1",
  sourceNumber: "ПН-1",
  warehouseId: ids.warehouseId,
  inventoryItemId: ids.itemId,
  quantityDelta: 1,
  occurredAt: at("2026-09-10T10:00:00"),
  ...overrides,
})

const balance = (t: TestConvex<typeof schema>, warehouseId: Id<"warehouses">, itemId: Id<"inventoryItems">) =>
  t.run(async (ctx) => (await ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouseId).eq("inventoryItemId", itemId)).unique())!)

describe("stock movements (W1-PLT-02)", () => {
  it("averages receipts, costs outflows at the average and ignores a repeat", async () => {
    const { t, warehouseId, itemId } = await setup()
    await t.run(async (ctx) => {
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "r1", quantityDelta: 10, unitCost: 4000 }))
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "r2", quantityDelta: 10, unitCost: 5000, occurredAt: at("2026-09-11T10:00:00") }))
      const out = await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "o1", quantityDelta: -4, occurredAt: at("2026-09-12T10:00:00"), sourceExternalId: "sale-1" }))
      expect(out).toMatchObject({ unitCost: 4500, amount: 18000, balanceAfter: 16 })
      const again = await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "o1", quantityDelta: -4 }))
      expect(again._id).toBe(out._id)
    })
    expect(await balance(t, warehouseId, itemId)).toMatchObject({ quantity: 16, averageUnitCost: 4500 })
  })

  it("refuses a negative balance unless allowed, and a reversal restores quantity and cost", async () => {
    const { t, warehouseId, itemId } = await setup()
    await t.run(async (ctx) => {
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "r1", quantityDelta: 2, unitCost: 4000 }))
      await expect(applyStockMovement(ctx, move({ warehouseId, itemId }, { quantityDelta: -3, occurredAt: at("2026-09-11T10:00:00") }))).rejects.toThrow(/Недостаточно остатка/)
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "o1", sourceExternalId: "sale-1", quantityDelta: -2, occurredAt: at("2026-09-11T10:00:00") }))
      await reverseSourceMovements(ctx, { sourceExternalId: "sale-1", occurredAt: at("2026-09-12T10:00:00"), reversalKey: "refund-1" })
      await reverseSourceMovements(ctx, { sourceExternalId: "sale-1", occurredAt: at("2026-09-12T10:00:00"), reversalKey: "refund-1" })
    })
    expect(await balance(t, warehouseId, itemId)).toMatchObject({ quantity: 2, averageUnitCost: 4000 })
  })

  it("re-chains later movements after a backdated one (B-12)", async () => {
    vi.useFakeTimers()
    const { t, warehouseId, itemId } = await setup(true)
    await t.run(async (ctx) => {
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "m1", quantityDelta: 10, unitCost: 1000, occurredAt: at("2026-09-01T10:00:00") }))
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "m2", quantityDelta: -5, occurredAt: at("2026-09-10T10:00:00") }))
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "m3", quantityDelta: 5, unitCost: 1000, occurredAt: at("2026-09-20T10:00:00") }))
      // Inserted between m1 and m2: 10 more at 2000 → average 1500 before m2.
      await applyStockMovement(ctx, move({ warehouseId, itemId }, { externalId: "late", quantityDelta: 10, unitCost: 2000, occurredAt: at("2026-09-05T10:00:00") }))
    })
    expect((await balance(t, warehouseId, itemId)).recalculating).toBe(true)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const [m2, m3] = await t.run(async (ctx) => [
      await ctx.db.query("stockMovements").withIndex("by_external_id", (q) => q.eq("externalId", "m2")).unique(),
      await ctx.db.query("stockMovements").withIndex("by_external_id", (q) => q.eq("externalId", "m3")).unique(),
    ])
    expect(m2).toMatchObject({ balanceAfter: 15, unitCost: 1500, amount: 7500 })
    expect(m3?.balanceAfter).toBe(20)
    expect(m3?.averageUnitCostAfter).toBeCloseTo((15 * 1500 + 5 * 1000) / 20, 6)
    expect(await balance(t, warehouseId, itemId)).toMatchObject({ quantity: 20, recalculating: false })
  })

  it("refuses a backdated movement into a closed period", async () => {
    const { t, warehouseId, itemId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("periodLocks", { externalId: "l", organizationExternalId: "sandyq", kind: "final", lockedThrough: almatyDayStart("2026-08-31"), active: true, reason: "Август", createdBy: "a", createdAt: 1 })
      await expect(applyStockMovement(ctx, move({ warehouseId, itemId }, { quantityDelta: 1, unitCost: 1, occurredAt: at("2026-08-20T10:00:00") }))).rejects.toThrow(/закрыт по 31\.08\.2026/)
    })
  })
})

describe("M-3 warehouses migration (W1-STK-02)", () => {
  it("creates main warehouses once, backfills rows and verifies with no mismatches", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (const externalId of ["almaty", "shymkent", "iiko-copy"]) {
        const restaurantId = await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
        if (externalId !== "iiko-copy") await ctx.db.insert("posTerminals", { externalId: `${externalId}-01`, restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
      }
      const itemId = await ctx.db.insert("inventoryItems", { externalId: "flour", name: "Мука", nameSort: "мука", searchText: "мука", unit: "кг", active: true })
      for (const restaurantExternalId of ["almaty", "iiko-copy"]) {
        await ctx.db.insert("stockBalances", { restaurantExternalId, inventoryItemId: itemId, quantity: 8, averageUnitCost: 300, updatedAt: 1 })
        await ctx.db.insert("stockMovements", { restaurantExternalId, inventoryItemId: itemId, kind: "receipt", quantityDelta: 10, unitCost: 300, balanceAfter: 10, averageUnitCostAfter: 300, actorEmail: "a", occurredAt: 1 })
        await ctx.db.insert("stockMovements", { restaurantExternalId, inventoryItemId: itemId, kind: "writeoff", quantityDelta: -2, unitCost: 300, balanceAfter: 8, averageUnitCostAfter: 300, reason: "Порча", actorEmail: "a", occurredAt: 2 })
      }
    })
    const m3 = internal.migrations.m3StockWarehouses
    const page = { numItems: 200, cursor: null }
    const dry = await t.mutation(m3.ensureMainWarehouses, { dryRun: true })
    expect(dry.created.sort()).toEqual(["almaty-main", "iiko-copy-main", "shymkent-main"])
    expect(await t.run((ctx) => ctx.db.query("warehouses").collect())).toHaveLength(0)
    await t.mutation(m3.ensureMainWarehouses, {})
    expect((await t.mutation(m3.ensureMainWarehouses, {})).created).toEqual([])
    await t.mutation(m3.backfillBalances, { paginationOpts: page })
    const movements = await t.mutation(m3.backfillMovements, { paginationOpts: page })
    expect(movements.patched).toBe(4)
    const report = await t.query(m3.verify, { paginationOpts: page })
    expect(report.mismatches).toEqual([])
    const [movement] = await t.run((ctx) => ctx.db.query("stockMovements").collect())
    expect(movement).toMatchObject({ sourceModuleId: "legacy-stock", amount: 3000 })
    expect(movement.externalId).toMatch(/^legacy-/)
  })
})
