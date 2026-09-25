// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { almatyMoment, almatyToday } from "@/office/features/loyalty/model/reservations"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"
import { ReservationsWorkspace } from "@/office/features/loyalty/ui/reservations-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-LOY-07 «Банкеты и резервы» (floor plan + approval register + booking card) and W2-LOY-09
// («Сгорит N бонусов DD.MM» in the guest card). Guests, phones and tables are synthetic.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown[]>,
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(reference)
    ;(mocks.queryArgs[name] ??= []).push(args)
    const value = mocks.queries[name]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
    const name = getFunctionName(reference)
    mocks.paginatedArgs.push({ name, args })
    const value = mocks.paginated[name]
    const results = typeof value === "function" ? (value as (args: unknown) => unknown[])(args) : ((value as unknown[]) ?? [])
    return { results, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const fn = (name: string) => `domains/loyalty/reservations:${name}`
const today = almatyToday()
const at = (time: string) => almatyMoment(today, time)!

const TABLES = [
  { _id: "dt1", _creationTime: 0, externalId: "t4", restaurantExternalId: "r1", hall: "Основной зал", label: "Стол 4", capacity: 4, shape: "rect", x: 2, y: 2, width: 2, height: 2, rotation: 0, active: true, updatedAt: 0 },
  { _id: "dt2", _creationTime: 0, externalId: "t5", restaurantExternalId: "r1", hall: "Основной зал", label: "Стол 5", capacity: 6, shape: "circle", x: 6, y: 2, width: 3, height: 3, rotation: 0, active: true, updatedAt: 0 },
  { _id: "dt3", _creationTime: 0, externalId: "t9", restaurantExternalId: "r1", hall: "Терраса", label: "Стол 9", capacity: 2, shape: "rect", x: 1, y: 1, width: 1, height: 1, rotation: 0, active: true, updatedAt: 0 },
]
const BOOKING = { externalId: "rsv-1", number: "RSV-001", status: "approved", start: at("19:00"), end: at("22:00"), guestName: "Айгерим", phone: "7701•••••22", guestCount: 4, recordType: "reservation" }

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    _id: "res1",
    _creationTime: 0,
    externalId: "rsv-1",
    number: "RSV-001",
    organizationExternalId: "sandyq",
    restaurantExternalId: "r1",
    recordType: "reservation",
    hall: "Основной зал",
    tableExternalIds: ["t4"],
    guestName: "Айгерим",
    phone: "77015551122",
    start: at("19:00"),
    end: at("22:00"),
    guestCount: 4,
    occasion: "День рождения",
    prepayment: 10_000,
    prepaymentTypeExternalId: "pt-cash",
    menu: "Бешбармак на 4 персоны",
    status: "approved",
    version: 3,
    searchText: "",
    createdBy: "admin@sandyq.test",
    createdAt: 1_758_000_000_000,
    updatedAt: 1_758_000_000_000,
    ...overrides,
  }
}

const RESERVATIONS: Record<string, ReturnType<typeof reservation>> = {
  "rsv-1": reservation(),
  "rsv-draft": reservation({ externalId: "rsv-draft", number: "RSV-002", status: "draft", version: 1, prepayment: 0, prepaymentTypeExternalId: undefined, recordType: "banquet", guestCount: 10, tableExternalIds: ["t4", "t5"] }),
  "rsv-pending": reservation({ externalId: "rsv-pending", number: "RSV-003", status: "pending-approval", version: 2 }),
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= () => false
  mocks.queryArgs = {}
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    [fn("reservationSummary")]: { upcoming: 7 },
    [fn("floorPlan")]: {
      halls: ["Основной зал", "Терраса"],
      tables: TABLES.map((table) => ({ ...table, reservations: table.externalId === "t4" ? [BOOKING] : [] })),
    },
    [fn("listTables")]: TABLES,
    [fn("getReservation")]: (args: { externalId: string }) => RESERVATIONS[args.externalId] ?? null,
    "domains/retail/queries:listSettings": {
      page: [
        { _id: "s1", externalId: "pt-cash", kind: "payment-type", name: "Наличные", status: "published", effectiveFrom: 0, restaurantExternalIds: [] },
        { _id: "s2", externalId: "pt-other", kind: "payment-type", name: "Kaspi другого филиала", status: "published", effectiveFrom: 0, restaurantExternalIds: ["r2"] },
      ],
      isDone: true,
      continueCursor: "",
    },
  }
  mocks.paginated = {
    [fn("listReservations")]: [
      { ...RESERVATIONS["rsv-1"], phone: "7701•••••22", tableLabels: ["Стол 4"] },
      { ...RESERVATIONS["rsv-draft"], tableLabels: ["Стол 4", "Стол 5"] },
    ],
    "domains/loyalty/office:listGuests": [{ _id: "g1", _creationTime: 0, name: "Ерлан", phone: "77017778899", points: 0, createdAt: 0 }],
  }
  mocks.mutations = {
    [fn("saveReservation")]: vi.fn(async () => ({ externalId: "rsv-new", number: "RSV-004", version: 1 })),
    [fn("transitionReservation")]: vi.fn(async () => ({ status: "pending-approval", version: 2 })),
    [fn("saveTable")]: vi.fn(async () => "table-new"),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode = <ReservationsWorkspace />, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

const panel = () => screen.findByRole("form", { name: "Бронь" })
const lastListArgs = () => mocks.paginatedArgs.filter((call) => call.name === fn("listReservations")).at(-1)?.args
const plan = () => screen.getByRole("group", { name: "Схема зала «Основной зал»" })

describe("«Банкеты и резервы» register (W2-LOY-07)", () => {
  it("shows the approval tabs, the §5 columns, the KPI and the primary «Новая запись»", () => {
    renderAt("/office/reservations")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    const table = screen.getByRole("table", { name: "Банкеты и резервы" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Дата и время", "Гость", "Гостей", "Стол", "Предоплата ₸", "Статус"])
    expect(within(table).getByText("RSV-001")).toBeTruthy()
    expect(within(table).getByText("Согласовано")).toBeTruthy()
    expect(within(table).getByText("Черновик")).toBeTruthy()
    expect(within(table).getByText("Стол 4, Стол 5")).toBeTruthy()
    expect(within(table).getByText("+7701•••••22")).toBeTruthy()
    expect(within(table).getByText("10 000")).toBeTruthy()
    expect(within(table).getAllByText("19:00–22:00").length).toBe(2)
    expect(screen.getByText("Предстоящих резервов")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новая запись" }).className).toContain("bg-primary")
    expect(lastListArgs()).toMatchObject({ restaurantExternalId: "r1" })

    fireEvent.click(screen.getByRole("tab", { name: "Проведённые" }))
    expect(lastListArgs()).toMatchObject({ restaurantExternalId: "r1", status: "completed" })
  })

  it("a role without the edit right sees neither «Новая запись» nor «Редактировать схему»", () => {
    renderAt("/office/reservations", undefined, ["office.reservations.view"])
    expect(screen.queryByRole("button", { name: "Новая запись" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Редактировать схему" })).toBeNull()
  })
})

describe("floor plan", () => {
  it("draws the hall's tables coloured by the day's bookings; a table click lists its bookings and opens one", async () => {
    const router = renderAt("/office/reservations")
    expect(mocks.queryArgs[fn("floorPlan")]?.at(-1)).toEqual({ restaurantExternalId: "r1", date: today })
    const booked = within(plan()).getByRole("button", { name: "Стол 4, 4 места, забронирован" })
    within(plan()).getByRole("button", { name: "Стол 5, 6 мест, свободен" })
    expect(within(plan()).queryByRole("button", { name: /Стол 9/ })).toBeNull() // another hall
    // [0] is the focus ring, [1] the table itself.
    expect(booked.querySelectorAll("rect")[1]?.getAttribute("class")).toContain("fill-accent/20")

    fireEvent.click(booked)
    const bookings = screen.getByRole("list", { name: "Брони стола Стол 4" })
    expect(within(bookings).getByText("RSV-001")).toBeTruthy()
    expect(within(bookings).getByText(/19:00–22:00 · Резерв · 4 гостя/)).toBeTruthy()
    fireEvent.click(within(bookings).getByRole("button", { name: /RSV-001/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/reservations/rsv-1"))
  })

  it("switching the hall shows its tables; the day arrows change the date of the query", () => {
    renderAt("/office/reservations")
    fireEvent.click(screen.getByRole("button", { name: "Следующий день" }))
    expect((mocks.queryArgs[fn("floorPlan")]?.at(-1) as { date: string }).date).not.toBe(today)
    expect((screen.getByLabelText("Дата схемы") as HTMLInputElement).value).not.toBe(today)
  })

  it("«Новая бронь за этим столом» opens a new card with the table, the hall and the day of the plan", async () => {
    renderAt("/office/reservations")
    fireEvent.click(within(plan()).getByRole("button", { name: /^Стол 5/ }))
    fireEvent.click(screen.getByRole("button", { name: "Новая бронь за этим столом" }))
    const form = within(await panel())
    expect(form.getByRole("list", { name: "Выбрано" }).textContent).toContain("Стол 5")
    expect((form.getByLabelText("Дата") as HTMLInputElement).value).toBe(today)

    fireEvent.change(form.getByLabelText("Имя гостя"), { target: { value: "Ерлан" } })
    fireEvent.change(form.getByLabelText("Телефон"), { target: { value: "+7 701 777 88 99" } })
    fireEvent.change(form.getByLabelText("Гостей"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }))
    await waitFor(() => expect(mocks.mutations[fn("saveReservation")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveReservation")].mock.calls[0][0]).toEqual({
      restaurantExternalId: "r1",
      recordType: "reservation",
      hall: "Основной зал",
      tableExternalIds: ["t5"],
      guestName: "Ерлан",
      phone: "+7 701 777 88 99",
      start: at("19:00"),
      end: at("22:00"),
      guestCount: 5,
      occasion: "",
      prepayment: 0,
      menu: "",
    })
  })

  it("editing: add a table, nudge it with the keyboard, save through saveTable", async () => {
    renderAt("/office/reservations")
    fireEvent.click(screen.getByRole("button", { name: "Редактировать схему" }))
    expect(screen.getByRole("button", { name: "Сохранить схему" }).className).toContain("bg-primary")
    expect(screen.getByRole("button", { name: "Новая запись" }).className).not.toContain("bg-primary")
    fireEvent.click(screen.getByRole("button", { name: "Добавить стол" }))
    const properties = within(screen.getByRole("group", { name: "Свойства стола Стол 6" }))
    fireEvent.change(properties.getByLabelText("Вместимость, мест"), { target: { value: "8" } })
    fireEvent.keyDown(within(plan()).getByRole("button", { name: /^Стол 6/ }), { key: "ArrowDown" })

    fireEvent.click(screen.getByRole("button", { name: "Сохранить схему" }))
    await waitFor(() => expect(mocks.mutations[fn("saveTable")]).toHaveBeenCalledTimes(1))
    // freeSpot: right of «Стол 5» (x 6…9) with a free cell between, on the first row; then one cell down.
    expect(mocks.mutations[fn("saveTable")].mock.calls[0][0]).toEqual({ restaurantExternalId: "r1", hall: "Основной зал", label: "Стол 6", capacity: 8, shape: "rect", x: 10, y: 2, width: 2, height: 2, rotation: 0, active: true })
    await waitFor(() => expect(screen.getByRole("button", { name: "Редактировать схему" })).toBeTruthy())
  })

  it("editing an existing table sends its externalId; the server error stays on screen", async () => {
    mocks.mutations[fn("saveTable")].mockRejectedValueOnce(new ConvexError("Стол «Стол 5» в зале «Основной зал» уже есть"))
    renderAt("/office/reservations")
    fireEvent.click(screen.getByRole("button", { name: "Редактировать схему" }))
    fireEvent.keyDown(within(plan()).getByRole("button", { name: /^Стол 4/ }), { key: "ArrowRight" })
    const properties = within(screen.getByRole("group", { name: "Свойства стола Стол 4" }))
    fireEvent.change(properties.getByLabelText("Название стола"), { target: { value: "Стол 5" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить схему" }))
    await waitFor(() => expect(mocks.mutations[fn("saveTable")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveTable")].mock.calls[0][0]).toMatchObject({ externalId: "t4", label: "Стол 5", x: 3, y: 2 })
    expect(await screen.findByText("Стол «Стол 5» в зале «Основной зал» уже есть")).toBeTruthy()
  })
})

describe("booking card", () => {
  it("a new booking is checked on the client first", async () => {
    renderAt("/office/reservations/new")
    const form = within(await panel())
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }))
    const alerts = form.getAllByRole("alert").map((alert) => alert.textContent)
    expect(alerts).toEqual(expect.arrayContaining(["Выберите зал", "Выберите стол", "Укажите имя гостя", "Телефон — 10–15 цифр"]))
    expect(mocks.mutations[fn("saveReservation")]).not.toHaveBeenCalled()
  })

  it("a guest from the base fills the card; an overlap from the server is shown at «Стол(ы)»", async () => {
    mocks.mutations[fn("saveReservation")].mockRejectedValueOnce(new ConvexError("Стол «Стол 4» уже забронирован (RSV-001) на это время"))
    renderAt("/office/reservations")
    fireEvent.click(within(plan()).getByRole("button", { name: /^Стол 4/ }))
    fireEvent.click(screen.getByRole("button", { name: "Новая бронь за этим столом" }))
    const form = within(await panel())
    fireEvent.click(form.getByRole("combobox", { name: "Гость" }))
    fireEvent.click(await screen.findByRole("option", { name: /Ерлан/ }))
    expect((form.getByLabelText("Имя гостя") as HTMLInputElement).value).toBe("Ерлан")
    expect((form.getByLabelText("Телефон") as HTMLInputElement).value).toBe("77017778899")
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }))
    await waitFor(() => expect(mocks.mutations[fn("saveReservation")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveReservation")].mock.calls[0][0]).toMatchObject({ guestId: "g1", guestName: "Ерлан", phone: "77017778899", tableExternalIds: ["t4"], guestCount: 2 })
    // Under the field and in the banner.
    expect((await form.findAllByText("Стол «Стол 4» уже забронирован (RSV-001) на это время")).length).toBe(2)
  })

  it("an advance needs a payment type of the restaurant", async () => {
    renderAt("/office/reservations/new")
    const form = within(await panel())
    fireEvent.change(form.getByLabelText("Предоплата"), { target: { value: "15000" } })
    fireEvent.click(form.getByRole("combobox", { name: "Тип оплаты" }))
    expect(screen.getByRole("option", { name: "Наличные" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "Kaspi другого филиала" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("option", { name: "Наличные" }), { key: "Escape" })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }))
    expect(form.getByText("Укажите тип оплаты предоплаты")).toBeTruthy()
  })

  it("a draft: «Отправить на согласование» is the one primary and submits the saved version", async () => {
    renderAt("/office/reservations/rsv-draft")
    const form = within(await panel())
    expect(form.getByRole("radio", { name: "Банкет" }).getAttribute("aria-checked")).toBe("true")
    const submit = screen.getByRole("button", { name: "Отправить на согласование" })
    expect(submit.className).toContain("bg-primary")
    expect(screen.getByRole("button", { name: "Сохранить черновик" }).className).not.toContain("bg-primary")
    fireEvent.click(submit)
    await waitFor(() => expect(mocks.mutations[fn("transitionReservation")]).toHaveBeenCalledWith({ externalId: "rsv-draft", action: "submit", expectedVersion: 1 }))
    expect(mocks.mutations[fn("saveReservation")]).not.toHaveBeenCalled()
  })

  it("on approval: «Согласовать» only with the approve right; the card is read-only", async () => {
    renderAt("/office/reservations/rsv-pending")
    const form = within(await panel())
    expect(form.getByText("Бешбармак на 4 персоны")).toBeTruthy()
    expect(form.getByText("10 000 ₸ · Наличные")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Согласовать" }))
    await waitFor(() => expect(mocks.mutations[fn("transitionReservation")]).toHaveBeenCalledWith({ externalId: "rsv-pending", action: "approve", expectedVersion: 2 }))
    cleanup()

    renderAt("/office/reservations/rsv-pending", undefined, ["office.reservations.view", "office.reservations.edit"])
    await panel()
    expect(screen.queryByRole("button", { name: "Согласовать" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull()
  })

  it("an approved booking: «Провести» and «Отменить бронь» with a reason", async () => {
    renderAt("/office/reservations/rsv-1")
    const form = within(await panel())
    expect(screen.getByRole("button", { name: "Провести" }).className).toContain("bg-primary")
    fireEvent.click(form.getByRole("button", { name: "Отменить бронь" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Отменить бронь?" })
    expect(within(dialog).getByText(/Стол освободится/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Причина отмены"), { target: { value: "Гость перенёс визит" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить бронь" }))
    await waitFor(() => expect(mocks.mutations[fn("transitionReservation")]).toHaveBeenCalledWith({ externalId: "rsv-1", action: "cancel", expectedVersion: 3, reason: "Гость перенёс визит" }))
  })
})

describe("guest card: bonuses about to expire (W2-LOY-09)", () => {
  it("shows «Сгорит N бонусов DD.MM» from getGuest.nextExpiration", async () => {
    const guest = { _id: "g1", _creationTime: 0, phone: "7701•••••67", name: "Айгерим", points: 1200, createdAt: 0, status: "active", visits: 1, turnover: 0 }
    mocks.queries["domains/loyalty/office:guestSummary"] = { activeGuests: 1, publishedPrograms: 1 }
    mocks.queries["domains/loyalty/office:listCategories"] = []
    mocks.queries["domains/loyalty/office:listPrograms"] = []
    mocks.queries["domains/loyalty/office:getGuest"] = {
      guest,
      accounts: [{ _id: "a1", _creationTime: 0, externalId: "acc-1", guestId: "g1", programExternalId: "p-main", kind: "bonus", balance: 1200, reserved: 0, updatedAt: 0 }],
      transactions: [],
      consents: [],
      // 25.10.2026 02:00 in Almaty is still 24.10 in UTC: the date is Almaty's.
      nextExpiration: { at: Date.UTC(2026, 9, 24, 21, 0), points: 60 },
    }
    mocks.paginated["domains/loyalty/office:listGuests"] = [guest]
    renderAt("/office/guests/g1", <LoyaltyWorkspace />)
    expect(await screen.findByText("Сгорит 60 бонусов 25.10")).toBeTruthy()
    // The guests KPI now counts upcoming reservations too (OFFICE-DESIGN §5 guests).
    expect(screen.getByText("Предстоящих резервов")).toBeTruthy()
  })

  it("no line when nothing expires", async () => {
    mocks.queries["domains/loyalty/office:guestSummary"] = { activeGuests: 1, publishedPrograms: 1 }
    mocks.queries["domains/loyalty/office:listCategories"] = []
    mocks.queries["domains/loyalty/office:listPrograms"] = []
    mocks.queries["domains/loyalty/office:getGuest"] = { guest: { _id: "g1", _creationTime: 0, phone: "7701", name: "А", points: 0, createdAt: 0 }, accounts: [], transactions: [], consents: [], nextExpiration: null }
    renderAt("/office/guests/g1", <LoyaltyWorkspace />)
    await screen.findByRole("form", { name: "Гость" })
    expect(screen.queryByText(/Сгорит/)).toBeNull()
  })
})
