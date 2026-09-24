import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { SYSTEM_ACCOUNTS } from "../../convex/lib/accounts"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const receipts = api.domains.purchasing.receipts
const at = (local: string) => Date.parse(`${local}+05:00`)

async function setup(options: { vatPayer?: boolean; policy?: "ignore" | "warn" | "block" | "block-higher" } = {}) {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true, vatPayer: options.vatPayer ?? false })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("warehouses", { externalId: "main", name: "Основной", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
    await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", kind: "ingredient", active: true })
    await ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "123456789012", supplierType: "external", vatPayer: true, priceDeviationPolicy: options.policy ?? "warn", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной партнёр" })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }) }
}

async function receive(admin: ReturnType<TestConvex<typeof schema>["withIdentity"]>, lines: { quantity: number; unitCostGross: number; vatRate?: number }[], date = at("2026-09-10T10:00:00")) {
  const { externalId } = await admin.mutation(receipts.createReceiptDraft, { supplierExternalId: "partner", warehouseExternalId: "main" })
  await admin.mutation(receipts.saveReceipt, { externalId, date, supplierExternalId: "partner", warehouseExternalId: "main", invoiceNumber: "INV-1", lines: lines.map((line) => ({ itemExternalId: "meat", vatRate: 0, ...line })) })
  return externalId
}

const balance = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const warehouse = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", "main")).unique())!
    return ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", warehouse._id)).first()
  })
const journal = (t: TestConvex<typeof schema>, source: string) => t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", source)).collect())

describe("receipts (W1-STK-10)", () => {
  it("averages two receipts at different prices and posts payables equal to the gross total", async () => {
    const { t, admin } = await setup()
    const first = await receive(admin, [{ quantity: 10, unitCostGross: 4000 }])
    await admin.mutation(receipts.postReceipt, { externalId: first })
    const second = await receive(admin, [{ quantity: 10, unitCostGross: 4400 }], at("2026-09-11T10:00:00"))
    const result = await admin.mutation(receipts.postReceipt, { externalId: second })
    expect(result.warnings).toEqual([])
    expect(await balance(t)).toMatchObject({ quantity: 20, averageUnitCost: 4200 })
    const entries = await journal(t, second)
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(44000)
    expect(entries[0]).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.rawMaterials.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.payables.externalId })
    await admin.mutation(receipts.postReceipt, { externalId: second })
    expect(await t.run((ctx) => ctx.db.query("stockLots").collect())).toHaveLength(2)
  })

  it("posts VAT only when both the organization and the supplier pay VAT", async () => {
    const payer = await setup({ vatPayer: true })
    const withVat = await receive(payer.admin, [{ quantity: 1, unitCostGross: 11200, vatRate: 12 }])
    await payer.admin.mutation(receipts.postReceipt, { externalId: withVat })
    const entries = await journal(payer.t, withVat)
    expect(entries.map((entry) => [entry.debitAccountExternalId, entry.amount])).toEqual([
      [SYSTEM_ACCOUNTS.rawMaterials.externalId, 10000],
      [SYSTEM_ACCOUNTS.vatRecoverable.externalId, 1200],
    ])
    expect((await balance(payer.t))?.averageUnitCost).toBe(10000)

    const nonPayer = await setup({ vatPayer: false })
    const gross = await receive(nonPayer.admin, [{ quantity: 1, unitCostGross: 11200, vatRate: 12 }])
    await nonPayer.admin.mutation(receipts.postReceipt, { externalId: gross })
    expect((await journal(nonPayer.t, gross)).map((entry) => entry.amount)).toEqual([11200])
  })

  it("a posted receipt can't be saved (B-E1) or reversed after its goods were used", async () => {
    const { t, admin } = await setup()
    const receipt = await receive(admin, [{ quantity: 5, unitCostGross: 4000 }])
    await admin.mutation(receipts.postReceipt, { externalId: receipt })
    await expect(admin.mutation(receipts.saveReceipt, { externalId: receipt, date: at("2026-09-10T10:00:00"), supplierExternalId: "partner", warehouseExternalId: "main", invoiceNumber: "X", lines: [] })).rejects.toThrow(/только сторнировать/)
    await t.run(async (ctx) => {
      const warehouse = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", "main")).unique())!
      const item = (await ctx.db.query("inventoryItems").withIndex("by_external_id", (q) => q.eq("externalId", "meat")).unique())!
      await applyStockMovement(ctx, { externalId: "sale", kind: "sale", sourceModuleId: "orders", sourceExternalId: "order-1", sourceNumber: "1", warehouseId: warehouse._id, inventoryItemId: item._id, quantityDelta: -2, occurredAt: at("2026-09-11T10:00:00") })
    })
    await expect(admin.mutation(receipts.reverseReceipt, { externalId: receipt, reason: "Ошибка поставки" })).rejects.toThrow(/израсходован/)
  })

  it("reverses a receipt that was not used", async () => {
    const { t, admin } = await setup()
    const receipt = await receive(admin, [{ quantity: 5, unitCostGross: 4000 }])
    await admin.mutation(receipts.postReceipt, { externalId: receipt })
    await admin.mutation(receipts.reverseReceipt, { externalId: receipt, reason: "Возврат всей поставки" })
    expect((await balance(t))?.quantity).toBe(0)
    expect((await journal(t, receipt)).map((entry) => entry.amount)).toEqual([20000, 20000])
  })

  it("blocks a price outside the supplier's allowance", async () => {
    const { admin } = await setup({ policy: "block" })
    await admin.mutation(receipts.postReceipt, { externalId: await receive(admin, [{ quantity: 10, unitCostGross: 4000 }]) })
    const expensive = await receive(admin, [{ quantity: 1, unitCostGross: 6000 }], at("2026-09-11T10:00:00"))
    await expect(admin.mutation(receipts.postReceipt, { externalId: expensive })).rejects.toThrow(/отклоняется на 50 %/)
  })
})
