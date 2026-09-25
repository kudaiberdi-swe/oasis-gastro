// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { minutesToTime, plural, recordCount, timeToMinutes } from "@/office/features/corporation/model/corporation"
import { OrganizationsWorkspace } from "@/office/features/corporation/ui/organizations-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-ADM-06 «Организации». Organizations, BINs and names are synthetic.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
    return typeof value === "function" ? value(args) : value
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/corporation/organizations:listOrganizations"
const SAVE = "domains/corporation/organizations:saveOrganization"
const SET_ACTIVE = "domains/corporation/organizations:setOrganizationActive"
const CONTEXT = "domains/office/queries:context"

// 1..9,0,1 + control digit 3 passes the KZ check (tests/convex/corporation.test.ts).
const VALID_BIN = "123456789013"

function organization(overrides: Record<string, unknown> = {}) {
  return {
    _id: "org1",
    _creationTime: 0,
    externalId: "sandyq",
    name: "Sandyq",
    legalName: "ТОО «Сандык Тест»",
    bin: VALID_BIN,
    currency: "KZT",
    timezone: "Asia/Almaty",
    jurisdiction: "KZ",
    vatPayer: true,
    active: true,
    version: 4,
    restaurantCount: 3,
    activeRestaurantCount: 3,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.queries = {
    [CONTEXT]: { ready: true, user: { restaurantScopes: ["*"] }, adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы", organizationExternalId: "sandyq" }], organization: { name: "Sandyq", timezone: "Asia/Almaty", currency: "KZT" } },
    [LIST]: [organization(), organization({ _id: "org2", externalId: "old", name: "Старая организация", legalName: undefined, bin: undefined, active: false, restaurantCount: 0, activeRestaurantCount: 0, version: 1 })],
  }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => "sandyq"),
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

describe("corporation model", () => {
  it("declines «запись» in Russian (not «1 записей»)", () => {
    expect(recordCount(1)).toBe("1 запись")
    expect(recordCount(3)).toBe("3 записи")
    expect(recordCount(11)).toBe("11 записей")
    expect(recordCount(21)).toBe("21 запись")
    expect(plural(114, ["a", "b", "c"])).toBe("c")
  })

  it("converts the business-day cutoff between ЧЧ:ММ and minutes", () => {
    expect(minutesToTime(0)).toBe("00:00")
    expect(minutesToTime(270)).toBe("04:30")
    expect(timeToMinutes("04:30")).toBe(270)
    expect(timeToMinutes("12:00")).toBe(720)
    expect(timeToMinutes("12:01")).toBeNull()
    expect(timeToMinutes("4:75")).toBeNull()
    expect(timeToMinutes("")).toBeNull()
  })
})

describe("«Организации» (W2-ADM-06)", () => {
  it("shows the configured columns instead of «Сумма / значение» (L-10) and Russian statuses (L-9)", () => {
    renderWith(<OrganizationsWorkspace />)
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 6)).toEqual(["Название", "БИН", "Валюта", "Часовой пояс", "Ресторанов", "Статус"])
    const [, first, second] = within(table).getAllByRole("row")
    expect(within(first).getByText("Sandyq")).toBeTruthy()
    expect(within(first).getByText(VALID_BIN)).toBeTruthy()
    expect(within(first).getByText("Активно")).toBeTruthy()
    expect(within(second).getByText("Неактивно")).toBeTruthy()
    expect(screen.getByText("2 записи")).toBeTruthy()
  })

  it("filters by status tab and search, with counters on the tabs", () => {
    renderWith(<OrganizationsWorkspace />)
    expect(screen.getByRole("tab", { name: /Активные/ }).textContent).toContain("1")
    fireEvent.click(screen.getByRole("tab", { name: /Неактивные/ }))
    expect(screen.getByText("Старая организация")).toBeTruthy()
    expect(screen.queryByText(VALID_BIN)).toBeNull()
    expect(screen.getByText("1 запись")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: /Все/ }))
    fireEvent.change(screen.getByLabelText("Поиск организаций"), { target: { value: "12345" } })
    expect(screen.getByText("Sandyq")).toBeTruthy()
    expect(screen.queryByText("Старая организация")).toBeNull()
  })

  it("checks the BIN control digit before the server and saves the edited legal name", async () => {
    renderWith(<OrganizationsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq"))
    const form = screen.getByRole("form", { name: "Организация" })
    expect((within(form).getByLabelText("Код организации") as HTMLInputElement).value).toBe("sandyq")
    fireEvent.change(within(form).getByLabelText("БИН / ИИН"), { target: { value: "123456789012" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await within(form).findByText(/контрольная цифра не сходится/)).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByLabelText("БИН / ИИН"), { target: { value: VALID_BIN } })
    fireEvent.change(within(form).getByLabelText("Юридическое название"), { target: { value: "  ТОО «Сандык Групп» " } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
      externalId: "sandyq",
      expectedVersion: 4,
      name: "Sandyq",
      legalName: "ТОО «Сандык Групп»",
      bin: VALID_BIN,
      currency: "KZT",
      timezone: "Asia/Almaty",
      jurisdiction: "KZ",
      vatPayer: true,
    })
    expect(await screen.findByText("Организация сохранена")).toBeTruthy()
  })

  it("an iiko organization marks its source fields «из iiko, только чтение»", () => {
    mocks.queries[LIST] = [organization({ sourceSystem: "iiko-server", sourceReadOnly: true })]
    renderWith(<OrganizationsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq"))
    const form = screen.getByRole("form", { name: "Организация" })
    expect((within(form).getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
    expect(within(form).getAllByText("Из iiko, только чтение")).toHaveLength(3)
    expect((within(form).getByLabelText("БИН / ИИН") as HTMLInputElement).disabled).toBe(false)
    expect((within(form).getByLabelText("Юридическое название") as HTMLInputElement).disabled).toBe(false)
  })

  it("disabling asks in a dialog and shows the server refusal there", async () => {
    mocks.mutations[SET_ACTIVE] = vi.fn(async () => {
      throw new Error("Сначала отключите рестораны организации")
    })
    renderWith(<OrganizationsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq"))
    fireEvent.click(screen.getByRole("switch", { name: "Организация активна" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Отключить организацию?")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Отключить" }))
    await waitFor(() => expect(mocks.mutations[SET_ACTIVE]).toHaveBeenCalledWith({ externalId: "sandyq", active: false }))
    expect(await within(dialog).findByText("Сначала отключите рестораны организации")).toBeTruthy()
  })

  it("without the edit right: no «Новая организация», no «Сохранить», fields read-only", () => {
    renderWith(<OrganizationsWorkspace />, ["office.organizations.view"])
    expect(screen.queryByRole("button", { name: /Новая организация/ })).toBeNull()
    fireEvent.click(screen.getByText("Sandyq"))
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    expect((screen.getByLabelText("БИН / ИИН") as HTMLInputElement).disabled).toBe(true)
  })

  it("a new organization is only offered to a network user", async () => {
    renderWith(<OrganizationsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новая организация/ })[0])
    const form = screen.getByRole("form", { name: "Организация" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Sandyq Astana LLP" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({ name: "Sandyq Astana LLP", legalName: undefined, bin: undefined, currency: "KZT", timezone: "Asia/Almaty", jurisdiction: "KZ", vatPayer: false })

    cleanup()
    mocks.queries[CONTEXT] = { ...(mocks.queries[CONTEXT] as object), user: { restaurantScopes: ["almaty"] } }
    renderWith(<OrganizationsWorkspace />)
    expect(screen.queryByRole("button", { name: /Новая организация/ })).toBeNull()
  })
})
