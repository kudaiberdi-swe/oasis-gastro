// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import { BankStatementsWorkspace } from "@/office/features/finance/ui/bank-statements-workspace"
import { BudgetsWorkspace } from "@/office/features/finance/ui/budgets-workspace"
import { PaymentCalendarWorkspace } from "@/office/features/finance/ui/payment-calendar-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatAmount, formatPercent, formatTenge } from "@/shared/lib/format"

// W3-FIN-11/12/13 screens: bank statements (paste CSV → import → auto-match → confirm), the payment calendar
// month with the cash gap, budgets (register plan-fact, the editor, «Новая версия»). Stands in for the e2e
// scenario until it runs against a preview deployment.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: [] as { name: string; args: unknown }[],
  paginated: {} as Record<string, unknown>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.queryArgs.push({ name, args })
    if (args === "skip") return undefined
    const value = mocks.queries[name]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
    const value = mocks.paginated[name]
    const results = typeof value === "function" ? (value as (args: unknown) => unknown[])(args) : ((value as unknown[]) ?? [])
    return { results, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/finance/records:list"
const GET = "domains/finance/records:get"
const SAVE = "domains/finance/records:save"
const TRANSITION = "domains/finance/records:transition"
const BANK = "domains/finance/bankStatements"
const exact = { normalizer: (text: string) => text.trim() }

function record(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "x" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "x",
    moduleId: "bank-statements",
    number: "БВ-2026-00001",
    name: "Оплата клининга",
    status: "draft",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-21",
    amount: 50_000,
    data: {},
    searchText: "",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const SUGGESTED = record({ externalId: "bank-line:1", counterpartyExternalId: "cp-1", data: { bank: "halyk", accountIban: "KZ12345678901234567A", direction: "outgoing", counterparty: "ТОО Клининг", bin: "123456789013", purpose: "Оплата клининга", documentNumber: "11", matchStatus: "suggested", suggestedExternalId: "pay-1", suggestedKind: "payment", suggestedNumber: "ПЛ-2026-00007", statementExternalId: "st-1" } })
const INCOMING = record({ externalId: "bank-line:2", number: "БВ-2026-00002", name: "Предоплата", amount: 90_000, status: "posted", data: { bank: "kaspi-business", accountIban: "KZ12345678901234567A", direction: "incoming", counterparty: "ТОО Банкет", bin: "", purpose: "Предоплата", matchStatus: "posted", matchedNumber: "ПЛ-2026-00008", statementExternalId: "st-1" } })
const BUDGET = record({ externalId: "budget-1", moduleId: "budgets", number: "БЮ-2026-00001", name: "Операционный бюджет", status: "approved", businessDate: "2026-09-01", amount: 60_000, version: 3, data: { periodStart: "2026-09-01", periodEnd: "2026-09-30", budgetVersion: 1 } })
const PLAN = record({ externalId: "pc-1", moduleId: "payment-calendar", number: "ПК-2026-00001", name: "Аренда", status: "approved", amount: 400_000, counterpartyExternalId: "cp-1", cashflowCategoryExternalId: "cat-out", data: { direction: "outgoing", plannedAt: "2026-09-25", priority: "required" } })

const day = (date: string, flow: Partial<{ incoming: number; outgoing: number; items: number; balance: number | null; gap: boolean }> = {}) => ({ date, incoming: 0, outgoing: 0, items: 0, balance: 100_000, gap: false, ...flow })

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queryArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/finance/records:references": {
      accounts: [{ externalId: "acc-7210", code: "7210", name: "Расходы на услуги", type: "expense", allowManualEntries: true }],
      cashflowCategories: [{ externalId: "cat-out", name: "Оплата услуг", direction: "outgoing" }],
      counterparties: [{ externalId: "cp-1", name: "ТОО Клининг" }],
      restaurants: [{ externalId: "r1", name: "Sandyq Абая" }],
      truncated: false,
    },
    [GET]: (args: { externalId: string }) => [SUGGESTED, INCOMING, BUDGET, PLAN].find((row) => row.externalId === args.externalId) ?? null,
    [`${BANK}:importProfiles`]: [],
    [`${BANK}:recentImports`]: [],
    [`${BANK}:matchCandidates`]: { counterparty: { externalId: "cp-1", name: "ТОО Клининг", bin: "123456789013" }, candidates: [{ kind: "payment", externalId: "pay-1", number: "ПЛ-2026-00007", name: "Оплата клининга", amount: 50_000, date: "2026-09-20", restaurantExternalId: "r1", status: "posted", exact: true }, { kind: "obligation", externalId: "ob-1", number: "ОБ-2026-00003", name: "Уборка", amount: 60_000, date: "2026-09-30", restaurantExternalId: "r1", status: "posted", exact: false }] },
    "domains/finance/cashflow:cashflowForecast": {
      month: "2026-09",
      today: "2026-09-20",
      currentBalance: 100_000,
      openingBalance: null,
      days: [day("2026-09-19", { balance: null }), day("2026-09-20", { items: 1, outgoing: 20_000, balance: 80_000 }), day("2026-09-25", { items: 1, outgoing: 150_000, balance: -70_000, gap: true }), day("2026-09-27", { items: 1, incoming: 200_000, balance: 130_000 })],
      incoming: 200_000,
      outgoing: 170_000,
      minimumBalance: -70_000,
      gapDays: 1,
      overdue: { incoming: 0, outgoing: 20_000, items: 1 },
      undated: { items: 0, amount: 0 },
      truncated: false,
    },
    "domains/finance/budgets:budgetLines": [
      { lineNo: 1, accountExternalId: "acc-7210", planAmount: 40_000 },
      { lineNo: 2, cashflowCategoryExternalId: "cat-out", planAmount: 20_000 },
    ],
    "domains/finance/budgets:budgetExecution": {
      period: { start: "2026-09-01", end: "2026-09-30" },
      lines: [
        { lineNo: 1, accountExternalId: "acc-7210", planAmount: 40_000, fact: 42_000, deviation: 2000, percent: 105 },
        { lineNo: 2, cashflowCategoryExternalId: "cat-out", planAmount: 20_000, fact: 25_000, deviation: 5000, percent: 125 },
      ],
      plan: 60_000,
      fact: 67_000,
      percent: 111.7,
      truncated: false,
    },
  }
  mocks.paginated = { [LIST]: (args: { moduleId: string }) => (args.moduleId === "bank-statements" ? [SUGGESTED, INCOMING] : args.moduleId === "budgets" ? [BUDGET] : [PLAN]) }
  mocks.mutations = {
    [`${BANK}:saveImportProfile`]: vi.fn(async () => ({ accountIban: "KZ12345678901234567A" })),
    [`${BANK}:importStatement`]: vi.fn(async (args: unknown) => ({ statementExternalId: (args as { statementExternalId: string }).statementExternalId, imported: 2, duplicates: 0 })),
    [`${BANK}:autoMatch`]: vi.fn(async () => ({ checked: 2, suggested: 1, unmatched: 1 })),
    [`${BANK}:confirmMatch`]: vi.fn(async () => ({ matchStatus: "matched", number: "ПЛ-2026-00007" })),
    [`${BANK}:unmatch`]: vi.fn(async () => ({ matchStatus: "unmatched" })),
    [SAVE]: vi.fn(async () => ({ externalId: "x", number: "x", version: 2 })),
    [TRANSITION]: vi.fn(async () => ({ status: "posted", version: 2 })),
    "domains/finance/budgets:setBudgetLines": vi.fn(async () => ({ total: 0, lines: 0 })),
    "domains/finance/budgets:copyBudgetVersion": vi.fn(async () => ({ externalId: "budget-2", number: "БЮ-2026-00002", version: 1, budgetVersion: 2 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter(
    [
      { path: "/office/bank-statements/:id?", element: <BankStatementsWorkspace /> },
      { path: "/office/payment-calendar/:id?", element: <PaymentCalendarWorkspace /> },
      { path: "/office/budgets/:id?", element: <BudgetsWorkspace /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Банковские выписки» (W3-FIN-11)", () => {
  it("config columns, document tabs, the match state of each line", () => {
    renderAt("/office/bank-statements")
    const table = screen.getByRole("table", { name: "Банковские выписки" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата", "Банк", "Счёт", "Приход, ₸", "Расход, ₸", "Сопоставлено", "Статус"])
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Проведённые", "Сторно"])
    const suggested = within(table).getByText("БВ-2026-00001").closest("tr")!
    expect(within(suggested).getByText("Halyk")).toBeTruthy()
    expect(within(suggested).getByText("KZ12…567A")).toBeTruthy()
    expect(within(suggested).getByText(formatAmount(50_000), exact)).toBeTruthy()
    expect(within(suggested).getByText("Предложено")).toBeTruthy()
    expect(within(suggested).getByText("ПЛ-2026-00007")).toBeTruthy()
    const posted = within(table).getByText("БВ-2026-00002").closest("tr")!
    expect(within(posted).getByText("Kaspi Business")).toBeTruthy()
    expect(within(posted).getAllByText("Проведено").length).toBeGreaterThan(0)
    // No «Новая запись»: lines come from the import only.
    expect(screen.queryByRole("button", { name: /Новая/ })).toBeNull()
  })

  it("paste CSV → preview → «Импортировать» saves the account's mapping and sends the lines → «Сопоставить автоматически»", async () => {
    renderAt("/office/bank-statements")
    const panel = screen.getByRole("region", { name: "Импорт CSV" })
    expect(within(panel).getByText("Дата;номер;контрагент;БИН;назначение;сумма;incoming/outgoing")).toBeTruthy()
    const importButton = within(panel).getByRole("button", { name: "Импортировать" })
    expect(importButton.className).toContain("bg-card")
    expect(within(panel).getByRole("button", { name: "Сопоставить автоматически" })).toHaveProperty("disabled", true)
    fireEvent.change(within(panel).getByLabelText("IBAN счёта"), { target: { value: "kz12 3456 7890 1234 567a" } })
    fireEvent.change(within(panel).getByLabelText("Или вставьте строки выписки"), { target: { value: "2026-09-21;11;ТОО Клининг;123456789013;Оплата клининга;50000;outgoing\n2026-09-22;12;ТОО Банкет;;Предоплата;90000;incoming" } })
    expect(within(panel).getByRole("status").textContent).toContain(`Распознано строк: 2 · приход ${formatTenge(90_000)} · расход ${formatTenge(50_000)}`)
    fireEvent.click(importButton)
    await waitFor(() => expect(mocks.mutations[`${BANK}:importStatement`]).toHaveBeenCalled())
    expect(mocks.mutations[`${BANK}:saveImportProfile`]).toHaveBeenCalledWith(expect.objectContaining({ accountIban: "KZ12345678901234567A", restaurantExternalId: "r1", bank: "sandyq", amountMode: "direction", hasHeader: false }))
    const sent = (mocks.mutations[`${BANK}:importStatement`] as ReturnType<typeof vi.fn>).mock.calls[0][0] as { statementExternalId: string; rows: unknown[] }
    expect(sent).toMatchObject({ restaurantExternalId: "r1", accountIban: "KZ12345678901234567A", bank: "sandyq" })
    expect(sent.rows).toEqual([
      { date: "2026-09-21", number: "11", amount: 50_000, direction: "outgoing", counterparty: "ТОО Клининг", bin: "123456789013", purpose: "Оплата клининга", occurrence: 0 },
      { date: "2026-09-22", number: "12", amount: 90_000, direction: "incoming", counterparty: "ТОО Банкет", bin: "", purpose: "Предоплата", occurrence: 0 },
    ])
    expect(await screen.findByText("Загружено строк: 2")).toBeTruthy()
    const match = within(panel).getByRole("button", { name: "Сопоставить автоматически" })
    await waitFor(() => expect(match).toHaveProperty("disabled", false))
    fireEvent.click(match)
    await waitFor(() => expect(mocks.mutations[`${BANK}:autoMatch`]).toHaveBeenCalledWith({ statementExternalId: sent.statementExternalId }))
  })

  it("an unverified preset says so; a line with errors blocks the import", () => {
    renderAt("/office/bank-statements")
    const panel = screen.getByRole("region", { name: "Импорт CSV" })
    fireEvent.change(within(panel).getByLabelText("IBAN счёта"), { target: { value: "KZ12345678901234567A" } })
    fireEvent.change(within(panel).getByLabelText("Или вставьте строки выписки"), { target: { value: "2026-09-21;11;ТОО;123;Оплата;50000;outgoing" } })
    expect(within(panel).getByText("Строка 1: БИН / ИИН «123» — не 12 цифр")).toBeTruthy()
    expect(within(panel).getByRole("button", { name: "Импортировать" })).toHaveProperty("disabled", true)
  })

  it("the line card: bank data, the suggestion to confirm, candidates of the counterparty", async () => {
    renderAt("/office/bank-statements/bank-line%3A1")
    const card = await screen.findByRole("dialog")
    expect(within(card).getByText("Строка выписки БВ-2026-00001")).toBeTruthy()
    expect(within(card).getByText("KZ12 3456 7890 1234 567A")).toBeTruthy()
    expect(within(card).getByText("Предложено: платёж ПЛ-2026-00007")).toBeTruthy()
    const candidates = within(card).getByRole("list", { name: "Кандидаты на сопоставление" })
    expect(within(candidates).getByText("Точное совпадение")).toBeTruthy()
    expect(within(candidates).getByText(/Сумма отличается на/)).toBeTruthy()
    fireEvent.click(within(card).getByRole("button", { name: "Подтвердить" }))
    await waitFor(() => expect(mocks.mutations[`${BANK}:confirmMatch`]).toHaveBeenCalledWith({ lineExternalId: "bank-line:1", targetExternalId: "pay-1" }))
    expect(within(card).getByRole("button", { name: "Провести" })).toBeTruthy()
  })
})

describe("«Платёжный календарь» (W3-FIN-12)", () => {
  it("KPI of the calendar (not the journal's), the month grid with a destructive gap day, config columns", () => {
    renderAt("/office/payment-calendar")
    expect(screen.getByText("Поступления", { selector: "p" })).toBeTruthy()
    expect(screen.getByText("Платежи", { selector: "p" })).toBeTruthy()
    expect(screen.getByText("Минимальный остаток")).toBeTruthy()
    expect(screen.getByText(formatTenge(-70_000), exact)).toBeTruthy()
    expect(screen.getByText("Кассовый разрыв: дней 1")).toBeTruthy()
    expect(screen.queryByText("Оборот по дебету")).toBeNull()
    const month = screen.getByRole("table", { name: /Поступления, платежи и остаток по дням/ })
    const gap = within(month).getByLabelText("25.09.2026, кассовый разрыв")
    expect(gap.className).toContain("bg-destructive/10")
    expect(within(gap).getByText(`= ${formatAmount(-70_000)}`, exact)).toBeTruthy()
    expect(within(month).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"])
    const table = screen.getByRole("table", { name: "Платёжный календарь" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата", "Контрагент", "Статья", "Сумма, ₸", "Статус"])
    expect(within(table).getByText("Оплата услуг")).toBeTruthy()
    expect(within(table).getByText("25.09.2026")).toBeTruthy()
  })

  it("«Следующий месяц» asks the forecast of October", () => {
    renderAt("/office/payment-calendar")
    fireEvent.click(screen.getByRole("button", { name: "Следующий месяц" }))
    const months = mocks.queryArgs.filter((call) => call.name === "domains/finance/cashflow:cashflowForecast").map((call) => (call.args as { month: string }).month)
    expect(new Set(months).size).toBe(2)
  })
})

describe("«Бюджеты» (W3-FIN-13)", () => {
  it("the register: period, restaurant, plan, fact and execution of an agreed budget", () => {
    renderAt("/office/budgets")
    const table = screen.getByRole("table", { name: "Бюджеты" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Период", "Ресторан", "План, ₸", "Факт, ₸", "Исполнение, %", "Статус"])
    const row = within(table).getByText("БЮ-2026-00001").closest("tr")!
    expect(within(row).getByText("01.09.2026 — 30.09.2026")).toBeTruthy()
    expect(within(row).getByText(formatAmount(67_000), exact)).toBeTruthy()
    expect(within(row).getByText(formatPercent(111.7), exact)).toBeTruthy()
  })

  it("the editor: KPI, lines «Счёт / статья · План · Факт · Отклонение · %», «Новая версия» opens the copy", async () => {
    const router = renderAt("/office/budgets/budget-1")
    expect(await screen.findByText("Бюджет БЮ-2026-00001")).toBeTruthy()
    const lines = screen.getByRole("table", { name: "План и факт по строкам бюджета" })
    expect(within(lines).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Счёт / статья", "План, ₸", "Факт, ₸", "Отклонение, ₸", "%"])
    const account = within(lines).getByText("7210 · Расходы на услуги").closest("tr")!
    expect(within(account).getByText(formatAmount(42_000), exact)).toBeTruthy()
    expect(within(account).getByText(formatPercent(105), exact)).toBeTruthy()
    expect(screen.getByText("Исполнение", { selector: "p" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Новая версия" }))
    await waitFor(() => expect(mocks.mutations["domains/finance/budgets:copyBudgetVersion"]).toHaveBeenCalledWith({ externalId: "budget-1" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/budgets/budget-2"))
  })
})
