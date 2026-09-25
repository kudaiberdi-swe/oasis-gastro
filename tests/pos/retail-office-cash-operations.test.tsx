// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { CashOperationRow } from "@/office/features/retail/data/use-retail-office"
import { periodRange } from "@/office/features/retail/model/retail-office"
import { CashOperationsWorkspace } from "@/office/features/retail-settings/ui/cash-operations-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-RTL-04: «Внесения и изъятия» — «Журнал операций» over retail/office.listCashOperations and
// «Типы операций» (the versioned reference, unchanged).

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: [] as { name: string; args: unknown }[],
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs.push({ name, args })
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
    return { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: () => vi.fn(),
}))

const JOURNAL = "domains/retail/office:listCashOperations"
const SETTINGS = "domains/retail/queries:listSettings"

const row = (overrides: Partial<CashOperationRow>): CashOperationRow => ({
  _id: "e1" as CashOperationRow["_id"],
  direction: "cash-out",
  amount: -20_000,
  reason: "Инкассация вечерняя",
  operationTypeName: "Инкассация",
  employeeName: "Арман Арманов",
  shiftNumber: 180,
  businessDate: "2026-09-03",
  restaurantName: "Sandyq Абая",
  createdAt: Date.parse("2026-09-03T23:15:00+05:00"),
  ...overrides,
})

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": {
      adminRestaurants: [
        { externalId: "r1", name: "Sandyq Абая" },
        { externalId: "r2", name: "Sandyq Достык" },
      ],
      user: { restaurantScopes: ["*"] },
    },
    "domains/retail/queries:accountOptions": [],
  }
  mocks.paginated = {
    [JOURNAL]: [row({}), row({ _id: "e2" as CashOperationRow["_id"], direction: "cash-in", amount: 10_000, operationTypeName: "Внесение размена", reason: "", employeeName: null, shiftNumber: 181 })],
    [SETTINGS]: [],
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <CashOperationsWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={["*"]}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

const last = (name: string) => mocks.paginatedArgs.filter((call) => call.name === name).at(-1)?.args

describe("«Журнал операций» (W1-RTL-04)", () => {
  it("is the first tab: date / shift, operation pill, reason, employee and a signed amount", () => {
    renderAt("/office/cash-operations")
    expect(screen.getByRole("tab", { name: "Журнал операций" }).getAttribute("aria-selected")).toBe("true")
    const table = screen.getByRole("table", { name: "Журнал внесений и изъятий" })
    for (const header of ["Дата / смена", "Операция", "Основание", "Сотрудник", "Сумма"]) expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy()
    const [, cashOut, cashIn] = within(table).getAllByRole("row")
    expect(within(cashOut).getByText("Изъятие")).toBeTruthy()
    expect(within(cashOut).getByText("Инкассация")).toBeTruthy()
    expect(within(cashOut).getByText("Арман Арманов")).toBeTruthy()
    expect(within(cashOut).getByText("смена №180 · Sandyq Абая")).toBeTruthy()
    expect(within(cashOut).getByText(formatTenge(-20_000), { normalizer: (text) => text })).toBeTruthy()
    expect(formatTenge(-20_000).startsWith("−")).toBe(true)
    expect(within(cashIn).getByText("Внесение")).toBeTruthy()
    expect(within(cashIn).getByText("—")).toBeTruthy()
    // No direction: one page of both kinds and a hint how to page further.
    expect(last(JOURNAL)).toEqual({})
    expect(screen.getByText(/Чтобы листать дальше, выберите «Внесения» или «Изъятия»/)).toBeTruthy()
  })

  it("sends the Almaty day range of the period and asks to fix a reversed one", () => {
    renderAt("/office/cash-operations")
    fireEvent.change(screen.getByLabelText("Период с"), { target: { value: "2026-09-01" } })
    fireEvent.change(screen.getByLabelText("Период по"), { target: { value: "2026-09-03" } })
    expect(last(JOURNAL)).toEqual({ from: Date.parse("2026-09-01T00:00:00+05:00"), to: Date.parse("2026-09-03T23:59:59.999+05:00") })
    fireEvent.change(screen.getByLabelText("Период с"), { target: { value: "2026-09-05" } })
    expect(screen.getByText("Укажите период")).toBeTruthy()
    expect(last(JOURNAL)).toBe("skip")
  })

  it("an empty journal says where operations come from", () => {
    mocks.paginated[JOURNAL] = []
    renderAt("/office/cash-operations")
    expect(screen.getByText("Операций пока нет")).toBeTruthy()
  })

  it("«Типы операций» keeps the reference; an open type in the URL shows that tab", async () => {
    // ≥1440: the type's panel sits beside the register instead of a modal over the tabs.
    vi.stubGlobal("innerWidth", 1440)
    renderAt("/office/cash-operations")
    await userEvent.click(screen.getByRole("tab", { name: "Типы операций" }))
    expect(screen.getByRole("tab", { name: "Типы операций" }).getAttribute("aria-selected")).toBe("true")
    expect(last(SETTINGS)).toMatchObject({ kind: "cash-operation-type" })
    cleanup()
    renderAt("/office/cash-operations/cash-operation-type-collection")
    expect(screen.getByRole("tab", { name: "Типы операций" }).getAttribute("aria-selected")).toBe("true")
  })

  it("the journal tab closes an open type", async () => {
    vi.stubGlobal("innerWidth", 1440)
    const router = renderAt("/office/cash-operations/cash-operation-type-collection")
    await userEvent.click(screen.getByRole("tab", { name: "Журнал операций" }))
    expect(router.state.location.pathname).toBe("/office/cash-operations")
    expect(screen.getByRole("table", { name: "Журнал внесений и изъятий" })).toBeTruthy()
  })
})

describe("periodRange", () => {
  it("is empty without dates and null for a reversed or malformed period", () => {
    expect(periodRange("", "")).toEqual({})
    expect(periodRange("2026-09-02", "2026-09-01")).toBeNull()
    expect(periodRange("02.09.2026", "")).toBeNull()
  })
})
