// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/shared/components/theme-provider"
import { appRoutes } from "@/shared/routing/routes"

// W1-ADM-05: /office opens «Стартовая страница»; a role without `office.dashboard.view` lands on its
// first allowed section instead of «Нет доступа».

const mocks = vi.hoisted(() => ({ capabilities: ["*"] as string[] }))

vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }) }))
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }))
vi.mock("@/office/features/favorites/ui/favorite-star", () => ({ FavoriteStar: () => null }))
vi.mock("@/office/features/session/data/use-office-context", () => ({
  useOfficeContext: () => ({
    context: { ready: true, canBootstrap: false, email: "admin@sandyq.test", user: { name: "Админ" }, capabilities: mocks.capabilities, restaurants: [], organization: null },
    bootstrap: vi.fn(),
  }),
}))
vi.mock("@/office/features/dashboard/ui/office-dashboard", () => ({ DashboardWorkspace: () => <p>DashboardWorkspace</p> }))
vi.mock("@/office/features/receipts/ui/receipts-workspace", () => ({ ReceiptsWorkspace: () => <p>ReceiptsWorkspace</p> }))

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

describe("start page route (W1-ADM-05)", () => {
  it("opens the dashboard at /office", async () => {
    mocks.capabilities = ["office.dashboard.view"]
    const router = renderAt("/office")
    expect(await screen.findByText("DashboardWorkspace")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/office/dashboard")
    expect(screen.getByRole("heading", { level: 1, name: "Стартовая страница" })).toBeTruthy()
    expect(screen.getByText("Оперативное состояние сети и задачи на сегодня")).toBeTruthy()
  })

  it("sends a role without the start page to its first allowed section", async () => {
    mocks.capabilities = ["office.receipts.view"]
    const router = renderAt("/office")
    expect(await screen.findByText("ReceiptsWorkspace")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/office/receipts")
  })
})
