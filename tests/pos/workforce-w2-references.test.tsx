// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { minuteToTime, positionArgs, positionDraftOf, shiftTypeArgs, shiftTypeDraftOf, shiftTypeHours, timeToMinute, validatePosition, validateShiftType } from "@/office/features/workforce/model/w2"
import { PositionsWorkspace } from "@/office/features/workforce/ui/positions-workspace"
import { ShiftTypesWorkspace } from "@/office/features/workforce/ui/shift-types-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-HR-02 «Должности» and W2-HR-03 «Типы смен»: master registers, cards, ЧЧ:ММ time, color tokens.

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

const CASHIER = {
  _id: "p1",
  externalId: "position-cashier",
  code: "CASH",
  name: "Кассир",
  payType: "hourly",
  defaultRate: 1500,
  weeklyHours: 40,
  posRole: "cashier",
  active: true,
  version: 2,
  createdAt: 0,
  updatedAt: 0,
  employeeCount: 3,
}

const NIGHT = {
  _id: "s1",
  externalId: "shift-type-night",
  code: "N",
  name: "Ночь",
  startMinute: 22 * 60,
  endMinute: 6 * 60,
  breakMinutes: 30,
  nightCoefficient: 1.5,
  holidayCoefficient: 2,
  colorToken: "cat-tea",
  active: true,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  timeLabel: "22:00–06:00",
  hours: 7.5,
}

beforeEach(() => {
  mocks.queries = {
    "domains/workforce/references:listPositions": [CASHIER],
    "domains/workforce/references:listShiftTypes": [NIGHT],
    "domains/corporation/departments:listDepartments": [],
  }
  mocks.queryArgs = {}
  mocks.mutations = {
    "domains/workforce/references:savePosition": vi.fn(async () => "position-new"),
    "domains/workforce/references:setPositionActive": vi.fn(async () => null),
    "domains/workforce/references:saveShiftType": vi.fn(async () => "shift-type-new"),
    "domains/workforce/references:setShiftTypeActive": vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string, Workspace: () => React.ReactNode, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <Workspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("model (W2-HR-02/03)", () => {
  it("converts ЧЧ:ММ to minutes and counts a shift over midnight", () => {
    expect(timeToMinute("22:00")).toBe(1320)
    expect(timeToMinute("24:00")).toBeNull()
    expect(minuteToTime(390)).toBe("06:30")
    expect(shiftTypeHours(22 * 60, 6 * 60, 30)).toBe(7.5)
    expect(shiftTypeHours(9 * 60, 21 * 60, 60)).toBe(11)
  })

  it("mirrors the server checks: coefficient ≥ 1, break shorter than the shift, same start and end", () => {
    const draft = shiftTypeDraftOf(null)
    expect(validateShiftType(draft)).toMatchObject({ code: "Укажите код", name: "Укажите название" })
    const filled = { ...draft, code: "D", name: "День" }
    expect(validateShiftType(filled)).toEqual({})
    expect(validateShiftType({ ...filled, nightCoefficient: "0,9" }).nightCoefficient).toBe("Не меньше 1")
    expect(validateShiftType({ ...filled, end: "09:00" }).end).toBe("Начало и окончание смены совпадают")
    expect(validateShiftType({ ...filled, start: "22:00", end: "02:00", breakMinutes: "240" }).breakMinutes).toBe("Перерыв должен быть короче смены")
    expect(shiftTypeArgs(null, { ...filled, start: "22:00", end: "06:00", nightCoefficient: "1,5" })).toMatchObject({ startMinute: 1320, endMinute: 360, nightCoefficient: 1.5, colorToken: "cat-meat" })
  })

  it("positions: whole tenge rate and a weekly norm from 1 to 84", () => {
    const draft = { ...positionDraftOf(null), code: "C", name: "Кассир", defaultRate: 1500 }
    expect(validatePosition(draft)).toEqual({})
    expect(validatePosition({ ...draft, weeklyHours: "90" }).weeklyHours).toBe("Норма часов в неделю — от 1 до 84")
    expect(validatePosition({ ...draft, defaultRate: null }).defaultRate).toBe("Ставка — целое число тенге")
    expect(positionArgs(CASHIER as never, { ...positionDraftOf(CASHIER as never), weeklyHours: "37,5" })).toMatchObject({ externalId: "position-cashier", expectedVersion: 2, weeklyHours: 37.5, posRole: "cashier" })
  })
})

describe("«Должности» (W2-HR-02)", () => {
  it("columns per §5; the rate carries its unit, never a bare «1 ₸» (L-10)", () => {
    renderAt("/office/positions", PositionsWorkspace)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Активные", "Неактивные"])
    const table = screen.getByRole("table", { name: "Должности" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Код", "Название", "Ставка по умолчанию", "Сотрудников", "Статус"]))
    expect(within(table).getByText((content) => text(content) === "1 500 ₸/ч")).toBeTruthy()
    expect(within(table).getByText("3")).toBeTruthy()
    expect(within(table).getByText("Активно")).toBeTruthy()
  })

  it("a tab filters on the server", () => {
    renderAt("/office/positions", PositionsWorkspace)
    fireEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    expect(mocks.queryArgs["domains/workforce/references:listPositions"]).toContainEqual({ status: "inactive" })
  })

  it("creates a position from the card", async () => {
    const router = renderAt("/office/positions/new", PositionsWorkspace)
    const form = screen.getByRole("form", { name: "Должность" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "Повар" } })
    fireEvent.change(within(form).getByLabelText("Код"), { target: { value: "COOK" } })
    fireEvent.change(within(form).getByLabelText("Ставка по умолчанию"), { target: { value: "2 000" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/references:savePosition"]).toHaveBeenCalledWith({ code: "COOK", name: "Повар", payType: "hourly", defaultRate: 2000, weeklyHours: 40 }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/positions/position-new"))
  })

  it("the card shows the employee count; deactivation asks first", async () => {
    renderAt("/office/positions/position-cashier", PositionsWorkspace)
    expect(screen.getByText("Сотрудников на должности: 3")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Отключить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/references:setPositionActive"]).toHaveBeenCalledWith({ externalId: "position-cashier", active: false }))
  })

  it("without the edit right: no «Новая должность», the card is read-only", () => {
    renderAt("/office/positions/position-cashier", PositionsWorkspace, ["office.positions.view"])
    expect(screen.queryByRole("button", { name: /Новая должность/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Отключить" })).toBeNull()
  })
})

describe("«Типы смен» (W2-HR-03)", () => {
  it("time «22:00–06:00 +1», duration in «ч», coefficients; the color is a token swatch", () => {
    renderAt("/office/shift-types", ShiftTypesWorkspace)
    const table = screen.getByRole("table", { name: "Типы смен" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Код", "Название", "Время", "Длительность", "Оплата", "Статус"]))
    expect(within(table).getByText("22:00–06:00")).toBeTruthy()
    expect(within(table).getByText((content) => text(content) === "7 ч 30 мин")).toBeTruthy()
    expect(within(table).getByText("ночь ×1,5 · праздник ×2")).toBeTruthy()
    expect(table.querySelector(".bg-cat-tea")).not.toBeNull()
  })

  it("the card edits ЧЧ:ММ, not a minute of the day, and picks a color from the palette", async () => {
    renderAt("/office/shift-types/shift-type-night", ShiftTypesWorkspace)
    const form = screen.getByRole("form", { name: "Тип смены" })
    expect((within(form).getByLabelText("Начало") as HTMLInputElement).value).toBe("22:00")
    expect(within(form).getByText("На следующий день")).toBeTruthy()
    expect(within(form).getByRole("radio", { name: "Чай" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.change(within(form).getByLabelText("Окончание"), { target: { value: "07:00" } })
    fireEvent.click(within(form).getByRole("radio", { name: "Бирюза" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() =>
      expect(mocks.mutations["domains/workforce/references:saveShiftType"]).toHaveBeenCalledWith({
        externalId: "shift-type-night",
        expectedVersion: 1,
        code: "N",
        name: "Ночь",
        startMinute: 1320,
        endMinute: 420,
        breakMinutes: 30,
        nightCoefficient: 1.5,
        holidayCoefficient: 2,
        colorToken: "cat-turkistan",
      }),
    )
  })

  it("a coefficient below 1 never reaches the server", async () => {
    renderAt("/office/shift-types/new", ShiftTypesWorkspace)
    const form = screen.getByRole("form", { name: "Тип смены" })
    fireEvent.change(within(form).getByLabelText("Название"), { target: { value: "День" } })
    fireEvent.change(within(form).getByLabelText("Короткий код"), { target: { value: "D" } })
    fireEvent.change(within(form).getByLabelText("Праздничный коэффициент"), { target: { value: "0,5" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Не меньше 1", { selector: "[role=alert]" })).toBeTruthy()
    expect(mocks.mutations["domains/workforce/references:saveShiftType"]).not.toHaveBeenCalled()
  })
})
