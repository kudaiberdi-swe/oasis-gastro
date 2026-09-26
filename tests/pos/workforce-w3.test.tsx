// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ComponentType } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { addDays, expiryNote, formatMetricValue, medicalArgs, medicalDraftOf, motivationDraftOf, todayAlmaty, validateMedical, validateProgram } from "@/office/features/workforce/model/w3"
import { MedicalRecordsWorkspace } from "@/office/features/workforce/ui/medical-records-workspace"
import { MotivationWorkspace } from "@/office/features/workforce/ui/motivation-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W3-HR-07 «Мотивационные программы» and W3-HR-08 «Медкнижки и анализы» (office).

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

const text = (value: string | null) => (value ?? "").replace(/\s/g, " ")
const TODAY = "2026-09-26"

const CONTEXT = { adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }], user: { restaurantScopes: ["*"] } }

const PROGRAM = {
  _id: "p1",
  externalId: "motivation-1",
  number: "МП-2026-00001",
  name: "План продаж августа",
  organizationExternalId: "sandyq",
  restaurantExternalId: "almaty",
  status: "published",
  metric: "sales",
  threshold: 500_000,
  rewardType: "fixed",
  rewardValue: 15_000,
  startsAt: "2026-08-01",
  endsAt: "2026-08-31",
  requiresApproval: false,
  participants: { positionExternalIds: [], employeeCodes: [] },
  version: 2,
  searchText: "",
  createdAt: 0,
  updatedAt: 0,
}

const RESULTS = {
  rows: [
    { employeeId: "e1", employeeCode: "101", employeeName: "Айгерім Серікова", positionName: "Кассир", fact: 612_000, basis: "Чеков: 140", fulfilled: true, reward: 15_000, accrued: null },
    { employeeId: "e2", employeeCode: "102", employeeName: "Ерлан Ахметов", positionName: "Кассир", fact: 310_000, basis: "Чеков: 70", fulfilled: false, reward: 0, accrued: null },
  ],
  totals: { participants: 2, fulfilled: 1, reward: 15_000, accrued: 0 },
  kitchenTruncated: false,
  accruable: true,
  reason: null,
}

const RECORD = {
  _id: "m1",
  externalId: "medical-record-1",
  number: "МК-2026-00001",
  employeeId: "e1",
  employeeCode: "101",
  employeeName: "Айгерім Серікова",
  organizationExternalId: "sandyq",
  restaurantExternalId: "almaty",
  status: "approved",
  documentType: "medical-book",
  issuedAt: "2025-10-01",
  expiresAt: addDays(todayAlmaty(), 10),
  issuer: "Поликлиника №1",
  documentNumber: "MK-778812",
  fitForWork: true,
  comment: "Флюорография в порядке",
  expiryProcessed: false,
  version: 3,
  createdAt: 0,
  updatedAt: 0,
  piiHidden: false,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": CONTEXT,
    "domains/workforce/motivation:get": PROGRAM,
    "domains/workforce/motivation:results": RESULTS,
    "domains/workforce/medical:get": RECORD,
    "domains/workforce/medical:expiringMedicalRecords": { withinDays: 30, today: TODAY, count: 1, expiredCount: 0, truncated: false, rows: [{ externalId: "medical-record-1", number: "МК-2026-00001", employeeName: "Айгерім Серікова", documentType: "medical-book", expiresAt: "2026-10-06", restaurantExternalId: "almaty" }], expired: [] },
    "domains/workforce/medical:settings": { revokeAdmissionOnExpiry: true, notifyWithinDays: 7 },
    "domains/workforce/references:listPositions": [],
    "domains/workforce/queries:listPosEmployees": [{ _id: "e1", code: "101", displayName: "Айгерім Серікова", role: "cashier", active: true, restaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }] }],
  }
  mocks.paginated = { "domains/workforce/motivation:list": [PROGRAM], "domains/workforce/medical:list": [RECORD] }
  mocks.paginatedArgs = {}
  mocks.mutations = {
    "domains/workforce/motivation:save": vi.fn(async () => "motivation-1"),
    "domains/workforce/motivation:transition": vi.fn(async () => null),
    "domains/workforce/motivation:accrue": vi.fn(async () => ({ created: 1, skipped: 0, amount: 15_000, businessDate: "2026-08-31" })),
    "domains/workforce/medical:save": vi.fn(async () => "medical-record-1"),
    "domains/workforce/medical:transition": vi.fn(async () => null),
    "domains/workforce/medical:saveSettings": vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderAt(path: string, Workspace: ComponentType, capabilities: string[] = ["*"]) {
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

describe("model (W3-HR-07/08)", () => {
  it("mirrors the server rules", () => {
    const draft = { ...motivationDraftOf(null, { restaurantExternalId: "almaty", today: TODAY }), name: "План", threshold: "500000", rewardValue: "15000" }
    expect(draft).toMatchObject({ startsAt: "2026-09-01", endsAt: "2026-09-30" })
    expect(validateProgram(draft)).toEqual({})
    expect(validateProgram({ ...draft, metric: "average-check", rewardType: "percent", rewardValue: "5" }).rewardType).toMatch(/только от продаж/)
    expect(validateProgram({ ...draft, endsAt: "2026-08-31" }).endsAt).toBe("Окончание не может быть раньше начала")
    expect(validateProgram({ ...draft, metric: "attendance", threshold: "120" }).threshold).toMatch(/от 0 до 100/)
    expect(text(formatMetricValue("kitchen-time", 14.25))).toBe("14,3 мин")
    expect(text(formatMetricValue("attendance", 92.5))).toBe("92,5 %")

    const medical = { ...medicalDraftOf(null, { restaurantExternalId: "almaty" }), employeeId: "e1", issuedAt: "2026-09-01", expiresAt: "2026-09-01", issuer: "Поликлиника", documentNumber: "1" }
    expect(validateMedical(null, medical, TODAY).expiresAt).toBe("Срок действия должен быть позже даты выдачи")
    expect(validateMedical(null, { ...medical, expiresAt: "2027-09-01" }, TODAY)).toEqual({})
    expect(validateMedical(null, { ...medical, issuedAt: "2026-10-01", expiresAt: "2027-09-01" }, TODAY).issuedAt).toMatch(/будущем/)
    const masked = { ...RECORD, documentNumber: "•••••••12", comment: undefined, piiHidden: true } as never
    const args = medicalArgs(masked, medicalDraftOf(masked))
    expect(args.documentNumber).toBeUndefined()
    expect(args.comment).toBeUndefined()
    expect(expiryNote("2026-09-20", TODAY)).toEqual({ text: "истёк 6 дн. назад", tone: "danger" })
    expect(expiryNote("2026-10-06", TODAY)).toEqual({ text: "осталось 10 дн.", tone: "warning" })
  })
})

describe("«Мотивационные программы»", () => {
  it("register: publish tabs, config columns, the threshold with its unit", () => {
    renderAt("/office/motivation", MotivationWorkspace)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Опубликованные", "Неактивные", "Завершённые"])
    expect(screen.getByPlaceholderText("Поиск: мотивационные программы")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Мотивационные программы" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Название", "Показатель", "Период", "Статус"])
    expect(within(table).getByText((content) => text(content) === "порог ≥ 500 000 ₸")).toBeTruthy()
    expect(within(table).getByText("01.08.2026 — 31.08.2026")).toBeTruthy()
    expect(within(table).getByText("Опубликовано")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Черновики" }))
    expect(mocks.paginatedArgs["domains/workforce/motivation:list"]).toMatchObject({ status: "draft" })
  })

  it("an empty register says «0 записей» and «Записей пока нет»", () => {
    mocks.paginated["domains/workforce/motivation:list"] = []
    renderAt("/office/motivation", MotivationWorkspace)
    expect(screen.getByText("0 записей")).toBeTruthy()
    expect(screen.getByText("Записей пока нет")).toBeTruthy()
  })

  it("the «Результаты» tab accrues bonuses into payroll after a confirmation", async () => {
    renderAt("/office/motivation/motivation-1", MotivationWorkspace)
    expect(screen.getByRole("heading", { name: "Программа МП-2026-00001" })).toBeTruthy()
    expect(screen.getByText("Программа опубликована — только чтение")).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Результаты" }))
    const table = await screen.findByRole("table", { name: "Результаты программы" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Сотрудник", "Факт", "Выполнено", "Премия"])
    expect(within(table).getByText((content) => text(content) === "612 000 ₸")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Начислить премии" }))
    fireEvent.click(await screen.findByRole("button", { name: "Начислить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/motivation:accrue"]).toHaveBeenCalledWith({ externalId: "motivation-1" }))
  })

  it("without the payroll right there is no accrual button", async () => {
    renderAt("/office/motivation/motivation-1", MotivationWorkspace, ["office.motivation.view", "office.motivation.edit"])
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Результаты" }))
    await screen.findByRole("table", { name: "Результаты программы" })
    expect(screen.queryByRole("button", { name: "Начислить премии" })).toBeNull()
    expect(screen.getByText(/Начисления и удержания — изменение/)).toBeTruthy()
  })

  it("a new program is checked before the call", async () => {
    renderAt("/office/motivation/new", MotivationWorkspace)
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "План сентября" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Укажите порог")).toBeTruthy()
    expect(mocks.mutations["domains/workforce/motivation:save"]).not.toHaveBeenCalled()
  })
})

describe("«Медкнижки и анализы»", () => {
  it("register: the expiry banner filters to the next 30 days; approval tabs and columns", () => {
    renderAt("/office/medical-records", MedicalRecordsWorkspace)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Отменённые"])
    expect(screen.getByText("Документы с истечением в ближайшие 30 дней: 1")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Медкнижки и анализы" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Номер", "Сотрудник", "Документ", "Выдан", "Действует до", "Статус"])
    expect(within(table).queryByText(/₸/)).toBeNull()
    expect(within(table).getByText("осталось 10 дн.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Показать" }))
    expect(mocks.paginatedArgs["domains/workforce/medical:list"]).toMatchObject({ expiringWithinDays: 30 })
    expect(screen.getByText("Контроль сроков")).toBeTruthy()
  })

  it("a masked record keeps its number and comment hidden", () => {
    mocks.queries["domains/workforce/medical:get"] = { ...RECORD, status: "draft", documentNumber: "•••••••12", comment: undefined, piiHidden: true }
    renderAt("/office/medical-records/medical-record-1", MedicalRecordsWorkspace)
    expect(screen.getByText("Персональные данные скрыты")).toBeTruthy()
    expect(screen.getByText("•••••••12")).toBeTruthy()
    expect(screen.getByText("Скрыт")).toBeTruthy()
    expect(screen.queryByDisplayValue("MK-778812")).toBeNull()
  })

  it("an end date not after the issue date is refused before the call", async () => {
    mocks.queries["domains/workforce/medical:get"] = { ...RECORD, status: "draft" }
    renderAt("/office/medical-records/medical-record-1", MedicalRecordsWorkspace)
    fireEvent.change(screen.getByLabelText("Действует до"), { target: { value: "2025-10-01" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Срок действия должен быть позже даты выдачи")).toBeTruthy()
    expect(mocks.mutations["domains/workforce/medical:save"]).not.toHaveBeenCalled()
  })

  it("an approved record: approve is gone, cancelling asks for a reason", async () => {
    renderAt("/office/medical-records/medical-record-1", MedicalRecordsWorkspace)
    expect(screen.getByText(/Согласовано — действует до/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Согласовать" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Отменить запись" }))
    expect(await screen.findByLabelText("Причина отмены")).toBeTruthy()
  })
})
