// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { ShiftAcceptanceRow, ShiftCandidate } from "@/office/features/finance/data/use-finance-records"
import { ShiftAcceptanceWorkspace } from "@/office/features/finance/ui/shift-acceptance-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-FIN-06: the panel lists closed shifts from `shifts` (L-12: bahandi's panel was empty); «Принять»
// needs the accountant's recount and a comment on a variance, and shows the posting it will write.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs.push({ name, args })
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
    return { results: (mocks.paginated[name] as unknown[]) ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const CANDIDATES = "domains/finance/shiftAcceptance:candidates"
const ACCEPTANCES = "domains/finance/shiftAcceptance:acceptances"
const ACCEPT = "domains/finance/shiftAcceptance:acceptShift"
const REVERSE = "domains/finance/shiftAcceptance:reverseShiftAcceptance"

const SHIFT: ShiftCandidate = {
  shiftId: "shift1" as ShiftCandidate["shiftId"],
  restaurantName: "Sandyq Абая",
  terminalName: "Касса №1",
  shiftNumber: 12,
  businessDate: "2026-09-23",
  zReportNumber: "Z-12",
  closedAt: Date.parse("2026-09-23T23:10:00+05:00"),
  closedByName: "Айгерім",
  expectedCash: 2300,
  countedCash: 2300,
  variance: 0,
}

const ACCEPTED: ShiftAcceptanceRow = {
  _id: "acc1" as ShiftAcceptanceRow["_id"],
  _creationTime: 0,
  shiftId: "shift0" as ShiftAcceptanceRow["shiftId"],
  restaurantExternalId: "r1",
  acceptedByEmail: "buh@sandyq.kz",
  acceptedAt: Date.parse("2026-09-22T10:00:00+05:00"),
  note: "Недостача 300",
  expectedCash: 2300,
  countedAtCloseCash: 2300,
  recountedCash: 2000,
  variance: -300,
  journalEntryExternalId: "shift-variance-shift0",
}

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": {
      adminRestaurants: [
        { externalId: "r1", name: "Sandyq Абая" },
        { externalId: "r2", name: "Sandyq Достык" },
      ],
      user: { restaurantScopes: ["*"] },
    },
    "domains/finance/records:references": {
      accounts: [
        { externalId: "acc-1010", code: "1010", name: "Денежные средства в кассе", type: "asset", allowManualEntries: true },
        { externalId: "acc-7480", code: "7480", name: "Недостачи", type: "expense", allowManualEntries: false },
      ],
      cashflowCategories: [],
      counterparties: [],
      restaurants: [],
      truncated: false,
    },
  }
  mocks.paginated = { [CANDIDATES]: [SHIFT], [ACCEPTANCES]: [ACCEPTED] }
  mocks.mutations = { [ACCEPT]: vi.fn(async () => "acceptance-2"), [REVERSE]: vi.fn(async () => null) }
})

afterEach(cleanup)

function renderPage(capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <ShiftAcceptanceWorkspace /> }], { initialEntries: ["/office/shift-acceptance"] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
}

const last = (name: string) => mocks.paginatedArgs.filter((call) => call.name === name).at(-1)?.args

describe("«Принятие смен» (W1-FIN-06)", () => {
  it("the panel lists closed shifts of every restaurant in scope; the register reads one restaurant", () => {
    renderPage()
    expect(last(CANDIDATES)).toEqual({})
    expect(last(ACCEPTANCES)).toEqual({ restaurantExternalId: "r1" })
    const list = screen.getByRole("list", { name: "Смены к приёмке" })
    expect(within(list).getByText("№12 · Касса №1")).toBeTruthy()
    // No «Новая запись»: acceptance starts from the panel (the primary lives in the dialog).
    expect(screen.queryByRole("button", { name: /Новая/ })).toBeNull()
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(0)

    const table = screen.getByRole("table", { name: "Принятые смены" })
    expect(within(table).getByText("buh@sandyq.kz")).toBeTruthy()
    expect(within(table).getByText("Проведён")).toBeTruthy()
  })

  it("«Принять» needs the recount, a comment on a variance and shows the shortage posting", async () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Принять смену №12 · Касса №1" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Принять" }))
    expect(within(dialog).getByText("Введите пересчитанную наличность")).toBeTruthy()
    expect(mocks.mutations[ACCEPT]).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText("Пересчитанная наличность"), { target: { value: "2000" } })
    expect(within(dialog).getByText(/Недостача: проводка Дт 7480 Недостачи — Кт 1010 Денежные средства в кассе/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Принять" }))
    expect(within(dialog).getByText("При расхождении укажите комментарий")).toBeTruthy()
    expect(mocks.mutations[ACCEPT]).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText("Комментарий"), { target: { value: "Недостача 300" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Принять" }))
    await waitFor(() => expect(mocks.mutations[ACCEPT]).toHaveBeenCalledWith({ shiftId: "shift1", recountedCash: 2000, note: "Недостача 300" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("an equal recount posts nothing and needs no comment; a server error stays in the dialog", async () => {
    mocks.mutations[ACCEPT] = vi.fn(async () => {
      throw new ConvexError("Период закрыт до 30.09.2026")
    })
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Принять смену №12 · Касса №1" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Пересчитанная наличность"), { target: { value: "2300" } })
    expect(within(dialog).getByText("Наличность сходится — проводка не создаётся.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Принять" }))
    await waitFor(() => expect(mocks.mutations[ACCEPT]).toHaveBeenCalledWith({ shiftId: "shift1", recountedCash: 2300, note: "" }))
    expect(await within(dialog).findByText("Период закрыт до 30.09.2026")).toBeTruthy()
  })

  it("without the post right there is no «Принять»; «Сторно» of an acceptance asks for a reason", async () => {
    renderPage(["office.shift-acceptance.view", "office.shift-acceptance.reverse"])
    expect(screen.queryByRole("button", { name: /Принять смену/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Сторно" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.change(within(confirm).getByLabelText("Причина сторно"), { target: { value: "Пересчёт" } })
    fireEvent.click(within(confirm).getByRole("button", { name: "Сторнировать" }))
    await waitFor(() => expect(mocks.mutations[REVERSE]).toHaveBeenCalledWith({ shiftId: "shift0", reason: "Пересчёт" }))
  })
})
