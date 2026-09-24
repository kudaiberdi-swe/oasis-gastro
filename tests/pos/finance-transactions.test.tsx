// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { FinanceRecord, JournalRow } from "@/office/features/finance/data/use-finance-records"
import { last30Days } from "@/office/features/finance/model/modules"
import { TransactionsWorkspace } from "@/office/features/finance/ui/journal-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-FIN-05: «Проводки» is the whole journal (system + manual lines), with KPI only here (L-11):
// Dr and Cr turnover of a chosen account differ; without an account one «Оборот за период».

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: [] as { name: string; args: unknown }[],
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
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
    mocks.paginatedArgs.push({ name, args })
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

const JOURNAL = "domains/finance/queries:journal"
const OVERVIEW = "domains/finance/queries:overview"
const TRANSITION = "domains/finance/records:transition"
const SAVE = "domains/finance/records:save"

const exact = { normalizer: (text: string) => text.trim() }

function line(overrides: Partial<JournalRow> & Pick<JournalRow, "_id" | "sourceModuleId" | "sourceExternalId">): JournalRow {
  return {
    _creationTime: 0,
    externalId: String(overrides._id),
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    sourceNumber: "№1",
    occurredAt: 0,
    businessDate: "2026-09-20",
    debitAccountExternalId: "acc-1010",
    creditAccountExternalId: "acc-6010",
    amount: 2300,
    description: "Заказ №1",
    debitAccount: { code: "1010", name: "Касса" },
    creditAccount: { code: "6010", name: "Выручка" },
    ...overrides,
  } as JournalRow
}

const ORDER = line({ _id: "j1" as JournalRow["_id"], sourceModuleId: "orders", sourceExternalId: "o1" })
const RECEIPT = line({
  _id: "j2" as JournalRow["_id"],
  sourceModuleId: "receipts",
  sourceExternalId: "rc-1",
  sourceNumber: "ПН-3-085",
  debitAccountExternalId: "acc-1310",
  creditAccountExternalId: "acc-3310",
  debitAccount: { code: "1310", name: "Сырьё" },
  creditAccount: { code: "3310", name: "Поставщики" },
  amount: 50_000,
  description: "Приход",
})
const REFUND = line({ _id: "j3" as JournalRow["_id"], sourceModuleId: "orders", sourceExternalId: "o1", sourceNumber: "№1-В", reversalOf: "j1" as JournalRow["_id"], description: "Возврат заказа №1" })

function operation(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "tx" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "tx-draft",
    moduleId: "transactions",
    number: "ПР-2026-00001",
    name: "Инкассация в банк",
    status: "draft",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-20",
    amount: 1000,
    debitAccountExternalId: "acc-1030",
    creditAccountExternalId: "acc-1010",
    data: { comment: "Сдали в банк", documentReference: "ПКО-5" },
    searchText: "",
    version: 4,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const OPERATIONS = [operation({}), operation({ externalId: "tx-posted", number: "ПР-2026-00002", status: "posted", version: 5 })]

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queryArgs = []
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/finance/records:references": {
      accounts: [
        { externalId: "acc-1010", code: "1010", name: "Касса", type: "asset", allowManualEntries: true },
        { externalId: "acc-1030", code: "1030", name: "Банк", type: "asset", allowManualEntries: true },
        { externalId: "acc-6010", code: "6010", name: "Выручка", type: "income", allowManualEntries: false },
      ],
      cashflowCategories: [],
      counterparties: [],
      restaurants: [{ externalId: "r1", name: "Sandyq Абая" }],
      truncated: false,
    },
    "domains/finance/records:get": (args: { externalId: string }) => OPERATIONS.find((row) => row.externalId === args.externalId) ?? null,
    [OVERVIEW]: (args: { accountExternalId?: string }) =>
      args.accountExternalId ? { mode: "account", debitTurnover: 2300, creditTurnover: 1000, balance: 1300, entriesCount: 3, truncated: false } : { mode: "book", turnover: 53_600, entriesCount: 3, truncated: false },
  }
  mocks.paginated = { [JOURNAL]: [ORDER, RECEIPT, REFUND], "domains/finance/records:list": [OPERATIONS[0]] }
  mocks.mutations = {
    [TRANSITION]: vi.fn(async () => ({ status: "posted", version: 5 })),
    [SAVE]: vi.fn(async () => ({ externalId: "tx-new", number: "ПР-2026-00003", version: 1 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <TransactionsWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

const last = (list: { name: string; args: unknown }[], name: string) => list.filter((call) => call.name === name).at(-1)?.args

describe("«Проводки» journal (W1-FIN-05)", () => {
  it("shows every journal line for the last 30 days, links system lines to their document, one turnover without an account", () => {
    renderAt("/office/transactions")
    expect(last(mocks.paginatedArgs, JOURNAL)).toEqual(last30Days())
    expect(screen.getByText("Оборот за период")).toBeTruthy()
    expect(screen.getByText(formatTenge(53_600), exact)).toBeTruthy()
    expect(screen.getByText("Проводок за 30 дней")).toBeTruthy()
    expect(screen.queryByText("Оборот Дт по счёту")).toBeNull()

    const table = screen.getByRole("table", { name: "Журнал проводок" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(["Номер", "Дата", "Дебет", "Кредит", "Сумма, ₸", "Источник", "Статус"])
    expect(within(table).getByRole("link", { name: "Приходная накладная" }).getAttribute("href")).toBe("/office/receipts/rc-1")
    expect(within(table).queryByRole("link", { name: "Касса · заказ" })).toBeNull()
    expect(within(table).getByText("1310 · Сырьё")).toBeTruthy()
    expect(within(table).getByText("Сторно")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новая операция" }).className).toContain("bg-primary")
  })

  it("document tabs: «Сторно» shows reversal lines, «Черновики» the manual drafts", () => {
    renderAt("/office/transactions")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Проведённые", "Сторно"])
    fireEvent.click(screen.getByRole("tab", { name: "Сторно" }))
    let table = screen.getByRole("table", { name: "Журнал проводок" })
    expect(within(table).getAllByRole("row")).toHaveLength(2)
    expect(within(table).getByText("№1-В")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "Черновики" }))
    expect(last(mocks.paginatedArgs, "domains/finance/records:list")).toMatchObject({ moduleId: "transactions", status: "draft" })
    table = screen.getByRole("table", { name: "Черновики ручных операций" })
    expect(within(table).getByText("ПР-2026-00001")).toBeTruthy()
  })

  it("filtering by an account switches KPI to Dr/Cr turnover — different numbers — and narrows the journal", async () => {
    renderAt("/office/transactions")
    fireEvent.click(screen.getByRole("combobox", { name: "Счёт" }))
    fireEvent.click(await screen.findByRole("option", { name: /1010 · Касса/ }))
    await waitFor(() => expect(screen.getByText("Оборот Дт по счёту")).toBeTruthy())
    expect(last(mocks.queryArgs, OVERVIEW)).toMatchObject({ accountExternalId: "acc-1010" })
    expect(last(mocks.paginatedArgs, JOURNAL)).toMatchObject({ accountExternalId: "acc-1010" })
    expect(screen.getByText(formatTenge(2300), exact)).toBeTruthy()
    expect(screen.getByText(formatTenge(1000), exact)).toBeTruthy()
    expect(screen.queryByText("Оборот за период")).toBeNull()
  })

  it("an incomplete period does not reach the server", () => {
    renderAt("/office/transactions")
    fireEvent.change(screen.getByLabelText("Период с"), { target: { value: "2026-10-01" } })
    fireEvent.change(screen.getByLabelText("Период по"), { target: { value: "2026-09-01" } })
    expect(screen.getByText("Укажите период")).toBeTruthy()
    expect(last(mocks.paginatedArgs, JOURNAL)).toBe("skip")
    expect(last(mocks.queryArgs, OVERVIEW)).toBe("skip")
  })

  it("hides «Новая операция» without the edit right", () => {
    renderAt("/office/transactions", ["office.transactions.view"])
    expect(screen.queryByRole("button", { name: "Новая операция" })).toBeNull()
  })
})

describe("manual operation card (W1-FIN-05)", () => {
  it("a new operation checks amount and accounts before calling the server", async () => {
    renderAt("/office/transactions/new")
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getByRole("button", { name: "Провести" }))
    expect(within(panel).getByText("Сумма должна быть больше нуля")).toBeTruthy()
    expect(within(panel).getByText("Выберите счёт дебета")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("an unchanged draft posts through records.transition with its version", async () => {
    renderAt("/office/transactions/tx-draft")
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByRole("button", { name: "Сохранить черновик" }).className).toContain("bg-card")
    fireEvent.click(within(panel).getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "transactions", externalId: "tx-draft", action: "post", expectedVersion: 4 }))
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("an edited draft is saved first, then posted with the new version", async () => {
    mocks.mutations[SAVE] = vi.fn(async () => ({ externalId: "tx-draft", number: "ПР-2026-00001", version: 5 }))
    renderAt("/office/transactions/tx-draft")
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("Первичный документ"), { target: { value: "ПКО-6" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith(expect.objectContaining({ action: "post", expectedVersion: 5 })))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "transactions", externalId: "tx-draft", expectedVersion: 4, debitAccountExternalId: "acc-1030", creditAccountExternalId: "acc-1010", data: { comment: "Сдали в банк", documentReference: "ПКО-6" } }),
    )
  })

  it("a posted operation is read-only; «Сторно» needs a reason", async () => {
    renderAt("/office/transactions/tx-posted")
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Провести" })).toBeNull()
    expect(within(panel).getByText("1030 · Банк")).toBeTruthy()
    fireEvent.click(within(panel).getByRole("button", { name: "Сторно" }))
    const confirm = await screen.findByRole("alertdialog")
    const submit = within(confirm).getByRole("button", { name: "Сторнировать" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(confirm).getByLabelText("Причина сторно"), { target: { value: "Ошибка в сумме" } })
    fireEvent.click(submit)
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "transactions", externalId: "tx-posted", action: "reverse", expectedVersion: 5, reason: "Ошибка в сумме" }))
  })
})
