// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { appRoutes } from "@/shared/routing/routes"

// Routing only: auth and the heavy workspaces are stubbed.
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }) }))
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }))
vi.mock("@/office/features/session/data/use-office-context", () => ({
  useOfficeContext: () => ({ context: { ready: true, email: "admin@sandyq.test", user: { name: "Админ" } }, bootstrap: vi.fn() }),
}))
vi.mock("@/pos/router", () => ({ PosRouter: () => <p>POS screen</p> }))
vi.mock("@/office/features/catalog/ui/catalog-workspace", () => ({ CatalogWorkspace: () => <p>CatalogWorkspace</p> }))
vi.mock("@/office/features/stock/ui/stock-workspace", () => ({ StockWorkspace: () => <p>StockWorkspace</p> }))
vi.mock("@/office/features/finance/ui/finance-workspace", () => ({ FinanceWorkspace: () => <p>FinanceWorkspace</p> }))
vi.mock("@/office/features/workforce/ui/workforce-workspace", () => ({ WorkforceWorkspace: () => <p>WorkforceWorkspace</p> }))
vi.mock("@/office/features/loyalty/ui/loyalty-workspace", () => ({ LoyaltyWorkspace: () => <p>LoyaltyWorkspace</p> }))
vi.mock("@/office/features/reports/ui/reports-workspace", () => ({ ReportsWorkspace: () => <p>ReportsWorkspace</p> }))

afterEach(cleanup)

function renderAt(url: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return router
}

describe("app routes (W0-FND-01)", () => {
  it("opens an office section straight from its URL, so a reload keeps it", async () => {
    renderAt("/office/stock")
    expect(await screen.findByText("StockWorkspace")).toBeTruthy()
  })

  it("sends /office to the default section and unknown sections to Not Found", async () => {
    const router = renderAt("/office")
    expect(await screen.findByText("CatalogWorkspace")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/office/catalog")

    cleanup()
    renderAt("/office/no-such-section")
    expect(await screen.findByText("Страница не найдена")).toBeTruthy()
  })

  it("redirects / to /pos and keeps the ?terminal= branch selection", async () => {
    const router = renderAt("/?terminal=sandyq-almaty-01")
    expect(await screen.findByText("POS screen")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/pos")
    expect(router.state.location.search).toBe("?terminal=sandyq-almaty-01")
  })

  it("shows Not Found for an unknown path", async () => {
    renderAt("/courier")
    expect(await screen.findByText("Страница не найдена")).toBeTruthy()
  })
})
