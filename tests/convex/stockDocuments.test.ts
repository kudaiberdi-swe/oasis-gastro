import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { SYSTEM_ACCOUNTS } from "../../convex/lib/accounts"
import { applyStockMovement } from "../../convex/lib/stockAccounting"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const docs = api.domains.stockDocuments
const at = (local: string) => Date.parse(`${local}+05:00`)

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const warehouse = (externalId: string, name: string) =>
      ctx.db.insert("warehouses", { externalId, name, shortName: name, restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: externalId === "main", active: true, searchText: name })
    const main = await warehouse("main", "Основной")
    await warehouse("kitchen", "Кухня")
    const meat = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", kind: "ingredient", active: true })
    await applyStockMovement(ctx, { externalId: "open", kind: "document", sourceModuleId: "receipts", sourceExternalId: "open", sourceNumber: "0", warehouseId: main, inventoryItemId: meat, quantityDelta: 10, unitCost: 4000, occurredAt: at("2026-09-01T10:00:00") })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "clerk", name: "Кладовщик", capabilities: ["office.writeoffs.view", "office.writeoffs.edit", "office.writeoffs.post"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "clerk", email: "clerk@sandyq.test", name: "Кладовщик", roleExternalId: "clerk", restaurantScopes: ["almaty"], warehouseScopes: ["*"], active: true })
  })
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), clerk: t.withIdentity({ email: "clerk@sandyq.test" }) }
}

async function document(user: ReturnType<TestConvex<typeof schema>["withIdentity"]>, type: "writeoff" | "inventory" | "transfer", body: Record<string, unknown>) {
  const { externalId, number } = await user.mutation(docs.mutations.createDocument, { type, restaurantExternalId: "almaty" })
  await user.mutation(docs.mutations.saveDocument, { type, externalId, date: at("2026-09-10T12:00:00"), counterpartyName: "", reason: "", comment: "", lines: [], ...body })
  return { externalId, number }
}

const balance = (t: TestConvex<typeof schema>, warehouse: string) =>
  t.run(async (ctx) => {
    const row = (await ctx.db.query("warehouses").withIndex("by_external_id", (q) => q.eq("externalId", warehouse)).unique())!
    return ctx.db.query("stockBalances").withIndex("by_warehouse_item", (q) => q.eq("warehouseId", row._id)).first()
  })
const journal = (t: TestConvex<typeof schema>, source: string) => t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", source)).collect())

describe("stock documents (W1-STK-08)", () => {
  it("inventory: surplus debits stock, shortage credits it, zero lines post nothing", async () => {
    const { t, admin } = await setup()
    const surplus = await document(admin, "inventory", { sourceWarehouseExternalId: "main", lines: [{ itemExternalId: "meat", quantity: 0, actualQuantity: 12 }] })
    await admin.mutation(docs.mutations.postDocument, { type: "inventory", externalId: surplus.externalId })
    const [plus] = await journal(t, surplus.externalId)
    expect(plus).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.rawMaterials.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.otherIncome.externalId, amount: 8000 })
    const shortage = await document(admin, "inventory", { sourceWarehouseExternalId: "main", lines: [{ itemExternalId: "meat", quantity: 0, actualQuantity: 9 }] })
    await admin.mutation(docs.mutations.postDocument, { type: "inventory", externalId: shortage.externalId })
    const [minus] = await journal(t, shortage.externalId)
    expect(minus).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.inventoryVariance.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.rawMaterials.externalId, amount: 12000 })
    expect((await balance(t, "main"))?.quantity).toBe(9)
  })

  it("transfer moves stock at the source cost without doubling and without a journal entry", async () => {
    const { t, admin } = await setup()
    const transfer = await document(admin, "transfer", { sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "kitchen", lines: [{ itemExternalId: "meat", quantity: 3 }] })
    const result = await admin.mutation(docs.mutations.postDocument, { type: "transfer", externalId: transfer.externalId })
    expect(result.totalAmount).toBe(12000)
    expect(await balance(t, "kitchen")).toMatchObject({ quantity: 3, averageUnitCost: 4000 })
    expect(await journal(t, transfer.externalId)).toEqual([])
    await expect(document(admin, "transfer", { sourceWarehouseExternalId: "main", destinationWarehouseExternalId: "main", lines: [] })).rejects.toThrow(/различаться/)
  })

  it("a write-off needs a reason; its reversal restores stock and mirrors the entry; reversal needs its own right", async () => {
    const { t, admin, clerk } = await setup()
    await expect(document(clerk, "writeoff", { sourceWarehouseExternalId: "main", lines: [{ itemExternalId: "meat", quantity: 1 }] })).rejects.toThrow(/причину/)
    const writeoff = await document(clerk, "writeoff", { sourceWarehouseExternalId: "main", reason: "Порча при хранении", lines: [{ itemExternalId: "meat", quantity: 2 }] })
    await clerk.mutation(docs.mutations.postDocument, { type: "writeoff", externalId: writeoff.externalId })
    await expect(clerk.mutation(docs.mutations.saveDocument, { type: "writeoff", externalId: writeoff.externalId, date: at("2026-09-10T12:00:00"), sourceWarehouseExternalId: "main", counterpartyName: "", reason: "Порча", comment: "", lines: [] })).rejects.toThrow(/только сторнировать/)
    await expect(clerk.mutation(docs.mutations.reverseDocument, { type: "writeoff", externalId: writeoff.externalId, reason: "Ошибка" })).rejects.toThrow(/Недостаточно прав/)
    await admin.mutation(docs.mutations.reverseDocument, { type: "writeoff", externalId: writeoff.externalId, reason: "Ошибка количества" })
    expect((await balance(t, "main"))?.quantity).toBe(10)
    const entries = await journal(t, writeoff.externalId)
    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ debitAccountExternalId: entries[0].creditAccountExternalId, creditAccountExternalId: entries[0].debitAccountExternalId, amount: 8000 })
    const card = await admin.query(docs.queries.getDocument, { type: "writeoff", externalId: writeoff.externalId })
    expect(card).toMatchObject({ status: "reversed", reverseReason: "Ошибка количества" })
    // The draft of the first, rejected attempt already took 00001: numbers are assigned at creation.
    expect(writeoff.number).toBe("СП-2026-00002")
  })

  it("refuses more than the stock and a closed period", async () => {
    const { t, admin } = await setup()
    const big = await document(admin, "writeoff", { sourceWarehouseExternalId: "main", reason: "Проверка", lines: [{ itemExternalId: "meat", quantity: 50 }] })
    await expect(admin.mutation(docs.mutations.postDocument, { type: "writeoff", externalId: big.externalId })).rejects.toThrow(/Недостаточно остатка/)
    await t.run((ctx) => ctx.db.insert("periodLocks", { externalId: "l", organizationExternalId: "sandyq", kind: "final", lockedThrough: at("2026-09-15T00:00:00"), active: true, reason: "Сентябрь", createdBy: "a", createdAt: 1 }))
    await expect(admin.mutation(docs.mutations.postDocument, { type: "writeoff", externalId: big.externalId })).rejects.toThrow(/закрыт/)
  })
})

describe("outgoing invoices and supplier returns (W2-STK-13)", () => {
  const obligation = (t: TestConvex<typeof schema>, externalId: string) => t.run((ctx) => ctx.db.query("financeRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())

  it("a return based on a receipt shrinks its bill, can't exceed what was received, and reversal restores it", async () => {
    const { t, admin } = await setup()
    await t.run((ctx) => ctx.db.insert("suppliers", { externalId: "partner", name: "Мясной партнёр", bin: "", supplierType: "external", vatPayer: false, priceDeviationPolicy: "ignore", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true, searchText: "мясной" }))
    const receipts = api.domains.purchasing.receipts
    const { externalId: receipt } = await admin.mutation(receipts.createReceiptDraft, { supplierExternalId: "partner", warehouseExternalId: "main" })
    await admin.mutation(receipts.saveReceipt, { externalId: receipt, date: at("2026-09-05T10:00:00"), supplierExternalId: "partner", warehouseExternalId: "main", invoiceNumber: "INV-7", lines: [{ itemExternalId: "meat", quantity: 5, unitCostGross: 4400, vatRate: 0 }] })
    await admin.mutation(receipts.postReceipt, { externalId: receipt })
    const bill = `obligation:receipts:${receipt}:main`
    expect(await obligation(t, bill)).toMatchObject({ amount: 22000 })

    const body = (quantity: number) => ({ sourceWarehouseExternalId: "main", supplierExternalId: "partner", receiptExternalId: receipt, lines: [{ itemExternalId: "meat", quantity }] })
    const create = async (quantity: number) => {
      const { externalId } = await admin.mutation(docs.mutations.createDocument, { type: "supplier-return", restaurantExternalId: "almaty" })
      await admin.mutation(docs.mutations.saveDocument, { type: "supplier-return", externalId, date: at("2026-09-10T12:00:00"), counterpartyName: "", reason: "Брак", comment: "", ...body(quantity) })
      return externalId
    }
    const first = await create(2)
    const { totalAmount } = await admin.mutation(docs.mutations.postDocument, { type: "supplier-return", externalId: first })
    expect(totalAmount).toBe(Math.round((2 * (10 * 4000 + 5 * 4400)) / 15))
    expect(await obligation(t, bill)).toMatchObject({ amount: 22000 - totalAmount! })
    expect(await balance(t, "main")).toMatchObject({ quantity: 13 })
    const [entry] = await journal(t, first)
    expect(entry).toMatchObject({ debitAccountExternalId: SYSTEM_ACCOUNTS.payables.externalId, creditAccountExternalId: SYSTEM_ACCOUNTS.rawMaterials.externalId, amount: totalAmount })

    const second = await create(4)
    await expect(admin.mutation(docs.mutations.postDocument, { type: "supplier-return", externalId: second })).rejects.toThrow(/больше полученного/)
    await expect(admin.mutation(receipts.reverseReceipt, { externalId: receipt, reason: "Ошибка" })).rejects.toThrow(/Сначала/)

    await admin.mutation(docs.mutations.reverseDocument, { type: "supplier-return", externalId: first, reason: "Ошибка" })
    expect(await obligation(t, bill)).toMatchObject({ amount: 22000 })
    expect(await balance(t, "main")).toMatchObject({ quantity: 15 })
  })

  it("an outgoing invoice with sale prices books COGS at cost, revenue at price, and the buyer's debt", async () => {
    const { t, admin } = await setup()
    const { externalId } = await admin.mutation(docs.mutations.createDocument, { type: "outgoing-invoice", restaurantExternalId: "almaty" })
    await admin.mutation(docs.mutations.saveDocument, { type: "outgoing-invoice", externalId, date: at("2026-09-10T12:00:00"), sourceWarehouseExternalId: "main", counterpartyName: "Кафе «Жол»", reason: "", comment: "", lines: [{ itemExternalId: "meat", quantity: 2, salePrice: 6000 }] })
    expect(await admin.mutation(docs.mutations.postDocument, { type: "outgoing-invoice", externalId })).toMatchObject({ totalAmount: 8000 })
    const entries = await journal(t, externalId)
    expect(entries.map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount]).sort()).toEqual([
      [SYSTEM_ACCOUNTS.cogs.externalId, SYSTEM_ACCOUNTS.rawMaterials.externalId, 8000],
      [SYSTEM_ACCOUNTS.receivables.externalId, SYSTEM_ACCOUNTS.revenue.externalId, 12000],
    ].sort())
    expect(await obligation(t, `obligation:outgoing-invoices:${externalId}:main`)).toMatchObject({ amount: 12000, status: "posted", data: expect.objectContaining({ direction: "receivable" }) })
    await admin.mutation(docs.mutations.reverseDocument, { type: "outgoing-invoice", externalId, reason: "Ошибка" })
    expect(await obligation(t, `obligation:outgoing-invoices:${externalId}:main`)).toMatchObject({ status: "reversed", amount: 0 })
  })
})
