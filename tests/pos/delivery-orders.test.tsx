// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { CallCenterWorkspace, DeliveryOrdersWorkspace } from "@/office/features/delivery/ui/delivery-orders-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W2-DLV-02…05: «Заказы доставки», «Колл-центр» and the order card. Orders and guests are synthetic.

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

const OVERVIEW = "domains/delivery/queries:overview"
const KPIS = "domains/delivery/queries:kpis"
const ORDER = "domains/delivery/queries:order"
const REFERENCES = "domains/delivery/queries:references"
const PRODUCTS = "domains/delivery/queries:products"
const SAVE = "domains/delivery/mutations:saveOrder"
const TRANSITION = "domains/delivery/mutations:transitionOrder"
const exact = { normalizer: (text: string) => text.trim() }

function row(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "delivery-1",
    number: "DEL-000001",
    status: "unprocessed",
    restaurantExternalId: "r1",
    customerName: "Айгерим",
    phone: "77015551234",
    address: "Абая 10, кв. 5",
    expectedAt: Date.parse("2026-09-25T14:30:00Z"),
    predictedCookingCompleteAt: null,
    courierName: null,
    total: 9600,
    paymentStatus: "unpaid",
    late: false,
    version: 1,
    ...overrides,
  }
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    _id: "d1",
    _creationTime: 0,
    externalId: "delivery-1",
    orderId: "o1",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    number: "DEL-000001",
    status: "on-way",
    customerName: "Айгерим",
    phone: "77015551234",
    address: "Абая 10, кв. 5",
    latitude: 43.2389,
    longitude: 76.8897,
    zoneExternalId: "zone-1",
    sourceExternalId: "source-phone",
    courierExternalId: "courier-101",
    expectedAt: Date.parse("2026-09-25T14:30:00Z"),
    cookingStartAt: Date.parse("2026-09-25T13:40:00Z"),
    predictedCookingCompleteAt: Date.parse("2026-09-25T14:00:00Z"),
    subtotal: 9000,
    deliveryFee: 600,
    total: 9600,
    paymentStatus: "unpaid",
    comment: "",
    version: 7,
    searchText: "",
    createdAt: 0,
    updatedAt: 0,
    source: { externalId: "source-phone", name: "Телефон", kind: "phone", settlementMode: "on-delivered", defaultPaymentTypeExternalId: "pt-cash" },
    zone: { externalId: "zone-1", name: "Центр", deliveryFee: 600, minimumOrder: 3000 },
    courier: { externalId: "courier-101", name: "Ерлан", status: "on-delivery" },
    lines: [{ productExternalId: "p-beshbarmak", productName: "Бешбармак", quantity: 2, unitPrice: 4500, lineTotal: 9000, sizeExternalId: null, sizeLabel: null, modifierSelections: [] }],
    ...overrides,
  }
}

const RESTAURANTS = [{ externalId: "r1", name: "Sandyq Абая" }]

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queryArgs = []
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: RESTAURANTS, user: { restaurantScopes: ["*"] } },
    [KPIS]: { active: 3, late: 1, onWay: 1, deliveredToday: 5 },
    [REFERENCES]: (args: { restaurantExternalId?: string }) =>
      args.restaurantExternalId
        ? {
            restaurants: RESTAURANTS,
            sources: [
              { externalId: "source-site", name: "Сайт sandyq.kz", kind: "website", commissionPercent: 0, settlementMode: "on-delivered", defaultPaymentTypeExternalId: null },
              { externalId: "source-phone", name: "Телефон", kind: "phone", commissionPercent: 0, settlementMode: "on-delivered", defaultPaymentTypeExternalId: "pt-cash" },
            ],
            couriers: [{ externalId: "courier-101", name: "Ерлан", status: "available", transport: "scooter" }],
            paymentTypes: [
              { externalId: "pt-cash", name: "Наличные курьеру" },
              { externalId: "pt-card", name: "Карта онлайн" },
            ],
          }
        : { restaurants: RESTAURANTS, sources: [], couriers: [], paymentTypes: [] },
    [PRODUCTS]: [
      { productExternalId: "p-beshbarmak", name: "Бешбармак", price: 4500, available: true, hasSizes: false },
      { productExternalId: "p-baursak", name: "Баурсаки", price: 900, available: false, hasSizes: false },
    ],
    [ORDER]: (args: { externalId: string }) => (args.externalId === "delivery-1" ? order() : null),
  }
  mocks.paginated = {
    [OVERVIEW]: [row(), row({ externalId: "delivery-2", number: "DEL-000002", status: "waiting", late: true, courierName: "Ерлан", predictedCookingCompleteAt: Date.parse("2026-09-25T14:00:00Z"), version: 4 })],
  }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "delivery-new", number: "DEL-000003", total: 9600 })),
    [TRANSITION]: vi.fn(async () => ({ status: "delivered", version: 8 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"], section: "delivery" | "call-center" = "delivery") {
  const Workspace = section === "call-center" ? CallCenterWorkspace : DeliveryOrdersWorkspace
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <Workspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Заказы доставки» register (W2-DLV-02, office/59)", () => {
  it("shows the four KPIs, six tabs, the parity columns and the rows with delivery statuses", () => {
    renderAt("/office/delivery-orders")
    const kpis = screen.getByRole("group", { name: "Показатели доставки" })
    for (const label of ["Активные", "Опаздывают", "В пути", "Доставлено сегодня"]) expect(within(kpis).getByText(label)).toBeTruthy()
    expect(within(kpis).getByText("5")).toBeTruthy()
    const tabs = screen.getByRole("tablist", { name: "Статус заказов" })
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["В работе", "Не обработаны", "Ожидают", "В пути", "Закрыты", "Все"])
    expect(screen.getByPlaceholderText("Номер, гость, телефон или адрес")).toBeTruthy()
    const table = screen.getByRole("table")
    for (const header of ["Заказ", "Обещано", "Гость / адрес", "Исполнение", "Сумма, ₸", "Статус"]) expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy()
    expect(within(table).getByText("DEL-000001")).toBeTruthy()
    expect(within(table).getByText("Не обработан")).toBeTruthy()
    expect(within(table).getByText("Ожидает")).toBeTruthy()
    expect(within(table).getByText("Опаздывает")).toBeTruthy()
    expect(within(table).getByText("Курьер не назначен")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Новый заказ/ })).toBeTruthy()
    expect(mocks.paginatedArgs.find((call) => call.name === OVERVIEW)?.args).toMatchObject({ tab: "active", channel: "delivery" })
  })

  it("runs the row's quick move with the row version and opens the card on a row click", async () => {
    const router = renderAt("/office/delivery-orders")
    fireEvent.click(screen.getByRole("button", { name: "Пора готовить" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "delivery-2", to: "ready-to-cook", expectedVersion: 4 }))
    expect(router.state.location.pathname).toBe("/office/delivery-orders")
    fireEvent.click(screen.getByText("DEL-000001"))
    expect(router.state.location.pathname).toBe("/office/delivery-orders/delivery-1")
  })

  it("filters by tab on the server and shows the parity empty text", () => {
    mocks.paginated[OVERVIEW] = []
    renderAt("/office/delivery-orders")
    expect(screen.getByText("Заказов с такими условиями нет")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "В пути" }))
    expect(mocks.paginatedArgs.at(-1)?.args).toMatchObject({ tab: "on-way" })
  })

  it("hides «Новый заказ» and the quick moves without the edit right", () => {
    renderAt("/office/delivery-orders", ["office.delivery-orders.view"])
    expect(screen.queryByRole("button", { name: /Новый заказ/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Пора готовить" })).toBeNull()
  })
})

describe("«Колл-центр» (W2-DLV-04, office/62)", () => {
  it("is the operator's workplace over the same register with the call-center rights", () => {
    const router = renderAt("/office/call-center", ["office.call-center.view", "office.call-center.edit"], "call-center")
    expect(screen.getByRole("heading", { name: "Рабочее место оператора" })).toBeTruthy()
    expect(mocks.paginatedArgs.find((call) => call.name === OVERVIEW)?.args).toMatchObject({ channel: "call-center" })
    expect(mocks.queryArgs.find((call) => call.name === KPIS)?.args).toMatchObject({ channel: "call-center" })
    fireEvent.click(screen.getByRole("button", { name: /Новый заказ/ }))
    expect(router.state.location.pathname).toBe("/office/call-center/new")
  })

  it("creates an order with the «Телефон» source pre-filled; number and total come from the server", async () => {
    const router = renderAt("/office/call-center/new", ["*"], "call-center")
    expect(screen.getByRole("heading", { name: "Новый заказ доставки" })).toBeTruthy()
    expect(screen.getByText("Присвоится при сохранении")).toBeTruthy()
    const guest = screen.getByRole("region", { name: "Гость и адрес" })
    fireEvent.change(within(guest).getByLabelText("Гость"), { target: { value: "Айгерим" } })
    fireEvent.change(within(guest).getByLabelText("Телефон"), { target: { value: "+7 701 555 12 34" } })
    fireEvent.change(within(guest).getByLabelText("Адрес"), { target: { value: "Абая 10, кв. 5" } })
    fireEvent.change(within(guest).getByLabelText("Широта"), { target: { value: "43.2389" } })
    fireEvent.change(within(guest).getByLabelText("Долгота"), { target: { value: "76.8897" } })

    const lines = screen.getByRole("region", { name: "Состав заказа" })
    expect(within(lines).getByText("Цены берутся из действующего каталога")).toBeTruthy()
    fireEvent.click(within(lines).getByRole("combobox", { name: "Добавить" }))
    fireEvent.click(await screen.findByRole("option", { name: /Баурсаки/ }))
    expect(within(lines).getByText("«Баурсаки» в стоп-листе ресторана")).toBeTruthy()
    fireEvent.click(within(lines).getByRole("combobox", { name: "Добавить" }))
    fireEvent.click(await screen.findByRole("option", { name: /Бешбармак/ }))
    // The unit price is the server's (resolvePrice); the line total waits for the save.
    expect(within(lines).getByText("4 500")).toBeTruthy()
    expect(within(lines).getByText("после сохранения")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "call-center",
        restaurantExternalId: "r1",
        sourceExternalId: "source-phone",
        customerName: "Айгерим",
        latitude: 43.2389,
        longitude: 76.8897,
        lines: [{ productExternalId: "p-beshbarmak", quantity: 1 }],
      }),
    )
    const args = (mocks.mutations[SAVE] as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(args).not.toHaveProperty("number")
    expect(await screen.findByText(`Заказ DEL-000003 сохранён · ${formatTenge(9600)}`, exact)).toBeTruthy()
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/call-center/delivery-new"))
  })

  it("does not save a new order with missing guest data", async () => {
    renderAt("/office/delivery-orders/new")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Укажите имя гостя")).toBeTruthy()
    expect(screen.getByText("Добавьте хотя бы одну позицию")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })
})

describe("order card transitions (W2-DLV-03/05, office-details/11)", () => {
  it("shows the card read-only once the order left the kitchen, with server totals", () => {
    renderAt("/office/delivery-orders/delivery-1")
    expect(screen.getByRole("heading", { name: "Доставка DEL-000001" })).toBeTruthy()
    expect(screen.getByText("В пути", { selector: "span" })).toBeTruthy()
    expect(screen.getByText("Единый заказ офиса, кассы и кухни")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    const lines = screen.getByRole("region", { name: "Состав заказа" })
    expect(within(lines).getByText("9 000")).toBeTruthy()
    expect(within(lines).getByText(formatTenge(600), exact)).toBeTruthy()
    expect(within(lines).getByText(formatTenge(9600), exact)).toBeTruthy()
  })

  it("asks «Оплата при доставке» before «Доставлен» with the source's payment type and the server total", async () => {
    renderAt("/office/delivery-orders/delivery-1")
    fireEvent.click(screen.getByRole("button", { name: "Доставлен" }))
    const dialog = await screen.findByRole("dialog", { name: "Оплата при доставке" })
    expect(within(dialog).getByText(formatTenge(9600), exact)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Оплатить и отметить доставленным" }))
    await waitFor(() =>
      expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "delivery-1", to: "delivered", expectedVersion: 7, payment: { paymentTypeExternalId: "pt-cash", amount: 9600 } }),
    )
  })

  it("explains a closed delivery shift in the payment dialog", async () => {
    mocks.mutations[TRANSITION] = vi.fn(async () => {
      throw new ConvexError("Откройте смену на кассе «Доставка» ресторана — доставка оплачивается в ней")
    })
    renderAt("/office/delivery-orders/delivery-1")
    fireEvent.click(screen.getByRole("button", { name: "Доставлен" }))
    const dialog = await screen.findByRole("dialog", { name: "Оплата при доставке" })
    fireEvent.click(within(dialog).getByRole("button", { name: /Оплатить/ }))
    expect(await within(dialog).findByText("Смена доставки закрыта")).toBeTruthy()
    expect(within(dialog).getByText(/Откройте смену на кассе «Доставка» в POS/)).toBeTruthy()
  })

  it("cancels only with a reason and the cancel right", async () => {
    mocks.queries[ORDER] = () => order({ status: "cooking", courierExternalId: undefined, courier: null })
    renderAt("/office/delivery-orders/delivery-1")
    expect(screen.getByRole("button", { name: "Приготовлен" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }))
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Отменить заказ" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Причина отмены"), { target: { value: "Гость отказался" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "delivery-1", to: "cancelled", expectedVersion: 7, reason: "Гость отказался" }))

    cleanup()
    renderAt("/office/delivery-orders/delivery-1", ["office.delivery-orders.view", "office.delivery-orders.edit"])
    expect(screen.getByRole("button", { name: "Приготовлен" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Отменить" })).toBeNull()
  })

  it("keeps the moves disabled while an editable order has unsaved changes", () => {
    mocks.queries[ORDER] = () => order({ status: "waiting" })
    renderAt("/office/delivery-orders/delivery-1")
    const move = screen.getByRole("button", { name: "Пора готовить" }) as HTMLButtonElement
    expect(move.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText("Адрес"), { target: { value: "Абая 12" } })
    expect((screen.getByRole("button", { name: "Пора готовить" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy()
  })
})
