// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import { ServicesWorkspace } from "@/office/features/finance/ui/services-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"

// W2-FIN-08: «Акты услуг» — document lifecycle, VAT shown and computed like the server, «Оплачено» from the obligation.

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
const exact = { normalizer: (text: string) => text.trim() }

function act(overrides: Partial<FinanceRecord>): FinanceRecord {
  return {
    _id: "s" as FinanceRecord["_id"],
    _creationTime: 0,
    externalId: "act-draft",
    moduleId: "services",
    number: "АУ-2026-00001",
    name: "Уборка сентябрь",
    status: "draft",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-20",
    amount: 112_000,
    counterpartyExternalId: "cp-1",
    debitAccountExternalId: "acc-7210",
    creditAccountExternalId: "acc-3310",
    data: { serviceDirection: "received", vatRate: 12, vatAmount: 12_000, dueDate: "2026-09-30", contract: "№ 7" },
    searchText: "",
    version: 3,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const ACTS = [act({}), act({ externalId: "act-posted", number: "АУ-2026-00002", status: "posted", version: 4, debitAccountExternalId: "acc-1210", creditAccountExternalId: "acc-6030", data: { serviceDirection: "provided", vatRate: 0, vatAmount: 0 }, amount: 325_000 })]
const OBLIGATION = act({ externalId: "obligation:services:act-posted:main", moduleId: "accounts-payable", number: "ОБ-2026-00001", status: "posted", amount: 200_000, data: { direction: "receivable", originalAmount: 325_000, allocatedAmount: 125_000 } })

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queryArgs = []
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/finance/records:references": {
      accounts: [
        { externalId: "acc-7210", code: "7210", name: "Расходы на услуги", type: "expense", allowManualEntries: true },
        { externalId: "acc-3310", code: "3310", name: "Поставщики", type: "liability", allowManualEntries: false },
        { externalId: "acc-1210", code: "1210", name: "Покупатели", type: "asset", allowManualEntries: false },
        { externalId: "acc-6030", code: "6030", name: "Доход от услуг", type: "income", allowManualEntries: false },
      ],
      cashflowCategories: [],
      counterparties: [{ externalId: "cp-1", name: "ТОО Клининг" }],
      restaurants: [{ externalId: "r1", name: "Sandyq Абая" }],
      truncated: false,
    },
    [GET]: (args: { moduleId: string; externalId: string }) => (args.moduleId === "accounts-payable" ? (args.externalId === OBLIGATION.externalId ? OBLIGATION : null) : (ACTS.find((row) => row.externalId === args.externalId) ?? null)),
  }
  mocks.paginated = { [LIST]: ACTS }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "act-draft", number: "АУ-2026-00001", version: 4 })),
    [TRANSITION]: vi.fn(async () => ({ status: "posted", version: 5 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <ServicesWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Акты услуг» register (W2-FIN-08)", () => {
  it("config columns, document tabs, «Оплачено» from the act's obligation", () => {
    renderAt("/office/services")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Проведённые", "Сторно"])
    const table = screen.getByRole("table", { name: "Акты услуг" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата", "Контрагент", "Направление", "Сумма, ₸", "Оплачено, ₸", "Статус"])
    const posted = within(table).getByText("АУ-2026-00002").closest("tr")!
    expect(within(posted).getByText("Оказанная услуга")).toBeTruthy()
    expect(within(posted).getByText(formatAmount(125_000), exact)).toBeTruthy()
    expect(within(table).getAllByText("ТОО Клининг")).toHaveLength(2)
    expect(mocks.queryArgs.some((call) => call.name === GET && (call.args as { externalId?: string }).externalId === "obligation:services:act-posted:main")).toBe(true)
    expect(screen.getByRole("button", { name: "Новый акт" }).className).toContain("bg-primary")
  })

  it("without «Задолженность» rights «Оплачено» is a dash and the obligation is never asked for", () => {
    renderAt("/office/services", ["office.services.view"])
    expect(mocks.queryArgs.some((call) => call.name === GET && call.args !== "skip")).toBe(false)
    expect(screen.queryByRole("button", { name: "Новый акт" })).toBeNull()
  })
})

describe("service act card (W2-FIN-08)", () => {
  it("a new act needs a counterparty and a positive amount before the server is called", async () => {
    renderAt("/office/services/new")
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getByRole("button", { name: "Провести" }))
    expect(within(panel).getByText("Выберите контрагента")).toBeTruthy()
    expect(within(panel).getByText("Сумма акта должна быть больше нуля")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("shows «в т. ч. НДС» and the default accounts; an edited draft is saved, then posted", async () => {
    renderAt("/office/services/act-draft")
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText(new RegExp(`в т\\. ч\\. НДС 12 %: ${formatTenge(12_000)}`), exact)).toBeTruthy()
    expect(within(panel).getAllByText(/По умолчанию — 7210 · Расходы на услуги/).length).toBeGreaterThan(0)
    expect(within(panel).getByRole("button", { name: "Провести" }).className).toContain("bg-primary")
    expect(within(panel).getByRole("button", { name: "Сохранить черновик" }).className).toContain("bg-card")

    fireEvent.change(within(panel).getByLabelText("Договор"), { target: { value: "№ 8" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "services", externalId: "act-draft", action: "post", expectedVersion: 4 }))
    const saved = (mocks.mutations[SAVE] as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved).toMatchObject({ moduleId: "services", externalId: "act-draft", expectedVersion: 3, counterpartyExternalId: "cp-1", data: { serviceDirection: "received", vatRate: 12, contract: "№ 8", dueDate: "2026-09-30" } })
    expect(saved).not.toHaveProperty("debitAccountExternalId")
  })

  it("a posted act is read-only with «Расчёты» and «Сторно»", async () => {
    renderAt("/office/services/act-posted")
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Провести" })).toBeNull()
    expect(within(panel).getByText("1210 · Покупатели")).toBeTruthy()
    expect(within(panel).getByRole("link", { name: "ОБ-2026-00001" }).getAttribute("href")).toBe("/office/accounts-payable/obligation%3Aservices%3Aact-posted%3Amain")
    expect(within(panel).getByText(formatTenge(200_000), exact)).toBeTruthy()
    fireEvent.click(within(panel).getByRole("button", { name: "Сторно" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.change(within(confirm).getByLabelText("Причина сторно"), { target: { value: "Ошибка в акте" } })
    fireEvent.click(within(confirm).getByRole("button", { name: "Сторнировать" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "services", externalId: "act-posted", action: "reverse", expectedVersion: 4, reason: "Ошибка в акте" }))
  })
})
