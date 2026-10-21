// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Sidebar } from "@/office/components/sidebar"
import { useExpandedGroups } from "@/office/data/use-office-navigation"
import { allowsCapability } from "@/office/model/capabilities"
import { filterNavigationByCapabilities, searchNavigation } from "@/office/model/nav-filter"
import { officeItems, officeNavigation } from "@/office/model/navigation"
import { ThemeProvider } from "@/shared/components/theme-provider"

// This Node/jsdom pair exposes no working localStorage; the hook only needs get/setItem.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("office navigation model (W0-UI-01)", () => {
  it("has the 12 bahandi groups in order with unique item ids", () => {
    expect(officeNavigation.map((group) => group.id)).toEqual([
      "home", "sales", "stock", "production", "finance", "employees", "guests", "delivery", "corporation", "exchange", "admin", "reports",
    ])
    expect(officeItems).toHaveLength(91)
    expect(new Set(officeItems.map((item) => item.id)).size).toBe(officeItems.length)
    expect(officeItems.some((item) => item.id === "integration-egais")).toBe(true)
  })

  it("hides items without the right and groups left empty; «Избранное» is everyone's (W3-ADM-13)", () => {
    const groups = filterNavigationByCapabilities(officeNavigation, ["office.receipts.view", "office.audit-log.view"])
    expect(groups.map((group) => group.id)).toEqual(["home", "stock", "admin"])
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual(["favorites", "receipts", "audit-log"])
    expect(filterNavigationByCapabilities(officeNavigation, ["*"])).toHaveLength(12)
    expect(filterNavigationByCapabilities(officeNavigation, []).flatMap((group) => group.items.map((item) => item.id))).toEqual(["favorites"])
  })

  it("shows the whole catalog block to an old office.catalog.* role (legacy alias)", () => {
    const stock = filterNavigationByCapabilities(officeNavigation, ["office.catalog.*"]).find((group) => group.id === "stock")!
    expect(stock.items.map((item) => item.id)).toEqual(["nomenclature", "product-groups", "modifiers", "size-scales", "price-orders", "price-lists"])
  })

  it("finds «накладн» in labels and descriptions", () => {
    const labels = searchNavigation(officeNavigation, "накладн").flatMap((group) => group.items.map((item) => item.label))
    expect(labels).toContain("Приходные накладные")
    expect(labels).toContain("Расходные накладные")
    expect(labels).not.toContain("Номенклатура")
    expect(searchNavigation(officeNavigation, "ЁЛКА ничего")).toHaveLength(0)
  })

  it("matches the backend's capability rule", () => {
    expect(allowsCapability(["office.finance.*"], "office.finance.view")).toBe(true)
    expect(allowsCapability(["office.finance.view"], "office.finance.edit")).toBe(false)
    expect(allowsCapability(["*"], "office.anything.view")).toBe(true)
  })

  it("remembers opened groups and always opens the active one", () => {
    const { result, unmount } = renderHook(() => useExpandedGroups("stock"))
    expect(result.current.expanded).toContain("stock")
    act(() => result.current.toggle("finance"))
    unmount()
    const again = renderHook(() => useExpandedGroups(undefined))
    expect(again.result.current.expanded).toEqual(expect.arrayContaining(["stock", "finance"]))
  })
})

describe("navigation rights", () => {
  it("every item's right is office.<section>.view or a documented exception", () => {
    for (const item of officeItems) {
      expect(item.capability, item.id).toMatch(/^office\.[a-z0-9-]+\.view$/)
      if (item.kind !== undefined) expect(["report", "integration", "link"]).toContain(item.kind)
    }
  })
})

// fix-office-sidebar-collapse: the group of the current page opens on entry and can then be closed.
function renderSidebar(activeItemId: string) {
  const sidebar = (id: string) => (
    <ThemeProvider>
      <MemoryRouter>
        <Sidebar groups={officeNavigation} activeItemId={id} collapsed={false} canToggleCollapsed={false} onToggleCollapsed={() => {}} footerLine="" />
      </MemoryRouter>
    </ThemeProvider>
  )
  const view = render(sidebar(activeItemId))
  return { ...view, navigate: (id: string) => view.rerender(sidebar(id)) }
}

const header = (label: string) => screen.getByRole("button", { name: label })
const link = (label: string) => screen.queryByRole("link", { name: label })
const activeGroupStyle = "[&>svg:first-child]:text-nav-accent"

describe("office sidebar groups open and close (fix-office-sidebar-collapse)", () => {
  it("[fix-office-sidebar-collapse] close the group of the current page", () => {
    renderSidebar("stock")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(header("Товары и склады"))
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    expect(link("Остатки")).toBeNull()
    expect(header("Товары и склады").className).toContain(activeGroupStyle)
    cleanup()

    renderSidebar("dashboard")
    expect(header("Главная").getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(header("Главная"))
    expect(header("Главная").getAttribute("aria-expanded")).toBe("false")
    expect(link("Стартовая страница")).toBeNull()
    expect(header("Главная").className).toContain(activeGroupStyle)
  })

  it("[fix-office-sidebar-collapse] open a closed group", () => {
    renderSidebar("dashboard")
    expect(header("Финансы").getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(header("Финансы"))
    expect(header("Финансы").getAttribute("aria-expanded")).toBe("true")
    expect(link("Проводки")).not.toBeNull()
  })

  it("[fix-office-sidebar-collapse] close a group that does not hold the current page", () => {
    renderSidebar("dashboard")
    fireEvent.click(header("Финансы"))
    fireEvent.click(header("Финансы"))
    expect(header("Финансы").getAttribute("aria-expanded")).toBe("false")
    expect(link("Проводки")).toBeNull()
  })

  it("[fix-office-sidebar-collapse] entering a page opens its group", () => {
    renderSidebar("stock")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
    expect(link("Остатки")?.getAttribute("aria-current")).toBe("page")
  })

  it("[fix-office-sidebar-collapse] closed group stays closed on the same page", () => {
    const { navigate } = renderSidebar("stock")
    fireEvent.click(header("Товары и склады"))
    navigate("stock")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    expect(link("Остатки")).toBeNull()
  })

  it("[fix-office-sidebar-collapse] page in the same group keeps the group closed", () => {
    const { navigate } = renderSidebar("stock")
    fireEvent.click(header("Товары и склады"))
    navigate("receipts")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    expect(link("Приходные накладные")).toBeNull()
  })

  it("[fix-office-sidebar-collapse] page in another group opens that group", () => {
    const { navigate } = renderSidebar("dashboard")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    navigate("stock")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
    expect(link("Остатки")?.getAttribute("aria-current")).toBe("page")
  })

  it("[fix-office-sidebar-collapse] Enter toggles a group header", async () => {
    const user = userEvent.setup()
    renderSidebar("dashboard")
    header("Главная").focus()
    await user.keyboard("{Enter}")
    expect(header("Главная").getAttribute("aria-expanded")).toBe("false")
    expect(link("Стартовая страница")).toBeNull()
    await user.keyboard("{Enter}")
    expect(header("Главная").getAttribute("aria-expanded")).toBe("true")
    expect(link("Стартовая страница")).not.toBeNull()
  })

  it("[fix-office-sidebar-collapse] Space toggles a group header", async () => {
    const user = userEvent.setup()
    renderSidebar("stock")
    header("Товары и склады").focus()
    await user.keyboard(" ")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    expect(link("Остатки")).toBeNull()
    await user.keyboard(" ")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
    expect(link("Остатки")).not.toBeNull()
  })

  it("[fix-office-sidebar-collapse] open groups are remembered in the browser", () => {
    window.localStorage.setItem("sandyq-office-nav", JSON.stringify(["home"]))
    const { unmount } = renderSidebar("stock")
    fireEvent.click(header("Финансы"))
    fireEvent.click(header("Главная"))
    unmount()
    renderSidebar("nomenclature")
    expect(header("Финансы").getAttribute("aria-expanded")).toBe("true")
    expect(header("Главная").getAttribute("aria-expanded")).toBe("false")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
  })

  it("[fix-office-sidebar-collapse] reload reopens the group of the current page", () => {
    const { unmount } = renderSidebar("stock")
    fireEvent.click(header("Товары и склады"))
    fireEvent.click(header("Финансы"))
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("false")
    unmount()
    renderSidebar("stock")
    expect(header("Финансы").getAttribute("aria-expanded")).toBe("true")
    expect(header("Товары и склады").getAttribute("aria-expanded")).toBe("true")
  })
})
