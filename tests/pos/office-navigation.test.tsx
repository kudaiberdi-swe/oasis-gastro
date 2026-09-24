// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useExpandedGroups } from "@/office/data/use-office-navigation"
import { allowsCapability } from "@/office/model/capabilities"
import { filterNavigationByCapabilities, searchNavigation } from "@/office/model/nav-filter"
import { officeItems, officeNavigation } from "@/office/model/navigation"

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

  it("hides items without the right and groups left empty", () => {
    const groups = filterNavigationByCapabilities(officeNavigation, ["office.receipts.view", "office.audit-log.view"])
    expect(groups.map((group) => group.id)).toEqual(["stock", "admin"])
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual(["receipts", "audit-log"])
    expect(filterNavigationByCapabilities(officeNavigation, ["*"])).toHaveLength(12)
    expect(filterNavigationByCapabilities(officeNavigation, [])).toHaveLength(0)
  })

  it("shows the whole catalog block to an old office.catalog.* role (legacy alias)", () => {
    const [stock] = filterNavigationByCapabilities(officeNavigation, ["office.catalog.*"])
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
