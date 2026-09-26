// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { intervalLabel, parsePlanned, peakInterval } from "@/office/features/production-logistics/config"
import { KitchenPlanWorkspace, SemiFinishedSheetWorkspace } from "@/office/features/production-logistics/ui/logistics-page"
import { ToastProvider } from "@/shared/components/ui"

// W3-PRD-07/08 (office UI): «Прогноз кухни» over both pages, the plan made from the forecast in one click,
// the sheet's need and its production act. Synthetic restaurants, dishes and preparations.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

const resolve = (name: string, args: unknown) => {
  const value = mocks.queries[name]
  return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
}

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : resolve(getFunctionName(reference), args)),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) =>
    args === "skip"
      ? { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
      : { results: mocks.paginated[getFunctionName(reference)] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const FORECAST = "domains/productionLogistics/queries:forecast"
const REQUIREMENT = "domains/productionLogistics/queries:semiFinishedRequirement"
const LIST = "domains/productionLogistics/queries:listRecords"
const GET = "domains/productionLogistics/queries:getRecord"
const CREATE = "domains/productionLogistics/mutations:createFromForecast"
const ACT = "domains/productionLogistics/mutations:createProductionAct"
const TRANSITION = "domains/productionLogistics/mutations:transitionRecord"

const intervals = (index: number, value: number) => Array.from({ length: 96 }, (_, at) => (at === index ? value : 0))
const DISHES = ["Бешбармак", "Лагман", "Плов", "Манты", "Самса", "Шашлык", "Куырдак", "Баурсаки", "Чай"]
const forecast = {
  restaurantExternalId: "r1",
  targetDate: "2026-09-28",
  weekday: 1,
  sourceDates: ["2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31", "2026-08-24", "2026-08-17"],
  daysWithSales: 6,
  intervals: intervals(52, 12),
  products: DISHES.map((name, index) => ({ productExternalId: `dish-${index}`, name, averageQuantity: 90 - index * 10, recommendedQuantity: 90 - index * 10, intervals: intervals(52, 1) })),
}
const sheetLine = { lineNo: 1, productExternalId: "patty", name: "Котлета", unit: "шт", forecastQuantity: 40, onHand: 10, plannedQuantity: 30, actualQuantity: 12 }
const sheetRow = {
  _id: "pr1",
  _creationTime: 0,
  externalId: "semi-finished-sheet-1",
  moduleId: "semi-finished-sheet",
  number: "ВП-2026-00006",
  businessDate: "2026-09-28",
  status: "draft",
  organizationExternalId: "org",
  restaurantExternalId: "r1",
  comment: "",
  lines: [sheetLine, { ...sheetLine, lineNo: 2, productExternalId: "sauce", name: "Соус", unit: "кг", forecastQuantity: 2, onHand: 0.5, plannedQuantity: 1.5, actualQuantity: 0 }],
  searchText: "",
  version: 3,
  createdBy: "chef@sandyq.test",
  createdAt: 0,
  updatedAt: 0,
  restaurantName: "Sandyq Абая",
  unit: null,
  plannedTotal: null,
  actualTotal: null,
  doneCount: 0,
  plannedCount: 2,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }, { externalId: "r2", name: "Sandyq Достык" }], user: { restaurantScopes: ["*"] } },
    [FORECAST]: forecast,
    [REQUIREMENT]: {
      forecast,
      lines: [{ productExternalId: "patty", name: "Котлета", unit: "шт", inventoryItemExternalId: "prep-patty", forecastQuantity: 40, onHand: 10, plannedQuantity: 30, actualQuantity: 12, canProduce: true, usedBy: ["Бешбармак"] }],
      dishesWithoutRecipe: ["Чай"],
      warehouses: [{ externalId: "kitchen", name: "Горячий цех", kind: "kitchen" }],
      sheet: null,
    },
    [GET]: { ...sheetRow, lines: sheetRow.lines.map((line) => ({ ...line, canProduce: line.productExternalId === "patty" })), acts: [], warehouses: [{ externalId: "kitchen", name: "Горячий цех", kind: "kitchen" }] },
  }
  mocks.paginated = { [LIST]: [] }
  mocks.mutations = {
    [CREATE]: vi.fn(async () => ({ externalId: "kitchen-plan-1", existing: false })),
    [ACT]: vi.fn(async () => ({ externalId: "production-9", lines: 1, skipped: [] })),
    [TRANSITION]: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode, capabilities: string[] = ["*"]) {
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

describe("«Прогноз кухни» helpers", () => {
  it("labels intervals in Almaty time and finds the peak", () => {
    expect(intervalLabel(94)).toBe("23:30–23:45")
    expect(intervalLabel(95)).toBe("23:45–00:00")
    expect(peakInterval(intervals(52, 3))).toBe(52)
    expect(peakInterval(intervals(0, 0))).toBeNull()
    expect([parsePlanned("1,5"), parsePlanned(""), parsePlanned("-1"), parsePlanned("2")]).toEqual([1.5, null, null, 2])
  })
})

describe("«План на кухню» (W3-PRD-07)", () => {
  it("shows eight forecast cards for the restaurant and date, and makes the plan from the forecast in one click", async () => {
    const router = renderAt("/office/kitchen-plan?restaurant=r1&date=2026-09-28", <KitchenPlanWorkspace />)
    const panel = screen.getByRole("region", { name: "Прогноз кухни" })
    expect(within(panel).getByText("Средний спрос за шесть недель; расчёт по 15-минутным интервалам")).toBeTruthy()
    expect(within(panel).getAllByRole("listitem")).toHaveLength(8)
    expect(within(panel).getByText("Бешбармак")).toBeTruthy()
    expect(within(panel).getByText("Рекомендуется: 90")).toBeTruthy()
    expect(within(panel).queryByText("Чай")).toBeNull()
    expect(within(panel).getByText(/пик 13:00–13:15/)).toBeTruthy()
    expect(screen.getByPlaceholderText("Поиск: план на кухню")).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Активные" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Новая запись" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/kitchen-plan/kitchen-plan-1"))
    expect(mocks.mutations[CREATE]).toHaveBeenCalledWith({ moduleId: "kitchen-plan", restaurantExternalId: "r1", targetDate: "2026-09-28" })
  })

  it("says so when the weekday had no sales, and hides «Новая запись» without the right", () => {
    mocks.queries[FORECAST] = { ...forecast, daysWithSales: 0, products: [], intervals: intervals(0, 0) }
    renderAt("/office/kitchen-plan?restaurant=r1&date=2026-09-28", <KitchenPlanWorkspace />, ["office.kitchen-plan.view"])
    expect(screen.getByText(/Нет продаж в этот день недели \(понедельник\)/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Новая запись" })).toBeNull()
  })
})

describe("«Ведомость полуфабрикатов» (W3-PRD-08)", () => {
  it("shows the same forecast panel, the need of the day and the register columns", () => {
    mocks.paginated[LIST] = [sheetRow]
    renderAt("/office/semi-finished-sheet?restaurant=r1&date=2026-09-28", <SemiFinishedSheetWorkspace />)
    expect(within(screen.getByRole("region", { name: "Прогноз кухни" })).getByText("Рекомендуется: 90")).toBeTruthy()
    const need = screen.getByRole("region", { name: "Потребность в заготовках" })
    expect(within(need).getByText("Котлета")).toBeTruthy()
    expect(within(need).getByText("Для: Бешбармак")).toBeTruthy()
    expect(within(need).getByText(/Чай — их заготовки в потребность не попали/)).toBeTruthy()
    expect(within(need).getByRole("button", { name: "Создать по прогнозу" })).toBeTruthy()
    const table = screen.getByRole("table", { name: "Ведомость полуфабрикатов" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Дата", "Ресторан", "Заготовка", "План", "Факт", "Статус"]))
    expect(within(table).getByText("ВП-2026-00006")).toBeTruthy()
    expect(within(table).getByText("Котлета, Соус")).toBeTruthy()
    expect(within(table).getByText("0 из 2 поз.")).toBeTruthy()
    expect(screen.getByText("1 запись")).toBeTruthy()
  })

  it("makes a production act draft from the sheet with what is left to make", async () => {
    renderAt("/office/semi-finished-sheet/semi-finished-sheet-1", <SemiFinishedSheetWorkspace />)
    expect(await screen.findByRole("heading", { name: /Ведомость полуфабрикатов ВП-2026-00006/ })).toBeTruthy()
    const lines = screen.getByRole("region", { name: "Заготовки" })
    expect(within(lines).getByText("по составу")).toBeTruthy() // the sauce is not made by an act
    fireEvent.click(screen.getByRole("button", { name: "Создать акт приготовления" }))
    await waitFor(() => expect(mocks.mutations[ACT]).toHaveBeenCalledWith({ externalId: "semi-finished-sheet-1", sourceWarehouseExternalId: "kitchen", destinationWarehouseExternalId: "kitchen" }))
    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "semi-finished-sheet-1", action: "post", expectedVersion: 3 }))
  })
})
