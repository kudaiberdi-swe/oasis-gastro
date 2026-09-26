import { afterEach, describe, expect, it, vi } from "vitest"

import { api } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

// W3-FIN-11/12/13: bank statement import and matching, the payment calendar forecast, budgets and plan-fact.

const records = api.domains.finance.records
const bank = api.domains.finance.bankStatements
const obligations = api.domains.finance.obligations
const IBAN = "KZ12345678901234567A"
const SUPPLIER_BIN = "123456789013"

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Бухгалтер", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  const base = { restaurantExternalId: "almaty", businessDate: "2026-09-20", amount: 0 }
  const counterparty = await admin.mutation(records.save, { ...base, moduleId: "counterparties", name: "ТОО Клининг", data: { roles: "supplier", bin: SUPPLIER_BIN } })
  const category = await admin.mutation(records.save, { ...base, moduleId: "cashflow-categories", name: "Услуги", data: { code: "srv", direction: "outgoing", activity: "operating" } })
  return { admin, base, counterparty: counterparty.externalId, category: category.externalId }
}

type Admin = Awaited<ReturnType<typeof office>>["admin"]

async function advance(admin: Admin, moduleId: "services" | "payments" | "budgets" | "payment-calendar" | "bank-statements", saved: { externalId: string; version: number }, actions: ("submit" | "approve" | "post")[]) {
  let version = saved.version
  for (const action of actions) version = (await admin.mutation(records.transition, { moduleId, externalId: saved.externalId, action, expectedVersion: version })).version
  return version
}

/** A received service of `amount` ₸ (no VAT) due on `dueDate`: its payable obligation. */
async function payable(admin: Admin, counterparty: string, amount: number, dueDate: string, businessDate = "2026-09-20") {
  const act = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate, moduleId: "services", name: `Услуга ${amount}`, amount, counterpartyExternalId: counterparty, data: { serviceDirection: "received", vatRate: 0, dueDate } })
  await advance(admin, "services", act, ["post"])
  const open = await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })
  return open.find((row) => row.original === amount)!
}

const row = (overrides: Partial<{ date: string; number: string; amount: number; direction: "incoming" | "outgoing"; counterparty: string; bin: string; purpose: string; occurrence: number }>) => ({
  date: "2026-09-21",
  number: "1",
  amount: 1000,
  direction: "outgoing" as const,
  counterparty: "ТОО Клининг",
  bin: SUPPLIER_BIN,
  purpose: "Оплата",
  ...overrides,
})

async function bankLines(t: Awaited<ReturnType<typeof setup>>["t"]) {
  return t.run((ctx) => ctx.db.query("financeRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", "bank-statements")).take(50))
}

afterEach(() => {
  vi.useRealTimers()
})

describe("bank statements (W3-FIN-11)", () => {
  it("a re-import of the same file in another order adds no lines; identical lines of one file are both kept", async () => {
    const { t } = await setup()
    const { admin, counterparty } = await office(t)
    const rows = [row({ number: "11", amount: 50_000, purpose: "Оплата клининга" }), row({ number: "", amount: 700, purpose: "Комиссия банка", bin: "", counterparty: "Банк" }), row({ number: "", amount: 700, purpose: "Комиссия банка", bin: "", counterparty: "Банк", occurrence: 1 }), row({ number: "12", amount: 90_000, direction: "incoming", date: "2026-09-22" })]
    const first = await admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: "kz12 3456 7890 1234 567a", bank: "halyk", statementExternalId: "st-1", rows })
    expect(first).toMatchObject({ imported: 4, duplicates: 0 })
    const again = await admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: IBAN, bank: "halyk", statementExternalId: "st-2", rows: [...rows].reverse() })
    expect(again).toMatchObject({ imported: 0, duplicates: 4 })
    const lines = await bankLines(t)
    expect(lines).toHaveLength(4)
    const fee = lines.filter((line) => line.data.purpose === "Комиссия банка")
    expect(fee).toHaveLength(2)
    // The BIN finds the counterparty at import.
    expect(lines.find((line) => line.data.documentNumber === "11")).toMatchObject({ amount: 50_000, counterpartyExternalId: counterparty, status: "draft", businessDate: "2026-09-21", data: { accountIban: IBAN, direction: "outgoing", matchStatus: "unmatched", statementExternalId: "st-1" } })
    await expect(admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: IBAN, bank: "halyk", statementExternalId: "st-3", rows: Array.from({ length: 501 }, (_, index) => row({ number: String(index) })) })).rejects.toThrow(/Не больше 500/)
    await expect(admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: "KZ1", bank: "halyk", statementExternalId: "st-4", rows })).rejects.toThrow(/IBAN/)
    await expect(admin.mutation(records.save, { ...{ restaurantExternalId: "almaty", businessDate: "2026-09-21", amount: 5 }, moduleId: "bank-statements", name: "Руками", data: {} })).rejects.toThrow(/импортом/)
  })

  it("auto-match by BIN + amount + date ±3 days suggests the payment; confirming and posting reconciles it without a second journal line", async () => {
    const { t } = await setup()
    const { admin, counterparty, category } = await office(t)
    const payment = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-19", moduleId: "payments", name: "Оплата клининга", amount: 50_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank" } })
    await advance(admin, "payments", payment, ["submit", "approve", "post"])
    await admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: IBAN, bank: "kaspi-business", statementExternalId: "st-1", rows: [row({ number: "11", amount: 50_000 }), row({ number: "12", amount: 50_001 }), row({ number: "13", amount: 50_000, date: "2026-09-30" })] })
    expect(await admin.mutation(bank.autoMatch, { statementExternalId: "st-1" })).toEqual({ checked: 3, suggested: 1, unmatched: 2 })
    const lines = await bankLines(t)
    const exact = lines.find((line) => line.data.documentNumber === "11")!
    expect(exact.data).toMatchObject({ matchStatus: "suggested", suggestedExternalId: payment.externalId, suggestedKind: "payment" })
    // A week later is outside ±3 days: listed for manual matching, not exact.
    const late = lines.find((line) => line.data.documentNumber === "13")!
    expect(late.data.matchStatus).toBe("unmatched")

    await admin.mutation(bank.confirmMatch, { lineExternalId: exact.externalId, targetExternalId: payment.externalId })
    // The payment is taken: another line cannot match it.
    const { candidates } = await admin.query(bank.matchCandidates, { lineExternalId: late.externalId })
    expect(candidates.some((candidate) => candidate.externalId === payment.externalId)).toBe(false)
    await expect(admin.mutation(bank.confirmMatch, { lineExternalId: late.externalId, targetExternalId: payment.externalId })).rejects.toThrow(/не подходит/)

    const journalBefore = await t.run((ctx) => ctx.db.query("journalEntries").take(50))
    const matched = (await admin.query(records.get, { moduleId: "bank-statements", externalId: exact.externalId }))!
    await advance(admin, "bank-statements", matched, ["post"])
    const posted = (await admin.query(records.get, { moduleId: "bank-statements", externalId: exact.externalId }))!
    expect(posted).toMatchObject({ status: "posted", data: { matchStatus: "posted", matchedPaymentExternalId: payment.externalId } })
    expect(await t.run((ctx) => ctx.db.query("journalEntries").take(50))).toHaveLength(journalBefore.length)
  })

  it("posting an unmatched line matched to an obligation creates a posted bank payment that settles it; reversing the line reverses the payment", async () => {
    const { t } = await setup()
    const { admin, counterparty, category } = await office(t)
    const obligation = await payable(admin, counterparty, 30_000, "2026-09-22")
    await admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: IBAN, bank: "halyk", statementExternalId: "st-1", rows: [row({ number: "21", amount: 30_000 })] })
    await admin.mutation(bank.autoMatch, { statementExternalId: "st-1" })
    let [line] = await bankLines(t)
    expect(line.data).toMatchObject({ matchStatus: "suggested", suggestedExternalId: obligation.externalId, suggestedKind: "obligation" })
    await admin.mutation(bank.confirmMatch, { lineExternalId: line.externalId, targetExternalId: obligation.externalId })
    line = (await admin.query(records.get, { moduleId: "bank-statements", externalId: line.externalId }))!
    await expect(advance(admin, "bank-statements", line, ["post"])).rejects.toThrow(/статью ДДС/)
    const saved = await admin.mutation(records.save, { moduleId: "bank-statements", externalId: line.externalId, expectedVersion: line.version, name: "x", restaurantExternalId: "almaty", businessDate: "2026-01-01", amount: 1, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { amount: 999, comment: "Клининг сентябрь" } })
    line = (await admin.query(records.get, { moduleId: "bank-statements", externalId: line.externalId }))!
    // The card changes only the category and the comment, never the bank's amount or date.
    expect(line).toMatchObject({ amount: 30_000, businessDate: "2026-09-21", version: saved.version, data: { comment: "Клининг сентябрь", matchStatus: "matched" } })
    await advance(admin, "bank-statements", line, ["post"])
    line = (await admin.query(records.get, { moduleId: "bank-statements", externalId: line.externalId }))!
    const paymentId = String(line.data.matchedPaymentExternalId)
    const payment = (await admin.query(records.get, { moduleId: "payments", externalId: paymentId }))!
    expect(payment).toMatchObject({ status: "posted", amount: 30_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank", bankLineExternalId: line.externalId } })
    const journal = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", paymentId)).take(5))
    expect(journal.map((entry) => [entry.debitAccountExternalId, entry.creditAccountExternalId, entry.amount])).toEqual([["acc-3310", "acc-1030", 30_000]])
    expect(await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" })).toEqual([])

    await admin.mutation(records.transition, { moduleId: "bank-statements", externalId: line.externalId, action: "reverse", expectedVersion: line.version, reason: "Ошибка сопоставления" })
    expect((await admin.query(records.get, { moduleId: "payments", externalId: paymentId }))!.status).toBe("reversed")
    expect((await admin.query(obligations.openObligations, { counterpartyExternalId: counterparty, direction: "payable", restaurantExternalId: "almaty" }))[0].open).toBe(30_000)
  })

  it("unmatch frees the payment; the mapping is saved per bank account and checked", async () => {
    const { t } = await setup()
    const { admin, counterparty, category } = await office(t)
    const payment = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-21", moduleId: "payments", name: "Оплата", amount: 1000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank" } })
    await advance(admin, "payments", payment, ["submit", "approve"])
    await admin.mutation(bank.importStatement, { restaurantExternalId: "almaty", accountIban: IBAN, bank: "manual", statementExternalId: "st-1", rows: [row({})] })
    const [line] = await bankLines(t)
    await admin.mutation(bank.confirmMatch, { lineExternalId: line.externalId, targetExternalId: payment.externalId })
    expect((await admin.query(records.get, { moduleId: "payments", externalId: payment.externalId }))!.data.bankLineExternalId).toBe(line.externalId)
    await admin.mutation(bank.unmatch, { lineExternalId: line.externalId })
    expect((await admin.query(records.get, { moduleId: "payments", externalId: payment.externalId }))!.data.bankLineExternalId).toBeUndefined()
    expect((await admin.query(records.get, { moduleId: "bank-statements", externalId: line.externalId }))!.data.matchStatus).toBe("unmatched")

    const mapping = { accountIban: IBAN, restaurantExternalId: "almaty", bank: "manual", encoding: "windows-1251" as const, delimiter: ";" as const, amountMode: "debit-credit" as const, hasHeader: true }
    await expect(admin.mutation(bank.saveImportProfile, { ...mapping, columns: [{ field: "date", header: "Дата" }] })).rejects.toThrow(/Не выбраны колонки/)
    const columns = [{ field: "date", header: "Дата" }, { field: "debit", header: "Дебет" }, { field: "credit", header: "Кредит" }, { field: "counterparty", index: 3 }, { field: "bin", header: "БИН" }, { field: "purpose", header: "Назначение" }]
    await admin.mutation(bank.saveImportProfile, { ...mapping, columns })
    await admin.mutation(bank.saveImportProfile, { ...mapping, delimiter: ",", columns })
    const profiles = await admin.query(bank.importProfiles, {})
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ accountIban: IBAN, delimiter: ",", amountMode: "debit-credit", organizationExternalId: "sandyq" })
  })
})

describe("payment calendar forecast (W3-FIN-12)", () => {
  it("counts open obligations without a calendar record, moves overdue ones to today and flags the cash gap", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-20T12:00:00+05:00"), toFake: ["Date"] })
    const { t } = await setup()
    const { admin, counterparty } = await office(t)
    // 100 000 ₸ on the bank account.
    const incoming = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-19", moduleId: "cashflow-categories", name: "Поступления", amount: 0, data: { code: "in", direction: "incoming", activity: "operating" } })
    const receipt = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-19", moduleId: "payments", name: "Аванс", amount: 100_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: incoming.externalId, data: { direction: "incoming", method: "bank" } })
    await advance(admin, "payments", receipt, ["submit", "approve", "post"])
    await payable(admin, counterparty, 150_000, "2026-09-25")
    await payable(admin, counterparty, 20_000, "2026-09-10", "2026-09-01")
    const linked = await payable(admin, counterparty, 40_000, "2026-09-28")
    // A calendar record that plans the 40 000 obligation on the 29th (it replaces the obligation's due date) and a planned receipt.
    const plan = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-20", moduleId: "payment-calendar", name: "Оплата по графику", amount: 40_000, counterpartyExternalId: counterparty, data: { direction: "outgoing", plannedAt: "2026-09-29", priority: "required", obligationExternalId: linked.externalId } })
    await advance(admin, "payment-calendar", plan, ["submit"])
    const banquet = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-20", moduleId: "payment-calendar", name: "Предоплата банкета", amount: 200_000, data: { direction: "incoming", plannedAt: "2026-09-27" } })
    await advance(admin, "payment-calendar", banquet, ["submit", "approve"])
    await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-20", moduleId: "payment-calendar", name: "Черновик", amount: 1_000_000, data: { direction: "outgoing", plannedAt: "2026-09-26" } })
    await expect(admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-20", moduleId: "payment-calendar", name: "Без даты", amount: 1, data: { direction: "outgoing" } })).rejects.toThrow(/Плановая дата/)

    const forecast = await admin.query(api.domains.finance.cashflow.cashflowForecast, { month: "2026-09" })
    const day = (date: string) => forecast.days.find((row) => row.date === date)!
    expect(forecast).toMatchObject({ today: "2026-09-20", currentBalance: 100_000, openingBalance: null, overdue: { outgoing: 20_000, items: 1 } })
    expect(day("2026-09-19")).toMatchObject({ balance: null, outgoing: 0 })
    expect(day("2026-09-20")).toMatchObject({ outgoing: 20_000, balance: 80_000, gap: false })
    expect(day("2026-09-25")).toMatchObject({ outgoing: 150_000, balance: -70_000, gap: true })
    expect(day("2026-09-26")).toMatchObject({ outgoing: 0, balance: -70_000 })
    expect(day("2026-09-27")).toMatchObject({ incoming: 200_000, balance: 130_000, gap: false })
    expect(day("2026-09-28")).toMatchObject({ outgoing: 0 })
    expect(day("2026-09-29")).toMatchObject({ outgoing: 40_000, balance: 90_000 })
    expect(forecast).toMatchObject({ incoming: 200_000, outgoing: 210_000, minimumBalance: -70_000, gapDays: 2 })
    // The next month opens with the balance planned through the end of this one.
    const october = await admin.query(api.domains.finance.cashflow.cashflowForecast, { month: "2026-10" })
    expect(october).toMatchObject({ openingBalance: 90_000, gapDays: 0 })
  })
})

describe("budgets (W3-FIN-13)", () => {
  it("fact by account equals the journal turnover of the period; by category — its posted payments", async () => {
    const { t } = await setup()
    const { admin, counterparty, category } = await office(t)
    await payable(admin, counterparty, 30_000, "2026-09-25", "2026-09-05")
    await payable(admin, counterparty, 12_000, "2026-09-25", "2026-09-28")
    await payable(admin, counterparty, 99_000, "2026-10-25", "2026-10-02") // another period
    const payment = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-10", moduleId: "payments", name: "Оплата", amount: 25_000, counterpartyExternalId: counterparty, cashflowCategoryExternalId: category, data: { direction: "outgoing", method: "bank" } })
    await advance(admin, "payments", payment, ["submit", "approve", "post"])

    const budget = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-01", moduleId: "budgets", name: "Операционный бюджет", amount: 0, data: { periodStart: "2026-09-01", periodEnd: "2026-09-30", budgetVersion: 7 } })
    await admin.mutation(api.domains.finance.budgets.setBudgetLines, { budgetExternalId: budget.externalId, lines: [{ accountExternalId: "acc-7210", planAmount: 40_000 }, { cashflowCategoryExternalId: category, planAmount: 20_000 }] })
    await expect(admin.mutation(api.domains.finance.budgets.setBudgetLines, { budgetExternalId: budget.externalId, lines: [{ accountExternalId: "acc-7210", planAmount: 1 }, { accountExternalId: "acc-7210", planAmount: 2 }] })).rejects.toThrow(/уже есть/)
    const saved = (await admin.query(records.get, { moduleId: "budgets", externalId: budget.externalId }))!
    // The server owns the version number; the lines' sum is the budget's amount, the record's version stays.
    expect(saved).toMatchObject({ amount: 60_000, version: budget.version, data: { budgetVersion: 1 } })

    const execution = await admin.query(api.domains.finance.budgets.budgetExecution, { externalId: budget.externalId })
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_debit_date", (q) => q.eq("debitAccountExternalId", "acc-7210").gte("businessDate", "2026-09-01").lte("businessDate", "2026-09-30")).take(50))
    expect(execution.lines[0]).toMatchObject({ accountExternalId: "acc-7210", planAmount: 40_000, fact: entries.reduce((sum, entry) => sum + entry.amount, 0) })
    expect(execution.lines[0].fact).toBe(42_000)
    expect(execution.lines[1]).toMatchObject({ cashflowCategoryExternalId: category, planAmount: 20_000, fact: 25_000, deviation: 5000, percent: 125 })
    expect(execution).toMatchObject({ plan: 60_000, fact: 67_000, percent: 111.7 })
  })

  it("a new version copies the lines as a draft and leaves the approved one unchanged; reports count only the newest agreed version", async () => {
    const { t } = await setup()
    const { admin, category } = await office(t)
    const budget = await admin.mutation(records.save, { restaurantExternalId: "almaty", businessDate: "2026-09-01", moduleId: "budgets", name: "Бюджет", amount: 50_000, data: { periodStart: "2026-09-01", periodEnd: "2026-09-30" } })
    await admin.mutation(api.domains.finance.budgets.setBudgetLines, { budgetExternalId: budget.externalId, lines: [{ accountExternalId: "acc-7210", planAmount: 30_000 }, { cashflowCategoryExternalId: category, planAmount: 20_000 }] })
    await advance(admin, "budgets", budget, ["submit", "approve"])
    const before = (await admin.query(records.get, { moduleId: "budgets", externalId: budget.externalId }))!

    const copy = await admin.mutation(api.domains.finance.budgets.copyBudgetVersion, { externalId: budget.externalId })
    expect(copy.budgetVersion).toBe(2)
    const draft = (await admin.query(records.get, { moduleId: "budgets", externalId: copy.externalId }))!
    expect(draft).toMatchObject({ status: "draft", amount: 50_000, data: { budgetVersion: 2, previousVersionExternalId: budget.externalId, periodStart: "2026-09-01" } })
    await admin.mutation(api.domains.finance.budgets.setBudgetLines, { budgetExternalId: copy.externalId, lines: [{ accountExternalId: "acc-7210", planAmount: 35_000 }] })
    await expect(admin.mutation(api.domains.finance.budgets.setBudgetLines, { budgetExternalId: budget.externalId, lines: [] })).rejects.toThrow(/черновика/)

    expect(await admin.query(records.get, { moduleId: "budgets", externalId: budget.externalId })).toEqual(before)
    expect((await admin.query(api.domains.finance.budgets.budgetLines, { budgetExternalId: budget.externalId })).map((line) => line.planAmount)).toEqual([30_000, 20_000])

    const report = (reportId: string) => admin.query(api.domains.reports.queries.execute, { reportId, config: { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] } })
    expect((await report("finance-14")).rows).toHaveLength(2)
    await advance(admin, "budgets", draft, ["submit", "approve"])
    const rows = (await report("finance-14")).rows
    expect(rows.map((row) => [row.key, row.cells.plan])).toEqual([[copy.externalId, 35_000]])
  })
})
