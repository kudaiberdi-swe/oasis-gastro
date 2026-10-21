// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { EMPTY_DESCRIPTION, EMPTY_TITLE, ReportSchedulesWorkspace } from "@/office/features/reports/ui/report-schedules-page"
import { ToastProvider } from "@/shared/components/ui"

// W2-RPT-06: «Рассылки отчётов» — the register, row actions (Активна, Запустить сейчас, Скачать последний,
// Удалить with a danger confirmation) and the rights: without edit only the download stays.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, Mock<(...args: unknown[]) => Promise<unknown>>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/reports/schedules:listSchedules"
const CONFIG = { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: ["almaty"] }

const DAILY = {
  _id: "s1",
  _creationTime: 0,
  externalId: "report-schedule-1",
  ownerKey: "analyst@sandyq.test",
  reportId: "sales-01",
  reportTitle: "Выручка по дням",
  name: "Выручка для управляющих",
  recipients: ["boss@sandyq.test", "chef@sandyq.test"],
  format: "xlsx",
  cadence: "daily",
  timeOfDay: "08:00",
  periodPreset: "yesterday",
  config: CONFIG,
  // 26.09.2026 08:00 Almaty = 03:00 UTC
  nextRunAt: Date.parse("2026-09-26T03:00:00Z"),
  active: true,
  lastRunAt: Date.parse("2026-09-25T03:00:00Z"),
  lastStatus: "Готово · ожидает провайдера отправки",
  lastFileUrl: "https://files.example.test/report.xlsx",
  createdAt: 0,
  updatedAt: 0,
}

const MONTHLY = {
  ...DAILY,
  _id: "s2",
  externalId: "report-schedule-2",
  name: "Итоги месяца",
  recipients: ["cfo@sandyq.test"],
  format: "csv",
  cadence: "monthly",
  dayOfMonth: 31,
  periodPreset: "last-month",
  active: false,
  lastRunAt: undefined,
  lastStatus: "Нет доступа",
  lastFileUrl: null,
}

beforeEach(() => {
  mocks.queries = { [LIST]: [DAILY, MONTHLY] }
  mocks.mutations = {
    "domains/reports/schedules:setScheduleActive": vi.fn(async () => null),
    "domains/reports/schedules:runScheduleNow": vi.fn(async () => null),
    "domains/reports/schedules:deleteSchedule": vi.fn(async () => null),
    "domains/reports/schedules:saveSchedule": vi.fn(async () => ({ externalId: "report-schedule-1", nextRunAt: DAILY.nextRunAt })),
  }
})

afterEach(cleanup)

function renderPage(capabilities: string[] = ["office.report-schedules.view", "office.report-schedules.edit"]) {
  const router = createMemoryRouter([{ path: "/office/report-schedules", element: <ReportSchedulesWorkspace /> }], { initialEntries: ["/office/report-schedules"] })
  render(
    <CapabilitiesProvider capabilities={capabilities}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </CapabilitiesProvider>,
  )
}

const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement

describe("Рассылки отчётов", () => {
  it("shows the empty state with the hint to open a report", () => {
    mocks.queries[LIST] = []
    renderPage()
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Открыть каталог отчётов" }).getAttribute("href")).toBe("/office/reports")
  })

  it("shows a skeleton while loading", () => {
    mocks.queries[LIST] = undefined
    renderPage()
    expect(document.querySelector("[aria-busy=true]")).toBeTruthy()
  })

  it("lists schedules with the columns and plain-language statuses", () => {
    renderPage()
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(["Название", "Отчёт", "Получатели", "Формат", "Следующий запуск", "Последний запуск", "Статус"]))

    const daily = within(row("Выручка для управляющих"))
    expect(daily.getByText("Ежедневно в 08:00 · Вчера")).toBeTruthy()
    expect(daily.getByText("Выручка по дням")).toBeTruthy()
    expect(daily.getByText(/и ещё 1/)).toBeTruthy()
    expect(daily.getByText("XLSX")).toBeTruthy()
    expect(daily.getByText("26.09, 08:00")).toBeTruthy()
    expect(daily.getByText("25.09, 08:00")).toBeTruthy()
    expect(daily.getByText("Файл готов · ждёт отправки")).toBeTruthy()
    expect(daily.getByText("Активна", { selector: "span.rounded-round" })).toBeTruthy()
    expect(daily.getByRole("link", { name: "Скачать последний: Выручка для управляющих" }).getAttribute("href")).toBe(DAILY.lastFileUrl)

    const monthly = within(row("Итоги месяца"))
    expect(monthly.getByText("Ежемесячно, 31-го в 08:00 · Прошлый месяц")).toBeTruthy()
    expect(monthly.getByText("CSV")).toBeTruthy()
    expect(monthly.getByText("Отключена")).toBeTruthy()
    expect(monthly.getByText("Нет доступа к отчёту")).toBeTruthy()
    expect(monthly.queryByRole("link", { name: /Скачать последний/ })).toBeNull()
  })

  it("pauses a schedule and runs it now", async () => {
    renderPage()
    fireEvent.click(screen.getByRole("switch", { name: "Активна: Выручка для управляющих" }))
    await waitFor(() => expect(mocks.mutations["domains/reports/schedules:setScheduleActive"]).toHaveBeenCalledWith({ externalId: "report-schedule-1", active: false }))
    expect(await screen.findByText("Рассылка отключена")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Запустить сейчас: Итоги месяца" }))
    await waitFor(() => expect(mocks.mutations["domains/reports/schedules:runScheduleNow"]).toHaveBeenCalledWith({ externalId: "report-schedule-2" }))
  })

  it("deletes only after the danger confirmation and shows a server refusal", async () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Удалить: Итоги месяца" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Удалить рассылку?")).toBeTruthy()
    expect(mocks.mutations["domains/reports/schedules:deleteSchedule"]).not.toHaveBeenCalled()

    mocks.mutations["domains/reports/schedules:deleteSchedule"].mockRejectedValueOnce(new Error("Рассылка не найдена"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }))
    expect(await within(dialog).findByText("Рассылка не найдена")).toBeTruthy()

    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(mocks.mutations["domains/reports/schedules:deleteSchedule"]).toHaveBeenLastCalledWith({ externalId: "report-schedule-2" })
  })

  it("opens a schedule for editing with its values and saves it under the same id", async () => {
    Element.prototype.hasPointerCapture ??= () => false
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Изменить: Выручка для управляющих" }))
    const dialog = await screen.findByRole("dialog", { name: "Рассылка отчёта" })
    expect((within(dialog).getByLabelText("Название") as HTMLInputElement).value).toBe("Выручка для управляющих")
    expect(within(dialog).getByText("boss@sandyq.test")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }))
    await waitFor(() =>
      expect(mocks.mutations["domains/reports/schedules:saveSchedule"]).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: "report-schedule-1", reportId: "sales-01", recipients: DAILY.recipients, format: "xlsx", cadence: "daily", config: CONFIG }),
      ),
    )
  })

  it("without the edit right keeps only the download", () => {
    renderPage(["office.report-schedules.view"])
    const daily = within(row("Выручка для управляющих"))
    expect(daily.queryByRole("switch")).toBeNull()
    expect(daily.queryByRole("button", { name: /Запустить сейчас|Удалить|Изменить/ })).toBeNull()
    expect(daily.getByRole("link", { name: /Скачать последний/ })).toBeTruthy()
  })
})
