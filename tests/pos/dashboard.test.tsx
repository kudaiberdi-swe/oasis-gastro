// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { periodRange, plural, quickAccessTiles } from "@/office/features/dashboard/model/dashboard"
import { DashboardWorkspace } from "@/office/features/dashboard/ui/office-dashboard"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { officeNavigation } from "@/office/model/navigation"

// W1-ADM-05 «Стартовая страница»: KPI, graph, «Рестораны сети» drill-down, «Быстрый доступ», period presets.

const mocks = vi.hoisted(() => ({ result: undefined as unknown, calls: [] as { name: string; args: unknown }[] }))

vi.mock("convex/react", () => ({
  useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query, args }]) => {
        mocks.calls.push({ name: getFunctionName(query), args })
        return [key, mocks.result]
      }),
    ),
}))

const text = (value: string) => value.replace(/[\u2009\u00a0]/g, " ")

const series = Array.from({ length: 30 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, value: index === 29 ? 72_128_169 : 1000 }))

const DATA = {
  revenue: 72_128_169,
  previousRevenue: 64_116_150,
  orders: 481,
  previousOrders: 400,
  averageCheck: 2462,
  postedDocuments: 0,
  draftDocuments: 0,
  exchangeErrors: 0,
  restaurants: [
    { restaurantExternalId: "almaty", name: "Sandyq Абая", documents: 2, turnover: 34_777_759, orders: 250, status: "working" },
    { restaurantExternalId: "astana", name: "Sandyq Астана", documents: 5, turnover: 25_000_000, orders: 231, status: "no-shifts" },
  ],
  series,
}

function renderDashboard(url = "/office/dashboard", capabilities: string[] = ["*"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/office/:section/:id?",
        element: (
          <CapabilitiesProvider capabilities={capabilities}>
            <DashboardWorkspace />
          </CapabilitiesProvider>
        ),
      },
    ],
    { initialEntries: [url] },
  )
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-09-30T06:00:00Z")) // 11:00 in Almaty
  mocks.result = DATA
  mocks.calls = []
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("start page model (W1-ADM-05)", () => {
  it("counts presets in Almaty business days, today included", () => {
    const now = Date.parse("2026-09-29T20:30:00Z") // 01:30 on 30.09 in Almaty
    expect(periodRange("today", now)).toEqual({ from: "2026-09-30", to: "2026-09-30" })
    expect(periodRange("7d", now)).toEqual({ from: "2026-09-24", to: "2026-09-30" })
    expect(periodRange("30d", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" })
  })

  it("uses Russian plurals", () => {
    const forms: [string, string, string] = ["документ", "документа", "документов"]
    expect([0, 1, 2, 5, 11, 12, 21, 22, 25, 111].map((count) => plural(count, forms))).toEqual([
      "документов",
      "документ",
      "документа",
      "документов",
      "документов",
      "документов",
      "документ",
      "документа",
      "документов",
      "документов",
    ])
  })

  it("quick access takes the first allowed section of every group except «Главная»", () => {
    const all = quickAccessTiles(filterNavigationByCapabilities(officeNavigation, ["*"]))
    expect(all).toHaveLength(8)
    expect(all.map((tile) => tile.item.id)).not.toContain("dashboard")
    expect(all[0].item.id).toBe("pos")
    const limited = quickAccessTiles(filterNavigationByCapabilities(officeNavigation, ["office.dashboard.view", "office.receipts.view", "office.audit-log.view"]))
    expect(limited.map((tile) => tile.item.id)).toEqual(["receipts", "audit-log"])
  })
})

describe("start page screen (W1-ADM-05)", () => {
  it("shows the four KPI, the delta and «Обмен работает штатно»; asks for today by default", async () => {
    renderDashboard()
    expect(mocks.calls.at(-1)).toEqual({ name: "domains/platform/queries:dashboard", args: { from: "2026-09-30", to: "2026-09-30" } })
    const revenue = screen.getByText("Выручка").parentElement!
    expect(text(revenue.textContent ?? "")).toContain("72 128 169 ₸")
    expect(screen.getByText("+12,5 % к прошлому периоду").className).toContain("text-success")
    expect(screen.getByText("481")).toBeTruthy()
    expect(text(screen.getByText(/Средний чек/).textContent ?? "")).toBe("Средний чек 2 462 ₸")
    expect(screen.getByText("Проведено документов")).toBeTruthy()
    expect(screen.getByText("0 черновиков")).toBeTruthy()
    expect(screen.getByText("Обмен работает штатно")).toBeTruthy()
    expect(screen.getByRole("figure", { name: "Выручка за 30 дней" })).toBeTruthy()
  })

  it("flags exchange errors instead of «штатно»", () => {
    mocks.result = { ...DATA, exchangeErrors: 3 }
    renderDashboard()
    expect(screen.queryByText("Обмен работает штатно")).toBeNull()
    expect(screen.getByText("Проверьте очередь интеграций").className).toContain("text-destructive")
  })

  it("lists the restaurants and opens «Выручка по дням» filtered by the clicked one", () => {
    const router = renderDashboard()
    const table = screen.getByRole("table", { name: "Рестораны сети" })
    const row = within(table).getByText("Sandyq Абая").closest("tr")!
    expect(within(row).getByText("2 документа")).toBeTruthy()
    expect(within(row).getByText("Работает")).toBeTruthy()
    expect(within(table).getByText("Нет смен")).toBeTruthy()
    fireEvent.click(row)
    expect(router.state.location.pathname).toBe("/office/reports/sales-01")
    expect(new URLSearchParams(router.state.location.search).get("restaurants")).toBe("almaty")
    expect(new URLSearchParams(router.state.location.search).get("from")).toBe("2026-09-30")
  })

  it("keeps the rows static without the reports right", () => {
    const router = renderDashboard("/office/dashboard", ["office.dashboard.view"])
    fireEvent.click(screen.getByText("Sandyq Абая"))
    expect(router.state.location.pathname).toBe("/office/dashboard")
  })

  it("switches the period through the presets and keeps it in the URL", () => {
    const router = renderDashboard()
    fireEvent.click(screen.getByRole("radio", { name: "7 дней" }))
    expect(router.state.location.search).toBe("?period=7d")
    expect(mocks.calls.at(-1)?.args).toEqual({ from: "2026-09-24", to: "2026-09-30" })
    fireEvent.click(screen.getByRole("radio", { name: "Сегодня" }))
    expect(router.state.location.search).toBe("")
  })

  it("reads ?period=30d from a deep link", () => {
    renderDashboard("/office/dashboard?period=30d")
    expect(mocks.calls.at(-1)?.args).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(screen.getByRole("radio", { name: "30 дней" }).getAttribute("aria-checked")).toBe("true")
  })

  it("shows an EmptyState, not zeros, when there are no sales", () => {
    mocks.result = { ...DATA, revenue: 0, previousRevenue: 0, orders: 0, previousOrders: 0, averageCheck: 0, series: series.map((point) => ({ ...point, value: 0 })) }
    renderDashboard()
    expect(screen.getByText("Продаж пока нет")).toBeTruthy()
    expect(screen.queryByText("Выручка")).toBeNull()
    expect(screen.queryByRole("figure")).toBeNull()
    expect(screen.getByRole("table", { name: "Рестораны сети" })).toBeTruthy()
  })

  it("shows a skeleton while loading and a banner with «Повторить» on error", () => {
    mocks.result = undefined
    renderDashboard()
    expect(screen.getByRole("status", { name: "Загрузка стартовой страницы" })).toBeTruthy()
    cleanup()
    mocks.result = new Error("Нет доступа к ресторану")
    renderDashboard()
    expect(screen.getByRole("alert").textContent).toContain("Нет доступа к ресторану")
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy()
  })

  it("quick access tiles are links to the allowed sections only", () => {
    renderDashboard("/office/dashboard", ["office.dashboard.view", "office.receipts.view"])
    const section = screen.getByRole("region", { name: "Быстрый доступ" })
    const links = within(section).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/office/receipts"])
  })
})
