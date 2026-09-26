// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { formatTenge } from "@/shared/lib/format"
import { checkAge, FloorGrid, SEARCH_FROM_TABLES, type FloorCheck, type FloorData, type FloorTable } from "@/pos/features/order-taking/ui/floor-grid"

// «Зал» (redesign item 2): table tiles instead of a typed table number, no on-screen keyboard.

afterEach(cleanup)

const NOW = Date.UTC(2026, 8, 26, 8, 0)

function check(overrides: Partial<FloorCheck> & Pick<FloorCheck, "orderId">): FloorCheck {
  return { number: 12, status: "draft", total: 12_650, createdAt: NOW - 42 * 60_000, kitchenSentAt: null, mine: true, ...overrides }
}

function table(label: string, checks: FloorCheck[] = [], capacity = 4): FloorTable {
  return { tableId: `id-${label}`, label, capacity, checks }
}

function floor(overrides: Partial<FloorData> = {}): FloorData {
  const halls = overrides.halls ?? [
    { name: "Основной зал", tables: [table("Стол 1"), table("Стол 2", [check({ orderId: "o2", tableLabel: "Стол 2", hallLabel: "Основной зал", status: "held" })]), table("Стол 3", [check({ orderId: "o3", total: 5_000, kitchenSentAt: NOW - 60_000 })])] },
    { name: "Терраса", tables: [table("Т1", [], 6)] },
  ]
  return { halls, orphans: [], tableCount: halls.reduce((sum, hall) => sum + hall.tables.length, 0), truncated: false, ...overrides }
}

function renderGrid(props: Partial<Parameters<typeof FloorGrid>[0]> = {}) {
  const handlers = { onOpenChange: vi.fn(), onOpenTable: vi.fn(), onSelectCheck: vi.fn() }
  render(<FloorGrid open floor={floor()} activeOrderId={null} now={NOW} {...handlers} {...props} />)
  return handlers
}

describe("FloorGrid", () => {
  it("a free tile opens a new check at that table at once — no text field, no keyboard", () => {
    const handlers = renderGrid()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
    const free = screen.getByRole("button", { name: /^Стол 1: свободен/ })
    expect(free.textContent).toContain("4 места")
    fireEvent.click(free)
    expect(handlers.onOpenTable).toHaveBeenCalledWith({ tableLabel: "Стол 1", hallLabel: "Основной зал" })
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false)
    expect(handlers.onSelectCheck).not.toHaveBeenCalled()
  })

  it("a taken tile shows total, age and status in text and selects its check", () => {
    const handlers = renderGrid()
    const held = screen.getByRole("button", { name: /^Стол 2: занят, 42 мин/ })
    expect(held.textContent).toContain(formatTenge(12_650))
    expect(held.textContent).toContain("42 мин")
    expect(within(held).getByText("Отложен")).toBeTruthy()
    expect(within(screen.getByRole("button", { name: /^Стол 3: занят/ })).getByText("На кухне")).toBeTruthy()
    fireEvent.click(held)
    expect(handlers.onSelectCheck).toHaveBeenCalledWith("o2")
    expect(handlers.onOpenTable).not.toHaveBeenCalled()
  })

  it("the current check's tile is marked and tapping it just closes the grid", () => {
    const handlers = renderGrid({ activeOrderId: "o2" })
    const current = screen.getByRole("button", { name: /^Стол 2/ })
    expect(current.getAttribute("aria-current")).toBe("true")
    expect(current.className).not.toContain("primary")
    fireEvent.click(current)
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false)
    expect(handlers.onSelectCheck).not.toHaveBeenCalled()
  })

  it("several checks at one table: a small chooser", () => {
    const data = floor({ halls: [{ name: "Зал", tables: [table("Стол 5", [check({ orderId: "a", number: 21, total: 3_000 }), check({ orderId: "b", number: 22, total: 4_000, createdAt: NOW - 5 * 60_000 })])] }] })
    const handlers = renderGrid({ floor: data })
    const tile = screen.getByRole("button", { name: /^Стол 5: 2 чека/ })
    expect(tile.textContent).toContain(formatTenge(7_000))
    fireEvent.click(tile)
    const list = screen.getByRole("list", { name: "Чеки стола Стол 5" })
    fireEvent.click(within(list).getByRole("button", { name: /№22/ }))
    expect(handlers.onSelectCheck).toHaveBeenCalledWith("b")
  })

  it("a table taken at another terminal is shown but cannot be opened here", () => {
    const data = floor({ halls: [{ name: "Зал", tables: [table("Стол 9", [check({ orderId: "x", mine: false, terminalName: "Касса 2" })])] }] })
    renderGrid({ floor: data })
    const tile = screen.getByRole("button", { name: /^Стол 9: занят на кассе Касса 2/ }) as HTMLButtonElement
    expect(tile.disabled).toBe(true)
    expect(tile.textContent).toContain("Касса 2")
  })

  it("hall tabs switch the hall; the count is the taken tables", () => {
    const handlers = renderGrid()
    const tabs = screen.getByRole("tablist", { name: "Залы" })
    expect(within(tabs).getByRole("tab", { name: /Основной зал/ }).getAttribute("aria-selected")).toBe("true")
    fireEvent.click(within(tabs).getByRole("tab", { name: /Терраса/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Т1: свободен/ }))
    expect(handlers.onOpenTable).toHaveBeenCalledWith({ tableLabel: "Т1", hallLabel: "Терраса" })
  })

  it("search and sort appear only from 30 tables, and the search never takes focus by itself", () => {
    const few = Array.from({ length: SEARCH_FROM_TABLES - 1 }, (_, index) => table(`Стол ${index + 1}`))
    renderGrid({ floor: floor({ halls: [{ name: "Зал", tables: few }] }) })
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "Порядок столов" })).toBeNull()
    cleanup()

    const many = Array.from({ length: SEARCH_FROM_TABLES }, (_, index) => table(`Стол ${index + 1}`, index === 4 ? [check({ orderId: "big", total: 90_000 })] : index === 7 ? [check({ orderId: "old", total: 1_000, createdAt: NOW - 3 * 3_600_000 })] : []))
    renderGrid({ floor: floor({ halls: [{ name: "Зал", tables: many }] }) })
    const search = screen.getByRole("searchbox", { name: "Найти стол" })
    expect(document.activeElement).not.toBe(search)
    const order = () => within(screen.getByRole("list", { name: "Столы" })).getAllByRole("button").map((button) => button.getAttribute("aria-label")!.split(":")[0])
    expect(order().slice(0, 3)).toEqual(["Стол 1", "Стол 2", "Стол 3"]) // natural order, not «Стол 1, 10, 11»
    fireEvent.click(screen.getByRole("radio", { name: "По сумме" }))
    expect(order().slice(0, 2)).toEqual(["Стол 5", "Стол 8"])
    fireEvent.click(screen.getByRole("radio", { name: "По времени" }))
    expect(order().slice(0, 2)).toEqual(["Стол 8", "Стол 5"])
    expect(screen.getByRole("button", { name: /^Стол 8/ }).textContent).toContain("3 ч 00 мин")
    fireEvent.change(search, { target: { value: "2" } })
    expect(order()).toEqual(["Стол 2", "Стол 12", "Стол 20", "Стол 21", "Стол 22", "Стол 23", "Стол 24", "Стол 25", "Стол 26", "Стол 27", "Стол 28", "Стол 29"])
  })

  it("keeps checks whose table is not on the plan, and «Без стола» opens a check with no table", () => {
    const handlers = renderGrid({ floor: floor({ orphans: [check({ orderId: "typed", tableLabel: "Стол 40", number: 31 }), check({ orderId: "takeaway", number: 32 })] }) })
    const section = screen.getByRole("region", { name: "Чеки вне схемы" })
    fireEvent.click(within(section).getByRole("button", { name: /^Без стола, чек №32/ }))
    expect(handlers.onSelectCheck).toHaveBeenCalledWith("takeaway")
    fireEvent.click(screen.getByRole("button", { name: /Без стола$/ }))
    expect(handlers.onOpenTable).toHaveBeenCalledWith({})
  })

  it("without a floor plan: the open checks and a digit pad for «Стол вне схемы»", () => {
    const handlers = renderGrid({ floor: floor({ halls: [], tableCount: 0, orphans: [check({ orderId: "o5", tableLabel: "Стол 5" })] }) })
    expect(screen.getByText(/Схема зала не настроена/)).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "Открытые чеки" })).getByRole("button", { name: /^Стол 5, чек №12/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Стол вне схемы/ }))
    expect(screen.queryByRole("textbox")).toBeNull()
    const pad = screen.getByRole("group", { name: "Номер стола" })
    fireEvent.click(within(pad).getByRole("button", { name: "1" }))
    fireEvent.click(within(pad).getByRole("button", { name: "2" }))
    expect(screen.getByRole("status", { name: "Номер стола: введено 2 из 3" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Открыть стол 12" }))
    expect(handlers.onOpenTable).toHaveBeenCalledWith({ tableLabel: "Стол 12" })
  })

  it("the pad reuses a check already open under that number instead of opening a second one", () => {
    const handlers = renderGrid({ floor: floor({ halls: [], tableCount: 0, orphans: [check({ orderId: "o5", tableLabel: "Стол 5" })] }) })
    fireEvent.click(screen.getByRole("button", { name: /Стол вне схемы/ }))
    expect((screen.getByRole("button", { name: "Открыть стол" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(screen.getByRole("group", { name: "Номер стола" })).getByRole("button", { name: "5" }))
    fireEvent.click(screen.getByRole("button", { name: "Открыть стол 5" }))
    expect(handlers.onSelectCheck).toHaveBeenCalledWith("o5")
    expect(handlers.onOpenTable).not.toHaveBeenCalled()
  })

  it("no plan and no checks: an honest empty state", () => {
    renderGrid({ floor: floor({ halls: [], tableCount: 0 }) })
    expect(screen.getByText("Открытых чеков нет")).toBeTruthy()
  })

  it("shows a loading state until the floor arrives", () => {
    renderGrid({ floor: undefined })
    expect(screen.getByRole("status", { name: "Загрузка зала" })).toBeTruthy()
  })

  it("«move»: only free tables are live and the check moves there", async () => {
    const onMove = vi.fn(async () => undefined)
    const handlers = renderGrid({ mode: "move", activeOrderId: "o3", currentTable: { tableLabel: "Стол 3" }, onMove })
    expect(screen.getByRole("heading", { name: "Перенести на стол" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Без стола/ })).toBeNull()
    expect((screen.getByRole("button", { name: /^Стол 2/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: /^Стол 3/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /^Стол 1: свободен/ }))
    expect(onMove).toHaveBeenCalledWith({ tableLabel: "Стол 1", hallLabel: "Основной зал" })
    await vi.waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe("FloorGrid «move» by number", () => {
  it("moves to a table off the plan typed on the pad", async () => {
    const onMove = vi.fn(async () => undefined)
    renderGrid({ mode: "move", activeOrderId: "o3", currentTable: { tableLabel: "Стол 3" }, onMove })
    fireEvent.click(screen.getByRole("button", { name: /Стол вне схемы/ }))
    const pad = screen.getByRole("group", { name: "Номер стола" })
    for (const digit of ["4", "4"]) fireEvent.click(within(pad).getByRole("button", { name: digit }))
    fireEvent.click(screen.getByRole("button", { name: "Перенести на стол 44" }))
    await vi.waitFor(() => expect(onMove).toHaveBeenCalledWith({ tableLabel: "Стол 44" }))
  })

  it("refuses a taken table of the plan before asking the server", () => {
    const onMove = vi.fn(async () => undefined)
    renderGrid({ mode: "move", activeOrderId: "o3", currentTable: { tableLabel: "Стол 3" }, onMove })
    fireEvent.click(screen.getByRole("button", { name: /Стол вне схемы/ }))
    fireEvent.click(within(screen.getByRole("group", { name: "Номер стола" })).getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("button", { name: "Перенести на стол 2" }))
    expect(screen.getByRole("alert").textContent).toContain("За столом «Стол 2» уже открыт чек")
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe("checkAge", () => {
  it("minutes, then hours with zero-padded minutes", () => {
    expect(checkAge(NOW - 20_000, NOW)).toBe("только что")
    expect(checkAge(NOW - 42 * 60_000, NOW)).toBe("42 мин")
    expect(checkAge(NOW - 65 * 60_000, NOW)).toBe("1 ч 05 мин")
    expect(checkAge(NOW + 60_000, NOW)).toBe("только что") // a terminal clock slightly behind
  })
})
