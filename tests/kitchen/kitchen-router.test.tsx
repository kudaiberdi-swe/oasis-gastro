// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const convex = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), boardError: null as Error | null }))

const OPTIONS = [
  {
    restaurantExternalId: "almaty",
    restaurantName: "Sandyq Алматы",
    city: "Алматы",
    address: "ул. Абылай хана, 1",
    terminals: [{ externalId: "almaty-01", name: "Главная касса", terminalNumber: 1 }],
  },
]

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    if (args === "skip") return undefined
    if (args && typeof args === "object" && "sessionToken" in args) {
      if (convex.boardError) throw convex.boardError
      return []
    }
    return OPTIONS
  },
  useAction: () => convex.login,
  useMutation: () => convex.logout,
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: false }),
}))
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }))
vi.mock("@/pos/router", () => ({ PosRouter: () => <p>POS screen</p> }))

import { kitchenTerminalLabel, KitchenRouter } from "@/kitchen/router"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { appRoutes } from "@/shared/routing/routes"

const SESSION = {
  sessionToken: "token",
  expiresAt: Date.now() + 3_600_000,
  employee: { id: "e", code: "300", displayName: "Повар", role: "kitchen" },
  terminal: { id: "t", externalId: "almaty-01", name: "Главная касса", terminalNumber: 1 },
  restaurant: { id: "r", externalId: "almaty", name: "Sandyq Алматы", city: "Алматы" },
}

// This Node/jsdom pair exposes no working Web Storage; the kitchen only needs get/set/remove.
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage())
  vi.stubGlobal("sessionStorage", memoryStorage())
  window.history.replaceState(null, "", "/kitchen")
  convex.login = vi.fn().mockResolvedValue(SESSION)
  convex.logout = vi.fn().mockResolvedValue(null)
  convex.boardError = null
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("/kitchen sign-in (W1-KDS-02)", () => {
  it("picks a terminal, signs in with an operator PIN session and opens the board", async () => {
    render(<KitchenRouter />)
    expect(screen.getByRole("heading", { name: "Выберите рабочее место" })).toBeTruthy()
    await userEvent.click(screen.getByRole("radio", { name: /Главная касса/ }))
    await userEvent.click(screen.getByRole("button", { name: "Продолжить к входу" }))

    expect(screen.getByText("Экран кухни · Sandyq Алматы · Главная касса")).toBeTruthy()
    await userEvent.keyboard("300{Enter}1234{Enter}")
    expect(convex.login).toHaveBeenCalledWith({ employeeCode: "300", pin: "1234", terminalExternalId: "almaty-01", purpose: "operator" })
    expect(await screen.findByRole("heading", { level: 1, name: "Заказы кухни" })).toBeTruthy()
    expect(window.localStorage.getItem("sandyq-kitchen-terminal")).toBe("almaty-01")
    // The kitchen keeps its own session, apart from the cashier's.
    expect(window.sessionStorage.getItem("sandyq-kitchen-session")).toContain("token")
    expect(window.sessionStorage.getItem("sandyq-pos-session")).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "Выйти" }))
    expect(convex.logout).toHaveBeenCalledWith({ sessionToken: "token" })
    expect(screen.getByRole("heading", { name: "Вход в кассу" })).toBeTruthy()
  })

  it("takes a kitchen terminal from ?terminal= even when the picker does not list it", () => {
    window.history.replaceState(null, "", "/kitchen?terminal=almaty-kds")
    render(<KitchenRouter />)
    expect(screen.getByText("Экран кухни")).toBeTruthy()
    expect(window.localStorage.getItem("sandyq-kitchen-terminal")).toBe("almaty-kds")
  })

  it("returns to the PIN screen with the reason when the server refuses the session", () => {
    window.localStorage.setItem("sandyq-kitchen-terminal", "almaty-01")
    window.sessionStorage.setItem("sandyq-kitchen-session", JSON.stringify(SESSION))
    convex.boardError = new Error("Сессия истекла. Войдите снова")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<KitchenRouter />)
    consoleError.mockRestore()
    expect(screen.getByText("Сессия истекла. Войдите снова")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Вход в кассу" })).toBeTruthy()
    expect(window.sessionStorage.getItem("sandyq-kitchen-session")).toBeNull()
  })

  it("labels the terminal without repeating the branch", () => {
    expect(kitchenTerminalLabel("Sandyq Алматы", "Sandyq Алматы · Кухня")).toBe("Экран кухни · Sandyq Алматы · Кухня")
    expect(kitchenTerminalLabel()).toBe("Экран кухни")
  })
})

describe("kitchen routes", () => {
  it("sends the old /pos/kitchen to /kitchen and keeps ?terminal=", async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/pos/kitchen?terminal=almaty-kds"] })
    render(
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>,
    )
    expect(router.state.location.pathname).toBe("/kitchen")
    expect(router.state.location.search).toBe("?terminal=almaty-kds")
  })
})
