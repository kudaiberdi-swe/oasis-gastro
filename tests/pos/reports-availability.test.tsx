// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W3-RPT-03: honest states — a report whose mechanic the owner switched off (Г-11) and a report whose
// data source is not connected yet («Телефония не подключена») show a state instead of zeros.

const mocks = vi.hoisted(() => ({ queries: {} as Record<string, unknown>, calls: [] as string[] }))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    if (args === "skip") return undefined
    mocks.calls.push(name)
    return mocks.queries[name]
  },
  useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) => Object.fromEntries(Object.entries(queries).map(([key, { query }]) => [key, mocks.queries[getFunctionName(query)]])),
  useMutation: () => async () => null,
}))

const NOT_CONNECTED = {
  reportId: "delivery-20",
  generatedAt: Date.parse("2026-09-26T07:00:00Z"),
  sourceLabel: "Журнал звонков телефонии",
  columns: [{ key: "group", label: "Дата", unit: "date", align: "left" }],
  rows: [],
  totals: {},
  kpis: [],
  truncated: false,
  unavailable: { title: "Телефония не подключена", description: "Провайдер телефонии ещё не выбран, в журнале нет ни одного звонка." },
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.calls = []
  mocks.queries = {
    "domains/reports/queries:coverage": { total: 190, implemented: 1, notApplicableKz: 3, mechanicDisabled: 1, byFamily: {}, implementedIds: ["delivery-20"] },
    "domains/reports/queries:restaurantsForFilter": [{ _id: "r1", externalId: "almaty", name: "Sandyq Алматы" }],
    "domains/reports/queries:execute": NOT_CONNECTED,
    "domains/reports/mutations:listViews": [],
  }
})

afterEach(cleanup)

function renderAt(url: string) {
  const router = createMemoryRouter([{ path: "/office/reports/:id?", element: <ReportsWorkspace /> }], { initialEntries: [url] })
  render(
    <CapabilitiesProvider capabilities={["*"]}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </CapabilitiesProvider>,
  )
}

describe("report availability (W3-RPT-03)", () => {
  it("«Корпоративные клиенты»: «Механика выключена» in the catalog, «Недоступно: механика выключена» in the viewer, no execute", () => {
    renderAt("/office/reports/delivery-10?from=2026-09-01&to=2026-09-07")
    // Role queries over the 190-card catalog are slow in jsdom: the pill is found by text (catalog card + viewer header).
    expect(screen.getAllByText("Механика выключена")).toHaveLength(2)
    expect(screen.getByText("Недоступно: механика выключена")).toBeTruthy()
    expect(mocks.calls).not.toContain("domains/reports/queries:execute")
  }, 15_000)

  it("a call-center report without telephony says «Телефония не подключена» instead of an empty table", () => {
    renderAt("/office/reports/delivery-20?from=2026-09-01&to=2026-09-07")
    expect(screen.getByText("Телефония не подключена")).toBeTruthy()
    expect(screen.queryByText("За выбранный период данных нет")).toBeNull()
    expect(document.querySelector("table")).toBeNull()
  }, 15_000)
})
