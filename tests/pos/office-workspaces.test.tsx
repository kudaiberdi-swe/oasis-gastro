// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
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
})
