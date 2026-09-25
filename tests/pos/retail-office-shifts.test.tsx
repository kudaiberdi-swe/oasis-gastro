// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { ShiftCard } from "@/office/features/retail/data/use-retail-office"
import { shiftCandidate } from "@/office/features/retail/model/retail-office"
import { CashShiftsWorkspace } from "@/office/features/retail/ui/cash-shifts-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-RTL-06: «Кассовые смены» — cards over retail/office.listShifts; «Принять смену» opens the one
// finance acceptance dialog (B-21) and calls finance.shiftAcceptance.acceptShift.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
  /** One-off client queries (useConvex().query): «Печать Z» loads the saved report. */
  clientQueries: {} as Record<string, (args: unknown) => Promise<unknown>>,
  printed: [] as string[],
}))

vi.mock("@/pos/features/print/print-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/pos/features/print/print-document")>()),
  printHtml: (html: string) => {
    mocks.printed.push(html)
    return true
  },
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs.push({ name, args })
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
    return { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
  useConvex: () => CLIENT,
}))

const CLIENT = { query: (reference: FunctionReference<"query">, args: unknown) => mocks.clientQueries[getFunctionName(reference)](args) }

const LIST = "domains/retail/office:listShifts"
const ACCEPT = "domains/finance/shiftAcceptance:acceptShift"
const Z_REPORT = "domains/retail/office:getZReport"

const SNAPSHOT = {
  catalogGrossSales: 126_000,
  discounts: 1_000,
  serviceCharge: 0,
  sales: 125_000,
  refunds: 1_500,
  netSales: 123_500,
  averageCheck: 10_417,
  expectedCash: 60_000,
  payments: { cash: { sales: 40000, refunds: 0, net: 40000, saleCount: 4, refundCount: 0 }, card: { sales: 85000, refunds: 1500, net: 83500, saleCount: 8, refundCount: 1 }, qr: { sales: 0, refunds: 0, net: 0, saleCount: 0, refundCount: 0 } },
  cashMovements: { cashIn: 0, cashOut: 0, cashInCount: 0, cashOutCount: 0 },
  orderCounts: { paid: 12, partiallyRefunded: 0, refunded: 1, cancelled: 0, draft: 0, held: 0, discounted: 1 },
  openOrders: { count: 0, total: 0 },
  heldOrders: { count: 0, total: 0 },
  cancelledAmount: 0,
  saleOrderCount: 12,
  refundOrderCount: 1,
}

const shift = (overrides: Partial<ShiftCard>): ShiftCard => ({
  _id: "s181" as ShiftCard["_id"],
  number: 181,
  terminalName: "Главная касса",
  restaurantName: "Sandyq Абая",
  businessDate: "2026-09-04",
  status: "open",
  openedAt: Date.parse("2026-09-04T09:00:00+05:00"),
  closedAt: null,
  openedByName: "Арман Арманов",
  closedByName: null,
  sales: 0,
  refunds: 0,
  expectedCash: 50_000,
  countedCash: null,
  variance: null,
  zReportNumber: null,
  zReportId: null,
  acceptance: null,
  ...overrides,
})

const OPEN = shift({})
const CLOSED = shift({
  _id: "s180" as ShiftCard["_id"],
  number: 180,
  status: "closed",
  closedAt: Date.parse("2026-09-03T23:10:00+05:00"),
  closedByName: "Айгерім",
  sales: 125_000,
  refunds: 1_500,
  expectedCash: 60_000,
  countedCash: 59_700,
  variance: -300,
  zReportNumber: "Z-20260903-01-180",
  zReportId: "z180" as ShiftCard["zReportId"],
})
const ACCEPTED = shift({
  _id: "s179" as ShiftCard["_id"],
  number: 179,
  status: "accepted",
  closedAt: Date.parse("2026-09-02T23:10:00+05:00"),
  closedByName: "Айгерім",
  expectedCash: 40_000,
  countedCash: 40_000,
  variance: 0,
  zReportNumber: "Z-20260902-01-179",
  zReportId: "z179" as ShiftCard["zReportId"],
  acceptance: { recountedCash: 40_000, variance: 0, acceptedAt: Date.parse("2026-09-03T10:00:00+05:00"), note: "Сверено" },
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
    "domains/finance/records:references": { accounts: [], cashflowCategories: [], counterparties: [], restaurants: [], truncated: false },
  }
  mocks.paginated = { [LIST]: [OPEN, CLOSED, ACCEPTED] }
  mocks.mutations = { [ACCEPT]: vi.fn(async () => "acceptance-1") }
  mocks.printed = []
  mocks.clientQueries = {
    [Z_REPORT]: vi.fn(async (args: unknown) =>
      (args as { zReportId: string }).zReportId === "z180"
        ? {
            _id: "z180",
            number: "Z-20260903-01-180",
            businessDate: "2026-09-03",
            shiftNumber: 180,
            openedAt: Date.parse("2026-09-03T09:00:00+05:00"),
            closedAt: Date.parse("2026-09-03T23:10:00+05:00"),
            closedByName: "Айгерім",
            openingCash: 20_000,
            countedCash: 59_700,
            variance: -300,
            snapshot: SNAPSHOT,
            restaurantName: "Sandyq Абая",
            restaurantAddress: "пр. Абая, 1",
            terminalName: "Главная касса",
            terminalNumber: 1,
          }
        : null,
    ),
  }
})

afterEach(cleanup)

function renderPage(capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <CashShiftsWorkspace /> }], { initialEntries: ["/office/cash-shifts"] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
}

const last = (name: string) => mocks.paginatedArgs.filter((call) => call.name === name).at(-1)?.args
const exact = { normalizer: (text: string) => text }
const card = (name: string) => screen.getByRole("article", { name })

describe("«Кассовые смены» (W1-RTL-06)", () => {
  it("shows the tabs, the acceptance comment and a card per shift with KPI and the cash lines", () => {
    renderPage()
    const tabs = screen.getByRole("tablist", { name: "Статус смен" })
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Открытые", "Закрытые"])
    expect(screen.getByLabelText("Комментарий при принятии")).toBeTruthy()
    expect(last(LIST)).toEqual({ status: "all" })

    const open = card("Смена №181 · Главная касса")
    expect(within(open).getByText("Открыта")).toBeTruthy()
    expect(within(open).getByText("Sandyq Абая · 04.09.2026")).toBeTruthy()
    for (const label of ["Продажи", "Возвраты", "Расхождение", "Открыл", "Закрыл", "Ожидается", "Фактически"]) expect(within(open).getByText(label)).toBeTruthy()
    expect(within(open).getByText("Арман Арманов")).toBeTruthy()
    expect(within(open).getByText(formatTenge(50_000), exact)).toBeTruthy()
    // An open shift has nothing to accept or print.
    expect(within(open).queryByRole("button")).toBeNull()

    const closed = card("Смена №180 · Главная касса")
    expect(within(closed).getByText("Закрыта")).toBeTruthy()
    expect(within(closed).getByText(formatTenge(125_000), exact)).toBeTruthy()
    expect(within(closed).getByText(formatTenge(-300), exact)).toBeTruthy()
    expect(within(closed).getByText(formatTenge(59_700), exact)).toBeTruthy()
    expect(within(closed).getAllByRole("button").filter((button) => button.classList.contains("bg-primary"))).toHaveLength(1)

    const accepted = card("Смена №179 · Главная касса")
    expect(within(accepted).getByText("Принята")).toBeTruthy()
    expect(within(accepted).getByText("Сверено")).toBeTruthy()
    expect(within(accepted).queryByRole("button", { name: /Принять смену/ })).toBeNull()
  })

  it("«Печать Z» loads the saved Z-report and prints it on the POS form", async () => {
    renderPage()
    fireEvent.click(within(card("Смена №180 · Главная касса")).getByRole("button", { name: "Печать Z · смена №180" }))
    await waitFor(() => expect(mocks.printed).toHaveLength(1))
    expect(mocks.clientQueries[Z_REPORT]).toHaveBeenCalledWith({ zReportId: "z180" })
    expect(mocks.printed[0]).toContain("Z-ОТЧЁТ")
    expect(mocks.printed[0]).toContain("Z-20260903-01-180")
    expect(mocks.printed[0]).toContain("Sandyq Абая")
    expect(mocks.printed[0]).toContain("Главная касса")
    expect(mocks.printed[0]).toContain("Айгерім")
  })

  it("a Z-report outside the scope is not printed; a closed shift without one has an inactive button", async () => {
    mocks.paginated[LIST] = [{ ...CLOSED, zReportId: "z-foreign" as ShiftCard["zReportId"] }, { ...CLOSED, _id: "s178" as ShiftCard["_id"], number: 178, zReportId: null }]
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Печать Z · смена №180" }))
    expect(await screen.findByText(/Z-отчёт не найден/)).toBeTruthy()
    expect(mocks.printed).toHaveLength(0)
    const missing = within(card("Смена №178 · Главная касса")).getByRole("button", { name: "Печать Z" })
    expect(missing.getAttribute("aria-disabled")).toBe("true")
    expect(missing.getAttribute("title")).toMatch(/нет сохранённого Z-отчёта/)
  })

  it("the tabs narrow the status on the server", () => {
    renderPage()
    fireEvent.click(screen.getByRole("tab", { name: "Закрытые" }))
    expect(last(LIST)).toEqual({ status: "closed" })
  })

  it("«Принять смену» opens the finance dialog with the comment and posts acceptShift", async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText("Комментарий при принятии"), { target: { value: "Недостача 300, объяснительная" } })
    fireEvent.click(screen.getByRole("button", { name: "Принять смену №180 · Главная касса" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Принять смену №180")).toBeTruthy()
    expect((within(dialog).getByLabelText("Комментарий") as HTMLTextAreaElement).value).toBe("Недостача 300, объяснительная")
    fireEvent.change(within(dialog).getByLabelText("Пересчитанная наличность"), { target: { value: "59700" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Принять" }))
    await waitFor(() => expect(mocks.mutations[ACCEPT]).toHaveBeenCalledWith({ shiftId: "s180", recountedCash: 59_700, note: "Недостача 300, объяснительная" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("without the post right there is no «Принять смену» and no acceptance comment", () => {
    renderPage(["office.cash-shifts.view"])
    expect(screen.queryByRole("button", { name: /Принять смену/ })).toBeNull()
    expect(screen.queryByLabelText("Комментарий при принятии")).toBeNull()
    expect(within(card("Смена №180 · Главная касса")).getByRole("button", { name: "Печать Z · смена №180" })).toBeTruthy()
  })

  it("an empty tab says where shifts come from", () => {
    mocks.paginated[LIST] = []
    renderPage()
    expect(screen.getByText("Смен пока нет")).toBeTruthy()
  })
})

describe("shiftCandidate", () => {
  it("maps a card to the acceptance dialog's shift", () => {
    expect(shiftCandidate(CLOSED)).toEqual({
      shiftId: "s180",
      restaurantName: "Sandyq Абая",
      terminalName: "Главная касса",
      shiftNumber: 180,
      businessDate: "2026-09-04",
      zReportNumber: "Z-20260903-01-180",
      closedAt: CLOSED.closedAt,
      closedByName: "Айгерім",
      expectedCash: 60_000,
      countedCash: 59_700,
      variance: -300,
    })
  })
})
