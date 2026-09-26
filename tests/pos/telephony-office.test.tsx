// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TelephonyWorkspace } from "@/office/features/delivery/ui/telephony-workspace"

// W3-DLV-09 «Телефония»: the call journal. Calls and phones are synthetic.

const mocks = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], args: [] as unknown[] }))

vi.mock("convex/react", () => ({
  useQuery: () => ({ adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }, { externalId: "r2", name: "Sandyq Достык" }], user: { restaurantScopes: ["*"] } }),
  usePaginatedQuery: (_reference: unknown, args: unknown) => {
    mocks.args.push(args)
    return { results: mocks.rows, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
}))

const CALL = {
  externalId: "generic:c-1",
  provider: "historical-import",
  direction: "inbound",
  status: "completed",
  phone: "7700•••••00",
  restaurantExternalId: "r1",
  hasGuest: false,
  deliveryExternalId: null,
  deliveryNumber: null,
  startedAt: Date.parse("2026-09-03T14:00:00+05:00"),
  answeredAt: null,
  endedAt: null,
  durationSeconds: null,
  hasRecording: false,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= () => false
  mocks.args = []
  mocks.rows = [CALL, { ...CALL, externalId: "generic:c-2", provider: "generic", direction: "outbound", status: "missed", deliveryExternalId: "delivery-1", deliveryNumber: "DLV-2026-00007" }]
})

afterEach(cleanup)

function renderPage() {
  const router = createMemoryRouter([{ path: "/office/:section", element: <TelephonyWorkspace /> }], { initialEntries: ["/office/telephony"] })
  render(<RouterProvider router={router} />)
}

describe("«Телефония» (W3-DLV-09)", () => {
  it("the journal block, the columns and Russian statuses; «Без заказа» or a link to the delivery", () => {
    renderPage()
    expect(screen.getByRole("heading", { name: "Журнал звонков" })).toBeTruthy()
    expect(screen.getByText("Провайдер указан в каждой записи")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Журнал звонков" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Время", "Направление", "Провайдер", "Телефон", "Ресторан", "Статус"])
    const [, first, second] = within(table).getAllByRole("row")
    expect(within(first).getByText("Входящий")).toBeTruthy()
    expect(within(first).getByText("Исторический импорт")).toBeTruthy()
    expect(within(first).getByText("Без заказа")).toBeTruthy()
    expect(within(first).getByText("Завершён")).toBeTruthy()
    expect(within(second).getByRole("link", { name: "Доставка DLV-2026-00007" }).getAttribute("href")).toBe("/office/delivery-orders/delivery-1")
    expect(within(second).getByText("Пропущен")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Исходящие" }))
    expect(mocks.args.at(-1)).toEqual({ direction: "outbound" })
  })

  it("an empty journal says calls appear once the provider is connected", () => {
    mocks.rows = []
    renderPage()
    expect(screen.getByText("Журнал пуст")).toBeTruthy()
    expect(screen.getByText("Звонки появятся после подключения провайдера телефонии.")).toBeTruthy()
  })
})
