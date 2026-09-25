import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api } from "../../convex/_generated/api"
import { FINANCE_CALCULATORS } from "../../convex/domains/reports/calculators/finance"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

// W2-RPT-05: the 18 finance reports of W2 and the L-11 fix of finance.overview.

type T = TestConvex<typeof schema>
const records = api.domains.finance.records
const obligations = api.domains.finance.obligations
const period = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] as string[] }

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Бухгалтер", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  const run = (reportId: string, extra?: Record<string, string | number | boolean>, config: Partial<typeof period> & { groupBy?: "account" | "restaurant" | "cashflow-category" | "day"; secondaryGroupBy?: "account" | "restaurant" } = {}) =>
    admin.query(api.domains.reports.queries.execute, { reportId, config: { ...period, ...config, ...(extra ? { extra } : {}) } })
  return { admin, run }
}

type Admin = Awaited<ReturnType<typeof office>>["admin"]

/** Walks an approval / document record through the given actions. */
async function advance(admin: Admin, moduleId: "services" | "payments" | "budgets" | "payment-calendar", saved: { externalId: string; version: number }, actions: ("submit" | "approve" | "post")[]) {
  let version = saved.version
  for (const action of actions) version = (await admin.mutation(records.transition, { moduleId, externalId: saved.externalId, action, expectedVersion: version })).version
  return version
}

/**
 * A received cleaning service 112 000 ₸ with 12 % VAT (due 21.09), a 50 000 ₸ bank payment allocated to it,
 * and a provided banquet service 56 000 ₸ with 12 % VAT to another counterparty.
 */
async function settlements(admin: Admin) {
  const base = { restaurantExternalId: "almaty", businessDate: "2026-09-20", amount: 0 }
  const supplier = await admin.mutation(records.save, { ...base, moduleId: "counterparties", name: "ТОО Клининг", data: { roles: "supplier", bin: "123456789013", vatPayer: true } })
  const customer = await admin.mutation(records.save, { ...base, moduleId: "counterparties", name: "ТОО Банкет", data: { roles: "customer", bin: "123456789014" } })
  const category = await admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", name: "Услуги", data: { code: "srv", direction: "outgoing", activity: "operating" } })
  const received = await admin.mutation(records.save, { ...base, moduleId: "services", name: "Уборка сентябрь", amount: 112_000, counterpartyExternalId: supplier.externalId, data: { serviceDirection: "received", vatRate: 12, dueDate: "2026-09-21" } })
  await advance(admin, "services", received, ["post"])
  const provided = await admin.mutation(records.save, { ...base, moduleId: "services", name: "Банкет", amount: 56_000, counterpartyExternalId: customer.externalId, data: { serviceDirection: "provided", vatRate: 12 } })
  await advance(admin, "services", provided, ["post"])
  const obligation = (await admin.query(obligations.openObligations, { counterpartyExternalId: supplier.externalId, direction: "payable", restaurantExternalId: "almaty" })).find((row) => row.original === 112_000)!
  const payment = await admin.mutation(records.save, { ...base, moduleId: "payments", name: "Оплата клининга", amount: 50_000, counterpartyExternalId: supplier.externalId, cashflowCategoryExternalId: category.externalId, data: { direction: "outgoing", method: "bank" } })
  await admin.mutation(obligations.setPaymentAllocations, { paymentExternalId: payment.externalId, allocations: [{ obligationExternalId: obligation.externalId, amount: 50_000 }] })
  await advance(admin, "payments", payment, ["submit", "approve", "post"])
  return { base, supplier: supplier.externalId, customer: customer.externalId, category: category.externalId }
}

const cell = (result: { rows: { key: string; cells: Record<string, number | string> }[] }, key: string) => result.rows.find((row) => row.key === key)?.cells

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-09-24T12:00:00+05:00"), toFake: ["Date"] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe("finance reports W2 (W2-RPT-05)", () => {
  it("registers the 18 reports; every one runs with columns", async () => {
    expect(Object.keys(FINANCE_CALCULATORS).sort()).toEqual(["finance-01", "finance-04", "finance-05", "finance-06", "finance-07", "finance-09", "finance-10", "finance-11", "finance-12", "finance-13", "finance-14", "finance-15", "finance-16", "finance-17", "finance-19", "finance-20", "finance-21", "finance-olap"])
    const { t } = await setup()
    const { run } = await office(t)
    for (const reportId of Object.keys(FINANCE_CALCULATORS)) expect((await run(reportId)).columns.length, reportId).toBeGreaterThan(0)
  })

  it("POS money: balance sheet balances, trial balance Dt = Kt, cash book, account card, OLAP, result and revenue by payment type", async () => {
    const { t, productId } = await setup()
    const { admin, run } = await office(t)
    const order = await draft(t, productId) // 2 × 1000 + 15 % service = 2300
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300 }] })
    const today = "2026-09-24"
    const deposit = await admin.mutation(records.save, { moduleId: "transactions", restaurantExternalId: "almaty", businessDate: today, name: "Инкассация в банк", amount: 1000, debitAccountExternalId: "acc-1030", creditAccountExternalId: "acc-1010", data: { comment: "" } })
    await admin.mutation(records.transition, { moduleId: "transactions", externalId: deposit.externalId, action: "post", expectedVersion: deposit.version })

    // finance-01: assets (cash 1300 + bank 1000) = liabilities 0 + equity 0 + result (6010 2000 + 6030 300).
    const balance = await run("finance-01")
    expect(balance.kpis.find((kpi) => kpi.key === "assets")?.value).toBe(2300)
    expect(balance.kpis.find((kpi) => kpi.key === "passive")?.value).toBe(2300)
    expect(balance.kpis.find((kpi) => kpi.key === "difference")?.value).toBe(0)
    expect(cell(balance, "acc-1010")?.amount).toBe(1300)
    expect(cell(balance, "result")?.amount).toBe(2300)

    // finance-06: debit turnover = credit turnover, closing Dt = closing Kt.
    const trial = await run("finance-06")
    expect(trial.totals.debit).toBe(trial.totals.credit)
    expect(trial.totals.closingDebit).toBe(trial.totals.closingCredit)
    expect(cell(trial, "acc-1010")).toMatchObject({ debit: 2300, credit: 1000, closingDebit: 1300, closingCredit: 0 })

    // finance-04: cash 0 → +2300 −1000 → 1300; bank +1000.
    const book = await run("finance-04")
    expect(cell(book, `acc-1010:${today}`)).toMatchObject({ opening: 0, incoming: 2300, outgoing: 1000, closing: 1300 })
    expect(cell(book, `acc-1030:${today}`)).toMatchObject({ incoming: 1000, closing: 1000 })
    expect(book.kpis.find((kpi) => kpi.key === "closing")?.value).toBe(2300)

    // finance-07: the card of 1010 (by code) with a running balance.
    const card = await run("finance-07", { account: "1010" })
    expect(card.rows).toHaveLength(3)
    expect(card.rows.at(-1)?.cells.balance).toBe(1300)
    expect(card.kpis.find((kpi) => kpi.key === "closing")?.value).toBe(1300)

    // finance-olap: by account every line is two legs (Dt = Kt in total); by restaurant one «Сумма».
    const byAccount = await run("finance-olap")
    expect(byAccount.totals.debit).toBe(byAccount.totals.credit)
    expect(cell(byAccount, "acc-1010")).toMatchObject({ debit: 2300, credit: 1000, balance: 1300 })
    const byRestaurant = await run("finance-olap", undefined, { groupBy: "restaurant" })
    expect(byRestaurant.columns.map((column) => column.key)).toEqual(["group", "amount", "count"])
    expect(cell(byRestaurant, "almaty")).toMatchObject({ amount: 2300 + 300 + 1000, count: 3 })
    const pivot = await run("finance-olap", undefined, { groupBy: "restaurant", secondaryGroupBy: "account" })
    expect(cell(pivot, "almaty|acc-6030")).toMatchObject({ debit: 0, credit: 300 })

    // finance-21 and finance-19.
    expect(cell(await run("finance-21"), "almaty")).toMatchObject({ revenue: 2300, net: 2300, result: 2300, margin: 100 })
    const revenue = await run("finance-19")
    expect(revenue.rows).toHaveLength(1)
    expect(revenue.rows[0].cells).toMatchObject({ net: 2300, share: 100 })
    expect(String(revenue.rows[0].cells.account)).toMatch(/^1010/)
  })

  it("counterparties: debts, balances, the reconciliation statement equals the open debt, calendar and cashflow categories", async () => {
    const { t } = await setup()
    const { admin, run } = await office(t)
    const { supplier, customer, base } = await settlements(admin)
    const open = (await admin.query(obligations.openObligations, { counterpartyExternalId: supplier, direction: "payable", restaurantExternalId: "almaty" })).reduce((sum, row) => sum + row.open, 0)
    expect(open).toBe(62_000)

    // finance-10: payable 62 000, overdue (due 21.09, report on 30.09 → 9 days).
    const payables = await run("finance-10")
    expect(cell(payables, supplier)).toMatchObject({ group: "ТОО Клининг", total: 62_000, current: 0, d30: 62_000 })
    expect(payables.kpis.find((kpi) => kpi.key === "overdue")?.value).toBe(62_000)
    // The obligation dates from the posting of the act (24.09): on 20.09 there was no debt yet.
    expect(cell(await run("finance-10", undefined, { dateTo: "2026-09-20" }), supplier)).toBeUndefined()
    // finance-09: the banquet is owed to us.
    expect(cell(await run("finance-09"), customer)).toMatchObject({ total: 56_000, current: 56_000 })

    // finance-12: act of reconciliation = what we owe the counterparty.
    const act = await run("finance-12", { counterpartyExternalId: supplier })
    expect(act.kpis.find((kpi) => kpi.key === "ourDebt")?.value).toBe(open)
    expect(act.kpis.find((kpi) => kpi.key === "closing")?.value).toBe(-open)
    expect(act.totals).toEqual({ debit: 50_000, credit: 112_000 })
    expect(act.rows.map((row) => row.key)).toEqual(expect.arrayContaining(["opening", "closing"]))
    expect(cell(act, "closing")).toMatchObject({ debit: 0, credit: 62_000 })
    // From 22.09 the payment of 20.09 is in the opening balance.
    const later = await run("finance-12", { counterpartyExternalId: supplier }, { dateFrom: "2026-09-22" })
    expect(later.kpis.find((kpi) => kpi.key === "opening")?.value).toBe(50_000)
    expect(later.kpis.find((kpi) => kpi.key === "closing")?.value).toBe(-open)
    // Without a counterparty: the balances of all of them.
    expect((await run("finance-12")).sourceLabel).toMatch(/Выберите контрагента/)

    // finance-11: the same balances side by side.
    const balances = await run("finance-11")
    expect(cell(balances, supplier)).toMatchObject({ debit: 50_000, credit: 112_000, closing: -62_000, payable: 62_000 })
    expect(cell(balances, customer)).toMatchObject({ closing: 56_000, receivable: 56_000 })

    // finance-13: the open obligation on its due date and a planned incoming payment; a cash gap.
    const planned = await admin.mutation(records.save, { ...base, moduleId: "payment-calendar", name: "Предоплата банкета", amount: 30_000, data: { direction: "incoming", plannedAt: "2026-09-26" } })
    await advance(admin, "payment-calendar", planned, ["submit"])
    const calendar = await run("finance-13")
    expect(cell(calendar, "2026-09-21")).toMatchObject({ outgoing: 62_000, balance: -62_000, status: "Кассовый разрыв" })
    expect(cell(calendar, "2026-09-26")).toMatchObject({ incoming: 30_000, balance: -32_000 })
    expect(calendar.kpis.find((kpi) => kpi.key === "minimum")?.value).toBe(-62_000)

    // finance-20: the payment under its cashflow category.
    const categories = await run("finance-20")
    expect(categories.rows).toHaveLength(1)
    expect(categories.rows[0].cells).toMatchObject({ group: "Услуги", activity: "Операционная", outgoing: 50_000, incoming: 0, net: -50_000 })

    // The balance sheet still balances with VAT, payables and a negative bank.
    const sheet = await run("finance-01")
    expect(sheet.kpis.find((kpi) => kpi.key === "difference")?.value).toBe(0)
    expect(cell(sheet, "acc-3310")?.amount).toBe(62_000)
  })

  it("VAT: 12 % of a payer's receipt is input VAT; services give input and output VAT; a non-payer gets a banner", async () => {
    const { t } = await setup()
    const { admin, run } = await office(t)
    await t.run(async (ctx) => {
      const organization = (await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", "sandyq")).unique())!
      await ctx.db.patch(organization._id, { vatPayer: true })
      const supplierId = await ctx.db.insert("suppliers", { externalId: "s1", name: "ТОО Мясо", bin: "123456789015", supplierType: "external", vatPayer: true, priceDeviationPolicy: "ignore", allowedDeviationPercent: 0, restaurantExternalIds: [], active: true, searchText: "мясо" })
      const warehouseId = await ctx.db.insert("warehouses", { externalId: "almaty-main", name: "Склад", shortName: "Склад", restaurantExternalId: "almaty", organizationExternalId: "sandyq", kind: "storage", allowNegativeStock: true, internalTransfers: true, isSalesDefault: true, active: true, searchText: "склад" })
      const itemId = await ctx.db.insert("inventoryItems", { externalId: "meat", name: "Мясо", nameSort: "мясо", searchText: "мясо", unit: "кг", kind: "ingredient", active: true })
      const receiptId = await ctx.db.insert("receipts", { externalId: "r1", number: "ПН-1", date: Date.parse("2026-09-20T10:00:00+05:00"), supplierId, warehouseId, restaurantExternalId: "almaty", organizationExternalId: "sandyq", invoiceNumber: "1", status: "draft", totalGross: 11_200, totalVat: 1200, totalNet: 10_000, searchText: "", createdAt: 0, updatedAt: 0 })
      await ctx.db.insert("receiptLines", { receiptId, lineNo: 1, inventoryItemId: itemId, quantity: 10, unitCostGross: 1120, vatRate: 12, amountGross: 11_200 })
    })
    await admin.mutation(api.domains.purchasing.receipts.postReceipt, { externalId: "r1" })

    const purchases = await run("finance-17")
    expect(purchases.rows).toHaveLength(1)
    expect(purchases.rows[0].cells).toMatchObject({ net: 10_000, vat: 1200, gross: 11_200, rate: 12 })
    expect(purchases.kpis.find((kpi) => kpi.key === "vat")?.value).toBe(1200)
    expect(purchases.sourceLabel).not.toMatch(/Не плательщик/)

    await settlements(admin)
    const sales = await run("finance-16")
    expect(sales.rows).toHaveLength(1)
    expect(sales.rows[0].cells).toMatchObject({ net: 50_000, vat: 6000, gross: 56_000, rate: 12 })
    const invoices = await run("finance-15")
    expect(invoices.rows).toHaveLength(3)
    expect(invoices.kpis.find((kpi) => kpi.key === "input")?.value).toBe(1200 + 12_000)
    expect(invoices.kpis.find((kpi) => kpi.key === "output")?.value).toBe(6000)
    expect(invoices.kpis.find((kpi) => kpi.key === "payable")?.value).toBe(6000 - 13_200)

    // Not a VAT payer: the receipt is at gross cost, no VAT line, and the report says why.
    await t.run(async (ctx) => {
      const organization = (await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", "sandyq")).unique())!
      await ctx.db.patch(organization._id, { vatPayer: false })
      const receipt = (await ctx.db.query("receipts").withIndex("by_external_id", (q) => q.eq("externalId", "r1")).unique())!
      const { _id, _creationTime, ...copy } = receipt
      const receiptId = await ctx.db.insert("receipts", { ...copy, externalId: "r2", number: "ПН-2", status: "draft" })
      const line = (await ctx.db.query("receiptLines").withIndex("by_receipt", (q) => q.eq("receiptId", _id)).take(1))[0]
      await ctx.db.insert("receiptLines", { receiptId, lineNo: 1, inventoryItemId: line.inventoryItemId, quantity: 10, unitCostGross: 1120, vatRate: 12, amountGross: 11_200 })
    })
    await admin.mutation(api.domains.purchasing.receipts.postReceipt, { externalId: "r2" })
    const nonPayer = await run("finance-17")
    expect(nonPayer.rows.filter((row) => String(row.cells.document).startsWith("ПН-2"))).toEqual([])
    expect(nonPayer.sourceLabel).toMatch(/Не плательщик НДС: Sandyq/)
    expect(nonPayer.kpis.find((kpi) => kpi.key === "nonVatPayers")?.value).toBe(1)
  })

  it("budgets: plan-fact by account and by cashflow category, execution per budget", async () => {
    const { t } = await setup()
    const { admin, run } = await office(t)
    const { base, category } = await settlements(admin)
    const byAccount = await admin.mutation(records.save, { ...base, businessDate: "2026-09-01", moduleId: "budgets", name: "Услуги сентябрь", amount: 100_000, data: { accountExternalId: "acc-7210", periodStart: "2026-09-01", periodEnd: "2026-09-30" } })
    await advance(admin, "budgets", byAccount, ["submit", "approve"])
    const byCategory = await admin.mutation(records.save, { ...base, businessDate: "2026-09-01", moduleId: "budgets", name: "Оплата услуг", amount: 40_000, cashflowCategoryExternalId: category, data: {} })
    await advance(admin, "budgets", byCategory, ["submit", "approve"])
    const draftBudget = await admin.mutation(records.save, { ...base, businessDate: "2026-09-01", moduleId: "budgets", name: "Черновик", amount: 1, data: { accountExternalId: "acc-7210" } })

    const execution = await run("finance-14")
    expect(execution.rows).toHaveLength(2)
    expect(cell(execution, byAccount.externalId)).toMatchObject({ plan: 100_000, fact: 100_000, remainder: 0, execution: 100, status: "В пределах" })
    expect(cell(execution, byCategory.externalId)).toMatchObject({ plan: 40_000, fact: 50_000, execution: 125, status: "Перерасход", period: "2026-09-01 — 2026-09-30" })
    expect(cell(execution, draftBudget.externalId)).toBeUndefined()
    expect(execution.kpis.find((kpi) => kpi.key === "overrun")?.value).toBe(1)

    const planFact = await run("finance-05")
    expect(cell(planFact, "acc-7210")).toMatchObject({ plan: 100_000, fact: 100_000, deviation: 0 })
    expect(cell(planFact, category)).toMatchObject({ group: "Услуги", plan: 40_000, fact: 50_000, deviation: 10_000 })
    expect(planFact.kpis.find((kpi) => kpi.key === "execution")?.value).toBe(107.1)
    // A budget of another period is not in the report.
    expect((await run("finance-05", undefined, { dateFrom: "2026-10-01", dateTo: "2026-10-31" })).rows).toEqual([])
  })
})

describe("finance.overview (L-11)", () => {
  it("by account: debit and credit turnover are counted separately; the whole book is one turnover", async () => {
    const { t } = await setup()
    const { admin } = await office(t)
    await settlements(admin)
    const payables = await admin.query(api.domains.finance.queries.overview, { from: "2026-09-01", to: "2026-09-30", accountExternalId: "acc-3310" })
    expect(payables).toMatchObject({ mode: "account", debitTurnover: 50_000, creditTurnover: 112_000, balance: -62_000, debitEntries: 1, creditEntries: 2, entriesCount: 3, truncated: false })
    const bank = await admin.query(api.domains.finance.queries.overview, { from: "2026-09-01", to: "2026-09-30", accountExternalId: "acc-1030" })
    expect(bank).toMatchObject({ debitTurnover: 0, creditTurnover: 50_000, balance: -50_000 })
    const book = await admin.query(api.domains.finance.queries.overview, { from: "2026-09-01", to: "2026-09-30" })
    // 100 000 + 12 000 (received), 50 000 + 6000 (provided), 50 000 (payment).
    expect(book).toEqual({ mode: "book", turnover: 218_000, entriesCount: 5, truncated: false })
  })
})
