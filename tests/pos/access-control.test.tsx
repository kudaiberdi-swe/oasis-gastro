// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CAPABILITY_CATALOG } from "../../convex/lib/capabilities"
import { AccessControlWorkspace } from "@/office/features/access-control/ui/access-control-workspace"
import { ToastProvider } from "@/shared/components/ui"

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  queryError: null as Error | null,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  // Convex useQuery throws a failed query's error during render.
  useQuery: () => {
    if (mocks.queryError) throw mocks.queryError
    return mocks.data
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference).split(":").pop()!
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

function fixture() {
  return {
    roles: [
      { externalId: "analyst", name: "Аналитик", capabilities: ["office.favorites.*", "office.reports.view"], system: true, fullAccess: false, sectionCount: 2 },
      { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true, fullAccess: true, sectionCount: CAPABILITY_CATALOG.length },
      { externalId: "cashier", name: "Кассир", capabilities: ["office.orders.view", "office.cash-shifts.view", "office.cash-operations.view", "office.pos.view", "office.dashboard.view"], system: false, fullAccess: false, sectionCount: 5 },
    ],
    users: [
      { externalId: "owner", email: "owner@sandyq.test", name: "Владелец", roleExternalId: "administrator", restaurantScopes: ["r1"], organizationScopes: ["org"], warehouseScopes: ["*"], active: true },
      { externalId: "aigerim", email: "aigerim@sandyq.test", name: "Айгерим", roleExternalId: "analyst", restaurantScopes: ["r1"], organizationScopes: ["org"], warehouseScopes: [], active: false },
    ],
    restaurants: [
      { externalId: "r1", name: "Sandyq Абая" },
      { externalId: "r2", name: "Sandyq Достык" },
    ],
    catalog: CAPABILITY_CATALOG,
    editor: { email: "owner@sandyq.test", externalId: "owner", fullAccess: true, capabilities: ["*"], warehouseScopes: ["*", "wh-main"] },
  }
}

beforeEach(() => {
  mocks.data = fixture()
  mocks.queryError = null
  mocks.mutations = {
    saveRole: vi.fn(async (args: unknown) => (args as { externalId: string }).externalId),
    saveUser: vi.fn(async (args: unknown) => (args as { externalId: string }).externalId),
    setUserActive: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/office/:section" element={<AccessControlWorkspace />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

const groupHeader = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) })

describe("«Роли и права» (W1-ACL-05)", () => {
  it("lists roles with «Полный доступ» and Russian plurals", () => {
    renderAt("/office/roles")
    const list = screen.getByRole("region", { name: "Роли" })
    expect(within(list).getByText("Полный доступ")).toBeTruthy()
    expect(within(list).getByText("2 разрешения")).toBeTruthy()
    expect(within(list).getByText("5 разрешений")).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Роли" }).getAttribute("aria-selected")).toBe("true")
  })

  it("expands a group when its header is clicked, with the «N функций» counter", () => {
    renderAt("/office/roles")
    const header = groupHeader("Главная")
    expect(header.textContent).toContain("2 функции")
    expect(groupHeader("Розничные продажи").textContent).toContain("8 функций")
    expect(header.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("checkbox", { name: "Стартовая страница: Просмотр" })).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("checkbox", { name: "Стартовая страница: Просмотр" })).toBeTruthy()
    // favorites is a reference: view + edit only, no «Проведение» cell.
    expect(screen.getByRole("checkbox", { name: "Избранное: Изменение" }).getAttribute("data-state")).toBe("checked")
    expect(screen.queryByRole("checkbox", { name: "Избранное: Проведение" })).toBeNull()
  })

  it("«Полный доступ» disables the matrix", () => {
    renderAt("/office/roles")
    fireEvent.click(groupHeader("Главная"))
    const box = screen.getByRole("checkbox", { name: "Стартовая страница: Просмотр" })
    expect(box.hasAttribute("disabled")).toBe(false)

    fireEvent.click(screen.getByRole("checkbox", { name: "Полный доступ ко всем функциям и будущим модулям" }))
    const after = screen.getByRole("checkbox", { name: "Стартовая страница: Просмотр" })
    expect(after.hasAttribute("disabled")).toBe(true)
    expect(after.getAttribute("data-state")).toBe("checked")
  })

  it("saves explicit office.<section>.<action> rights (wildcards expanded)", async () => {
    renderAt("/office/roles")
    fireEvent.click(groupHeader("Главная"))
    fireEvent.click(screen.getByRole("checkbox", { name: "Стартовая страница: Просмотр" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить роль" }))

    await waitFor(() => expect(mocks.mutations.saveRole).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveRole).toHaveBeenCalledWith({
      externalId: "analyst",
      name: "Аналитик",
      fullAccess: false,
      capabilities: ["office.dashboard.view", "office.favorites.view", "office.favorites.edit", "office.reports.view"],
    })
    expect(await screen.findByText("Роль сохранена")).toBeTruthy()
  })

  it("keeps the code of an existing role read-only and the administrator on full access", () => {
    renderAt("/office/roles")
    expect((screen.getByLabelText("Код") as HTMLInputElement).readOnly).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /Администратор/ }))
    expect(screen.getByRole("checkbox", { name: "Полный доступ ко всем функциям и будущим модулям" }).hasAttribute("disabled")).toBe(true)
  })

  it("switches to «Пользователи» through the URL", () => {
    renderAt("/office/roles")
    fireEvent.click(screen.getByRole("tab", { name: "Пользователи" }))
    expect(screen.getByRole("form", { name: "Учётная запись Office" })).toBeTruthy()
  })
})

describe("«Пользователи» (W1-ACL-06)", () => {
  it("shows statuses from the dictionary and no password field", () => {
    const { container } = renderAt("/office/users")
    const list = screen.getByRole("region", { name: "Пользователи" })
    expect(within(list).getByText("Активно")).toBeTruthy()
    expect(within(list).getByText("Неактивно")).toBeTruthy()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect((screen.getByLabelText("Email") as HTMLInputElement).type).toBe("email")
  })

  it("hides the active switch on the editor's own account", () => {
    renderAt("/office/users")
    expect(screen.getByRole("heading", { name: "Владелец" })).toBeTruthy()
    expect(screen.queryByRole("switch", { name: "Учётная запись активна" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Айгерим/ }))
    expect(screen.getByRole("switch", { name: "Учётная запись активна" })).toBeTruthy()
  })

  it("shows a server error in a Banner", async () => {
    mocks.mutations.saveUser = vi.fn(async () => {
      throw new ConvexError("Нельзя отключить собственную учётную запись")
    })
    renderAt("/office/users")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить пользователя" }))
    const banner = await screen.findByRole("alert")
    expect(banner.textContent).toContain("Нельзя отключить собственную учётную запись")
    expect(mocks.mutations.saveUser).toHaveBeenCalledWith({
      externalId: "owner",
      email: "owner@sandyq.test",
      name: "Владелец",
      roleExternalId: "administrator",
      restaurantScopes: ["r1"],
      warehouseScopes: ["*"],
      active: true,
    })
  })

  it("turns a failed query into the error state with «Повторить»", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.queryError = new ConvexError("Недостаточно прав")
    renderAt("/office/users")
    expect(screen.getByRole("alert").textContent).toContain("Недостаточно прав")
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy()
    spy.mockRestore()
  })

  it("renders the loading state while the query is pending", () => {
    mocks.data = undefined
    renderAt("/office/users")
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })
})
