import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { verdictFor } from "../../convex/lib/priceListCheck"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const lists = api.domains.stock.priceLists
const receipts = api.domains.purchasing.receipts
const at = (local: string) => Date.parse(`${local}+05:00`)

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("warehouses", { externalId: "main", name: "Основной", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
    await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", kind: "ingredient", active: true })
    await ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "", supplierType: "external", vatPayer: false, priceDeviationPolicy: "ignore", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной партнёр" })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }) }
}

const body = (price: number, deviationPolicy: "warn" | "block-higher") => ({ name: "Закупочные цены", kind: "supplier" as const, supplierExternalId: "partner", effectiveFrom: at("2026-09-01T00:00:00"), deviationPolicy, deviationPercent: 5, lines: [{ inventoryItemExternalId: "meat", supplierSku: "K-1", supplierName: "Конина мякоть", packageCoefficient: 10, price }] })

describe("price lists (W2-CAT-15)", () => {
  it("block-higher blocks a price 6 % above at 5 % tolerance, warns 6 % below", () => {
    expect(verdictFor("block-higher", 6, 5)).toBe("block")
    expect(verdictFor("block-higher", -6, 5)).toBe("warn")
    expect(verdictFor("warn", 4, 5)).toBe("ok")
  })

  it("editing a published list opens v2; publishing it expires v1; receipts are checked against the list", async () => {
    const { admin } = await setup()
    const v1 = await admin.mutation(lists.savePriceList, body(40000, "block-higher"))
    await admin.mutation(lists.publishPriceList, { externalId: v1.externalId })

    const { externalId: receipt } = await admin.mutation(receipts.createReceiptDraft, { supplierExternalId: "partner", warehouseExternalId: "main" })
    const save = (unitCostGross: number) => admin.mutation(receipts.saveReceipt, { externalId: receipt, date: at("2026-09-10T10:00:00"), supplierExternalId: "partner", warehouseExternalId: "main", invoiceNumber: "INV-1", lines: [{ itemExternalId: "meat", quantity: 5, unitCostGross, vatRate: 0 }] })
    await save(4240)
    expect((await admin.query(receipts.getReceipt, { externalId: receipt }))?.priceChecks[0]).toMatchObject({ reference: 4000, deviationPercent: 6, outcome: "block" })
    await expect(admin.mutation(receipts.postReceipt, { externalId: receipt })).rejects.toThrow(/отклоняется на 6/)

    const v2 = await admin.mutation(lists.savePriceList, { ...body(42500, "warn"), externalId: v1.externalId })
    expect(v2.version).toBe(2)
    expect((await admin.mutation(lists.savePriceList, { ...body(42500, "warn"), externalId: v1.externalId })).externalId).toBe(v2.externalId)
    await admin.mutation(lists.publishPriceList, { externalId: v2.externalId })
    expect((await admin.query(lists.getPriceList, { externalId: v1.externalId }))?.status).toBe("expired")
    expect((await admin.query(receipts.getReceipt, { externalId: receipt }))?.priceChecks[0]).toMatchObject({ reference: 4250, outcome: "ok" })
    await save(4600)
    expect((await admin.query(receipts.getReceipt, { externalId: receipt }))?.priceChecks[0]).toMatchObject({ outcome: "warn" })
    expect((await admin.mutation(receipts.postReceipt, { externalId: receipt })).warnings.length).toBeGreaterThan(0)
  })
})
