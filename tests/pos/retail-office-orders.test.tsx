// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { OrderDetail, OrderRow } from "@/office/features/retail/data/use-retail-office"
import { receiptFromDetail } from "@/office/features/retail/model/retail-office"
import { OrdersWorkspace } from "@/office/features/retail/ui/orders-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-RTL-05: «Заказы и чеки» — register by status tab over retail/office.listOrders and the receipt card
// (getOrderDetail) that opens on a row click at any width (L-17) and by its direct URL.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  printed: [] as string[],
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
    return { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: () => vi.fn(),
}))

vi.mock("@/pos/features/print/print-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/pos/features/print/print-document")>()),
  printHtml: (html: string) => {
    mocks.printed.push(html)
    return true
  },
}))

const LIST = "domains/retail/office:listOrders"
const DETAIL = "domains/retail/office:getOrderDetail"

const ORDER: OrderRow = {
  _id: "o1" as OrderRow["_id"],
  number: 100001,
  source: "Sandyq POS",
  status: "paid",
  createdAt: Date.parse("2026-09-04T11:56:27+05:00"),
  paidAt: Date.parse("2026-09-04T11:58:00+05:00"),
  businessDate: "2026-09-04",
  shiftNumber: 181,
  restaurantName: "Sandyq Абая",
  terminalName: "Главная касса",
  cashierName: "Айгерім",
  tableLabel: "5",
  orderTypeName: "В зале",
  total: 2300,
}

const DETAIL_ROW: OrderDetail = {
  order: {
    _id: ORDER._id,
    number: 100001,
    status: "paid",
    orderTypeName: "В зале",
    tableLabel: "5",
    guestCount: 2,
    comment: "Без лука",
    createdAt: ORDER.createdAt,
    paidAt: ORDER.paidAt,
    businessDate: "2026-09-04",
    restaurantName: "Sandyq Абая",
    terminalName: "Главная касса",
    cashierName: "Айгерім",
    retailConfigVersion: "order-type:hall@2, payment-type:cash@1",
  },
  lines: [
    { _id: "l1" as OrderDetail["lines"][number]["_id"], productName: "Бешбармак", sizeLabel: null, quantity: 1, unitPrice: 2000, lineTotal: 2000, modifiers: ["БЕЗ ЛУКА"], voided: false, sentToKitchen: true },
    { _id: "l2" as OrderDetail["lines"][number]["_id"], productName: "Шұбат", sizeLabel: "0,5 л", quantity: 1, unitPrice: 900, lineTotal: 900, modifiers: [], voided: true, sentToKitchen: false },
  ],
  totals: { subtotal: 2000, discount: 0, discountName: null, serviceCharge: 300, serviceChargePercent: 15, loyaltyRedeemed: 0, total: 2300 },
  payments: [{ _id: "p1" as OrderDetail["payments"][number]["_id"], type: "sale", name: "Наличные", amount: 2300, tendered: 3000, change: 700, createdAt: ORDER.paidAt! }],
  deletions: [{ _id: "d1" as OrderDetail["deletions"][number]["_id"], reason: "Ошибка кассира", comment: "", writeOff: false, line: "Шұбат", createdAt: ORDER.createdAt }],
  audit: [{ _id: "a1" as OrderDetail["audit"][number]["_id"], action: "order.checkout", summary: "Оплата 2 300 ₸", occurredAt: ORDER.paidAt! }],
}

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.printed = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["r1"] } },
    [DETAIL]: (args: { orderId: string }) => (args.orderId === "o1" ? DETAIL_ROW : null),
  }
  mocks.paginated = { [LIST]: [ORDER] }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string, width = 1440) {
  vi.stubGlobal("innerWidth", width)
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <OrdersWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={["office.orders.view"]}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

const last = (name: string) => mocks.paginatedArgs.filter((call) => call.name === name).at(-1)?.args
const exact = { normalizer: (text: string) => text }

describe("«Заказы и чеки» register (W1-RTL-05)", () => {
  it("has six status tabs, the search and the bahandi columns; ≥1440 shows the empty receipt pane", () => {
    renderAt("/office/orders")
    const tabs = screen.getByRole("tablist", { name: "Статус заказов" })
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Открытые", "Отложенные", "Оплаченные", "Возвраты", "Отменённые"])
    expect(screen.getByPlaceholderText("Номер, позиция или комментарий")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Заказы и чеки" })
    for (const header of ["Заказ", "Дата / смена", "Ресторан / кассир", "Статус", "Сумма"]) expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy()
    const [, row] = within(table).getAllByRole("row")
    expect(within(row).getByText("№100001")).toBeTruthy()
    expect(within(row).getByText("Sandyq POS")).toBeTruthy()
    expect(within(row).getByText("смена №181")).toBeTruthy()
    expect(within(row).getByText("Главная касса · Айгерім · стол 5")).toBeTruthy()
    expect(within(row).getByText("Оплачен")).toBeTruthy()
    expect(within(row).getByText(formatTenge(2300), exact)).toBeTruthy()
    expect(screen.getByText("Выберите заказ для просмотра чека")).toBeTruthy()
    expect(last(LIST)).toEqual({ status: "all", restaurantExternalId: "r1" })
  })

  it("a tab narrows the status on the server", () => {
    renderAt("/office/orders")
    fireEvent.click(screen.getByRole("tab", { name: "Возвраты" }))
    expect(last(LIST)).toEqual({ status: "refunded", restaurantExternalId: "r1" })
  })

  it.each([
    [1280, "dialog"],
    [1440, "complementary"],
  ] as const)("a row click at %ipx opens the receipt card (L-17) and its URL", (width, role) => {
    const router = renderAt("/office/orders", width)
    fireEvent.click(within(screen.getByRole("table", { name: "Заказы и чеки" })).getByText("№100001"))
    expect(router.state.location.pathname).toBe("/office/orders/o1")
    const panel = screen.getByRole(role, { name: "Заказ №100001" })
    expect(within(panel).getByText("Бешбармак")).toBeTruthy()
  })

  it("the direct URL shows the card: header, lines, totals, payments, deletions, config snapshot, audit", () => {
    renderAt("/office/orders/o1")
    const panel = screen.getByRole("complementary", { name: "Заказ №100001" })
    expect(within(panel).getByText("В зале · стол 5 · гостей: 2")).toBeTruthy()
    expect(within(panel).getByText("БЕЗ ЛУКА")).toBeTruthy()
    expect(within(panel).getByText("Удалена")).toBeTruthy()
    const totals = within(panel).getByRole("region", { name: "Итоги" })
    expect(within(totals).getByText(/Сервисный сбор 15/)).toBeTruthy()
    expect(within(totals).getByText(formatTenge(300), exact)).toBeTruthy()
    const payments = within(panel).getByRole("region", { name: "Платежи" })
    expect(within(payments).getByText("Наличные")).toBeTruthy()
    expect(within(payments).getByText(`Получено ${formatTenge(3000)} · сдача ${formatTenge(700)}`, exact)).toBeTruthy()
    expect(within(panel).getByText("Ошибка кассира")).toBeTruthy()
    expect(within(panel).getByText("order-type:hall@2")).toBeTruthy()
    expect(within(panel).getByText("Оплата заказа")).toBeTruthy()
    // The card has no primary: «Печать чека» is secondary.
    expect(panel.querySelectorAll("button.bg-primary")).toHaveLength(0)
    fireEvent.click(within(panel).getByRole("button", { name: "Печать чека" }))
    expect(mocks.printed).toHaveLength(1)
    expect(mocks.printed[0]).toContain("Заказ №100001")
    expect(mocks.printed[0]).toContain("Бешбармак")
    expect(mocks.printed[0]).not.toContain("Шұбат")
  })

  it("an order outside the scope or with a stale link says so", () => {
    renderAt("/office/orders/o404")
    expect(screen.getByText("Заказ не найден")).toBeTruthy()
  })

  it("closing the card returns to the register URL", () => {
    const router = renderAt("/office/orders/o1")
    fireEvent.click(within(screen.getByRole("complementary", { name: "Заказ №100001" })).getByRole("button", { name: "Закрыть" }))
    expect(router.state.location.pathname).toBe("/office/orders")
  })

  it("the search goes to the server after the debounce", async () => {
    vi.useFakeTimers()
    try {
      renderAt("/office/orders")
      fireEvent.change(screen.getByLabelText("Поиск заказов"), { target: { value: "бешбармак" } })
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(last(LIST)).toEqual({ status: "all", search: "бешбармак", restaurantExternalId: "r1" })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("receiptFromDetail", () => {
  it("prints active lines with sizes and modifiers, totals and payments", () => {
    const receipt = receiptFromDetail(DETAIL_ROW)
    expect(receipt.lines).toEqual([{ name: "Бешбармак", quantity: 1, amount: 2000, details: "БЕЗ ЛУКА" }])
    expect(receipt).toMatchObject({ kind: "receipt", orderNumber: 100001, statusLabel: "Оплачен", serviceChargeAmount: 300, total: 2300, comment: "Без лука" })
    expect(receipt.payments).toEqual([{ name: "Наличные", amount: 2300, tendered: 3000, change: 700, refund: false }])
  })
})
