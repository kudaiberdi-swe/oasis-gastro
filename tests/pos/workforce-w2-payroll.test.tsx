// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { fractionToPercentText, monthPeriod, percentTextToFraction, remainingByEmployee, rulesArgs, rulesDraftOf, validateRules } from "@/office/features/workforce/model/w2"
import { PayrollWorkspace } from "@/office/features/workforce/ui/payroll-workspace"
import { ToastProvider } from "@/shared/components/ui"

import { calculateKzPayroll, RULES_2026 } from "../../convex/lib/payroll"

// W2-HR-06 «Начисления и удержания»: runs register, the run card (post, payout, reversal), KZ rules in percents.

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

const taxes = calculateKzPayroll(340_000, true, RULES_2026)
const LINE = { employeeId: "emp1", employeeCode: "101", employeeName: "Айгерім Серікова", hours: 160, payType: "hourly", rate: 2000, adjustments: 20_000, advances: 0, gross: 340_000, ...taxes }
const TOTALS = { gross: 340_000, employeeTaxes: taxes.employeeTaxes, employerTaxes: taxes.employerTaxes, net: taxes.net, toPay: taxes.net }

function run(status: "draft" | "posted" | "reversed", extra: Record<string, unknown> = {}) {
  return { _id: "r1", externalId: "payroll-run-1", number: "PAY-2026-08-almaty", restaurantExternalId: "almaty", organizationExternalId: "sandyq", from: "2026-08-01", to: "2026-08-31", ruleExternalId: "payroll-rules-kz-2026", ruleVersion: "РК 2026", status, lines: [LINE], totals: TOTALS, paidAmount: 0, version: 1, createdAt: 0, updatedAt: 0, ...extra }
}

const RULES = { _id: "pr1", externalId: "payroll-rules-kz-2026", version: "РК 2026", effectiveFrom: "2026-01-01", status: "draft", ...RULES_2026, createdAt: 0, updatedAt: 0 }

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  const { lines: _lines, ...listed } = run("draft")
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }], user: { restaurantScopes: ["*"] } },
    "domains/workforce/payroll:listRuns": [{ ...listed, employeeCount: 1 }, { ...listed, _id: "r2", externalId: "payroll-run-2", number: "PAY-2026-07-almaty", from: "2026-07-01", to: "2026-07-31", status: "posted", employeeCount: 1 }],
    "domains/workforce/payroll:listRules": [RULES],
    "domains/workforce/payroll:getRun": { run: run("draft"), payouts: [], entries: [] },
    "domains/workforce/queries:listPosEmployees": [{ _id: "emp1", code: "101", displayName: "Айгерім Серікова", role: "cashier", active: true, restaurants: [{ externalId: "almaty", name: "Sandyq Алматы" }] }],
  }
  mocks.queryArgs = {}
  mocks.mutations = {
    "domains/workforce/payroll:calculatePayroll": vi.fn(async () => ({ externalId: "payroll-run-3", number: "PAY-2026-09-almaty", totals: TOTALS })),
    "domains/workforce/payroll:postPayroll": vi.fn(async () => null),
    "domains/workforce/payroll:reversePayroll": vi.fn(async () => null),
    "domains/workforce/payroll:createPayout": vi.fn(async () => ({ amount: 100_000, left: 0 })),
    "domains/workforce/payroll:saveRules": vi.fn(async () => "payroll-rules-kz-2026"),
    "domains/workforce/payroll:activateRules": vi.fn(async () => null),
    "domains/workforce/payroll:saveAdjustment": vi.fn(async () => "payroll-adjustment-1"),
  }
})

afterEach(cleanup)

function renderAt(path: string, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <PayrollWorkspace /> }], { initialEntries: [path] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("model (W2-HR-06)", () => {
  it("rates are fractions on the server and percents on screen", () => {
    expect(fractionToPercentText(0.035)).toBe("3,5")
    expect(fractionToPercentText(0.1)).toBe("10")
    expect(percentTextToFraction("3,5")).toBe(0.035)
    expect(percentTextToFraction("abc")).toBeNull()
    const draft = rulesDraftOf(RULES as never)
    expect(draft.text.opvrRate).toBe("3,5")
    expect(validateRules(draft)).toEqual({})
    expect(validateRules({ ...draft, text: { ...draft.text, ipnRate: "120" } }).ipnRate).toBe("Процент от 0 до 100")
    expect(rulesArgs(RULES as never, draft)).toMatchObject({ externalId: "payroll-rules-kz-2026", ...RULES_2026 })
  })

  it("the default period is the month; what is left to pay per employee", () => {
    expect(monthPeriod("2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(monthPeriod("2028-02-10").to).toBe("2028-02-29")
    expect(remainingByEmployee([{ employeeCode: "101", net: 300_000, advances: 50_000 }], [{ lines: [{ employeeCode: "101", amount: 100_000 }] }]).get("101")).toBe(150_000)
  })
})

describe("«Начисления и удержания» register", () => {
  it("document tabs, the period panel and money columns via formatTenge", () => {
    renderAt("/office/payroll")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Проведённые", "Сторно"])
    expect(screen.getByRole("region", { name: "Расчёт периода" })).toBeTruthy()
    const table = screen.getByRole("table", { name: "Ведомости" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Период", "Ресторан", "Сотрудников", "Начислено", "Удержано", "К выплате", "Статус"]))
    expect(within(table).getAllByText((content) => text(content) === "340 000 ₸")).toHaveLength(2)
    expect(within(table).getAllByText("Sandyq Алматы")).toHaveLength(2)
    fireEvent.click(screen.getByRole("tab", { name: "Проведённые" }))
    expect(within(screen.getByRole("table", { name: "Ведомости" })).getAllByRole("row")).toHaveLength(2)
  })

  it("«Рассчитать ведомость» (secondary) calculates the chosen restaurant and opens the run", async () => {
    const router = renderAt("/office/payroll")
    const panel = screen.getByRole("region", { name: "Расчёт периода" })
    fireEvent.change(within(panel).getByLabelText("Начало периода"), { target: { value: "2026-08-01" } })
    fireEvent.change(within(panel).getByLabelText("Конец периода"), { target: { value: "2026-08-31" } })
    const calculate = within(panel).getByRole("button", { name: "Рассчитать ведомость" })
    expect(calculate.className).not.toContain("bg-primary")
    fireEvent.click(calculate)
    await waitFor(() => expect(mocks.mutations["domains/workforce/payroll:calculatePayroll"]).toHaveBeenCalledWith({ restaurantExternalId: "almaty", from: "2026-08-01", to: "2026-08-31" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/payroll/payroll-run-3"))
  })

  it("«+ Корректировка» is the primary and saves a bonus", async () => {
    renderAt("/office/payroll")
    const add = screen.getByRole("button", { name: "Корректировка" })
    expect(add.className).toContain("bg-primary")
    fireEvent.click(add)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Сотрудник" }))
    fireEvent.click(await screen.findByRole("option", { name: /Айгерім Серікова/ }))
    fireEvent.change(within(dialog).getByLabelText("Дата"), { target: { value: "2026-08-20" } })
    fireEvent.change(within(dialog).getByLabelText("Сумма"), { target: { value: "20 000" } })
    fireEvent.change(within(dialog).getByLabelText("Основание"), { target: { value: "План продаж" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }))
    await waitFor(() =>
      expect(mocks.mutations["domains/workforce/payroll:saveAdjustment"]).toHaveBeenCalledWith({ restaurantExternalId: "almaty", employeeId: "emp1", businessDate: "2026-08-20", kind: "bonus", amount: 20_000, comment: "План продаж" }),
    )
  })

  it("«Правила РК»: percents in the card, saved as fractions", async () => {
    const router = renderAt("/office/payroll?type=rules")
    const table = screen.getByRole("table", { name: "Правила РК" })
    expect(within(table).getByText((content) => text(content) === "85 000 ₸")).toBeTruthy()
    expect(within(table).getByText((content) => text(content) === "10 % / 15 %")).toBeTruthy()
    fireEvent.click(within(table).getByText("РК 2026"))
    expect(router.state.location.pathname).toBe("/office/payroll/payroll-rules-kz-2026")
    const form = await screen.findByRole("form", { name: "Правила РК" })
    expect((within(form).getByLabelText("ОПВР") as HTMLInputElement).value).toBe("3,5")
    fireEvent.change(within(form).getByLabelText("ОПВР"), { target: { value: "4" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/payroll:saveRules"]).toHaveBeenCalledWith(expect.objectContaining({ externalId: "payroll-rules-kz-2026", opvrRate: 0.04, opvRate: 0.1, mzp: 85_000 })))
  })
})

describe("payroll run card", () => {
  it("KPI, every tax per line, «Провести» is the primary of a draft", async () => {
    renderAt("/office/payroll/payroll-run-1")
    expect(screen.getByRole("heading", { name: "Ведомость PAY-2026-08-almaty" })).toBeTruthy()
    const kpi = screen.getByRole("region", { name: "Итоги ведомости" })
    for (const label of ["Начислено", "Удержано", "Налоги работодателя", "К выплате"]) expect(within(kpi).getByText(label)).toBeTruthy()
    const lines = screen.getByRole("table", { name: "Строки ведомости" })
    expect(within(lines).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Сотрудник", "Часы", "Ставка", "Начислено", "ОПВ", "ВОСМС", "ИПН", "На руки", "ОПВР", "ООСМС", "СО", "СН"]))
    expect(within(lines).getByText((content) => text(content) === "160 ч")).toBeTruthy()
    expect(within(lines).getByText((content) => text(content) === "2 000 ₸/ч")).toBeTruthy()
    const post = screen.getByRole("button", { name: "Провести" })
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(1)
    fireEvent.click(post)
    await waitFor(() => expect(mocks.mutations["domains/workforce/payroll:postPayroll"]).toHaveBeenCalledWith({ externalId: "payroll-run-1" }))
    expect(screen.queryByRole("button", { name: "Сторно" })).toBeNull()
  })

  it("posted: a partial payout by bank", async () => {
    mocks.queries["domains/workforce/payroll:getRun"] = { run: run("posted"), payouts: [], entries: [{ _id: "j1", externalId: "payroll-run-1:101:gross", businessDate: "2026-08-31", debitAccountExternalId: "acc-3350", creditAccountExternalId: "acc-3350", amount: 340_000, description: "Начисление" }] }
    renderAt("/office/payroll/payroll-run-1")
    expect(within(screen.getByRole("table", { name: "Проводки" })).getByText("Начисление")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Выплатить" }))
    const dialog = await screen.findByRole("dialog")
    const amount = within(dialog).getByLabelText("К выплате: Айгерім Серікова") as HTMLInputElement
    expect(text(amount.value)).toBe(text(taxes.net.toLocaleString("ru-RU")))
    fireEvent.change(amount, { target: { value: "100000" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Выплатить" }))
    await waitFor(() => expect(mocks.mutations["domains/workforce/payroll:createPayout"]).toHaveBeenCalledWith({ runExternalId: "payroll-run-1", method: "bank", lines: [{ employeeCode: "101", amount: 100_000 }] }))
  })

  it("posted without payouts: «Сторно» asks for a reason", async () => {
    mocks.queries["domains/workforce/payroll:getRun"] = { run: run("posted"), payouts: [], entries: [] }
    renderAt("/office/payroll/payroll-run-1")
    fireEvent.click(screen.getByRole("button", { name: "Сторно" }))
    const confirm = await screen.findByRole("alertdialog")
    const submit = within(confirm).getByRole("button", { name: "Сторнировать" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(within(confirm).getByLabelText("Причина сторно"), { target: { value: "Ошибка ставки" } })
    fireEvent.click(submit)
    await waitFor(() => expect(mocks.mutations["domains/workforce/payroll:reversePayroll"]).toHaveBeenCalledWith({ externalId: "payroll-run-1", reason: "Ошибка ставки" }))
  })

  it("after a payout the reversal is unavailable", () => {
    mocks.queries["domains/workforce/payroll:getRun"] = { run: run("posted", { paidAmount: 100_000 }), payouts: [{ _id: "po1", externalId: "payroll-payout-1", runExternalId: "payroll-run-1", method: "cash", amount: 100_000, lines: [{ employeeCode: "101", amount: 100_000 }], createdBy: "admin@sandyq.test", createdAt: 0 }], entries: [] }
    renderAt("/office/payroll/payroll-run-1")
    expect((screen.getByRole("button", { name: "Сторно" }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(screen.getByRole("table", { name: "Выплаты" })).getByText("Касса")).toBeTruthy()
  })
})
