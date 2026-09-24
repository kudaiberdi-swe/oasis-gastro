// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { attendanceDraftOf, formatDeviation, fromAlmatyInput, toAlmatyInput, validateAttendance } from "@/office/features/workforce/model/modules"
import { AttendanceWorkspace } from "@/office/features/workforce/ui/attendance-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-HR-05: the attendance log (office), corrections with a reason, «Исходные данные POS», submit and approve.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: {} as Record<string, unknown>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs[name] = args
    return args === "skip" ? { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true } : { results: mocks.paginated[name] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const text = (value: string) => value.replace(/\s/g, " ")

const CONTEXT = { adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }], user: { restaurantScopes: ["*"] } }

const CLOCK_IN = Date.parse("2026-09-03T04:00:00Z") // 09:00 Almaty
const CLOCK_OUT = Date.parse("2026-09-03T12:30:00Z") // 17:30 Almaty

const COMPLETED = {
  _id: "a1",
  externalId: "attendance-1",
  number: "ЯВ-2026-00311",
  employeeId: "emp1",
  employeeCode: "555",
  employeeName: "Айгерім Серікова",
  organizationExternalId: "sandyq",
  restaurantExternalId: "almaty",
  businessDate: "2026-09-03",
  status: "completed",
  clockIn: CLOCK_IN,
  clockOut: CLOCK_OUT,
  breakMinutes: 30,
  hours: 8,
  attendanceType: "worked",
  source: "pos-shift",
  version: 2,
  searchText: "",
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  // cmdk (Combobox) scrolls the active option into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": CONTEXT,
    "domains/workforce/attendance:get": COMPLETED,
    "domains/workforce/queries:listPosEmployees": [{ _id: "emp1", code: "555", displayName: "Айгерім Серікова", role: "cashier", active: true, restaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }] }],
  }
  mocks.paginated = { "domains/workforce/attendance:list": [COMPLETED, { ...COMPLETED, _id: "a2", externalId: "attendance-2", number: "ЯВ-2026-00312", status: "approved", deviationMinutes: 15, attendanceType: "sick" }] }
  mocks.paginatedArgs = {}
  mocks.mutations = {
    "domains/workforce/attendance:save": vi.fn(async () => "attendance-1"),
    "domains/workforce/attendance:transition": vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <AttendanceWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("model (W1-HR-05)", () => {
  it("round-trips Almaty times and needs a reason when POS times change", () => {
    expect(toAlmatyInput(CLOCK_IN)).toBe("2026-09-03T09:00")
    expect(fromAlmatyInput("2026-09-03T09:00")).toBe(CLOCK_IN)
    const draft = attendanceDraftOf(COMPLETED as never)
    expect(validateAttendance(COMPLETED as never, draft)).toEqual({})
    expect(validateAttendance(COMPLETED as never, { ...draft, clockIn: "2026-09-03T08:00" }).correctionReason).toBe("Укажите причину корректировки")
    expect(validateAttendance(COMPLETED as never, { ...draft, clockOut: "2026-09-03T08:00" }).clockOut).toBe("Уход должен быть позже прихода")
    expect(text(formatDeviation(-70)!)).toBe("−1 ч 10 мин")
  })
})

describe("«Журнал явки» register", () => {
  it("shows lifecycle tabs and hours in «ч», never «₸» (L-10)", () => {
    renderAt("/office/attendance")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "На смене", "Завершённые", "Черновики", "На согласовании", "Согласованные", "Отменённые"])
    const table = screen.getByRole("table", { name: "Журнал явки" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Дата", "Сотрудник", "Приход", "Уход", "Часы", "Отклонение", "Статус"]))
    expect(within(table).getAllByText((content) => text(content) === "8 ч")).toHaveLength(2)
    expect(within(table).queryByText(/₸/)).toBeNull()
    expect(within(table).getAllByText("03.09.2026").length).toBe(2)
    expect(within(table).getAllByText("09:00").length).toBe(2)
    expect(within(table).getByText((content) => text(content) === "+15 мин")).toBeTruthy()
    expect(within(table).getByText("Sandyq Алматы · Больничный")).toBeTruthy()
    expect(within(table).getByText("Согласовано")).toBeTruthy()
  })

  it("a tab filters on the server", () => {
    renderAt("/office/attendance")
    fireEvent.click(screen.getByRole("tab", { name: "На согласовании" }))
    expect(mocks.paginatedArgs["domains/workforce/attendance:list"]).toMatchObject({ status: "pending-approval" })
  })
})

describe("attendance record", () => {
  it("a correction of POS times needs a reason; the POS data block is read-only", async () => {
    renderAt("/office/attendance/attendance-1")
    expect(screen.getByRole("heading", { name: "Явка ЯВ-2026-00311" })).toBeTruthy()
    const pos = screen.getByRole("region", { name: "Исходные данные POS" })
    expect(within(pos).getByText("Смена на кассе")).toBeTruthy()
    expect(within(pos).queryAllByRole("textbox")).toHaveLength(0)

    fireEvent.change(screen.getByLabelText("Приход"), { target: { value: "2026-09-03T08:00" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Укажите причину корректировки")).toBeTruthy()
    expect(mocks.mutations["domains/workforce/attendance:save"]).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Причина корректировки"), { target: { value: "Забыл отметиться" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/attendance:save"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/workforce/attendance:save"]).toHaveBeenCalledWith({
      externalId: "attendance-1",
      expectedVersion: 2,
      employeeId: "emp1",
      restaurantExternalId: "almaty",
      clockIn: Date.parse("2026-09-03T03:00:00Z"),
      clockOut: CLOCK_OUT,
      breakMinutes: 30,
      attendanceType: "worked",
      correctionReason: "Забыл отметиться",
    })
  })

  it("shows the POS times kept in `original` after a correction", () => {
    mocks.queries["domains/workforce/attendance:get"] = { ...COMPLETED, status: "draft", clockIn: CLOCK_IN - 3_600_000, original: { clockIn: CLOCK_IN, clockOut: CLOCK_OUT }, correctionReason: "Забыл отметиться" }
    renderAt("/office/attendance/attendance-1")
    const pos = screen.getByRole("region", { name: "Исходные данные POS" })
    expect(within(pos).getByText("Время, отмеченное на кассе до корректировки офиса.")).toBeTruthy()
    expect(within(pos).getByText(/09:00/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Отправить на согласование" }))
    return waitFor(() => expect(mocks.mutations["domains/workforce/attendance:transition"]).toHaveBeenCalledWith({ externalId: "attendance-1", action: "submit" }))
  })

  it("«Согласовать» needs office.attendance.post; an approved record is read-only", async () => {
    mocks.queries["domains/workforce/attendance:get"] = { ...COMPLETED, status: "pending-approval" }
    renderAt("/office/attendance/attendance-1", ["office.attendance.view", "office.attendance.edit"])
    expect(screen.queryByRole("button", { name: "Согласовать" })).toBeNull()
    cleanup()

    renderAt("/office/attendance/attendance-1")
    fireEvent.click(screen.getByRole("button", { name: "Согласовать" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/attendance:transition"]).toHaveBeenCalledWith({ externalId: "attendance-1", action: "approve" }))
    cleanup()

    mocks.queries["domains/workforce/attendance:get"] = { ...COMPLETED, status: "approved" }
    renderAt("/office/attendance/attendance-1")
    expect(screen.getByText("Явка согласована — только чтение")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    expect(screen.queryByLabelText("Приход")).toBeNull()
  })

  it("«Новая запись» creates a manual office record and opens it", async () => {
    mocks.mutations["domains/workforce/attendance:save"] = vi.fn(async () => "attendance-9")
    const router = renderAt("/office/attendance/new")
    expect(screen.getByRole("heading", { name: "Новая запись явки" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Выберите сотрудника")).toBeTruthy()

    fireEvent.click(screen.getByRole("combobox", { name: "Сотрудник" }))
    fireEvent.click(await screen.findByRole("option", { name: /Айгерім Серікова/ }))
    fireEvent.change(screen.getByLabelText("Приход"), { target: { value: "2026-09-03T09:00" } })
    fireEvent.change(screen.getByLabelText("Уход"), { target: { value: "2026-09-03T17:30" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/attendance:save"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/workforce/attendance:save"]).toHaveBeenCalledWith({ employeeId: "emp1", restaurantExternalId: "almaty", clockIn: CLOCK_IN, clockOut: CLOCK_OUT, breakMinutes: 0, attendanceType: "worked" })
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/attendance/attendance-9"))
  })
})
