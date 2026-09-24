// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
import { FinanceWorkspace } from "@/office/features/finance/ui/finance-workspace"
import { StockWorkspace } from "@/office/features/stock/ui/stock-workspace"
import { formatQuantity, formatTenge } from "@/shared/lib/format"

const exact = { normalizer: (text: string) => text.trim() }

const restaurants = [{ externalId: "r1", name: "Sandyq Абая" }]

vi.mock("@/office/features/catalog/data/use-office-catalog", () => ({
  useOfficeCatalog: () => ({
    loading: false,
    restaurants,
    categories: [{ _id: "c1", externalId: "soups", label: "Супы", shortLabel: "Супы", sortOrder: 0, active: true }],
    products: [{ _id: "p1", name: "Сорпа", nameKk: "Сорпа", nameSort: "сорпа", sku: "S-1", basePrice: 2500, enabled: true, category: "soups", prices: [] }],
  }),
  useOfficeCatalogMutations: () => ({ createCategory: vi.fn(), updateCategory: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn(), setProductPrice: vi.fn() }),
}))

vi.mock("@/office/features/stock/data/use-office-stock", () => ({
  useOfficeStock: () => ({
    loading: false,
    restaurants,
    items: [{ _id: "i1", name: "Мука", unit: "кг", minimumStock: 5, balances: [{ restaurantExternalId: "r1", quantity: 2.5, averageUnitCost: 400 }] }],
  }),
  useOfficeStockMutations: () => ({ createInventoryItem: vi.fn(), receiveStock: vi.fn(), writeOffStock: vi.fn(), adjustStock: vi.fn() }),
  useRecentMovements: () => ({
    loading: false,
    movements: [{ _id: "m1", occurredAt: Date.UTC(2026, 8, 1, 6, 0), itemName: "Мука", itemUnit: "кг", kind: "writeoff", quantityDelta: -1.5, balanceAfter: 2.5, actorEmail: "a@b.kz" }],
  }),
}))

const summaryFilters: unknown[] = []
vi.mock("@/office/features/finance/data/use-office-finance", () => ({
  useFinanceRestaurants: () => restaurants,
  useFinanceSummary: (filter: unknown) => {
    summaryFilters.push(filter)
    return { loading: false, summary: { revenue: 100_000, expense: 40_000, net: 60_000, byCategory: [{ category: "Аренда", kind: "expense", amount: 40_000 }] } }
  },
  useFinanceEntries: () => ({
    loading: false,
    entries: [{ _id: "e1", businessDate: "2026-09-01", restaurantExternalId: "r1", category: "Аренда", description: "Сентябрь", sourceModuleId: "manual", kind: "expense", amount: 40_000 }],
  }),
  useRecordExpense: () => vi.fn(),
}))

afterEach(cleanup)

describe("office workspaces on the shared primitives (W0-FND-05)", () => {
  it("catalog renders products in DataTable with formatted price and one primary action", () => {
    render(<CatalogWorkspace />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("Сорпа", { selector: "span.font-semibold" })).toBeTruthy()
    expect(within(table).getByText(formatTenge(2500), exact)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Добавить блюдо/ })).toBeTruthy()
  })

  it("stock switches between balances and log with a SegmentedControl", () => {
    render(<StockWorkspace />)
    expect(screen.getByText(formatQuantity(2.5, "кг"), exact)).toBeTruthy()
    const tabs = screen.getByRole("radiogroup", { name: "Раздел склада" })
    fireEvent.click(within(tabs).getByRole("radio", { name: "Журнал" }))
    expect(screen.getByText("Списание")).toBeTruthy()
    expect(screen.getByText(formatQuantity(-1.5, "кг"), exact)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Добавить товар/ })).toBeNull()
  })

  it("finance shows signed amounts and maps «Все филиалы» to no filter", () => {
    render(<FinanceWorkspace />)
    expect(summaryFilters.at(-1)).toEqual({ restaurantExternalId: undefined, from: undefined, to: undefined })
    expect(screen.getAllByText(formatTenge(-40_000), exact).length).toBeGreaterThan(0)
    expect(screen.getByRole("combobox", { name: "Филиал" }).textContent).toContain("Все филиалы")
  })
})
