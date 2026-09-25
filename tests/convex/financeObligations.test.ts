import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

const records = api.domains.finance.records
const obligations = api.domains.finance.obligations

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Бухгалтер", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  const base = { restaurantExternalId: "almaty", businessDate: "2026-09-20", amount: 0 }
  const counterparty = await admin.mutation(records.save, { ...base, moduleId: "counterparties", name: "ТОО Клининг", data: { roles: "supplier", bin: "123456789013", vatPayer: true } })
  const category = await admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", name: "Услуги", data: { code: "srv", direction: "outgoing", activity: "operating" } })
  return { admin, base, counterparty: counterparty.externalId, category: category.externalId }
}

describe("services, obligations and payments (W2-FIN-08/09/10)", () => {
  it("a received service posts net + VAT, creates a payable, and a payment settles it partly", async () => {
    const { t } = await setup()
    const { admin, base, counterparty, category } = await office(t)
    const act = await admin.mutation(records.save, { ...base, moduleId: "services", name: "Уборка сентябрь", amount: 112_000, counterpartyExternalId: counterparty, data: { serviceDirection: "received", vatRate: 12, dueDate: "2026-09-21" } })
    await admin.mutation(records.transition, { moduleId: "services", externalId: act.externalId, action: "post", expectedVersion: act.version })
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").take(10))
    expect(entries.map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount])).toEqual([
      ["acc-7210", "acc-3310", 100_000],
      ["acc-1420", "acc-3310", 12_000],
    ])
    const [obligation] = await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })
    expect(obligation).toMatchObject({ open: 112_000, original: 112_000 })
    expect(await admin.query(obligations.payablesSummary, {})).toMatchObject({ payable: 112_000, overdue: 112_000 })

    const payment = await admin.mutation(records.save, { ...base, moduleId: "payments", name: "Оплата клининга", amount: 50_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank" } })
    await expect(admin.mutation(obligations.setPaymentAllocations, { paymentExternalId: payment.externalId, allocations: [{ obligationExternalId: obligation.externalId, amount: 60_000 }] })).rejects.toThrow(/больше суммы/)
    await admin.mutation(obligations.setPaymentAllocations, { paymentExternalId: payment.externalId, allocations: [{ obligationExternalId: obligation.externalId, amount: 50_000 }] })
    let version = payment.version
    for (const action of ["submit", "approve", "post"] as const) version = (await admin.mutation(records.transition, { moduleId: "payments", externalId: payment.externalId, action, expectedVersion: version })).version
    expect((await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" }))[0].open).toBe(62_000)
    await expect(admin.mutation(records.transition, { moduleId: "services", externalId: act.externalId, action: "reverse", expectedVersion: act.version + 1, reason: "Ошибка" })).rejects.toThrow(/распределённые платежи/)

    await admin.mutation(records.transition, { moduleId: "payments", externalId: payment.externalId, action: "reverse", expectedVersion: version, reason: "Возврат" })
    expect((await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" }))[0].open).toBe(112_000)
    await admin.mutation(records.transition, { moduleId: "services", externalId: act.externalId, action: "reverse", expectedVersion: act.version + 1, reason: "Ошибка" })
    expect(await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })).toEqual([])
  })

  it("a document's obligation is reversed only with its document; a manual one is validated and paid without a counterparty match", async () => {
    const { t } = await setup()
    const { admin, base, counterparty, category } = await office(t)
    const act = await admin.mutation(records.save, { ...base, moduleId: "services", name: "Охрана", amount: 50_000, counterpartyExternalId: counterparty, data: { serviceDirection: "received", vatRate: 0 } })
    await admin.mutation(records.transition, { moduleId: "services", externalId: act.externalId, action: "post", expectedVersion: act.version })
    const [fromAct] = await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })
    const row = (await admin.query(records.get, { moduleId: "accounts-payable", externalId: fromAct.externalId }))!
    await expect(admin.mutation(records.transition, { moduleId: "accounts-payable", externalId: row.externalId, action: "reverse", expectedVersion: row.version, reason: "Ошибка" })).rejects.toThrow(/сторнируйте документ/)

    await expect(admin.mutation(records.save, { ...base, moduleId: "accounts-payable", name: "Штраф", amount: 10_000, data: {} })).rejects.toThrow(/вид задолженности/)
    const manual = await admin.mutation(records.save, { ...base, moduleId: "accounts-payable", name: "Налог на имущество", amount: 10_000, data: { direction: "payable", obligationKind: "tax" } })
    let version = manual.version
    for (const action of ["submit", "approve", "post"] as const) version = (await admin.mutation(records.transition, { moduleId: "accounts-payable", externalId: manual.externalId, action, expectedVersion: version })).version
    const open = await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })
    expect(open.find((item) => item.externalId === manual.externalId)).toMatchObject({ open: 10_000, original: 10_000 })
    const payment = await admin.mutation(records.save, { ...base, moduleId: "payments", name: "Налог", amount: 10_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank" } })
    await admin.mutation(obligations.setPaymentAllocations, { paymentExternalId: payment.externalId, allocations: [{ obligationExternalId: manual.externalId, amount: 10_000 }] })
  })

  it("a posted receipt owes its supplier; reversing the receipt cancels the obligation", async () => {
    const { t } = await setup()
    const { admin, counterparty } = await office(t)
    const { receiptId } = await t.run(async (ctx) => {
      const supplierId = await ctx.db.insert("suppliers", { externalId: "s1", name: "ТОО Мясо", bin: "123456789013", supplierType: "external", paymentDelayDays: 10, priceDeviationPolicy: "ignore", allowedDeviationPercent: 0, restaurantExternalIds: [], active: true, searchText: "мясо" })
      const warehouseId = await ctx.db.insert("warehouses", { externalId: "almaty-main", name: "Склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: true, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
      const itemId = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Мясо", nameSort: "мясо", searchText: "мясо", unit: "кг", kind: "ingredient", active: true })
      const receiptId = await ctx.db.insert("receipts", { externalId: "r1", number: "ПН-1", date: Date.parse("2026-09-20T10:00:00+05:00"), supplierId, warehouseId, restaurantExternalId: "almaty", organizationExternalId: "sandyq", invoiceNumber: "1", status: "draft", totalGross: 40_000, totalVat: 0, totalNet: 40_000, searchText: "", createdAt: 0, updatedAt: 0 })
      await ctx.db.insert("receiptLines", { receiptId, lineNo: 1, inventoryItemId: itemId, quantity: 10, unitCostGross: 4000, vatRate: 0, amountGross: 40_000 })
      return { receiptId }
    })
    await admin.mutation(api.domains.purchasing.receipts.postReceipt, { externalId: "r1" })
    const [obligation] = await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })
    expect(obligation).toMatchObject({ open: 40_000, dueDate: "2026-09-30", sourceNumber: "ПН-1" })
    await admin.mutation(api.domains.purchasing.receipts.reverseReceipt, { externalId: "r1", reason: "Возврат поставщику" })
    expect(await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })).toEqual([])
    expect(receiptId).toBeDefined()
  })
})

