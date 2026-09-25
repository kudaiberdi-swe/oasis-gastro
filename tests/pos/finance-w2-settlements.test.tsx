// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import { AccountsPayableWorkspace } from "@/office/features/finance/ui/accounts-payable-workspace"
import { PaymentsWorkspace } from "@/office/features/finance/ui/payments-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"

// W2-FIN-09/10: «Задолженность» (own KPI, rows lead to the source document, «Оплатить») and «Платежи»
// (approval lifecycle, allocation table, advance).

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

const SAVE = "domains/finance/records:save"
const TRANSITION = "domains/finance/records:transition"
const LIST = "domains/finance/records:list"
const GET = "domains/finance/records:get"
const SUMMARY = "domains/finance/obligations:payablesSummary"
const OPEN = "domains/finance/obligations:openObligations"
const ALLOCATIONS_OF = "domains/finance/obligations:paymentAllocationsOf"
const SET_ALLOCATIONS = "domains/finance/obligations:setPaymentAllocations"
const exact = { normalizer: (text: string) => text.trim() }

function row(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "x" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "x",
    moduleId: "accounts-payable",
    number: "ОБ-2026-00001",
    name: "Оплата поставщику «ТОО Мясо» по ПН-1",
    status: "posted",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-01",
    amount: 40_000,
    counterpartyExternalId: "cp-1",
    data: {},
    searchText: "",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const FROM_RECEIPT = row({ externalId: "obligation:receipts:rc-1:main", data: { direction: "payable", originalAmount: 100_000, allocatedAmount: 60_000, dueDate: "2020-01-10", sourceModuleId: "receipts", sourceExternalId: "rc-1", sourceNumber: "ПН-1", obligationKind: "supplier" } })
const RECEIVABLE = row({ externalId: "obligation:services:act-1:main", number: "ОБ-2026-00002", name: "Оплата от покупателя: кейтеринг", amount: 90_000, counterpartyExternalId: "cp-2", data: { direction: "receivable", originalAmount: 90_000, allocatedAmount: 0, dueDate: null, sourceModuleId: "services", sourceExternalId: "act-1", sourceNumber: "АУ-1", obligationKind: "service" } })
const MANUAL = row({ externalId: "ob-manual", number: "ОБ-2026-00003", name: "Штраф по договору", status: "draft", amount: 5000, version: 2, data: { direction: "payable", originalAmount: 5000, allocatedAmount: 0, dueDate: null, sourceModuleId: "accounts-payable", sourceExternalId: "", sourceNumber: "", obligationKind: "other" } })
const OBLIGATIONS = [FROM_RECEIPT, RECEIVABLE, MANUAL]

const PAYMENT_DRAFT = row({ externalId: "pay-draft", moduleId: "payments", number: "ПЛ-2026-00001", name: "Оплата мяса", status: "draft", amount: 50_000, cashflowCategoryExternalId: "cat-out", version: 3, data: { direction: "outgoing", method: "bank" } })
const PAYMENT_APPROVED = row({ externalId: "pay-approved", moduleId: "payments", number: "ПЛ-2026-00002", name: "Оплата мяса", status: "approved", amount: 30_000, cashflowCategoryExternalId: "cat-out", version: 6, data: { direction: "outgoing", method: "cash" } })
const PAYMENTS = [PAYMENT_DRAFT, PAYMENT_APPROVED]

const OPEN_ROWS = [
  { externalId: "obligation:receipts:rc-1:main", number: "ОБ-2026-00001", name: "Оплата поставщику «ТОО Мясо» по ПН-1", open: 40_000, original: 100_000, dueDate: "2026-09-10", sourceNumber: "ПН-1" },
  { externalId: "obligation:receipts:rc-2:main", number: "ОБ-2026-00004", name: "Оплата поставщику «ТОО Мясо» по ПН-2", open: 70_000, original: 70_000, dueDate: "2026-10-10", sourceNumber: "ПН-2" },
]

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queryArgs = []
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/finance/records:references": {
      accounts: [],
      cashflowCategories: [
        { externalId: "cat-out", name: "Оплата поставщикам", direction: "outgoing" },
        { externalId: "cat-in", name: "Поступления от покупателей", direction: "incoming" },
      ],
      counterparties: [
        { externalId: "cp-1", name: "ТОО Мясо" },
        { externalId: "cp-2", name: "ТОО Кейтеринг-клиент" },
      ],
      restaurants: [{ externalId: "r1", name: "Sandyq Абая" }],
      truncated: false,
    },
    [GET]: (args: { externalId: string }) => [...OBLIGATIONS, ...PAYMENTS].find((candidate) => candidate.externalId === args.externalId) ?? null,
    [SUMMARY]: { payable: 45_000, overdue: 40_000, receivable: 90_000, ageing: { upTo30: 5000, from31to60: 40_000, over60: 0 } },
    [OPEN]: (args: { counterpartyExternalId: string; direction: string }) => (args.counterpartyExternalId === "cp-1" && args.direction === "payable" ? OPEN_ROWS : []),
    [ALLOCATIONS_OF]: (args: { paymentExternalId: string }) => (args.paymentExternalId === "pay-approved" ? [{ paymentExternalId: "pay-approved", obligationExternalId: "obligation:receipts:rc-1:main", amount: 30_000 }] : []),
  }
  mocks.paginated = { [LIST]: (args: { moduleId: string }) => (args.moduleId === "payments" ? PAYMENTS : OBLIGATIONS) }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "pay-new", number: "ПЛ-2026-00003", version: 1 })),
    [TRANSITION]: vi.fn(async () => ({ status: "pending-approval", version: 2 })),
    [SET_ALLOCATIONS]: vi.fn(async () => ({ allocated: 40_000, advance: 0 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter(
    [
      { path: "/office/accounts-payable/:id?", element: <AccountsPayableWorkspace /> },
      { path: "/office/payments/:id?", element: <PaymentsWorkspace /> },
      { path: "/office/:section/:id?", element: <p>Другой раздел</p> },
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

describe("«Задолженность» (W2-FIN-09)", () => {
  it("own KPI (not the journal's), approval tabs, config columns in whole tenge", () => {
    renderAt("/office/accounts-payable")
    expect(screen.getByText("К оплате")).toBeTruthy()
    expect(screen.getByText(formatTenge(45_000), exact)).toBeTruthy()
    expect(screen.getByText("Просрочено", { selector: "p" })).toBeTruthy()
    expect(screen.getByText("Дебиторская", { selector: "p" })).toBeTruthy()
    expect(screen.queryByText("Оборот по дебету")).toBeNull()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    const table = screen.getByRole("table", { name: "Задолженность" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата", "Контрагент", "Сумма, ₸", "Оплачено, ₸", "Остаток, ₸", "Срок", "Статус", "Действия"])
    const receipt = within(table).getByText("ОБ-2026-00001").closest("tr")!
    expect(within(receipt).getByText(formatAmount(100_000), exact)).toBeTruthy()
    expect(within(receipt).getByText(formatAmount(60_000), exact)).toBeTruthy()
    expect(within(receipt).getByText(formatAmount(40_000), exact)).toBeTruthy()
    expect(within(receipt).getByText("Приходная накладная ПН-1")).toBeTruthy()
    expect(within(receipt).getByText("Просрочено")).toBeTruthy()
  })

  it("«Кредиторская / Дебиторская» narrows the rows; KPI follow the restaurant filter", () => {
    renderAt("/office/accounts-payable")
    expect(mocks.queryArgs.filter((call) => call.name === SUMMARY).at(-1)?.args).toEqual({})
    fireEvent.click(screen.getByRole("radio", { name: "Дебиторская" }))
    const table = screen.getByRole("table", { name: "Задолженность" })
    expect(within(table).queryByText("ОБ-2026-00001")).toBeNull()
    expect(within(table).getByText("ОБ-2026-00002")).toBeTruthy()
    expect(screen.getByText("1 записей")).toBeTruthy()
  })

  it("a row leads to its source document; a manual one opens its card", async () => {
    const router = renderAt("/office/accounts-payable")
    fireEvent.click(within(screen.getByRole("table", { name: "Задолженность" })).getByText("ОБ-2026-00002"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/services/act-1"))
    await router.navigate("/office/accounts-payable")
    fireEvent.click(within(await screen.findByRole("table", { name: "Задолженность" })).getByText("ОБ-2026-00003"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/accounts-payable/ob-manual"))
  })

  it("a manual draft goes through approval: «Отправить на согласование» is the one primary", async () => {
    renderAt("/office/accounts-payable/ob-manual")
    const panel = await screen.findByRole("dialog")
    const submit = within(panel).getByRole("button", { name: "Отправить на согласование" })
    expect(submit.className).toContain("bg-primary")
    expect(within(panel).getByRole("button", { name: "Сохранить черновик" }).className).toContain("bg-card")
    fireEvent.click(submit)
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "accounts-payable", externalId: "ob-manual", action: "submit", expectedVersion: 2 }))
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("a document-created obligation is read-only and never reversed by hand", async () => {
    renderAt(`/office/accounts-payable/${encodeURIComponent(FROM_RECEIPT.externalId)}`)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Сторно" })).toBeNull()
    expect(within(panel).getByText("Обязательство создано документом-основанием и сторнируется вместе с ним.")).toBeTruthy()
    expect(within(panel).getByRole("link", { name: "Приходная накладная ПН-1" }).getAttribute("href")).toBe("/office/receipts/rc-1")
  })

  it("«Оплатить» opens a payment draft filled with the obligation", async () => {
    const router = renderAt("/office/accounts-payable")
    fireEvent.click(screen.getByRole("button", { name: "Оплатить ОБ-2026-00001" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/payments/new"))
    expect(new URLSearchParams(router.state.location.search).get("obligation")).toBe(FROM_RECEIPT.externalId)
    const panel = await screen.findByRole("dialog")
    expect((within(panel).getByLabelText("Назначение платежа") as HTMLInputElement).value).toBe("Оплата поставщику «ТОО Мясо» по ПН-1")
    expect((within(panel).getByLabelText("К погашению по ОБ-2026-00001") as HTMLInputElement).value).toBe(formatAmount(40_000))
    expect((within(panel).getByLabelText("К погашению по ОБ-2026-00004") as HTMLInputElement).value).toBe("")
    expect(within(panel).getByText("Аванс").nextSibling?.textContent).toBe(formatTenge(0))
  })

  it("«Оплатить» is hidden without the right to create payments", () => {
    renderAt("/office/accounts-payable", ["office.accounts-payable.view"])
    expect(screen.queryByRole("button", { name: /Оплатить/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Новое обязательство" })).toBeNull()
  })
})

describe("«Платежи» (W2-FIN-10)", () => {
  it("approval tabs and config columns", () => {
    renderAt("/office/payments")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    const table = screen.getByRole("table", { name: "Платежи" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата", "Контрагент", "Направление", "Счёт", "Сумма, ₸", "Статус"])
    const approved = within(table).getByText("ПЛ-2026-00002").closest("tr")!
    expect(within(approved).getByText("Касса")).toBeTruthy()
    expect(within(approved).getByText("Исходящий")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "На согласовании" }))
    expect(mocks.paginatedArgs.filter((call) => call.name === LIST).at(-1)?.args).toMatchObject({ moduleId: "payments", status: "pending-approval" })
  })

  it("a draft allocates to several obligations; the rest is an advance; saving writes the allocation table", async () => {
    mocks.mutations[SAVE] = vi.fn(async () => ({ externalId: "pay-draft", number: "ПЛ-2026-00001", version: 4 }))
    renderAt("/office/payments/pay-draft")
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("К погашению по ОБ-2026-00001"), { target: { value: "40000" } })
    fireEvent.change(within(panel).getByLabelText("К погашению по ОБ-2026-00004"), { target: { value: "5000" } })
    expect(within(panel).getByText("Аванс").nextSibling?.textContent).toBe(formatTenge(5000))
    fireEvent.click(within(panel).getByRole("button", { name: "Отправить на согласование" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "payments", externalId: "pay-draft", action: "submit", expectedVersion: 4 }))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ moduleId: "payments", externalId: "pay-draft", expectedVersion: 3, counterpartyExternalId: "cp-1", cashflowCategoryExternalId: "cat-out", data: { direction: "outgoing", method: "bank" } }))
    expect(mocks.mutations[SET_ALLOCATIONS]).toHaveBeenCalledWith({
      paymentExternalId: "pay-draft",
      allocations: [
        { obligationExternalId: "obligation:receipts:rc-1:main", amount: 40_000 },
        { obligationExternalId: "obligation:receipts:rc-2:main", amount: 5000 },
      ],
    })
  })

  it("an allocation above the payment or the open remainder never reaches the server", async () => {
    renderAt("/office/payments/pay-draft")
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("К погашению по ОБ-2026-00004"), { target: { value: "60000" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    expect(within(panel).getByText("Распределено больше суммы платежа")).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText("К погашению по ОБ-2026-00004"), { target: { value: "" } })
    fireEvent.change(within(panel).getByLabelText("К погашению по ОБ-2026-00001"), { target: { value: "45000" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    expect(within(panel).getByText("Сумма платежа превышает открытый остаток обязательства")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("«Распределить по срокам» covers the earliest due first", async () => {
    renderAt("/office/payments/pay-draft")
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getByRole("button", { name: "Распределить по срокам" }))
    expect((within(panel).getByLabelText("К погашению по ОБ-2026-00001") as HTMLInputElement).value).toBe(formatAmount(40_000))
    expect((within(panel).getByLabelText("К погашению по ОБ-2026-00004") as HTMLInputElement).value).toBe(formatAmount(10_000))
  })

  it("an approved payment is read-only, shows its allocation and posts with «Провести»", async () => {
    renderAt("/office/payments/pay-approved")
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Сохранить черновик" })).toBeNull()
    expect(within(panel).queryByLabelText(/К погашению по/)).toBeNull()
    expect(within(panel).getByText("ОБ-2026-00001")).toBeTruthy()
    expect(within(panel).getByText("Распределено").nextSibling?.textContent).toBe(formatTenge(30_000))
    const post = within(panel).getByRole("button", { name: "Провести" })
    expect(post.className).toContain("bg-primary")
    fireEvent.click(post)
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "payments", externalId: "pay-approved", action: "post", expectedVersion: 6 }))
  })

  it("without the approve right a pending payment has no primary action", async () => {
    PAYMENTS.push(row({ externalId: "pay-pending", moduleId: "payments", number: "ПЛ-2026-00005", status: "pending-approval", amount: 1000, cashflowCategoryExternalId: "cat-out", data: { direction: "outgoing", method: "bank" } }))
    renderAt("/office/payments/pay-pending", ["office.payments.view", "office.payments.edit"])
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Согласовать" })).toBeNull()
    expect(within(panel).getByText("Запись на согласовании; изменить её можно после отмены.")).toBeTruthy()
    PAYMENTS.pop()
  })
})
