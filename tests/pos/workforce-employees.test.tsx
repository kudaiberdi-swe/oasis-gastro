// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { formatRate, profileArgs, profileDraftOf, validateHr } from "@/office/features/workforce/model/modules"
import { WorkforceWorkspace } from "@/office/features/workforce/ui/workforce-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-HR-01: the employees register (lifecycle master), «Из iiko» provisioning, «+ Новый сотрудник» and the HR card.
// Codes and PINs below are obviously fake test values.

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
    return args === "skip" ? { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true } : { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const text = (value: string) => value.replace(/\s/g, " ")

const CONTEXT = { adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }], user: { restaurantScopes: ["*"] } }
const BRANCHES = [{ externalId: "almaty", name: "Sandyq Алматы" }]

const HOURLY = {
  _id: "emp1",
  code: "555",
  displayName: "Айгерім Серікова",
  role: "cashier",
  restaurantIds: ["r1"],
  active: true,
  failedAttempts: 0,
  personnelNumber: "T-001",
  positionExternalId: "Кассир",
  payType: "hourly",
  baseRate: 2000,
  iin: "900101300123",
  phone: "+7 701 123 45 67",
  updatedAt: 1000,
  restaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }],
}

const SALARY = {
  _id: "emp2",
  code: "777",
  displayName: "Ерлан Нурланов",
  role: "manager",
  restaurantIds: ["r1"],
  active: false,
  failedAttempts: 0,
  payType: "salary",
  baseRate: 250000,
  iikoEmployeeExternalId: "iiko-2",
  restaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }],
}

const CANDIDATE = { _id: "c1", externalId: "iiko-9", displayName: "Данияр Касымов", code: "42", mainRoleCode: "COOK", departmentCodes: ["ALM"], active: true, branches: [{ externalId: "almaty", name: "Sandyq Алматы" }] }

beforeEach(() => {
  mocks.queries = {
    "domains/office/queries:context": CONTEXT,
    "domains/workforce/queries:listBranches": BRANCHES,
    "domains/workforce/queries:listUnprovisioned": [CANDIDATE],
    "domains/workforce/queries:suggestCredentials": { code: "900001", pin: "1111" },
    "domains/workforce/queries:getEmployee": HOURLY,
  }
  mocks.paginated = { "domains/workforce/queries:listEmployees": [HOURLY, SALARY] }
  mocks.paginatedArgs = {}
  mocks.mutations = {
    "domains/workforce/mutations:provisionPosAccess": vi.fn(async () => ({ code: "900001" })),
    "domains/workforce/mutations:createPosEmployee": vi.fn(async () => ({ employeeId: "emp9", code: "900001" })),
    "domains/workforce/mutations:updateEmployeeProfile": vi.fn(async () => null),
    "domains/workforce/mutations:updateEmployeeAssignment": vi.fn(async () => null),
    "domains/workforce/mutations:setEmployeeActive": vi.fn(async () => null),
    "domains/workforce/mutations:resetPin": vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"], element: ReactNode = <WorkforceWorkspace />) {
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

/** L-15: PIN and code fields never look like a login to the browser. */
function expectNoAutofill(input: HTMLElement) {
  expect(input.getAttribute("autocomplete")).toBe("off")
  expect(input.getAttribute("inputmode")).toBe("numeric")
  expect(input.getAttribute("type")).toBe("text")
  expect(input.getAttribute("name") ?? "").not.toMatch(/password|email|user/i)
}

describe("model (W1-HR-01)", () => {
  it("the rate always carries its unit (L-10)", () => {
    expect(text(formatRate(2000, "hourly")!)).toBe("2 000 ₸/ч")
    expect(text(formatRate(250000, "salary")!)).toBe("250 000 ₸/мес")
    expect(formatRate(undefined, "hourly")).toBeNull()
  })

  it("mirrors the server checks and always sends every HR field (an omitted one is cleared)", () => {
    expect(validateHr({ ...profileDraftOf(HOURLY as never), iin: "123" }).iin).toBe("ИИН — 12 цифр")
    expect(validateHr({ ...profileDraftOf(HOURLY as never), iin: "••••••••0123" }).iin).toBeUndefined()
    const args = profileArgs(HOURLY as never, { ...profileDraftOf(HOURLY as never), email: "" })
    expect(args).toMatchObject({ employeeId: "emp1", expectedUpdatedAt: 1000, personnelNumber: "T-001", iin: "900101300123", phone: "+7 701 123 45 67", email: "", payType: "hourly", baseRate: 2000, admitted: false })
  })
})

describe("«Сотрудники» register (W1-HR-01)", () => {
  it("shows master tabs and config columns: rate with a unit, POS code and role, status", () => {
    renderAt("/office/employees")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Активные", "Неактивные"])
    const table = screen.getByRole("table", { name: "Сотрудники" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(["Табельный №", "ФИО", "Должность", "Ресторан", "Ставка", "Тип оплаты", "Код POS", "Роль POS", "Статус"]))
    expect(headers.join(" ")).not.toContain("Сумма")
    expect(within(table).getByText((content) => text(content) === "2 000 ₸/ч")).toBeTruthy()
    expect(within(table).getByText((content) => text(content) === "250 000 ₸/мес")).toBeTruthy()
    expect(within(table).getByText("Почасовая")).toBeTruthy()
    expect(within(table).getByText("Менеджер")).toBeTruthy()
    expect(within(table).getByText("Неактивно")).toBeTruthy()
    expect(within(table).getByText("из iiko")).toBeTruthy()
  })

  it("the «Неактивные» tab asks the server for inactive employees", () => {
    renderAt("/office/employees")
    fireEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    expect(mocks.paginatedArgs["domains/workforce/queries:listEmployees"]).toMatchObject({ status: "inactive" })
  })

  it("a row opens the card; without the edit right there is no «Новый сотрудник»", () => {
    const router = renderAt("/office/employees", ["office.employees.view"])
    expect(screen.queryByRole("button", { name: /Новый сотрудник/ })).toBeNull()
    fireEvent.click(screen.getByText("Айгерім Серікова"))
    expect(router.state.location.pathname).toBe("/office/employees/emp1")
  })
})

describe("«Из iiko» (W1-HR-01 keeps the provisioning flow)", () => {
  it("provisions POS access with the suggested code and PIN; the fields are not autofilled", async () => {
    renderAt("/office/employees?view=iiko")
    expect(screen.getByRole("radio", { name: "Из iiko (1)" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Подключить" }))
    const dialog = await screen.findByRole("dialog")
    const pin = within(dialog).getByLabelText("PIN")
    expectNoAutofill(pin)
    expectNoAutofill(within(dialog).getByLabelText("Код сотрудника"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Выдать доступ" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/mutations:provisionPosAccess"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/workforce/mutations:provisionPosAccess"]).toHaveBeenCalledWith({ iikoEmployeeExternalId: "iiko-9", employeeCode: "900001", pin: "1111", role: "cashier", restaurantExternalIds: ["almaty"] })
    expect(await within(dialog).findByText("Доступ выдан: Данияр Касымов")).toBeTruthy()
  })
})

describe("«+ Новый сотрудник» (createPosEmployee)", () => {
  it("checks the PIN length before the server and sends the HR fields", async () => {
    renderAt("/office/employees")
    fireEvent.click(screen.getByRole("button", { name: /Новый сотрудник/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("ФИО"), { target: { value: "Асель Тестова" } })
    const pin = within(dialog).getByLabelText("PIN")
    expectNoAutofill(pin)
    fireEvent.change(pin, { target: { value: "123" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать сотрудника" }))
    expect(await within(dialog).findByText("PIN — от 4 до 6 цифр")).toBeTruthy()
    expect(mocks.mutations["domains/workforce/mutations:createPosEmployee"]).not.toHaveBeenCalled()

    fireEvent.change(pin, { target: { value: "2468" } })
    fireEvent.change(within(dialog).getByLabelText("Табельный номер"), { target: { value: "T-100" } })
    fireEvent.change(within(dialog).getByLabelText("Ставка"), { target: { value: "2000" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать сотрудника" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/mutations:createPosEmployee"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/workforce/mutations:createPosEmployee"]).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Асель Тестова", employeeCode: "900001", pin: "2468", role: "cashier", restaurantExternalIds: ["almaty"], personnelNumber: "T-100", baseRate: 2000 }),
    )
    expect(await within(dialog).findByText("Сотрудник создан: Асель Тестова")).toBeTruthy()
  })
})

describe("HR card /office/employees/:id", () => {
  it("has the three blocks and saves the profile with every field and the concurrency stamp", async () => {
    renderAt("/office/employees/emp1")
    expect(screen.getByRole("heading", { name: "Айгерім Серікова" })).toBeTruthy()
    for (const block of ["Основные", "Оплата", "Доступ к кассе"]) expect(screen.getByRole("region", { name: block })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "aigerim@sandyq.test" } })
    fireEvent.click(screen.getByRole("switch", { name: "Допущен к работе" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/mutations:updateEmployeeProfile"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/workforce/mutations:updateEmployeeProfile"]).toHaveBeenCalledWith({
      employeeId: "emp1",
      displayName: "Айгерім Серікова",
      expectedUpdatedAt: 1000,
      personnelNumber: "T-001",
      iin: "900101300123",
      phone: "+7 701 123 45 67",
      email: "aigerim@sandyq.test",
      employmentDate: "",
      admitted: true,
      positionExternalId: "Кассир",
      payType: "hourly",
      baseRate: 2000,
      applyBasicDeduction: false,
    })
    expect(mocks.mutations["domains/workforce/mutations:updateEmployeeAssignment"]).not.toHaveBeenCalled()
  })

  it("with masked personal data the HR fields are read-only, so a save never wipes the IIN", () => {
    mocks.queries["domains/workforce/queries:getEmployee"] = { ...HOURLY, iin: "••••••••0123", phone: "•••••••••••••••67" }
    renderAt("/office/employees/emp1")
    expect(screen.getByText("ИИН и телефон скрыты")).toBeTruthy()
    expect(screen.getByText("••••••••0123")).toBeTruthy()
    expect(screen.queryByLabelText("Email")).toBeNull()
  })

  it("«Сбросить PIN» uses a non-autofill field; «Отключить» asks for confirmation", async () => {
    renderAt("/office/employees/emp1")
    fireEvent.click(screen.getByRole("button", { name: "Сбросить PIN" }))
    const dialog = await screen.findByRole("dialog")
    expectNoAutofill(within(dialog).getByLabelText("Новый PIN"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Сбросить PIN" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/mutations:resetPin"]).toHaveBeenCalledWith({ employeeId: "emp1", pin: "1111" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Готово" }))

    fireEvent.click(screen.getByRole("button", { name: "Отключить" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Отключить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/mutations:setEmployeeActive"]).toHaveBeenCalledWith({ employeeId: "emp1", active: false }))
  })
})
