import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

const records = api.domains.finance.records

async function withAccountant(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Бухгалтер", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
  })
  return t.withIdentity({ email: "admin@sandyq.test" })
}

const base = { restaurantExternalId: "almaty", businessDate: "2026-09-24", amount: 0 }

describe("finance modules (W1-FIN-03/04/05)", () => {
  it("cashflow categories: seed, direction of the parent, no cycles", async () => {
    const { t } = await setup()
    const admin = await withAccountant(t)
    expect((await t.mutation(internal.domains.finance.seed.seedCashflowCategories, {})).created).toBe(6)
    expect((await t.mutation(internal.domains.finance.seed.seedCashflowCategories, {})).created).toBe(0)
    const refs = await admin.query(records.references, { moduleId: "cashflow-categories" })
    expect(refs.cashflowCategories.map((row) => row.name)).toContain("Выручка от продаж")
    const parent = "cashflow-categories-sandyq-suppliers"
    await expect(admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", name: "Продажи бара", data: { code: "bar", direction: "incoming", activity: "operating", parentExternalId: parent } })).rejects.toThrow(/другого направления/)
    const child = await admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", name: "Мясо", data: { code: "meat", direction: "outgoing", activity: "operating", parentExternalId: parent } })
    const suppliers = (await admin.query(records.get, { moduleId: "cashflow-categories", externalId: parent }))!
    await expect(admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", externalId: parent, expectedVersion: suppliers.version, name: suppliers.name, data: { ...suppliers.data, parentExternalId: child.externalId } })).rejects.toThrow(/самой себя/)
  })

  it("references: every category and restaurant carries its organization, one set per organization", async () => {
    const { t } = await setup()
    const admin = await withAccountant(t)
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { externalId: "tary", name: "Tary", currency: "KZT", timezone: "Asia/Almaty", active: true })
      await ctx.db.insert("restaurants", { externalId: "tary-1", organizationExternalId: "tary", name: "Tary 1", address: "—", timezone: "Asia/Almaty", active: true })
    })
    expect((await t.mutation(internal.domains.finance.seed.seedCashflowCategories, {})).created).toBe(12)
    const refs = await admin.query(records.references, { moduleId: "payments" })
    expect(refs.restaurants).toEqual(expect.arrayContaining([expect.objectContaining({ externalId: "almaty", organizationExternalId: "sandyq" }), expect.objectContaining({ externalId: "tary-1", organizationExternalId: "tary" })]))
    // The same six names twice over all organizations; per organization — once.
    expect(refs.cashflowCategories.filter((row) => row.name === "Оплата поставщикам")).toHaveLength(2)
    const sandyq = refs.cashflowCategories.filter((row) => row.organizationExternalId === "sandyq")
    expect(sandyq).toHaveLength(6)
    expect(new Set(sandyq.map((row) => row.name)).size).toBe(6)
  })

  it("counterparties: 12-digit unique BIN and debt from posted receipts", async () => {
    const { t } = await setup()
    const admin = await withAccountant(t)
    const counterparty = { ...base, moduleId: "counterparties" as const, name: "ТОО Мясо", data: { roles: "supplier", bin: "123456789012", bankAccount: "KZ12 3456 7890 1234 5678", vatPayer: true } }
    await expect(admin.mutation(records.save, { ...counterparty, data: { ...counterparty.data, bin: "123" } })).rejects.toThrow(/12 цифр/)
    const saved = await admin.mutation(records.save, counterparty)
    await expect(admin.mutation(records.save, { ...counterparty, name: "Дубль" })).rejects.toThrow(/таким БИН/)
    await t.run(async (ctx) => {
      const supplierId = await ctx.db.insert("suppliers", { externalId: "s1", name: "ТОО Мясо", bin: "123456789012", supplierType: "external", priceDeviationPolicy: "ignore", allowedDeviationPercent: 0, restaurantExternalIds: [], active: true, searchText: "мясо" })
      const warehouseId = await ctx.db.insert("warehouses", { externalId: "main", name: "Склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
      await ctx.db.insert("receipts", { externalId: "r1", number: "ПН-1", date: Date.now(), supplierId, warehouseId, restaurantExternalId: "almaty", organizationExternalId: "sandyq", invoiceNumber: "1", status: "posted", totalGross: 50_000, totalVat: 0, totalNet: 50_000, searchText: "", createdAt: 0, updatedAt: 0 })
    })
    expect(await admin.query(api.domains.finance.queries.counterpartyDebt, { externalId: saved.externalId })).toMatchObject({ received: 50_000, paid: 0, debt: 50_000 })
  })

  it("a manual operation posts one journal line and reverses to zero; overview by account differs Dr/Cr", async () => {
    const { t, productId } = await setup()
    const admin = await withAccountant(t)
    const order = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: order.total }] })
    const today = (await t.run((ctx) => ctx.db.query("journalEntries").take(1)))[0].businessDate
    const operation = { moduleId: "transactions" as const, restaurantExternalId: "almaty", businessDate: today, name: "Инкассация в банк", amount: 1000, debitAccountExternalId: "acc-1030", creditAccountExternalId: "acc-1010", data: { comment: "" } }
    await expect(admin.mutation(records.save, { ...operation, amount: 0 })).rejects.toThrow(/больше нуля/)
    const saved = await admin.mutation(records.save, operation)
    const posted = await admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "post", expectedVersion: saved.version })
    const cash = await admin.query(api.domains.finance.queries.overview, { from: today, to: today, accountExternalId: "acc-1010" })
    expect(cash).toMatchObject({ mode: "account", debitTurnover: 2300, creditTurnover: 1000, balance: 1300 })
    const book = await admin.query(api.domains.finance.queries.overview, { from: today, to: today })
    expect(book).toMatchObject({ mode: "book", turnover: 2300 + 300 + 1000, entriesCount: 3 })
    const journal = await admin.query(api.domains.finance.queries.journal, { from: today, to: today, sourceModuleId: "transactions", paginationOpts: { numItems: 20, cursor: null } })
    expect(journal.page.map((row) => [row.debitAccount?.code, row.creditAccount?.code, row.amount])).toEqual([["1030", "1010", 1000]])
    await admin.mutation(records.transition, { moduleId: "transactions", externalId: saved.externalId, action: "reverse", expectedVersion: posted.version, reason: "Ошибка" })
    const after = await admin.query(api.domains.finance.queries.overview, { from: today, to: today, accountExternalId: "acc-1030" })
    expect(after.mode === "account" && after.balance).toBe(0)
  })
})

describe("shift acceptance (W1-FIN-06)", () => {
  it("closed shifts wait for acceptance; surplus and shortage post; idempotent; reversal brings it back", async () => {
    const { t, productId } = await setup()
    const admin = await withAccountant(t)
    const order = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300 }] })
    expect((await admin.query(api.domains.finance.shiftAcceptance.candidates, { paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([])
    const { shiftId } = await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 2300, note: "" })
    const [candidate] = (await admin.query(api.domains.finance.shiftAcceptance.candidates, { paginationOpts: { numItems: 20, cursor: null } })).page
    expect(candidate).toMatchObject({ shiftId, expectedCash: 2300, countedCash: 2300 })

    await expect(admin.mutation(api.domains.finance.shiftAcceptance.acceptShift, { shiftId, recountedCash: 2000, note: "" })).rejects.toThrow(/комментарий/)
    const id = await admin.mutation(api.domains.finance.shiftAcceptance.acceptShift, { shiftId, recountedCash: 2000, note: "Недостача 300" })
    expect(await admin.mutation(api.domains.finance.shiftAcceptance.acceptShift, { shiftId, recountedCash: 2000, note: "Недостача 300" })).toBe(id)
    const variance = (await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", `shift-variance-${shiftId}`)).unique()))!
    expect(variance).toMatchObject({ debitAccountExternalId: "acc-7480", creditAccountExternalId: "acc-1010", amount: 300 })
    expect((await admin.query(api.domains.finance.shiftAcceptance.candidates, { paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([])

    await admin.mutation(api.domains.finance.shiftAcceptance.reverseShiftAcceptance, { shiftId, reason: "Пересчёт" })
    expect((await admin.query(api.domains.finance.shiftAcceptance.candidates, { paginationOpts: { numItems: 20, cursor: null } })).page).toHaveLength(1)
    const surplus = await admin.mutation(api.domains.finance.shiftAcceptance.acceptShift, { shiftId, recountedCash: 2400, note: "Излишек" })
    expect(surplus).not.toBe(id)
  })
})
