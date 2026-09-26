// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/shared/components/theme-provider"
import { appRoutes } from "@/shared/routing/routes"

// Routing only: auth and the heavy workspaces are stubbed.
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }) }))
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }))
// The «В избранное» star in the page header reads the live favorites list (W3-ADM-13).
vi.mock("@/office/features/favorites/ui/favorite-star", () => ({ FavoriteStar: () => null }))
vi.mock("@/office/features/session/data/use-office-context", () => ({
  useOfficeContext: () => ({
    context: { ready: true, canBootstrap: false, email: "admin@sandyq.test", user: { name: "Админ" }, capabilities: ["*"], restaurants: [], organization: null },
    bootstrap: vi.fn(),
  }),
}))
vi.mock("@/pos/router", () => ({ PosRouter: () => <p>POS screen</p> }))
vi.mock("@/office/features/dashboard/ui/office-dashboard", () => ({ DashboardWorkspace: () => <p>DashboardWorkspace</p> }))
vi.mock("@/office/features/nomenclature/ui/nomenclature-workspace", () => ({ NomenclatureWorkspace: () => <p>NomenclatureWorkspace</p> }))
vi.mock("@/office/features/stock/ui/balances-page", () => ({ BalancesPage: () => <p>BalancesPage</p> }))
vi.mock("@/office/features/finance/ui/journal-workspace", () => ({ TransactionsWorkspace: () => <p>TransactionsWorkspace</p> }))
vi.mock("@/office/features/workforce/ui/workforce-workspace", () => ({ WorkforceWorkspace: () => <p>WorkforceWorkspace</p> }))
vi.mock("@/office/features/loyalty/ui/loyalty-workspace", () => ({ LoyaltyWorkspace: () => <p>LoyaltyWorkspace</p> }))
vi.mock("@/office/features/reports/ui/reports-workspace", () => ({ ReportsWorkspace: () => <p>ReportsWorkspace</p> }))

afterEach(cleanup)

function renderAt(url: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] })
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  )
  return router
}

describe("app routes (W0-FND-01)", () => {
  it("opens an office section straight from its URL, so a reload keeps it", async () => {
    renderAt("/office/stock")
    expect(await screen.findByText("BalancesPage")).toBeTruthy()
  })

  it("sends /office to the default section and unknown sections to Not Found", async () => {
    const router = renderAt("/office")
    expect(await screen.findByText("DashboardWorkspace")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/office/dashboard")

    cleanup()
    renderAt("/office/no-such-section")
    expect(await screen.findByText("Страница не найдена")).toBeTruthy()
  })

  it("keeps old section URLs working and shows a placeholder for sections not built yet", async () => {
    const router = renderAt("/office/catalog")
    expect(await screen.findByText("NomenclatureWorkspace")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/office/nomenclature")

    cleanup()
    renderAt("/office/equipment")
    expect(await screen.findByText("Раздел в разработке")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Оборудование" })).toBeTruthy()
    expect(screen.queryByText(/Касса №|Смена закрыта/)).toBeNull()
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
