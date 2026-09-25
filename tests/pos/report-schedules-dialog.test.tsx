// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { ReportsWorkspace } from "@/office/features/reports/ui/reports-workspace"
import { ScheduleDialog } from "@/office/features/reports/ui/schedule-dialog"
import { ToastProvider } from "@/shared/components/ui"

// W2-RPT-06: «Рассылка отчёта» from the viewer (hidden without the edit right, only for implemented
// reports), email chips with format checks and the 20 limit, cadence fields, PDF not offered yet; the
// viewer's XLSX export uses the shared convex/lib/reportExport.ts module.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, Mock<(...args: unknown[]) => Promise<unknown>>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  useQueries: (queries: Record<string, { query: FunctionReference<"query">; args: unknown }>) =>
    Object.fromEntries(Object.entries(queries).map(([key, { query }]) => [key, mocks.queries[getFunctionName(query)]])),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const SAVE = "domains/reports/schedules:saveSchedule"
const CONFIG = { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: [] as string[] }

const RESULT = {
  reportId: "sales-01",
  generatedAt: Date.parse("2026-09-24T07:17:00Z"),
  sourceLabel: "Продажи кассы",
  columns: [
    { key: "group", label: "Дата", unit: "date", align: "left" },
    { key: "netAmount", label: "Выручка", unit: "money", align: "right" },
  ],
  rows: [{ key: "2026-09-01", cells: { group: "2026-09-01", netAmount: 1000 } }],
  totals: { netAmount: 1000 },
  kpis: [],
  truncated: false,
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= () => false
  mocks.queries = {
    "domains/reports/queries:coverage": { total: 190, implemented: 1, notApplicableKz: 0, byFamily: {}, implementedIds: ["sales-01"] },
    "domains/reports/queries:restaurantsForFilter": [],
    "domains/reports/queries:execute": RESULT,
    "domains/reports/mutations:listViews": [],
  }
  mocks.mutations = { [SAVE]: vi.fn(async () => ({ externalId: "report-schedule-9", nextRunAt: Date.parse("2026-09-26T03:00:00Z") })) }
})

afterEach(cleanup)

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <ToastProvider>
      <ScheduleDialog open onOpenChange={onOpenChange} report={{ id: "sales-01", title: "Выручка по дням" }} config={CONFIG} />
    </ToastProvider>,
  )
  return { dialog: screen.getByRole("dialog", { name: "Рассылка отчёта" }), onOpenChange }
}

function renderViewer(url: string, capabilities: string[]) {
  const router = createMemoryRouter([{ path: "/office/reports/:id?", element: <ReportsWorkspace /> }], { initialEntries: [url] })
  render(
    <CapabilitiesProvider capabilities={capabilities}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </CapabilitiesProvider>,
  )
}

function addRecipient(dialog: HTMLElement, value: string) {
  const input = within(dialog).getByLabelText("Получатели")
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: "Enter" })
}

function pick(dialog: HTMLElement, label: string, option: string) {
  const trigger = within(dialog).getByRole("combobox", { name: label })
  fireEvent.keyDown(trigger, { key: "Enter" })
  fireEvent.click(screen.getByRole("option", { name: option }))
}

describe("Рассылка отчёта (dialog)", () => {
  it("creates a daily XLSX mailing at 08:00 for yesterday by default", async () => {
    const { dialog, onOpenChange } = renderDialog()
    expect((within(dialog).getByLabelText("Название") as HTMLInputElement).value).toBe("Выручка по дням")
    expect((within(dialog).getByLabelText("Время (Алматы)") as HTMLInputElement).value).toBe("08:00")
    expect(within(dialog).getByRole("radio", { name: "XLSX" }).getAttribute("data-state")).toBe("checked")
    expect(within(dialog).getByText(/Первый запуск —/)).toBeTruthy()

    addRecipient(dialog, " Boss@Sandyq.test ")
    expect(within(dialog).getByText("boss@sandyq.test")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать рассылку" }))

    await waitFor(() =>
      expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
        externalId: undefined,
        reportId: "sales-01",
        viewExternalId: undefined,
        name: "Выручка по дням",
        recipients: ["boss@sandyq.test"],
        format: "xlsx",
        cadence: "daily",
        timeOfDay: "08:00",
        weekday: undefined,
        dayOfMonth: undefined,
        periodPreset: "yesterday",
        config: CONFIG,
      }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(await screen.findByText(/Рассылка создана\. Следующий запуск — 26\.09, 08:00/)).toBeTruthy()
  })

  it("checks recipients: format, duplicates, removal, at least one and at most 20", async () => {
    const { dialog } = renderDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать рассылку" }))
    expect(await within(dialog).findByText("Добавьте хотя бы одного получателя")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()

    addRecipient(dialog, "not-an-email")
    expect(within(dialog).getByText("Некорректный email: not-an-email")).toBeTruthy()

    addRecipient(dialog, "a@sandyq.test, b@sandyq.test; a@sandyq.test")
    expect(within(dialog).getAllByRole("button", { name: /^Убрать / })).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole("button", { name: "Убрать a@sandyq.test" }))
    expect(within(dialog).queryByText("a@sandyq.test")).toBeNull()

    addRecipient(dialog, Array.from({ length: 20 }, (_, index) => `user${index}@sandyq.test`).join(","))
    expect(within(dialog).getByText("Не больше 20 получателей")).toBeTruthy()
  })

  it("does not offer PDF yet and explains why", () => {
    const { dialog } = renderDialog()
    const pdf = within(dialog).getByRole("radio", { name: "PDF" })
    expect(pdf.hasAttribute("disabled") || pdf.getAttribute("data-disabled") !== null).toBe(true)
    expect(within(dialog).getByText("PDF появится с шаблонами печати")).toBeTruthy()
  })

  it("weekly asks for a weekday, monthly for a day with the short-month hint", async () => {
    const { dialog } = renderDialog()
    addRecipient(dialog, "boss@sandyq.test")
    fireEvent.click(within(dialog).getByRole("radio", { name: "CSV" }))

    pick(dialog, "Периодичность", "Еженедельно")
    pick(dialog, "День недели", "Пятница")
    expect((within(dialog).getByRole("combobox", { name: "Период данных" }) as HTMLElement).textContent).toBe("Последние 7 дней")

    pick(dialog, "Периодичность", "Ежемесячно")
    expect(within(dialog).queryByRole("combobox", { name: "День недели" })).toBeNull()
    pick(dialog, "День месяца", "31")
    expect(within(dialog).getByText("В коротких месяцах — последний день")).toBeTruthy()
    pick(dialog, "Период данных", "С начала месяца")
    fireEvent.change(within(dialog).getByLabelText("Время (Алматы)"), { target: { value: "21:30" } })

    fireEvent.click(within(dialog).getByRole("button", { name: "Создать рассылку" }))
    await waitFor(() =>
      expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
        expect.objectContaining({ format: "csv", cadence: "monthly", dayOfMonth: 31, weekday: undefined, timeOfDay: "21:30", periodPreset: "month-to-date" }),
      ),
    )
  })

  it("shows the server refusal and keeps the dialog open", async () => {
    mocks.mutations[SAVE].mockRejectedValueOnce(new Error("[CONVEX M(domains/reports/schedules:saveSchedule)] Нет доступа к ресторану"))
    const { dialog, onOpenChange } = renderDialog()
    addRecipient(dialog, "boss@sandyq.test")
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать рассылку" }))
    expect(await within(dialog).findByText("Нет доступа к ресторану")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("report viewer: XLSX and «Рассылка»", () => {
  const URL_ = "/office/reports/sales-01?from=2026-09-01&to=2026-09-07"

  it("shows «Рассылка» only with the edit right and opens the dialog with the current report", async () => {
    renderViewer(URL_, ["office.reports.view"])
    expect(await screen.findByRole("button", { name: /Экспорт XLSX/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Рассылка" })).toBeNull()
    cleanup()

    renderViewer(URL_, ["office.reports.view", "office.report-schedules.edit"])
    fireEvent.click(await screen.findByRole("button", { name: "Рассылка" }))
    const dialog = await screen.findByRole("dialog", { name: "Рассылка отчёта" })
    addRecipient(dialog, "boss@sandyq.test")
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать рассылку" }))
    await waitFor(() =>
      expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ reportId: "sales-01", config: expect.objectContaining({ dateFrom: "2026-09-01", dateTo: "2026-09-07" }) })),
    )
  })

  it("hides «Рассылка» for a report that is not implemented", async () => {
    renderViewer("/office/reports/sales-02", ["*"])
    expect(await screen.findByText("Отчёт в разработке")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Рассылка" })).toBeNull()
  })

  it("downloads XLSX: a zip workbook with the spreadsheet MIME and the .xlsx name", async () => {
    const blobs: Blob[] = []
    Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (blobs.push(blob), "blob:xlsx")), revokeObjectURL: vi.fn() })
    const names: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    renderViewer(URL_, ["*"])
    fireEvent.click(await screen.findByRole("button", { name: /Экспорт XLSX/ }))
    expect(blobs[0].type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]) // "PK" — a zip container
    expect(names[0]).toMatch(/\.xlsx$/)
    click.mockRestore()
  })
})
