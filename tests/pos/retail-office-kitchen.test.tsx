// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { KitchenSummaryRow } from "@/office/features/kitchen/data/use-kitchen-summary"
import { activeTicketsLabel, kitchenHref } from "@/office/features/kitchen/model/kitchen-link"
import { KitchenBoardWorkspace } from "@/office/features/kitchen/ui/kitchen-board-workspace"
import { findOfficeItem, OFFICE_LINKS } from "@/office/model/navigation"

// W1-KDS-03: «Экран кухни» in the office — restaurants with active tickets and a link to /kitchen, where
// the kitchen signs in with its own PIN (never through the office session).

const mocks = vi.hoisted(() => ({ queries: {} as Record<string, unknown> }))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
}))

const SUMMARY = "domains/kitchen/queries:officeSummary"

const ROWS: KitchenSummaryRow[] = [
  { restaurantExternalId: "almaty", restaurantName: "Sandyq Абая", activeTickets: 2, terminalExternalId: "kds-1", terminalName: "Кухня · Абая" },
  { restaurantExternalId: "dostyk", restaurantName: "Sandyq Достык", activeTickets: 0, terminalExternalId: null, terminalName: null },
]

beforeEach(() => {
  mocks.queries = { [SUMMARY]: ROWS }
})

afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/office/kitchen-board"]}>
      <KitchenBoardWorkspace />
    </MemoryRouter>,
  )
}

describe("«Экран кухни» (W1-KDS-03)", () => {
  it("is an office page with its own right, not a redirect to /kitchen", () => {
    expect(OFFICE_LINKS["kitchen-board"]).toBeUndefined()
    expect(findOfficeItem("kitchen-board")?.capability).toBe("office.kitchen-board.view")
  })

  it("lists restaurants with active tickets and opens the kitchen screen of the terminal in a new tab", () => {
    renderPage()
    const abaya = screen.getByRole("article", { name: "Sandyq Абая" })
    expect(within(abaya).getByText("2 активных")).toBeTruthy()
    expect(within(abaya).getByText("Кухня · Абая")).toBeTruthy()
    const link = within(abaya).getByRole("link", { name: /Открыть экран кухни/ })
    expect(link.getAttribute("href")).toBe("/kitchen?terminal=kds-1")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toContain("noopener")

    const dostyk = screen.getByRole("article", { name: "Sandyq Достык" })
    expect(within(dostyk).queryByRole("link")).toBeNull()
    expect(within(dostyk).getByText(/экран кухни открыть нельзя/)).toBeTruthy()
    expect(screen.getByText("Всего: 2 активных")).toBeTruthy()
  })

  it("loading and empty states", () => {
    mocks.queries = {}
    renderPage()
    expect(document.querySelector("[aria-busy=true]")).toBeTruthy()
    cleanup()
    mocks.queries = { [SUMMARY]: [] }
    renderPage()
    expect(screen.getByText("Кухонных терминалов нет")).toBeTruthy()
  })

  it("labels and links", () => {
    expect([1, 2, 5, 11, 21].map(activeTicketsLabel)).toEqual(["1 активный", "2 активных", "5 активных", "11 активных", "21 активный"])
    expect(kitchenHref("kds 1")).toBe("/kitchen?terminal=kds%201")
  })
})
