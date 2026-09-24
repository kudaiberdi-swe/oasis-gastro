// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it } from "vitest"

import { EditorPage } from "@/office/engine/editor-page"
import { formatValue } from "@/office/engine/format-value"
import { MasterPage } from "@/office/engine/master-page"
import { createMockModuleApi } from "@/office/engine/mock-module-api"
import { statusTabs, type ModuleConfig } from "@/office/engine/module-config"
import { cashflowCategoriesConfig, cashflowCategoryValues, transactionsConfig, transactionValues, type CashflowCategory, type Transaction } from "@/office/engine/reference-configs"
import { RegisterPage } from "@/office/engine/register-page"
import { ToastProvider } from "@/shared/components/ui"

afterEach(cleanup)

function inRouter(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: <ToastProvider>{element}</ToastProvider> }])
  return render(<RouterProvider router={router} />)
}

describe("value formatting per column kind (L-10)", () => {
  it("renders hours as hours, never as tenge", () => {
    render(<p>{formatValue("hours", 8)}</p>)
    expect(screen.getByText(/^8\sч$/)).toBeTruthy()
    expect(screen.queryByText(/₸/)).toBeNull()
  })
})

describe("status tabs follow the lifecycle", () => {
  it("builds different tabs per lifecycle", () => {
    expect(statusTabs("master").map((tab) => tab.label)).toEqual(["Все", "Активные", "Неактивные"])
    expect(statusTabs("publish").map((tab) => tab.label)).toEqual(["Все", "Черновики", "Опубликованные", "Неактивные"])
    expect(statusTabs("approval").map((tab) => tab.label)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    expect(statusTabs("document").map((tab) => tab.label)).toEqual(["Все", "Черновики", "Проведённые", "Сторно"])
  })
})

type Shift = { id: string; name: string; hours: number; status: string }
const shiftsConfig: ModuleConfig<Shift> = {
  id: "shift-types",
  entityLabel: "Тип смены",
  lifecycle: "master",
  statusOf: (row) => row.status,
  titleOf: (row) => row.name,
  columns: [
    { key: "name", label: "Название", kind: "text" },
    { key: "hours", label: "Длительность", kind: "hours" },
    { key: "status", label: "Статус", kind: "status" },
  ],
  fields: [{ key: "name", label: "Название", kind: "text", required: true }],
}

function shiftsApi(count: number, pageSize = 50) {
  return createMockModuleApi<Shift>({
    initial: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, name: `Смена ${index + 1}`, hours: 8, status: index % 3 === 0 ? "inactive" : "active" })),
    pageSize,
    search: (row) => row.name,
    create: (values, index) => ({ id: `n${index}`, name: String(values.name), hours: 8, status: "active" }),
    update: (row, values) => ({ ...row, name: String(values.name ?? row.name) }),
  })
}

describe("RegisterPage", () => {
  it("renders config columns, filters by tab and pages with «Показать ещё»", async () => {
    inRouter(<RegisterPage config={shiftsConfig} api={shiftsApi(7, 5)} getRowId={(row) => row.id} />)
    expect(screen.getAllByText(/^8\sч$/).length).toBeGreaterThan(0)
    expect(screen.getByText("Загружено 5")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }))
    expect(screen.getByText("Загружено 7")).toBeTruthy()

    await userEvent.click(screen.getByRole("tab", { name: "Неактивные" }))
    const bodyRows = screen.getAllByRole("row").slice(1)
    expect(bodyRows).toHaveLength(3)
    for (const row of bodyRows) expect(within(row).getByText("Неактивно")).toBeTruthy()
  })
})

describe("MasterPage", () => {
  it("validates required fields and creates a record", async () => {
    const api = createMockModuleApi<CashflowCategory>({
      initial: [],
      create: (values, index) => ({ id: `c${index}`, code: String(values.code), name: String(values.name), direction: "outflow", status: "active" }),
      update: (row) => row,
    })
    inRouter(<MasterPage config={cashflowCategoriesConfig} api={api} getRowId={(row) => row.id} toValues={cashflowCategoryValues} />)
    await userEvent.click(screen.getByRole("button", { name: "Новая запись: Статья ДДС" }))
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(screen.getAllByText("Заполните поле").length).toBeGreaterThan(0)

    await userEvent.type(screen.getByLabelText("Код *"), "12")
    await userEvent.type(screen.getByLabelText("Название *"), "Аренда")
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(screen.getByText("3–6 цифр")).toBeTruthy()

    await userEvent.clear(screen.getByLabelText("Код *"))
    await userEvent.type(screen.getByLabelText("Код *"), "220")
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(api.snapshot()).toEqual([expect.objectContaining({ code: "220", name: "Аренда" })])
  })
})

describe("EditorPage (L-18)", () => {
  const transaction = (status: string): Transaction => ({
    id: "tx",
    number: "ПР-000001",
    date: Date.parse("2026-09-20T00:00:00+05:00"),
    restaurant: "Sandyq Алматы",
    memo: "Выручка",
    status,
    lines: [
      { id: "a", account: "50.01 Касса", debit: 1000, credit: 0 },
      { id: "b", account: "90.01 Выручка", debit: 0, credit: 1000 },
    ],
  })
  const api = () =>
    createMockModuleApi<Transaction>({ initial: [transaction("posted")], create: () => transaction("draft"), update: (row, values) => ({ ...row, ...values }) as Transaction })

  it("shows a posted document read-only with a danger «Сторно»", () => {
    inRouter(<EditorPage config={transactionsConfig} api={api()} record={transaction("posted")} id="tx" toValues={transactionValues} onBack={() => {}} />)
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByText("Выручка")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Сторно" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Провести" })).toBeNull()
    expect(screen.getByRole("tab", { name: /Строки/ }).textContent).toContain("2")
  })

  it("lets a draft be edited and posted", async () => {
    const draftApi = createMockModuleApi<Transaction>({ initial: [transaction("draft")], create: () => transaction("draft"), update: (row, values) => ({ ...row, ...values }) as Transaction })
    inRouter(<EditorPage config={transactionsConfig} api={draftApi} record={transaction("draft")} id="tx" toValues={transactionValues} onBack={() => {}} />)
    const memo = screen.getByLabelText("Основание *")
    await userEvent.type(memo, " за смену")
    expect(screen.getByRole("status").textContent).toContain("Есть несохранённые изменения")
    await userEvent.click(screen.getByRole("button", { name: "Провести" }))
    expect(draftApi.snapshot()[0]).toEqual(expect.objectContaining({ status: "posted", memo: "Выручка за смену" }))
  })
})
