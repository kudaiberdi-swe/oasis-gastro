// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { RestaurantsWorkspace } from "@/office/features/corporation/ui/restaurants-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-ADM-07 «Рестораны». Restaurants and addresses are synthetic.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(reference)
    ;(mocks.queryArgs[name] ??= []).push(args)
    return mocks.queries[name]
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/corporation/restaurants:listRestaurants"
const SAVE = "domains/corporation/restaurants:saveRestaurant"
const SET_ACTIVE = "domains/corporation/restaurants:setRestaurantActive"
const ORGANIZATIONS = "domains/corporation/organizations:listOrganizations"
const CONTEXT = "domains/office/queries:context"

function restaurant(overrides: Record<string, unknown> = {}) {
  return {
    _id: "r1",
    _creationTime: 0,
    externalId: "almaty",
    organizationExternalId: "sandyq",
    name: "Sandyq Алматы",
    address: "пр. Абая, 1",
    city: "Алматы",
    timezone: "Asia/Almaty",
    currency: undefined,
    serviceMode: "table-service",
    businessDayCutoffMinutes: 240,
    active: true,
    version: 2,
    terminalCount: 2,
    warehouseCount: 1,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.queryArgs = {}
  mocks.queries = {
    [CONTEXT]: { ready: true, user: { restaurantScopes: ["*"] }, adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы", organizationExternalId: "sandyq" }], organization: { name: "Sandyq" } },
    [ORGANIZATIONS]: [
      { externalId: "sandyq", name: "Sandyq", active: true },
      { externalId: "tary", name: "Tary", active: true },
    ],
    [LIST]: [restaurant(), restaurant({ _id: "r2", externalId: "astana", name: "Sandyq Астана", city: undefined, address: "", active: false, terminalCount: 0, warehouseCount: 1 })],
  }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => "almaty"),
    [SET_ACTIVE]: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderWith(node: ReactNode, capabilities: string[] = ["*"]) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CapabilitiesProvider capabilities={capabilities}>{node}</CapabilitiesProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe("«Рестораны» (W2-ADM-07)", () => {
  it("lists every canonical restaurant with the configured columns (L-10)", () => {
    renderWith(<RestaurantsWorkspace />)
    const table = screen.getByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 6)).toEqual(["Название", "Город", "Адрес", "Терминалов", "Складов", "Статус"])
    const [, first, second] = within(table).getAllByRole("row")
    expect(within(first).getByText("Sandyq Алматы")).toBeTruthy()
    expect(within(first).getByText("пр. Абая, 1")).toBeTruthy()
    expect(within(first).getByText("2")).toBeTruthy()
    expect(within(second).getByText("Неактивно")).toBeTruthy()
    expect(screen.getByText("2 записи")).toBeTruthy()
  })

  it("the cutoff is typed as ЧЧ:ММ and saved in minutes", async () => {
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq Алматы"))
    const form = screen.getByRole("form", { name: "Ресторан" })
    const cutoff = within(form).getByLabelText("Отсечка бизнес-дня") as HTMLInputElement
    expect(cutoff.value).toBe("04:00")
    fireEvent.change(cutoff, { target: { value: "04:30" } })
    fireEvent.change(within(form).getByLabelText("Город"), { target: { value: " Алматы " } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
      externalId: "almaty",
      expectedVersion: 2,
      organizationExternalId: "sandyq",
      name: "Sandyq Алматы",
      address: "пр. Абая, 1",
      city: "Алматы",
      timezone: "Asia/Almaty",
      currency: undefined,
      serviceMode: "table-service",
      businessDayCutoffMinutes: 270,
    })
  })

  it("rejects a cutoff later than 12:00 before the server", async () => {
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq Алматы"))
    const form = screen.getByRole("form", { name: "Ресторан" })
    fireEvent.change(within(form).getByLabelText("Отсечка бизнес-дня"), { target: { value: "13:00" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await within(form).findByText("Время ЧЧ:ММ от 00:00 до 12:00")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("a new restaurant: concept defaults to table-service, the chosen one is sent", async () => {
    mocks.mutations[SAVE] = vi.fn(async () => "restaurant-new")
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новый ресторан/ })[0])
    const form = screen.getByRole("form", { name: "Ресторан" })
    expect(within(form).getByRole("radio", { name: "Ресторан с обслуживанием" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Sandyq Шымкент" } })
    fireEvent.change(within(form).getByLabelText("Адрес"), { target: { value: "ул. Тауке хана, 5" } })
    fireEvent.click(within(form).getByRole("radio", { name: "Фастфуд" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
      organizationExternalId: "sandyq",
      name: "Sandyq Шымкент",
      address: "ул. Тауке хана, 5",
      city: undefined,
      timezone: "Asia/Almaty",
      currency: undefined,
      serviceMode: "fast-food",
      businessDayCutoffMinutes: 0,
    })
    expect(await screen.findByText("Ресторан создан, основной склад добавлен")).toBeTruthy()
  })

  it("an iiko restaurant keeps name, address, zone and organization read-only", () => {
    mocks.queries[LIST] = [restaurant({ sourceSystem: "iiko-server" })]
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq Алматы"))
    const form = screen.getByRole("form", { name: "Ресторан" })
    expect((within(form).getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
    expect((within(form).getByLabelText("Адрес") as HTMLInputElement).disabled).toBe(true)
    expect(within(form).getAllByText("Из iiko, только чтение")).toHaveLength(4)
    expect((within(form).getByLabelText("Отсечка бизнес-дня") as HTMLInputElement).disabled).toBe(false)
  })

  it("«Сопоставление iiko» links to the data-exchange mapping", () => {
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq Алматы"))
    const tab = screen.getByRole("tab", { name: "Сопоставление iiko" })
    fireEvent.mouseDown(tab)
    fireEvent.click(tab)
    expect(screen.getByRole("link", { name: /Открыть сопоставление/ }).getAttribute("href")).toBe("/office/data-exchange")
  })

  it("filters by organization on the server and by status on the tabs", () => {
    renderWith(<RestaurantsWorkspace />)
    expect(mocks.queryArgs[LIST].at(-1)).toEqual({ organizationExternalId: undefined })
    fireEvent.click(screen.getByRole("tab", { name: /Неактивные/ }))
    expect(screen.getByText("Sandyq Астана")).toBeTruthy()
    expect(screen.queryByText("Sandyq Алматы")).toBeNull()
  })

  it("disabling with an open shift shows the server refusal in the dialog", async () => {
    mocks.mutations[SET_ACTIVE] = vi.fn(async () => {
      throw new Error("В ресторане открыта смена — закройте её перед отключением")
    })
    renderWith(<RestaurantsWorkspace />)
    fireEvent.click(screen.getByText("Sandyq Алматы"))
    fireEvent.click(screen.getByRole("switch", { name: "Ресторан активен" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Отключить" }))
    expect(await within(dialog).findByText(/открыта смена/)).toBeTruthy()
    expect(mocks.mutations[SET_ACTIVE]).toHaveBeenCalledWith({ externalId: "almaty", active: false })
  })
})
