// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { categoryCondition, dateInputToMs, guestSaveArgs, guestDraftOf, lastProgramDay, programDraftOf, programSaveArgs, validateGuest } from "@/office/features/loyalty/model/loyalty-model"
import { GuestCategoriesWorkspace } from "@/office/features/loyalty/ui/categories-workspace"
import { LoyaltyWorkspace } from "@/office/features/loyalty/ui/loyalty-workspace"
import { LoyaltyProgramsWorkspace } from "@/office/features/loyalty/ui/programs-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-LOY-04/05/06: office «Гости», «Программы лояльности», «Категории гостей» on convex/domains/loyalty/office.ts.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>>,
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
    const value = mocks.paginated[name]
    const results = typeof value === "function" ? (value as (args: unknown) => unknown[])(args) : ((value as unknown[]) ?? [])
    return { results, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const fn = (name: string) => `domains/loyalty/office:${name}`
const exact = { normalizer: (text: string) => text.trim() }

const GUEST = {
  _id: "g1",
  _creationTime: 0,
  phone: "7701•••••67",
  name: "Айгерим",
  points: 1200,
  createdAt: 1_758_000_000_000,
  status: "active",
  email: "a•••@mail.kz",
  birthDate: "••.••.••••",
  categoryExternalIds: ["guest-category-gold"],
  visits: 5,
  turnover: 60_000,
  lastVisitAt: 1_758_700_000_000,
  updatedAt: 100,
}
const CATEGORIES = [
  { _id: "c1", _creationTime: 0, externalId: "guest-category-gold", code: "gold", name: "Gold", color: "gold", assignment: "automatic", minimumSpend: 150_000, minimumVisits: 3, validDays: 365, active: true, createdAt: 0, updatedAt: 0 },
  { _id: "c2", _creationTime: 0, externalId: "guest-category-vip", code: "vip", name: "VIP", color: "primary", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0, active: false, createdAt: 0, updatedAt: 0 },
]
const PROGRAMS = [
  { _id: "p1", _creationTime: 0, externalId: "p-main", name: "Sandyq Bonus", status: "published", programKind: "bonus", accrualPercent: 5, maxRedemptionPercent: 50, welcomeBonus: 0, startsAt: dateInputToMs("2026-09-01"), restaurantExternalIds: ["*"], priority: 10, createdAt: 0, updatedAt: 0 },
  { _id: "p2", _creationTime: 0, externalId: "p-draft", name: "Gold x2", status: "draft", programKind: "bonus", accrualPercent: 10, maxRedemptionPercent: 30, welcomeBonus: 500, startsAt: dateInputToMs("2026-10-01"), endsAt: dateInputToMs("2027-01-01"), categoryExternalId: "guest-category-gold", restaurantExternalIds: ["r1"], priority: 10, createdAt: 0, updatedAt: 0 },
]
const CARD = {
  guest: GUEST,
  accounts: [{ _id: "a1", _creationTime: 0, externalId: "acc-1", guestId: "g1", programExternalId: "p-main", kind: "bonus", balance: 1200, reserved: 0, updatedAt: 0 }],
  transactions: [{ _id: "t1", _creationTime: 0, guestId: "g1", kind: "accrual", points: 115, balanceAfter: 1200, occurredAt: 1_758_700_000_000, description: "Начисление по заказу №100004" }],
  consents: [{ _id: "k1", _creationTime: 0, guestId: "g1", channel: "personal-data", granted: true, source: "office", actorKey: "admin@sandyq.test", recordedAt: 1_758_000_000_000 }],
}

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }, { externalId: "r2", name: "Sandyq Достык" }], user: { restaurantScopes: ["*"] } },
    [fn("guestSummary")]: { activeGuests: 60, publishedPrograms: 1 },
    [fn("listCategories")]: CATEGORIES,
    [fn("listPrograms")]: PROGRAMS,
    [fn("getGuest")]: (args: { guestId: string }) => (args.guestId === "g1" ? CARD : null),
  }
  mocks.paginated = { [fn("listGuests")]: [GUEST] }
  mocks.mutations = {
    [fn("saveGuest")]: vi.fn(async () => "g-new"),
    [fn("recordConsent")]: vi.fn(async () => null),
    [fn("setGuestStatus")]: vi.fn(async () => null),
    [fn("adjustBalance")]: vi.fn(async () => ({ balance: 1300 })),
    [fn("saveProgram")]: vi.fn(async () => ({ externalId: "p-draft", overlaps: [{ externalId: "p-main", name: "Sandyq Bonus", priority: 10, samePriority: true }] })),
    [fn("transitionProgram")]: vi.fn(async () => null),
    [fn("saveCategory")]: vi.fn(async () => "guest-category-new"),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode, capabilities: string[] = ["*"]) {
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

const panel = () => screen.findByRole("dialog")
const lastGuestArgs = () => mocks.paginatedArgs.filter((call) => call.name === fn("listGuests")).at(-1)?.args

describe("«Гости» register (W1-LOY-04)", () => {
  it("shows the §5 columns, KPI and masked phones; tabs filter by status on the server", () => {
    renderAt("/office/guests", <LoyaltyWorkspace />)
    const table = screen.getByRole("table", { name: "Гости" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(["Имя", "Телефон", "Категория", "Визитов", "Баланс бонусов", "Последний визит", "Статус"])
    expect(headers.join(" ")).not.toMatch(/Сумма/)
    expect(within(table).getByText("+7701•••••67")).toBeTruthy()
    expect(within(table).getByText("Gold")).toBeTruthy()
    expect(within(table).getByText("Активно")).toBeTruthy()
    expect(screen.getByText("Активных гостей")).toBeTruthy()
    expect(screen.getByText("60")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новый гость" }).className).toContain("bg-primary")

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Активные", "Неактивные"])
    fireEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    expect(lastGuestArgs()).toMatchObject({ status: "inactive" })
  })

  it("hides «Новый гость» without the edit right", () => {
    renderAt("/office/guests", <LoyaltyWorkspace />, ["office.guests.view"])
    expect(screen.queryByRole("button", { name: "Новый гость" })).toBeNull()
  })

  it("a new guest needs a name, a contact and both consents before the server is called", async () => {
    renderAt("/office/guests/new", <LoyaltyWorkspace />)
    const form = within(await panel())
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    expect(form.getByText("Укажите имя гостя")).toBeTruthy()
    expect(form.getByText("Нужно согласие на обработку персональных данных")).toBeTruthy()
    expect(form.getByText("Нужно согласие на трансграничную передачу")).toBeTruthy()
    expect(mocks.mutations[fn("saveGuest")]).not.toHaveBeenCalled()

    fireEvent.change(form.getByLabelText("Имя"), { target: { value: "Ерлан" } })
    fireEvent.change(form.getByLabelText("Телефон"), { target: { value: "+7 701 555 11 22" } })
    fireEvent.click(form.getByRole("checkbox", { name: /обработку персональных данных/ }))
    fireEvent.click(form.getByRole("checkbox", { name: /трансграничную/ }))
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[fn("saveGuest")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveGuest")].mock.calls[0][0]).toMatchObject({ name: "Ерлан", phone: "+7 701 555 11 22", categoryExternalIds: [], consents: { personalData: true, crossBorder: true } })
  })

  it("a masked card without the PII right keeps personal data read-only and saves it back unchanged", async () => {
    renderAt("/office/guests/g1", <LoyaltyWorkspace />, ["office.guests.view", "office.guests.edit", "office.guest-categories.view"])
    const form = within(await panel())
    const phone = form.getByLabelText("Телефон") as HTMLInputElement
    expect(phone.value).toBe("7701•••••67")
    expect(phone.readOnly).toBe(true)
    expect(form.getByText(/Заметки скрыты/)).toBeTruthy()
    expect(form.queryByRole("button", { name: "Корректировка" })).toBeNull() // needs office.loyalty-programs.approve

    fireEvent.change(form.getByLabelText("Имя"), { target: { value: "Айгерим Б." } })
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[fn("saveGuest")]).toHaveBeenCalled())
    const args = mocks.mutations[fn("saveGuest")].mock.calls[0][0]
    expect(args).toMatchObject({ guestId: "g1", expectedUpdatedAt: 100, name: "Айгерим Б.", phone: "7701•••••67", email: "a•••@mail.kz", birthDate: "••.••.••••" })
    expect(args).not.toHaveProperty("notes")
    expect(args).not.toHaveProperty("consents")
  })

  it("consents are recorded as new journal rows", async () => {
    renderAt("/office/guests/g1", <LoyaltyWorkspace />)
    const form = within(await panel())
    expect(form.getByRole("list", { name: "Журнал согласий" })).toBeTruthy()
    fireEvent.click(form.getByRole("button", { name: "Дать согласие: SMS-рассылки" }))
    const dialog = await screen.findByRole("dialog", { name: "Записать согласие" })
    fireEvent.change(within(dialog).getByLabelText("Документ-основание (необязательно)"), { target: { value: "Заявление №7" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать согласие" }))
    await waitFor(() => expect(mocks.mutations[fn("recordConsent")]).toHaveBeenCalledWith({ guestId: "g1", channel: "sms", granted: true, documentRef: "Заявление №7" }))
  })

  it("«Корректировка» adjusts a program account with a reason", async () => {
    renderAt("/office/guests/g1", <LoyaltyWorkspace />)
    const form = within(await panel())
    expect(form.getByText("Sandyq Bonus")).toBeTruthy()
    fireEvent.click(form.getByRole("button", { name: "Корректировка" }))
    const dialog = await screen.findByRole("dialog", { name: "Корректировка баланса" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Применить" }))
    expect(within(dialog).getByText(/Ненулевое целое число/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Баллы (± целое число)"), { target: { value: "+100" } })
    fireEvent.change(within(dialog).getByLabelText("Причина"), { target: { value: "Жалоба гостя" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Применить" }))
    await waitFor(() => expect(mocks.mutations[fn("adjustBalance")]).toHaveBeenCalledWith({ guestId: "g1", programExternalId: "p-main", amount: 100, reason: "Жалоба гостя" }))
  })
})

describe("«Программы лояльности» (W1-LOY-05)", () => {
  it("publish tabs, percent columns and period instead of an amount", () => {
    renderAt("/office/loyalty-programs", <LoyaltyProgramsWorkspace />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Опубликованные", "Неактивные"])
    const table = screen.getByRole("table", { name: "Программы лояльности" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(["Название", "Начисление, %", "Макс. списание, %", "Период", "Приоритет", "Статус"])
    expect(within(table).getByText("Опубликовано")).toBeTruthy()
    expect(within(table).getByText("01.10.2026 — 31.12.2026")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Черновики" }))
    expect(within(screen.getByRole("table", { name: "Программы лояльности" })).queryByText("Sandyq Bonus")).toBeNull()
  })

  it("a published program is read-only and can be copied into a draft", async () => {
    renderAt("/office/loyalty-programs/p-main", <LoyaltyProgramsWorkspace />)
    const form = within(await panel())
    expect(form.getByText("Изменить можно только черновик")).toBeTruthy()
    expect((form.getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
    expect(form.queryByRole("button", { name: "Сохранить" })).toBeNull()
    fireEvent.click(form.getByRole("button", { name: "Создать копию черновиком" }))
    const copy = within(await panel())
    expect((copy.getByLabelText("Название") as HTMLInputElement).value).toBe("Sandyq Bonus (копия)")
  })

  it("saving a draft shows the overlap warning; publishing is a separate action", async () => {
    renderAt("/office/loyalty-programs/p-draft", <LoyaltyProgramsWorkspace />)
    const form = within(await panel())
    expect((form.getByLabelText("Окончание (включительно)") as HTMLInputElement).value).toBe("2026-12-31")
    fireEvent.change(form.getByLabelText("Начисление, %"), { target: { value: "120" } })
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    expect(form.getByText("Начисление — от 0 до 100 %")).toBeTruthy()
    fireEvent.change(form.getByLabelText("Начисление, %"), { target: { value: "7,5" } })
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[fn("saveProgram")]).toHaveBeenCalled())
    expect(mocks.mutations[fn("saveProgram")].mock.calls[0][0]).toMatchObject({ externalId: "p-draft", accrualPercent: 7.5, restaurantExternalIds: ["r1"], categoryExternalId: "guest-category-gold", endsAt: dateInputToMs("2027-01-01") })
    expect(await screen.findByText("Пересечение при том же приоритете")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }))
    await waitFor(() => expect(mocks.mutations[fn("transitionProgram")]).toHaveBeenCalledWith({ externalId: "p-draft", action: "publish" }))
  })
})

describe("«Категории гостей» (W1-LOY-06)", () => {
  it("master tabs and the condition column", () => {
    renderAt("/office/guest-categories", <GuestCategoriesWorkspace />)
    const table = screen.getByRole("table", { name: "Категории гостей" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Название", "Код", "Условие", "Статус"])
    expect(within(table).getByText(`Авто: оборот от ${formatTenge(150_000)} · от 3 визитов · за 365 дн.`, exact)).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Активные" }))
    expect(within(screen.getByRole("table", { name: "Категории гостей" })).queryByText("VIP")).toBeNull()
  })

  it("a new category checks its code and saves a design-token color", async () => {
    renderAt("/office/guest-categories/new", <GuestCategoriesWorkspace />)
    const form = within(await panel())
    fireEvent.change(form.getByLabelText("Название"), { target: { value: "Постоянные" } })
    fireEvent.change(form.getByLabelText("Код"), { target: { value: "gold" } })
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    expect(form.getByText("Код категории уже занят")).toBeTruthy()
    fireEvent.change(form.getByLabelText("Код"), { target: { value: "regular" } })
    fireEvent.click(form.getByRole("radio", { name: "Бирюза" }))
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }))
    await waitFor(() =>
      expect(mocks.mutations[fn("saveCategory")]).toHaveBeenCalledWith({ code: "regular", name: "Постоянные", color: "cat-turkistan", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0, active: true }),
    )
  })
})

describe("loyalty office model", () => {
  it("program end dates are inclusive days in Almaty", () => {
    const draft = { ...programDraftOf(null, dateInputToMs("2026-09-25"), true), name: "Осень", endsAt: "2026-11-30" }
    const args = programSaveArgs(draft, null)
    expect(args).toMatchObject({ startsAt: dateInputToMs("2026-09-25"), endsAt: dateInputToMs("2026-12-01"), restaurantExternalIds: ["*"] })
    expect(lastProgramDay(args.endsAt!)).toBe("2026-11-30")
    expect(dateInputToMs("2026-09-25")).toBe(Date.UTC(2026, 8, 24, 19))
  })

  it("guest checks and save arguments", () => {
    expect(validateGuest({ ...guestDraftOf(null), name: "А", email: "bad" }, true)).toMatchObject({ email: "Некорректный email", personalData: expect.any(String) })
    const draft = { ...guestDraftOf(null), name: " Ерлан ", email: "e@sandyq.kz", personalData: true, crossBorder: true, documentRef: " №1 " }
    expect(guestSaveArgs(draft, null, true)).toMatchObject({ name: "Ерлан", email: "e@sandyq.kz", phone: undefined, notes: "", consents: { personalData: true, crossBorder: true, documentRef: "№1" } })
    expect(categoryCondition({ assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0 })).toBe("Вручную")
  })
})
