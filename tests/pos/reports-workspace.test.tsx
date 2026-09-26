// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { ReportFavoritesWorkspace } from "@/office/features/reports/ui/report-favorites-page"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-RPT-03/04/05: catalog with honest statuses, viewer on execute (KPI, table, «Итого», truncated, CSV),
// «Сводка продаж» on dashboardSummary, favorites and saved views.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, Mock<(...args: unknown[]) => Promise<unknown>>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    if (args === "skip") return undefined
    mocks.calls.push({ name, args })
    return mocks.queries[name]
  },
  useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query, args }]) => {
        const name = getFunctionName(query)
        mocks.calls.push({ name, args })
        return [key, mocks.queries[name]]
      }),
    ),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const text = (value: string) => value.replace(/[  ]/g, " ")
const PERIOD = "?from=2026-09-01&to=2026-09-07"

const RESULT = {
  reportId: "sales-01",
  generatedAt: Date.parse("2026-09-24T07:17:00Z"),
  sourceLabel: "Продажи кассы (предагрегат за день)",
  columns: [
    { key: "group", label: "Дата", unit: "date", align: "left" },
    { key: "orderCount", label: "Заказов", unit: "count", align: "right" },
    { key: "netAmount", label: "Выручка", unit: "money", align: "right" },
  ],
  rows: [
    { key: "2026-09-01", cells: { group: "2026-09-01", orderCount: 12, netAmount: 120500.4 } },
    { key: "2026-09-02", cells: { group: "2026-09-02", orderCount: 8, netAmount: 80000 } },
  ],
  totals: { orderCount: 20, netAmount: 200500.4 },
  kpis: [
    { key: "net", label: "Выручка", value: 200500.4, unit: "money" },
    { key: "orders", label: "Заказов", value: 20, unit: "count" },
  ],
  truncated: false,
}

const COVERAGE = {
  total: 190,
  implemented: 2,
  notApplicableKz: 1,
  byFamily: { sales: { implemented: 2, total: 29 } },
  implementedIds: ["sales-01", "sales-02"],
}

const VIEW = {
  externalId: "report-view-1",
  reportId: "sales-01",
  reportTitle: "Выручка по дням",
  name: "Алматы за неделю",
  favorite: true,
  config: { dateFrom: "2026-09-10", dateTo: "2026-09-16", restaurantExternalIds: ["almaty"] },
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.calls = []
  mocks.queries = {
    "domains/reports/queries:coverage": COVERAGE,
    "domains/reports/queries:restaurantsForFilter": [
      { _id: "r1", externalId: "almaty", name: "Sandyq Алматы" },
      { _id: "r2", externalId: "astana", name: "Sandyq Астана" },
    ],
    "domains/reports/queries:execute": RESULT,
    "domains/reports/queries:listShiftReports": [],
    "domains/reports/mutations:listViews": [],
  }
  mocks.mutations = {
    "domains/reports/mutations:saveView": vi.fn(async () => "report-view-2"),
    "domains/reports/mutations:deleteView": vi.fn(async () => null),
    "domains/reports/mutations:toggleFavorite": vi.fn(async () => ({ favorite: false })),
  }
})

afterEach(cleanup)

function renderAt(url: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter(
    [
      { path: "/office/reports/:id?", element: <ReportsWorkspace /> },
      { path: "/office/report-favorites/:id?", element: <ReportFavoritesWorkspace /> },
    ],
    { initialEntries: [url] },
  )
  render(
    <CapabilitiesProvider capabilities={capabilities}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </CapabilitiesProvider>,
  )
  return router
}

const executeCalls = () => mocks.calls.filter((call) => call.name === "domains/reports/queries:execute")

describe("report catalog (W1-RPT-03)", () => {
  it("lists the 190 reports with honest statuses, the «N из 190» badge and the KZ flag", () => {
    renderAt("/office/reports")
    expect(screen.getByText("Показано 190 из 190")).toBeTruthy()
    expect(screen.getByText("2 из 190")).toBeTruthy()
    const catalog = screen.getByRole("list", { name: "Каталог отчётов" })
    const daily = within(catalog).getByRole("link", { name: /Выручка по дням/ })
    expect(within(daily).getByText("Готов")).toBeTruthy()
    const stations = within(catalog).getByRole("link", { name: /Выручка станций по дням/ })
    expect(within(stations).getByText("В разработке")).toBeTruthy()
    const egais = within(catalog).getByRole("link", { name: /Документы ЕГАИС/ })
    expect(within(egais).getByText("Не применяется в РК")).toBeTruthy()
    const coupons = within(catalog).getByRole("link", { name: /Использование купонов/ })
    expect(within(coupons).getByText("Механика выключена")).toBeTruthy()
    expect(executeCalls()).toHaveLength(0)
  }, 20_000) // renders all 190 catalog rows: slow on a loaded machine

  it("searches by title and description", () => {
    renderAt("/office/reports")
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск отчёта" }), { target: { value: "почасовая" } })
    expect(screen.getByText("Показано 1 из 190")).toBeTruthy()
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск отчёта" }), { target: { value: "нет такого отчёта" } })
    expect(screen.getByText("Ничего не найдено")).toBeTruthy()
  })

  it("opens a report in development with an empty state and never calls execute", () => {
    renderAt(`/office/reports/sales-03${PERIOD}`)
    expect(screen.getByRole("heading", { name: "Выручка станций по дням" })).toBeTruthy()
    expect(screen.getByText("Отчёт в разработке")).toBeTruthy()
    expect(screen.getByText(/волне W2/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Экспорт CSV/ })).toBeNull()
    expect(executeCalls()).toHaveLength(0)
  })

  it("shows the status of an unavailable report (Г-11 mechanic off, not applicable in KZ) even when it has a calculator", () => {
    mocks.queries["domains/reports/queries:coverage"] = { ...COVERAGE, implementedIds: [...COVERAGE.implementedIds, "loyalty-11", "integrations-10"] }
    renderAt(`/office/reports/loyalty-11${PERIOD}`)
    const header = screen.getByRole("heading", { name: "Использование купонов" }).closest("header")!
    expect(within(header).getByText("Механика выключена")).toBeTruthy()
    expect(within(header).queryByText("Готов")).toBeNull()
    expect(screen.getByText("Недоступно: механика выключена")).toBeTruthy()

    cleanup()
    renderAt(`/office/reports/integrations-10${PERIOD}`)
    expect(screen.getByText("Не применяется в Казахстане")).toBeTruthy()
    expect(executeCalls()).toHaveLength(0)
  })

  it("shows «Отчёт не найден» for an unknown id", () => {
    renderAt("/office/reports/no-such-report")
    expect(screen.getByText("Отчёт не найден")).toBeTruthy()
    expect(executeCalls()).toHaveLength(0)
  })
})

describe("report viewer", () => {
  it("runs execute with the URL filters and renders KPI, the table and «Итого» in tenge without tiyn", () => {
    renderAt(`/office/reports/sales-01${PERIOD}&restaurants=almaty`)
    expect(executeCalls().at(-1)?.args).toEqual({ reportId: "sales-01", config: { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: ["almaty"] } })
    const table = screen.getByRole("table", { name: "Выручка по дням" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Дата", "Заказов", "Выручка"])
    expect(within(table).getByText("01.09.2026").closest("tr")!.querySelectorAll("td")[2].textContent).toBe("120\u2009500\u00a0₸")
    const totals = within(table).getByText("Итого").closest("tr")!
    expect(text(totals.textContent!)).toBe("Итого20200 500 ₸")
    expect(screen.getByText(/Источник: Продажи кассы/)).toBeTruthy()
    expect(screen.getByRole("figure", { name: "Выручка по дням" })).toBeTruthy()
  })

  it("warns when the result is truncated and blocks a period longer than a year", () => {
    mocks.queries["domains/reports/queries:execute"] = { ...RESULT, truncated: true }
    renderAt(`/office/reports/sales-01${PERIOD}`)
    expect(screen.getByText("Период слишком большой")).toBeTruthy()

    cleanup()
    mocks.calls = []
    renderAt("/office/reports/sales-01?from=2025-01-01&to=2026-09-07")
    expect(screen.getByText("Период не больше года (366 дней)")).toBeTruthy()
    expect(executeCalls()).toHaveLength(0)
  })

  it("shows a server error as a banner with «Повторить»", () => {
    mocks.queries["domains/reports/queries:execute"] = new Error("[CONVEX Q] Недостаточно прав для ресторана")
    renderAt(`/office/reports/sales-01${PERIOD}`)
    expect(screen.getByText("Не удалось сформировать отчёт")).toBeTruthy()
    expect(screen.getByText("Недостаточно прав для ресторана")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy()
  })

  it("exports CSV: UTF-8 BOM, «;», the columns on screen and the file name", async () => {
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return "blob:report"
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const clicks: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    })
    renderAt(`/office/reports/sales-01${PERIOD}&restaurants=almaty`)
    fireEvent.click(screen.getByRole("button", { name: /Экспорт CSV/ }))
    expect(clicks).toEqual(["Выручка по дням_2026-09-01_2026-09-07.csv"])
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = new TextDecoder().decode(bytes.slice(3))
    expect(csv).toContain("Рестораны;Sandyq Алматы")
    expect(csv).toContain("Дата;Заказов;Выручка\r\n01.09.2026;12;120500\r\n02.09.2026;8;80000\r\nИтого;20;200500")
    click.mockRestore()
  })
})

describe("«Сводка продаж» on dashboardSummary (W1-RPT-02)", () => {
  it("shows net revenue with the delta, orders, refunds and opens a restaurant's daily report", async () => {
    mocks.queries["domains/reports/queries:dashboardSummary"] = {
      revenue: 180000,
      grossRevenue: 200000,
      refunds: 20000,
      orders: 40,
      averageCheck: 5000,
      previousRevenue: 160000,
      series: [
        { date: "2026-09-01", value: 100000 },
        { date: "2026-09-02", value: 80000 },
      ],
      restaurants: [{ externalId: "almaty", name: "Sandyq Алматы", net: 180000, orders: 40 }],
    }
    const router = renderAt(`/office/reports${PERIOD}&view=summary`)
    const call = mocks.calls.find((entry) => entry.name === "domains/reports/queries:dashboardSummary")
    expect(call?.args).toEqual({ restaurantExternalIds: [], dateFrom: "2026-09-01", dateTo: "2026-09-07" })
    expect(screen.getAllByText("180 000 ₸").length).toBeGreaterThan(0)
    expect(text(screen.getByText(/к прошлому периоду/).textContent!)).toBe("+12,5 % к прошлому периоду")
    expect(screen.getByText("−20 000 ₸")).toBeTruthy()
    expect(screen.queryByText("Показано 190 из 190")).toBeNull()

    fireEvent.click(screen.getByText("Sandyq Алматы").closest("tr")!)
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/reports/sales-01"))
    expect(router.state.location.search).toBe(`${PERIOD}&restaurants=almaty`)
  })
})

describe("favorites and saved views (W1-RPT-05)", () => {
  it("«В избранное» saves the report with the current filters and shows the toast", async () => {
    renderAt(`/office/reports/sales-01${PERIOD}&restaurants=almaty`)
    fireEvent.click(screen.getByRole("button", { name: /В избранное/ }))
    const dialog = await screen.findByRole("dialog", { name: "Название представления" })
    const name = within(dialog).getByLabelText("Название") as HTMLInputElement
    expect(name.value).toBe("Выручка по дням")
    fireEvent.change(name, { target: { value: "Алматы, неделя" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить в избранное" }))
    await waitFor(() =>
      expect(mocks.mutations["domains/reports/mutations:saveView"]).toHaveBeenCalledWith({
        reportId: "sales-01",
        name: "Алматы, неделя",
        favorite: true,
        config: { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: ["almaty"] },
      }),
    )
    expect(await screen.findByText("Отчёт добавлен в избранное вместе с текущими фильтрами.")).toBeTruthy()
  })

  it("a favorite report shows «В избранном ♥» and removes it with toggleFavorite", async () => {
    mocks.queries["domains/reports/mutations:listViews"] = [VIEW]
    renderAt(`/office/reports/sales-01${PERIOD}`)
    fireEvent.click(screen.getByRole("button", { name: /В избранном ♥/ }))
    await waitFor(() => expect(mocks.mutations["domains/reports/mutations:toggleFavorite"]).toHaveBeenCalledWith({ reportId: "sales-01", config: { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: [] } }))
  })

  it("hides «В избранное» without office.report-favorites.edit", () => {
    renderAt(`/office/reports/sales-01${PERIOD}`, ["office.reports.view", "office.report-favorites.view"])
    expect(screen.queryByRole("button", { name: /В избранное/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Экспорт CSV/ })).toBeTruthy()
  })

  it("the favorites page is empty with the catalog hint", () => {
    renderAt("/office/report-favorites")
    expect(screen.getByText("Нет избранных отчётов")).toBeTruthy()
    expect(screen.getByText("Добавьте отчёт в избранное из полного каталога.")).toBeTruthy()
    expect(mocks.calls.find((call) => call.name === "domains/reports/mutations:listViews")?.args).toEqual({ favoritesOnly: true })
  })

  it("opening a saved view restores its filters", async () => {
    mocks.queries["domains/reports/mutations:listViews"] = [VIEW]
    const router = renderAt("/office/report-favorites")
    fireEvent.click(screen.getByRole("link", { name: /Алматы за неделю/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/report-favorites/report-view-1"))
    expect(router.state.location.search).toBe("?from=2026-09-10&to=2026-09-16&restaurants=almaty")
    expect(screen.getByText("Представление «Алматы за неделю»")).toBeTruthy()
    expect(executeCalls().at(-1)?.args).toEqual({ reportId: "sales-01", config: { dateFrom: "2026-09-10", dateTo: "2026-09-16", restaurantExternalIds: ["almaty"] } })
  })

  it("a bare deep link to a view gets the view's filters", async () => {
    mocks.queries["domains/reports/mutations:listViews"] = [VIEW]
    const router = renderAt("/office/report-favorites/report-view-1")
    await waitFor(() => expect(router.state.location.search).toBe("?from=2026-09-10&to=2026-09-16&restaurants=almaty"))
  })
})
