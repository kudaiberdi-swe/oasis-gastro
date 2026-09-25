// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CatalogWorkspace } from "@/office/features/catalog/ui/catalog-workspace"
import { formatTenge } from "@/shared/lib/format"

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

afterEach(cleanup)

describe("office workspaces on the shared primitives (W0-FND-05)", () => {
  it("catalog renders products in DataTable with formatted price and one primary action", () => {
    render(<CatalogWorkspace />)
    const table = screen.getByRole("table")
    expect(within(table).getByText("Сорпа", { selector: "span.font-semibold" })).toBeTruthy()
    expect(within(table).getByText(formatTenge(2500), exact)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Добавить блюдо/ })).toBeTruthy()
  })

})
