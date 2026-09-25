// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { descendantsOf } from "@/office/features/corporation/model/corporation"
import { DepartmentsWorkspace } from "@/office/features/corporation/ui/departments-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-ADM-08 «Подразделения». Departments and employees are synthetic.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    ;(mocks.paginatedArgs[name] ??= []).push(args)
    return { results: args === "skip" ? [] : (mocks.paginated[name] ?? []), status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/corporation/departments:listDepartments"
const SAVE = "domains/corporation/departments:saveDepartment"
const FROM_IIKO = "domains/corporation/departments:createFromIiko"
const SET_ACTIVE = "domains/corporation/departments:setDepartmentActive"
const LINKS = "domains/iiko/office:restaurantLinkOptions"
const EMPLOYEES = "domains/workforce/queries:listEmployees"
const CONTEXT = "domains/office/queries:context"
const ORGANIZATIONS = "domains/corporation/organizations:listOrganizations"

function department(overrides: Record<string, unknown> = {}) {
  return {
    _id: "d1",
    _creationTime: 0,
    externalId: "ops",
    organizationExternalId: "sandyq",
    code: "OPS",
    name: "Операционный департамент",
    kind: "office",
    active: true,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    level: 0,
    managerName: null,
    ...overrides,
  }
}

const TREE = [
  department(),
  department({ _id: "d2", externalId: "kitchen", code: "KIT", name: "Горячий цех", kind: "production", parentExternalId: "ops", restaurantExternalId: "almaty", level: 1, managerName: "Айгерим Сейтказы", managerEmployeeId: "emp1" }),
  department({ _id: "d3", externalId: "cold", code: "CLD", name: "Холодный цех", kind: "production", parentExternalId: "kitchen", level: 2 }),
  department({ _id: "d4", externalId: "delivery", code: "DLV", name: "Доставка", kind: "delivery", level: 0, active: false }),
]

beforeEach(() => {
  // cmdk (Combobox) scrolls the active option into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn()
  mocks.paginatedArgs = {}
  mocks.queries = {
    [CONTEXT]: { ready: true, user: { restaurantScopes: ["*"] }, adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы", organizationExternalId: "sandyq" }], organization: { name: "Sandyq" } },
    [ORGANIZATIONS]: [{ externalId: "sandyq", name: "Sandyq", active: true }],
    [LIST]: TREE,
    [LINKS]: { restaurants: [], departments: [{ externalId: "iiko-dep-1", name: "Sandyq Алматы (iiko)", code: "001" }] },
  }
  mocks.paginated = {
    [EMPLOYEES]: [
      { _id: "emp1", displayName: "Айгерим Сейтказы", code: "100001" },
      { _id: "emp2", displayName: "Бауыржан Нурланов", code: "100002" },
    ],
  }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => "department-new"),
    [FROM_IIKO]: vi.fn(async () => "department-iiko-iiko-dep-1"),
    [SET_ACTIVE]: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderWith(node: ReactNode, capabilities: string[] = ["*"]) {
  return render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>{node}</CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("«Подразделения» (W2-ADM-08)", () => {
  it("descendantsOf covers the department and its whole subtree", () => {
    expect([...descendantsOf(TREE, "ops")].sort()).toEqual(["cold", "kitchen", "ops"])
    expect([...descendantsOf(TREE, "cold")]).toEqual(["cold"])
  })

  it("shows the tree with indentation and the configured columns", () => {
    renderWith(<DepartmentsWorkspace />)
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 4)).toEqual(["Название", "Ресторан", "Ответственный", "Статус"])
    const [, ops, kitchen, cold] = within(table).getAllByRole("row")
    expect(within(ops).getByText("Операционный департамент")).toBeTruthy()
    expect(within(kitchen).getByText("Sandyq Алматы")).toBeTruthy()
    expect(within(kitchen).getByText("Айгерим Сейтказы")).toBeTruthy()
    const indent = (row: HTMLElement, name: string) => (within(row).getByText(name).parentElement as HTMLElement).style.paddingLeft
    expect(indent(kitchen, "Горячий цех")).toBe("20px")
    expect(indent(cold, "Холодный цех")).toBe("40px")
    expect(screen.getByText("4 записи")).toBeTruthy()
  })

  it("a department cannot pick itself or its children as the parent", () => {
    renderWith(<DepartmentsWorkspace />)
    fireEvent.click(screen.getByText("Операционный департамент"))
    const form = screen.getByRole("form", { name: "Подразделение" })
    fireEvent.click(within(form).getByRole("combobox", { name: "Родительское подразделение" }))
    const options = screen.getAllByRole("option").map((option) => option.textContent)
    expect(options.some((text) => text?.includes("Доставка"))).toBe(true)
    expect(options.some((text) => text?.includes("Горячий цех"))).toBe(false)
    expect(options.some((text) => text?.includes("Холодный цех"))).toBe(false)
    expect(options.some((text) => text?.includes("Операционный департамент"))).toBe(false)
  })

  it("creates «Горячий цех» under the operations department with a manager", async () => {
    renderWith(<DepartmentsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новое подразделение/ })[0])
    const form = screen.getByRole("form", { name: "Подразделение" })
    fireEvent.change(within(form).getByLabelText("Код"), { target: { value: " HOT " } })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Горячий цех 2" } })
    fireEvent.click(within(form).getByRole("combobox", { name: "Родительское подразделение" }))
    fireEvent.click(await screen.findByRole("option", { name: /Операционный департамент/ }))
    fireEvent.click(within(form).getByRole("combobox", { name: "Ответственный" }))
    fireEvent.click(await screen.findByRole("option", { name: /Бауыржан Нурланов/ }))
    fireEvent.change(within(form).getByLabelText("Центр затрат"), { target: { value: "CC-10" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
      organizationExternalId: "sandyq",
      restaurantExternalId: undefined,
      code: "HOT",
      name: "Горячий цех 2",
      parentExternalId: "ops",
      kind: "production",
      managerEmployeeId: "emp2",
      costCenter: "CC-10",
    })
    expect(mocks.paginatedArgs[EMPLOYEES].at(-1)).toEqual({ search: undefined, status: "active" })
  })

  it("validates code and name before the server", async () => {
    renderWith(<DepartmentsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новое подразделение/ })[0])
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Укажите код")).toBeTruthy()
    expect(screen.getByText("Укажите название")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("«Создать из iiko» copies one mirrored department", async () => {
    renderWith(<DepartmentsWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: /Создать из iiko/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Создать" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Подразделение iiko" }))
    fireEvent.click(await screen.findByRole("option", { name: /Sandyq Алматы \(iiko\)/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать" }))
    await waitFor(() => expect(mocks.mutations[FROM_IIKO]).toHaveBeenCalledWith({ iikoDepartmentExternalId: "iiko-dep-1", organizationExternalId: "sandyq" }))
    expect(await screen.findByText("Подразделение создано из iiko")).toBeTruthy()
  })

  it("without data-exchange or employees rights: no iiko import, no employee query", () => {
    renderWith(<DepartmentsWorkspace />, ["office.departments.view", "office.departments.edit"])
    expect(screen.queryByRole("button", { name: /Создать из iiko/ })).toBeNull()
    fireEvent.click(screen.getByText("Операционный департамент"))
    expect(mocks.paginatedArgs[EMPLOYEES]?.every((args) => args === "skip")).toBe(true)
    expect(screen.getByText("Список сотрудников доступен с правом «Сотрудники — просмотр»")).toBeTruthy()
  })
})
