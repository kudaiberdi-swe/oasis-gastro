// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { FinanceRecord } from "@/office/features/finance/data/use-finance-records"
import { CashflowCategoriesWorkspace } from "@/office/features/finance/ui/cashflow-categories-workspace"
import { CounterpartiesWorkspace } from "@/office/features/finance/ui/counterparties-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"

// W1-FIN-03/04: «Статьи ДДС» and «Контрагенты» — master registers with cards, no «Сумма» column (L-10).

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
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

const LIST = "domains/finance/records:list"
const SAVE = "domains/finance/records:save"
const TRANSITION = "domains/finance/records:transition"

function record(overrides: Partial<FinanceRecord> & Pick<FinanceRecord, "externalId" | "moduleId" | "name" | "data">): FinanceRecord {
  return {
    _id: overrides.externalId as FinanceRecord["_id"],
    _creationTime: 0,
    number: "ДДС-1",
    status: "active",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    businessDate: "2026-09-01",
    amount: 0,
    searchText: "",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const SALES = record({ externalId: "cf-sales", moduleId: "cashflow-categories", name: "Выручка от продаж", data: { code: "sales", direction: "incoming", activity: "operating" } })
const MEAT = record({ externalId: "cf-meat", moduleId: "cashflow-categories", number: "ДДС-2", name: "Мясо", status: "inactive", data: { code: "meat", direction: "outgoing", activity: "operating", parentExternalId: "cf-suppliers" } })
const MEAT_CO = record({
  externalId: "cp-meat",
  moduleId: "counterparties",
  number: "КА-1",
  name: "ТОО Мясной партнёр",
  bin: "123456789012",
  data: { roles: "supplier,customer", bin: "123456789012", bankAccount: "KZ123456789012345678", contact: "+7 701 111 22 33", vatPayer: true },
})
const RECORDS = [SALES, MEAT, MEAT_CO]

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/finance/records:references": {
      accounts: [],
      cashflowCategories: [
        { externalId: "cf-sales", name: "Выручка от продаж" },
        { externalId: "cf-suppliers", name: "Оплата поставщикам" },
      ],
      counterparties: [],
      restaurants: [{ externalId: "r1", name: "Sandyq Абая" }],
      truncated: false,
    },
    "domains/finance/records:get": (args: { moduleId: string; externalId: string }) => RECORDS.find((row) => row.externalId === args.externalId && row.moduleId === args.moduleId) ?? null,
    "domains/finance/queries:counterpartyDebt": { received: 50_000, paid: 20_000, debt: 30_000 },
  }
  mocks.paginated = { [LIST]: (args: { moduleId: string }) => RECORDS.filter((row) => row.moduleId === args.moduleId) }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "cf-new", number: "ДДС-3", version: 1 })),
    [TRANSITION]: vi.fn(async () => ({ status: "inactive", version: 2 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

const exact = { normalizer: (text: string) => text.trim() }
const lastListArgs = () => mocks.paginatedArgs.filter((call) => call.name === LIST).at(-1)?.args

describe("«Статьи ДДС» (W1-FIN-03)", () => {
  it("shows Название · Тип · Родитель · Статус without an amount, and master tabs filter by status", () => {
    renderAt("/office/cashflow-categories", <CashflowCategoriesWorkspace />)
    const table = screen.getByRole("table", { name: "Статьи ДДС" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(["Номер", "Название", "Тип", "Родитель", "Статус"]))
    expect(headers.join(" ")).not.toMatch(/Сумма/)
    expect(within(table).getByText("Приход")).toBeTruthy()
    expect(within(table).getByText("Оплата поставщикам")).toBeTruthy()
    expect(within(table).getByText("Неактивно")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новая статья" }).className).toContain("bg-primary")

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Активные", "Неактивные"])
    fireEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    expect(lastListArgs()).toMatchObject({ moduleId: "cashflow-categories", status: "inactive" })
  })

  it("hides «Новая статья» without the edit right", () => {
    renderAt("/office/cashflow-categories", <CashflowCategoriesWorkspace />, ["office.cashflow-categories.view"])
    expect(screen.queryByRole("button", { name: "Новая статья" })).toBeNull()
  })

  it("a new category checks name, code and direction before calling the server", async () => {
    renderAt("/office/cashflow-categories/new", <CashflowCategoriesWorkspace />)
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(within(panel).getByText("Укажите название статьи")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Аренда" } })
    fireEvent.change(within(panel).getByLabelText("Код"), { target: { value: "rent" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(within(panel).getByText("Выберите направление")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("an existing category saves with its version and can be switched off after confirmation", async () => {
    mocks.mutations[SAVE] = vi.fn(async () => ({ externalId: "cf-sales", number: "ДДС-1", version: 2 }))
    renderAt("/office/cashflow-categories/cf-sales", <CashflowCategoriesWorkspace />)
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Выручка зала" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "cashflow-categories", externalId: "cf-sales", expectedVersion: 1, name: "Выручка зала", amount: 0, data: { code: "sales", direction: "incoming", activity: "operating" } }),
    )
    await waitFor(() => expect((within(panel).getByRole("button", { name: "Отключить" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(panel).getByRole("button", { name: "Отключить" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Отключить" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "cashflow-categories", externalId: "cf-sales", action: "deactivate", expectedVersion: 1 }))
  })
})

describe("«Контрагенты» (W1-FIN-04)", () => {
  it("roles as pills, BIN, phone and «Долг ₸» from counterpartyDebt", () => {
    renderAt("/office/counterparties", <CounterpartiesWorkspace />)
    const table = screen.getByRole("table", { name: "Контрагенты" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(["Название", "БИН", "Тип", "Телефон", "Долг, ₸", "Статус"]))
    expect(within(table).getByText("Поставщик")).toBeTruthy()
    expect(within(table).getByText("Покупатель")).toBeTruthy()
    expect(within(table).queryByText("supplier,customer")).toBeNull()
    expect(within(table).getByText("123456789012")).toBeTruthy()
    expect(within(table).getByText(formatAmount(30_000), exact)).toBeTruthy()
    // KPI live only on «Проводки» (L-11).
    expect(screen.queryByText(/Оборот/)).toBeNull()
  })

  it("the card toggles roles as chips, shows the debt and saves roles as a comma string", async () => {
    renderAt("/office/counterparties/cp-meat", <CounterpartiesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText(formatTenge(30_000), exact)).toBeTruthy()
    const customer = within(panel).getByRole("button", { name: "Покупатель" })
    expect(customer.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(customer)
    fireEvent.click(within(panel).getByRole("button", { name: "Агрегатор" }))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ moduleId: "counterparties", externalId: "cp-meat", data: expect.objectContaining({ roles: "supplier,aggregator", bin: "123456789012", vatPayer: true }) }))
  })

  it("rejects a BIN that is not 12 digits before calling the server", async () => {
    renderAt("/office/counterparties/cp-meat", <CounterpartiesWorkspace />)
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("БИН / ИИН"), { target: { value: "1234" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(within(panel).getByText("БИН / ИИН — 12 цифр")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })
})
