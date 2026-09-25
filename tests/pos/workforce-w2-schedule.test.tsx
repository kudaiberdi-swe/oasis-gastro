// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { addDays, localTimestamp, mondayOf, normLabel, scheduleArgs, scheduleDraftOf, shiftBlockLayout, validateSchedule, weekRangeLabel } from "@/office/features/workforce/model/w2"
import { ScheduleWorkspace } from "@/office/features/workforce/ui/schedule-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-HR-04 «Расписание»: the week calendar, «Новая смена», published shifts, copy and publish a week.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    ;(mocks.queryArgs[name] ??= []).push(args)
    return args === "skip" ? undefined : mocks.queries[name]
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const text = (value: string) => value.replace(/\s/g, " ")
const at = (local: string) => Date.parse(`${local}+05:00`)

const DAYS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]

function shift(id: string, date: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  const startAt = at(`${date}T${start}:00`)
  let endAt = at(`${date}T${end}:00`)
  if (endAt <= startAt) endAt += 86_400_000
  const plannedHours = (endAt - startAt) / 3_600_000 - 1
  return { _id: id, externalId: id, employeeId: "emp1", employeeCode: "555", employeeName: "Айгерім Серікова", restaurantExternalId: "almaty", businessDate: date, start: startAt, end: endAt, breakMinutes: 60, plannedHours, status: "draft", version: 1, createdAt: 0, updatedAt: 0, colorToken: "cat-meat", shiftTypeName: "День", shiftTypeExternalId: "shift-type-day", ...extra }
}

const MONDAY = shift("schedule-1", "2026-09-28", "09:00", "19:00", { status: "published" })
const TUESDAY_NIGHT = shift("schedule-2", "2026-09-29", "22:00", "08:00", { colorToken: "cat-tea", shiftTypeName: "Ночь", shiftTypeExternalId: "shift-type-night" })

function week(overNorm = true) {
  const shifts = [MONDAY, TUESDAY_NIGHT]
  return {
    days: DAYS,
    rows: [
      {
        employeeId: "emp1",
        employeeName: "Айгерім Серікова",
        employeeCode: "555",
        positionName: "Кассир",
        plannedHours: overNorm ? 45 : 18,
        weeklyNorm: 40,
        overNorm,
        days: DAYS.map((date) => ({ date, hours: shifts.filter((row) => row.businessDate === date).reduce((sum, row) => sum + row.plannedHours, 0), shifts: shifts.filter((row) => row.businessDate === date) })),
      },
      { employeeId: "emp2", employeeName: "Нурлан Ахметов", employeeCode: "556", positionName: null, plannedHours: 0, weeklyNorm: null, overNorm: false, days: DAYS.map((date) => ({ date, hours: 0, shifts: [] })) },
    ],
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }], user: { restaurantScopes: ["*"] } },
    "domains/workforce/schedule:scheduleWeek": week(),
    "domains/workforce/references:listShiftTypes": [{ externalId: "shift-type-day", name: "День", timeLabel: "09:00–21:00", startMinute: 540, endMinute: 1260, breakMinutes: 60, colorToken: "cat-meat" }],
    "domains/workforce/references:listPositions": [{ externalId: "position-cashier", name: "Кассир" }],
  }
  mocks.queryArgs = {}
  mocks.mutations = {
    "domains/workforce/schedule:saveEntry": vi.fn(async () => "schedule-new"),
    "domains/workforce/schedule:removeEntry": vi.fn(async () => null),
    "domains/workforce/schedule:copyWeek": vi.fn(async () => ({ copied: 2, skipped: 1 })),
    "domains/workforce/schedule:publishWeek": vi.fn(async () => ({ published: 1 })),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <ScheduleWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("model (W2-HR-04)", () => {
  it("weeks start on Monday", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28")
    expect(mondayOf("2026-09-28")).toBe("2026-09-28")
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05")
    expect(weekRangeLabel("2026-09-28")).toBe("28.09 — 04.10.2026")
  })

  it("a shift over midnight stays in its start day with a «+1» mark", () => {
    expect(shiftBlockLayout({ start: at("2026-09-29T22:00:00"), end: at("2026-09-30T08:00:00") })).toEqual({ timeLabel: "22:00–08:00", nextDay: 1 })
    expect(shiftBlockLayout({ start: at("2026-09-29T09:00:00"), end: at("2026-09-29T18:00:00") })).toEqual({ timeLabel: "09:00–18:00", nextDay: 0 })
  })

  it("the dialog draft becomes Almaty timestamps; an end before the start is the next day", () => {
    const draft = { ...scheduleDraftOf(null, { employeeId: "emp1", date: "2026-09-29" }), start: "22:00", end: "06:00", breakMinutes: "30" }
    expect(validateSchedule(draft)).toEqual({})
    expect(scheduleArgs("almaty", null, draft)).toEqual({ restaurantExternalId: "almaty", employeeId: "emp1", start: at("2026-09-29T22:00:00"), end: at("2026-09-30T06:00:00"), breakMinutes: 30 })
    expect(localTimestamp("2026-09-29", 22 * 60)).toBe(at("2026-09-29T22:00:00"))
    expect(validateSchedule({ ...draft, breakMinutes: "600" }).breakMinutes).toBe("Перерыв должен быть короче смены")
    expect(text(normLabel(45, 40))).toBe("45 ч / норма 40 ч")
  })
})

describe("«Расписание» week calendar", () => {
  it("employees × days, blocks in the shift type color, hours in «ч» with a warning over the norm", () => {
    renderAt("/office/schedule?week=2026-09-30")
    expect(mocks.queryArgs["domains/workforce/schedule:scheduleWeek"]).toContainEqual({ restaurantExternalId: "almaty", weekStart: "2026-09-28" })
    const grid = screen.getByRole("table", { name: "Расписание на неделю" })
    expect(within(grid).getAllByRole("columnheader").map((cell) => text(cell.textContent ?? ""))).toEqual(["Сотрудник", "Пн 28.09", "Вт 29.09", "Ср 30.09", "Чт 01.10", "Пт 02.10", "Сб 03.10", "Вс 04.10", "Часы за неделю"])
    expect(within(grid).getByRole("rowheader", { name: /Айгерім Серікова/ })).toBeTruthy()
    const night = within(grid).getByRole("button", { name: /Смена: Айгерім Серікова, Вт 29\.09, 22:00–08:00 \(до следующего дня\)/ })
    expect(night.className).toContain("border-l-cat-tea")
    expect(within(night).getByText("+1")).toBeTruthy()
    expect(within(grid).getByText((content) => text(content) === "45 ч / норма 40 ч")).toBeTruthy()
    expect(within(grid).getByText((content) => text(content) === "Сверх нормы на 5 ч")).toBeTruthy()
    expect(within(grid).queryByText(/₸/)).toBeNull()
  })

  it("an empty cell opens «Новая смена» for that employee and day; the shift is saved as timestamps", async () => {
    renderAt("/office/schedule?week=2026-09-28")
    fireEvent.click(screen.getByRole("button", { name: "Новая смена: Нурлан Ахметов, Ср 30.09" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Новая смена" })).toBeTruthy()
    expect((within(dialog).getByLabelText("Дата") as HTMLInputElement).value).toBe("2026-09-30")
    fireEvent.change(within(dialog).getByLabelText("Начало"), { target: { value: "10:00" } })
    fireEvent.change(within(dialog).getByLabelText("Окончание"), { target: { value: "20:00" } })
    expect(within(dialog).getByText((content) => text(content) === "9 ч")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать смену" }))
    await waitFor(() =>
      expect(mocks.mutations["domains/workforce/schedule:saveEntry"]).toHaveBeenCalledWith({ restaurantExternalId: "almaty", employeeId: "emp2", start: at("2026-09-30T10:00:00"), end: at("2026-09-30T20:00:00"), breakMinutes: 60 }),
    )
  })

  it("an overlap from the server stays in the dialog", async () => {
    mocks.mutations["domains/workforce/schedule:saveEntry"] = vi.fn(async () => {
      throw new Error("Смена пересекается с существующим расписанием: 2026-09-28 09:00")
    })
    renderAt("/office/schedule?week=2026-09-28")
    fireEvent.click(screen.getByRole("button", { name: /Смена: Айгерім Серікова, Вт 29\.09/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }))
    expect(await within(dialog).findByText(/пересекается с существующим расписанием/)).toBeTruthy()
  })

  it("a published shift is read-only: «Снять и создать новую» removes it and opens a new shift", async () => {
    renderAt("/office/schedule?week=2026-09-28")
    fireEvent.click(screen.getByRole("button", { name: /Смена: Айгерім Серікова, Пн 28\.09/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Смена опубликована — только чтение")).toBeTruthy()
    expect(within(dialog).queryByLabelText("Начало")).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "Снять и создать новую" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Снять смену" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/schedule:removeEntry"]).toHaveBeenCalledWith({ externalId: "schedule-1" }))
    expect(await screen.findByRole("heading", { name: "Новая смена" })).toBeTruthy()
    expect((screen.getByLabelText("Начало") as HTMLInputElement).value).toBe("09:00")
  })

  it("«Опубликовать неделю» is the one primary; «Скопировать неделю» copies to the next week", async () => {
    const router = renderAt("/office/schedule?week=2026-09-28")
    const publish = screen.getByRole("button", { name: "Опубликовать неделю" })
    expect(publish.className).toContain("bg-primary")
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(1)
    fireEvent.click(publish)
    await waitFor(() => expect(mocks.mutations["domains/workforce/schedule:publishWeek"]).toHaveBeenCalledWith({ restaurantExternalId: "almaty", weekStart: "2026-09-28" }))

    fireEvent.click(screen.getByRole("button", { name: "Скопировать неделю" }))
    const dialog = await screen.findByRole("dialog")
    expect((within(dialog).getByLabelText("На неделю") as HTMLInputElement).value).toBe("2026-10-05")
    fireEvent.click(within(dialog).getByRole("button", { name: "Скопировать" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/schedule:copyWeek"]).toHaveBeenCalledWith({ restaurantExternalId: "almaty", fromWeekStart: "2026-09-28", toWeekStart: "2026-10-05" }))
    await waitFor(() => expect(router.state.location.search).toContain("week=2026-10-05"))
  })

  it("week navigation and the table view (hours in «ч»)", () => {
    const router = renderAt("/office/schedule?week=2026-09-28")
    fireEvent.click(screen.getByRole("button", { name: "Следующая неделя" }))
    expect(router.state.location.search).toContain("week=2026-10-05")
    fireEvent.click(screen.getByRole("radio", { name: "Таблица" }))
    const table = screen.getByRole("table", { name: "Смены недели" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Дата", "Сотрудник", "Смена", "Часы", "Статус"]))
    expect(within(table).getAllByText((content) => text(content) === "9 ч").length).toBeGreaterThan(0)
    expect(within(table).getByText("Опубликовано")).toBeTruthy()
  })

  it("without edit and approve rights: no create, copy or publish", () => {
    renderAt("/office/schedule?week=2026-09-28", ["office.schedule.view"])
    expect(screen.queryByRole("button", { name: /Новая смена/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Скопировать неделю" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Опубликовать неделю" })).toBeNull()
  })
})
