// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { CouriersWorkspace } from "@/office/features/delivery/ui/couriers-workspace"
import { SourcesWorkspace } from "@/office/features/delivery/ui/sources-workspace"
import { ZonesWorkspace } from "@/office/features/delivery/ui/zones-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-DLV-06…08: «Зоны доставки», «Курьеры», «Источники заказов» (master-detail). Data is synthetic.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
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
    return { results: args === "skip" ? [] : (mocks.paginated[name] ?? []), status: args === "skip" ? "LoadingFirstPage" : "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const SAVE_ZONE = "domains/delivery/mutations:saveZone"
const SAVE_COURIER = "domains/delivery/mutations:saveCourier"
const SET_STATUS = "domains/delivery/mutations:setCourierStatus"
const SAVE_SOURCE = "domains/delivery/mutations:saveSource"
const EMPLOYEES = "domains/workforce/queries:listEmployees"

const ZONE = {
  _id: "z1",
  _creationTime: 0,
  externalId: "zone-center",
  restaurantExternalId: "r1",
  name: "Центр",
  priority: 10,
  polygon: [
    { latitude: 43.26, longitude: 76.92 },
    { latitude: 43.26, longitude: 76.96 },
    { latitude: 43.23, longitude: 76.96 },
    { latitude: 43.23, longitude: 76.92 },
  ],
  deliveryFee: 600,
  minimumOrder: 3000,
  cookingMinutes: 20,
  deliveryMinutes: 32,
  active: true,
  updatedAt: 0,
}

function courier(overrides: Record<string, unknown> = {}) {
  return { _id: "c1", _creationTime: 0, externalId: "courier-101", employeeCode: "101", restaurantExternalId: "r1", name: "Курьер АДК", phone: "7700••••90", transport: "scooter", status: "available", active: true, updatedAt: 0, ...overrides }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/delivery/queries:zones": [ZONE],
    "domains/delivery/queries:couriers": [courier(), courier({ _id: "c2", externalId: "courier-102", employeeCode: "102", name: "Курьер Бек", status: "offline", transport: "car" }), courier({ _id: "c3", externalId: "courier-103", employeeCode: "103", name: "Курьер Нур", status: "on-delivery" })],
    "domains/delivery/queries:sources": [
      { _id: "s1", _creationTime: 0, externalId: "source-phone", name: "Телефон", kind: "phone", restaurantExternalIds: ["*"], commissionPercent: 0, confirmationRequired: false, settlementMode: "on-delivered", defaultPaymentTypeExternalId: "pt-cash", active: true, updatedAt: 0 },
      { _id: "s2", _creationTime: 0, externalId: "source-site", name: "Сайт sandyq.kz", kind: "website", restaurantExternalIds: ["r1"], commissionPercent: 0, confirmationRequired: true, settlementMode: "on-closed", active: true, updatedAt: 0 },
    ],
    "domains/delivery/queries:references": { restaurants: [{ externalId: "r1", name: "Sandyq Абая" }], sources: [], couriers: [], paymentTypes: [{ externalId: "pt-cash", name: "Наличные курьеру" }] },
  }
  mocks.paginated = { [EMPLOYEES]: [{ _id: "e1", code: "104", displayName: "Данияр Касымов", phone: "77015550104", restaurantIds: ["r"] }] }
  mocks.mutations = {
    [SAVE_ZONE]: vi.fn(async () => "zone-new"),
    [SAVE_COURIER]: vi.fn(async () => "courier-104"),
    [SET_STATUS]: vi.fn(async () => "offline"),
    [SAVE_SOURCE]: vi.fn(async () => "source-new"),
  }
})

afterEach(cleanup)

function renderWith(children: ReactNode, capabilities: string[] = ["*"]) {
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>{children}</CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("«Зоны доставки» (W2-DLV-06, office/60)", () => {
  it("lists zones with the fee, minutes and state, and opens the card with the coordinates and an SVG preview", () => {
    renderWith(<ZonesWorkspace />)
    const list = screen.getByRole("region", { name: "Действующие зоны" })
    expect(within(list).getByText("При пересечении используется больший приоритет")).toBeTruthy()
    expect(within(list).getByText("Центр · Sandyq Абая")).toBeTruthy()
    expect(within(list).getByText("Приоритет 10 · 4 точек")).toBeTruthy()
    expect(within(list).getByText("32 мин")).toBeTruthy()
    expect(within(list).getByText("Активна")).toBeTruthy()
    fireEvent.click(within(list).getByText("Центр · Sandyq Абая"))
    expect(screen.getByText("Одна координата latitude,longitude на строку")).toBeTruthy()
    expect((screen.getByLabelText("Координаты контура") as HTMLTextAreaElement).value).toBe("43.26,76.92\n43.26,76.96\n43.23,76.96\n43.23,76.92")
    expect(screen.getByRole("img", { name: "Контур зоны: 4 точек" })).toBeTruthy()
  })

  it("refuses a self-intersecting contour and saves a valid one with the parsed points", async () => {
    renderWith(<ZonesWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: /Новая зона/ }))
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Алмалы" } })
    fireEvent.change(screen.getByLabelText("Координаты контура"), { target: { value: "0,0\n1,1\n0,1\n1,0" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Границы зоны пересекают сами себя")).toBeTruthy()
    expect(mocks.mutations[SAVE_ZONE]).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Координаты контура"), { target: { value: "43.25,76.90\n43.25, 76.94\n43.22;76.94" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE_ZONE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE_ZONE]).toHaveBeenCalledWith({
      restaurantExternalId: "r1",
      name: "Алмалы",
      priority: 0,
      polygon: [
        { latitude: 43.25, longitude: 76.9 },
        { latitude: 43.25, longitude: 76.94 },
        { latitude: 43.22, longitude: 76.94 },
      ],
      deliveryFee: 0,
      minimumOrder: 0,
      cookingMinutes: 20,
      deliveryMinutes: 30,
      active: true,
    })
  })
})

describe("«Курьеры» (W2-DLV-07, office/61)", () => {
  it("shows Russian statuses and transport, opens or closes the shift from the row", async () => {
    renderWith(<CouriersWorkspace />)
    const list = screen.getByRole("region", { name: "Курьерская служба" })
    expect(within(list).getByText("Оперативный статус обновляется без изменения карточки")).toBeTruthy()
    expect(within(list).getAllByText("7700••••90 · Самокат")).toHaveLength(2)
    expect(within(list).getByText("7700••••90 · Автомобиль")).toBeTruthy()
    expect(within(list).getByText("Свободен")).toBeTruthy()
    expect(within(list).getByText("Не на смене")).toBeTruthy()
    expect(within(list).getByText("На доставке")).toBeTruthy()
    const shiftButtons = within(list).getAllByRole("button", { name: /смену/ })
    expect(shiftButtons.map((button) => button.textContent)).toEqual(["Закрыть смену", "Открыть смену", "Закрыть смену"])
    // A courier on an order keeps the shift.
    expect((shiftButtons[2] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(shiftButtons[1])
    await waitFor(() => expect(mocks.mutations[SET_STATUS]).toHaveBeenCalledWith({ externalId: "courier-102", status: "available" }))
  })

  it("creates a courier from an employee of the restaurant", async () => {
    renderWith(<CouriersWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: /Новый курьер/ }))
    expect(screen.getByText("Сотрудник должен существовать в разделе Сотрудники")).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Код сотрудника" }))
    fireEvent.click(await screen.findByRole("option", { name: /Данияр Касымов/ }))
    expect((screen.getByLabelText("Имя") as HTMLInputElement).value).toBe("Данияр Касымов")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE_COURIER]).toHaveBeenCalledWith({ employeeCode: "104", restaurantExternalId: "r1", name: "Данияр Касымов", phone: "77015550104", transport: "foot", active: true }))
    expect(mocks.paginatedArgs.find((call) => call.name === EMPLOYEES)?.args).toMatchObject({ restaurantExternalId: "r1", status: "active" })
  })

  it("sends a masked phone back as is — saveCourier keeps the stored number", async () => {
    renderWith(<CouriersWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0])
    expect((screen.getByLabelText("Телефон") as HTMLInputElement).value).toBe("7700••••90")
    expect(screen.getByText("Номер скрыт — при сохранении останется прежний")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE_COURIER]).toHaveBeenCalledWith(expect.objectContaining({ externalId: "courier-101", phone: "7700••••90" })))
  })

  it("«Ввести новый номер» clears a hidden phone, and a new one is checked", async () => {
    renderWith(<CouriersWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Ввести новый номер" }))
    expect((screen.getByLabelText("Телефон") as HTMLInputElement).value).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Телефон — от 10 до 15 цифр")).toBeTruthy()
    expect(mocks.mutations[SAVE_COURIER]).not.toHaveBeenCalled()
  })
})

describe("«Источники заказов» (W2-DLV-08, office/64)", () => {
  it("lists channels with the commission and saves the source card with restaurants as chips", async () => {
    renderWith(<SourcesWorkspace />)
    const list = screen.getByRole("region", { name: "Каналы" })
    expect(within(list).getByText("Комиссия учитывается в аналитике доставки")).toBeTruthy()
    expect(within(list).getByText("Сайт · расчёт при закрытии")).toBeTruthy()
    expect(within(list).getAllByText("Активен")).toHaveLength(2)
    fireEvent.click(within(list).getByText("Сайт sandyq.kz"))
    expect(screen.getByText("Секреты задаются в разделе Обмен")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Убрать Sandyq Абая" })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Комиссия, %"), { target: { value: "120" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Комиссия — от 0 до 100 %")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Комиссия, %"), { target: { value: "12,5" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() =>
      expect(mocks.mutations[SAVE_SOURCE]).toHaveBeenCalledWith({
        externalId: "source-site",
        name: "Сайт sandyq.kz",
        kind: "website",
        restaurantExternalIds: ["r1"],
        commissionPercent: 12.5,
        confirmationRequired: true,
        settlementMode: "on-closed",
        defaultPaymentTypeExternalId: undefined,
        active: true,
      }),
    )
  })

  it("is read-only without the edit right", () => {
    renderWith(<SourcesWorkspace />, ["office.delivery-sources.view"])
    expect(screen.queryByRole("button", { name: /Новый источник/ })).toBeNull()
    fireEvent.click(screen.getByText("Телефон"))
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    expect((screen.getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
  })
})
