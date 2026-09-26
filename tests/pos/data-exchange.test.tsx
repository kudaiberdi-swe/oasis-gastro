// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { DataExchangeWorkspace } from "@/office/features/data-exchange/ui/data-exchange-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-IIKO-07: «Обмен между точками / паритет iiko». View + branch mapping only; codes and PINs are fake.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs[name] = args
    return { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const OVERVIEW = "domains/iiko/office:integrationOverview"
const STATES = "domains/iiko/office:listEndpointStates"
const LINKS = "domains/iiko/office:restaurantLinkOptions"
const LINK = "domains/iiko/office:linkRestaurantToIikoDepartment"
const PROVISION = "domains/workforce/mutations:provisionPosAccess"

const EMPTY_OVERVIEW = { lastRun: null, runs: [], kpis: { operations: 0, mirrored: 0, blockedOneWay: 0, lastRunRecords: 0 } }

const RUN = {
  _id: "run1",
  _creationTime: 0,
  runExternalId: "iiko-run-2026-09-25",
  status: "completed",
  startedAt: Date.UTC(2026, 8, 25, 4, 0, 0),
  completedAt: Date.UTC(2026, 8, 25, 4, 1, 30),
  counts: { departments: 12, employees: 363 },
  countsByEndpoint: { "corporation/stores": 3, "corporation/terminals": 4 },
}

const LINK_OPTIONS = {
  restaurants: [
    { restaurantExternalId: "almaty", restaurantName: "Sandyq Алматы", iikoDepartmentExternalId: "dep-almaty", iikoDepartmentName: "Sandyq Алматы (iiko)", confirmedBy: "admin@sandyq.test", confirmedAt: 1000 },
    { restaurantExternalId: "astana", restaurantName: "Sandyq Астана", iikoDepartmentExternalId: null, iikoDepartmentName: null, confirmedBy: null, confirmedAt: null },
  ],
  departments: [
    { externalId: "dep-almaty", name: "Sandyq Алматы (iiko)", code: "ALM" },
    { externalId: "dep-astana", name: "Sandyq Астана (iiko)", code: "AST" },
  ],
}

const CANDIDATE = { _id: "c1", externalId: "iiko-9", displayName: "Данияр Касымов", code: "42", mainRoleCode: "COOK", departmentCodes: ["ALM"], active: true, branches: [{ externalId: "almaty", name: "Sandyq Алматы" }] }

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    [OVERVIEW]: EMPTY_OVERVIEW,
    [LINKS]: LINK_OPTIONS,
    "domains/workforce/queries:listBranches": [{ externalId: "almaty", name: "Sandyq Алматы" }],
    "domains/workforce/queries:listUnprovisioned": [CANDIDATE],
    "domains/workforce/queries:suggestCredentials": { code: "900001", pin: "1111" },
  }
  mocks.paginated = {}
  mocks.paginatedArgs = {}
  mocks.mutations = {
    [LINK]: vi.fn(async () => null),
    [PROVISION]: vi.fn(async () => ({ code: "900001" })),
  }
})

afterEach(cleanup)

function renderScreen(capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section", element: <DataExchangeWorkspace /> }], { initialEntries: ["/office/data-exchange"] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
}

/** L-15: the code and PIN never look like the office login to the browser. */
function expectNoAutofill(input: HTMLElement) {
  expect(input.getAttribute("autocomplete")).toBe("off")
  expect(input.getAttribute("inputmode")).toBe("numeric")
  expect(input.getAttribute("type")).toBe("text")
  const name = input.getAttribute("name") ?? ""
  expect(name).not.toBe("email")
  expect(name).not.toBe("password")
  expect(name).not.toMatch(/password|email|user/i)
}

describe("«Обмен между точками» — no import yet (parity with office/68)", () => {
  it("shows the header, the badge, zero KPIs and the import command with «Скопировать»", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    renderScreen()
    expect(screen.getByText("iiko Server → Convex")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Репликация и покрытие API" })).toBeTruthy()
    expect(screen.getByText("Импорт ещё не выполнялся")).toBeTruthy()
    for (const label of ["Операций Server API", "Зеркалируется", "Заблокировано one-way", "Записей последнего запуска"]) expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText("npm run iiko:seed -- --with-stock-master --with-products --with-balances --with-prices --with-sales")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Скопировать" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("npm run iiko:seed -- --with-stock-master --with-products --with-balances --with-prices --with-sales"))
    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeTruthy()
  })

  it("has no control that starts an import or talks to iiko", () => {
    renderScreen()
    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "")
    expect(labels.some((label) => /запуст|импортир|синхрон|обнов/i.test(label))).toBe(false)
  })

  it("the matrix has the bahandi columns, the domain filter and «Показано 0 из 0»", () => {
    renderScreen()
    const table = screen.getByRole("table", { name: "Матрица endpoint parity" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Метод", "Путь", "Операция", "Статус", "Convex / UI", "Записей"])
    expect(screen.getByRole("combobox", { name: "Домен" }).textContent).toContain("Все домены")
    expect(screen.getByText("Показано 0 из 0")).toBeTruthy()
  })
})

describe("«Доступ сотрудников к POS» (L-15)", () => {
  it("code and PIN fields are empty, not autofillable, and have no email/password names", () => {
    renderScreen()
    const form = screen.getByRole("form", { name: "Выдача доступа к POS" })
    expect(form.getAttribute("autocomplete")).toBe("off")
    const code = within(form).getByLabelText("Код входа") as HTMLInputElement
    const pin = within(form).getByLabelText("Новый PIN") as HTMLInputElement
    expectNoAutofill(code)
    expectNoAutofill(pin)
    expect(code.value).toBe("")
    expect(pin.value).toBe("")
    expect(form.querySelector('input[type="password"], input[name="email"], input[name="password"]')).toBeNull()
    expect(within(form).getByRole("button", { name: "Создать доступ" }).hasAttribute("disabled")).toBe(true)
  })

  it("provisions access with the shared form and shows the credentials once", async () => {
    renderScreen()
    const form = screen.getByRole("form", { name: "Выдача доступа к POS" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Сотрудник" }))
    fireEvent.click(await screen.findByRole("option", { name: /Данияр Касымов/ }))
    expect((within(form).getByLabelText("Код входа") as HTMLInputElement).value).toBe("900001")
    fireEvent.change(within(form).getByLabelText("Новый PIN"), { target: { value: "2468" } })
    fireEvent.click(within(form).getByRole("button", { name: "Создать доступ" }))
    await waitFor(() => expect(mocks.mutations[PROVISION]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[PROVISION]).toHaveBeenCalledWith({ iikoEmployeeExternalId: "iiko-9", employeeCode: "900001", pin: "2468", role: "cashier", restaurantExternalIds: ["almaty"] })
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Доступ выдан: Данияр Касымов")).toBeTruthy()
    expect(within(dialog).getByText("2468")).toBeTruthy()
  })

  it("checks the PIN length before the server", async () => {
    renderScreen()
    const form = screen.getByRole("form", { name: "Выдача доступа к POS" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Сотрудник" }))
    fireEvent.click(await screen.findByRole("option", { name: /Данияр Касымов/ }))
    fireEvent.change(within(form).getByLabelText("Новый PIN"), { target: { value: "12" } })
    fireEvent.click(within(form).getByRole("button", { name: "Создать доступ" }))
    expect(await within(form).findByText("PIN — от 4 до 6 цифр")).toBeTruthy()
    expect(mocks.mutations[PROVISION]).not.toHaveBeenCalled()
  })

  it("is hidden without office.employees.edit; mapping is read-only without office.data-exchange.edit", () => {
    renderScreen(["office.data-exchange.view"])
    expect(screen.queryByRole("form", { name: "Выдача доступа к POS" })).toBeNull()
    expect(screen.queryByRole("combobox", { name: /Подразделение iiko/ })).toBeNull()
    expect(screen.getByText("Sandyq Алматы (iiko)")).toBeTruthy()
  })
})

describe("«Сопоставление филиалов» (W1-IIKO-02)", () => {
  it("links a restaurant to an iiko department", async () => {
    renderScreen()
    const table = screen.getByRole("table", { name: "Сопоставление филиалов" })
    expect(within(table).getByText("Не сопоставлен")).toBeTruthy()
    fireEvent.click(within(table).getByRole("combobox", { name: "Подразделение iiko для «Sandyq Астана»" }))
    fireEvent.click(await screen.findByRole("option", { name: /Sandyq Астана \(iiko\)/ }))
    await waitFor(() => expect(mocks.mutations[LINK]).toHaveBeenCalledWith({ restaurantExternalId: "astana", iikoDepartmentExternalId: "dep-astana" }))
  })

  it("asks before taking a department from another restaurant and before unlinking", async () => {
    renderScreen()
    const table = screen.getByRole("table", { name: "Сопоставление филиалов" })
    fireEvent.click(within(table).getByRole("combobox", { name: "Подразделение iiko для «Sandyq Астана»" }))
    fireEvent.click(await screen.findByRole("option", { name: /Sandyq Алматы \(iiko\)/ }))
    const confirm = await screen.findByRole("alertdialog")
    expect(mocks.mutations[LINK]).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Перенести" }))
    await waitFor(() => expect(mocks.mutations[LINK]).toHaveBeenCalledWith({ restaurantExternalId: "astana", iikoDepartmentExternalId: "dep-almaty" }))

    fireEvent.click(within(table).getByRole("button", { name: "Снять" }))
    const unlink = await screen.findByRole("alertdialog")
    fireEvent.click(within(unlink).getByRole("button", { name: "Снять сопоставление" }))
    await waitFor(() => expect(mocks.mutations[LINK]).toHaveBeenLastCalledWith({ restaurantExternalId: "almaty", iikoDepartmentExternalId: undefined }))
  })
})

describe("after an import", () => {
  it("shows the last run, counts by endpoint, the run error and skip reasons in the matrix", () => {
    mocks.queries[OVERVIEW] = { lastRun: { ...RUN, error: "corporation/terminals: timeout" }, runs: [RUN, { ...RUN, _id: "run0", status: "failed" }], kpis: { operations: 2, mirrored: 2, blockedOneWay: 0, lastRunRecords: 7 } }
    mocks.paginated[STATES] = [
      { _id: "s1", _creationTime: 0, endpointKey: "corporation/terminals", lastStatus: "ok", lastRunAt: RUN.completedAt, classification: "mirrored", method: "GET", recordCount: 4, message: "Пропущено 1: подразделение dep-x не сопоставлено" },
      { _id: "s2", _creationTime: 0, endpointKey: "corporation/stores", lastStatus: "error", lastRunAt: RUN.completedAt, classification: "mirrored", method: "GET", recordCount: 0 },
    ]
    renderScreen()
    expect(screen.getAllByText("Готово").length).toBeGreaterThan(0)
    expect(screen.getByText("Импорт завершился с ошибкой")).toBeTruthy()
    expect(screen.getByText("iiko-run-2026-09-25")).toBeTruthy()
    expect(screen.getAllByText("1 мин 30 с").length).toBeGreaterThan(0)
    const counts = screen.getByRole("list", { name: "Записей по эндпоинтам" })
    expect(within(counts).getByText("Кассовые терминалы")).toBeTruthy()
    const matrix = screen.getByRole("table", { name: "Матрица endpoint parity" })
    expect(within(matrix).getByText("Пропущено 1: подразделение dep-x не сопоставлено")).toBeTruthy()
    expect(within(matrix).getAllByText("Зеркалируется")).toHaveLength(2)
    expect(within(matrix).getByText("Ошибка")).toBeTruthy()
    expect(within(matrix).getByText("posTerminals")).toBeTruthy()
    expect(screen.getByText("Показано 2 из 2")).toBeTruthy()
  })

  it("the domain filter goes to the server", async () => {
    renderScreen()
    fireEvent.click(screen.getByRole("combobox", { name: "Домен" }))
    fireEvent.click(await screen.findByRole("option", { name: "Организация" }))
    await waitFor(() => expect(mocks.paginatedArgs[STATES]).toEqual({ domain: "organization" }))
  })
})
