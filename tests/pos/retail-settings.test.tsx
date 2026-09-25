// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import type { RetailSetting } from "@/office/features/retail-settings/data/use-retail-settings"
import { draftFromSetting, fromDateInput, saveSettingArgs, validateSettingDraft, type SettingDraft } from "@/office/features/retail-settings/model/setting-draft"
import { CashOperationsWorkspace } from "@/office/features/retail-settings/ui/cash-operations-workspace"
import { DeletionReasonsWorkspace, OrderTypesWorkspace, PaymentTypesWorkspace } from "@/office/features/retail-settings/ui/retail-settings-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-RTL-03/04: versioned retail references in the office (payment/order/discount types, deletion
// reasons, cash operation types) over convex/domains/retail.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  paginatedArgs: [] as unknown[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    mocks.paginatedArgs.push(args)
    return { results: mocks.paginated[getFunctionName(reference)] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const JUNE_6 = Date.parse("2026-06-06T00:00:00+05:00")
const SAVE = "domains/retail/mutations:saveSetting"
const PUBLISH = "domains/retail/mutations:publishSetting"

function setting(overrides: Partial<RetailSetting> & Pick<RetailSetting, "externalId" | "kind" | "code" | "name" | "data">): RetailSetting {
  return {
    _id: overrides.externalId as RetailSetting["_id"],
    _creationTime: 0,
    status: "published",
    effectiveFrom: JUNE_6,
    sortOrder: 1,
    restaurantExternalIds: [],
    version: 1,
    searchText: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const CASH = setting({
  externalId: "payment-type-cash",
  kind: "payment-type",
  code: "cash",
  name: "Наличные",
  data: { kind: "payment-type", processorKind: "cash", account: "cash", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: true, allowsChange: true, opensCashDrawer: true },
})
const QR_DRAFT = setting({
  externalId: "payment-type-qr",
  kind: "payment-type",
  code: "kaspi-qr",
  name: "Kaspi QR",
  status: "draft",
  version: 1,
  restaurantExternalIds: ["r1"],
  data: { kind: "payment-type", processorKind: "qr", account: "inTransit", fiscal: true, revenue: true, manualEntry: true, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false },
})
const CARD_EXPIRED = setting({
  externalId: "payment-type-card-v1",
  kind: "payment-type",
  code: "card",
  name: "Карта (старая)",
  status: "expired",
  effectiveTo: Date.parse("2026-09-01T00:00:00+05:00"),
  data: { kind: "payment-type", processorKind: "card", account: "inTransit", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false },
})
const COLLECTION = setting({
  externalId: "cash-operation-type-collection",
  kind: "cash-operation-type",
  code: "collection",
  name: "Инкассация",
  data: { kind: "cash-operation-type", direction: "cash-out", cashAccount: "cash", correspondingAccount: "bank", maximumAmount: 50_000_000, requireManager: true },
})

const SETTINGS = [CASH, QR_DRAFT, CARD_EXPIRED, COLLECTION]

function context(scopes: string[]) {
  return {
    adminRestaurants: [
      { externalId: "r1", name: "Sandyq Абая", organizationExternalId: "org" },
      { externalId: "r2", name: "Sandyq Достык", organizationExternalId: "org" },
    ],
    user: { restaurantScopes: scopes },
  }
}

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": context(["*"]),
    "domains/retail/queries:accountOptions": [
      { value: "cash", code: "1010", name: "Касса", type: "asset" },
      { value: "inTransit", code: "1030", name: "Деньги в пути", type: "asset" },
      { value: "bank", code: "1030-b", name: "Расчётный счёт", type: "asset" },
    ],
    "domains/retail/queries:getSetting": (args: { externalId: string; kind: string }) => SETTINGS.find((row) => row.externalId === args.externalId && row.kind === args.kind) ?? null,
    "domains/finance/records:references": { cashflowCategories: [{ externalId: "cf-collection", name: "Инкассация выручки" }], accounts: [], counterparties: [], restaurants: [], truncated: false },
  }
  mocks.paginated = { "domains/retail/queries:listSettings": [CASH, QR_DRAFT, CARD_EXPIRED] }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => "payment-type-cash-v2"),
    [PUBLISH]: vi.fn(async () => null),
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

describe("«Типы оплат» register (W1-RTL-03)", () => {
  it("shows kind columns, Russian statuses and filters by the status tab", () => {
    renderAt("/office/payment-types", <PaymentTypesWorkspace />)
    const table = screen.getByRole("table", { name: "Типы оплат" })
    expect(within(table).getByText("Процессинг")).toBeTruthy()
    expect(within(table).getAllByText("1010 · Касса").length).toBe(1)
    expect(within(table).getByText("Опубликовано")).toBeTruthy()
    expect(within(table).getByText("Черновик")).toBeTruthy()
    expect(within(table).getByText("Истекло")).toBeTruthy()
    expect(within(table).getAllByText("Все рестораны").length).toBe(2)
    expect(within(table).getByText("Sandyq Абая")).toBeTruthy()
    expect(within(table).getByText("06.06.2026 — 01.09.2026")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новая настройка" })).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "Черновики" }))
    expect(mocks.paginatedArgs.at(-1)).toMatchObject({ kind: "payment-type", status: "draft" })
    fireEvent.click(screen.getByRole("tab", { name: "Все" }))
    expect(mocks.paginatedArgs.at(-1)).not.toHaveProperty("status")
  })

  it("hides «Новая настройка» without the edit right", () => {
    renderAt("/office/payment-types", <PaymentTypesWorkspace />, ["office.payment-types.view"])
    expect(screen.queryByRole("button", { name: "Новая настройка" })).toBeNull()
  })
})

describe("Setting form (W1-RTL-03)", () => {
  it("publishes an unchanged draft without saving it again", async () => {
    renderAt("/office/payment-types/payment-type-qr", <PaymentTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByRole("button", { name: "Сохранить черновик" }).className).toContain("bg-card")
    fireEvent.click(within(panel).getByRole("button", { name: "Опубликовать" }))
    await waitFor(() => expect(mocks.mutations[PUBLISH]).toHaveBeenCalledWith({ externalId: "payment-type-qr" }))
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("without the approve right there is no «Опубликовать» and saving is the primary", async () => {
    renderAt("/office/payment-types/payment-type-qr", <PaymentTypesWorkspace />, ["office.payment-types.view", "office.payment-types.edit"])
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByRole("button", { name: "Опубликовать" })).toBeNull()
    expect(within(panel).getByRole("button", { name: "Сохранить черновик" }).className).toContain("bg-primary")
  })

  it("editing a published version saves the next version and opens it", async () => {
    const router = renderAt("/office/payment-types/payment-type-cash", <PaymentTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText("Версия действует на кассах")).toBeTruthy()
    expect((within(panel).getByLabelText("Код") as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(within(panel).getByLabelText("Название в чеке"), { target: { value: "Нал." } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить новую версию" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "payment-type-cash", kind: "payment-type", code: "cash", receiptName: "Нал.", restaurantExternalIds: [], data: CASH.data }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/payment-types/payment-type-cash-v2"))
  })

  it("an expired version is read-only", async () => {
    renderAt("/office/payment-types/payment-type-card-v1", <PaymentTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText("Версия истекла — только чтение")).toBeTruthy()
    expect(within(panel).queryByRole("button", { name: /Сохранить/ })).toBeNull()
    expect(within(panel).queryByRole("button", { name: "Опубликовать" })).toBeNull()
    expect((within(panel).getByLabelText("Название") as HTMLInputElement).disabled).toBe(true)
  })

  it("change is only for cash: the switch is off and locked for a QR payment", async () => {
    renderAt("/office/payment-types/payment-type-qr", <PaymentTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    const change = within(panel).getByRole("switch", { name: /Со сдачей/ }) as HTMLButtonElement
    expect(change.disabled).toBe(true)
    expect(change.getAttribute("aria-checked")).toBe("false")
  })

  it("checks the service charge before the server and sends a typed order type", async () => {
    mocks.paginated = { "domains/retail/queries:listSettings": [] }
    mocks.mutations[SAVE] = vi.fn(async () => "order-type-new")
    renderAt("/office/order-types/new", <OrderTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText("Новая настройка · Типы заказов")).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText("Код"), { target: { value: "Veranda" } })
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Веранда" } })
    fireEvent.change(within(panel).getByLabelText("Сервисный сбор, %"), { target: { value: "31" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    expect(await within(panel).findByText("От 0 до 30 %", { selector: "[role=alert]" })).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()

    fireEvent.change(within(panel).getByLabelText("Сервисный сбор, %"), { target: { value: "12,5" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "order-type",
        code: "veranda",
        name: "Веранда",
        sortOrder: 0,
        restaurantExternalIds: [],
        data: { kind: "order-type", serviceMode: "dine-in", promptStage: "start", isDefault: false, serviceChargePercent: 12.5 },
      }),
    )
  })

  it("a restaurant user must pick restaurants; write-off needs an expense account", async () => {
    mocks.queries["domains/office/queries:context"] = context(["r1"])
    mocks.paginated = { "domains/retail/queries:listSettings": [] }
    renderAt("/office/deletion-reasons/new", <DeletionReasonsWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect(within(panel).queryByText("Пусто — все рестораны сети")).toBeNull()
    fireEvent.change(within(panel).getByLabelText("Код"), { target: { value: "spoilage" } })
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Порча" } })
    fireEvent.click(within(panel).getByRole("switch", { name: /Списывать со склада/ }))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    expect(await within(panel).findByText("Выберите хотя бы один ресторан")).toBeTruthy()
    expect(within(panel).getByText("Для списания укажите счёт расходов")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
  })

  it("shows the server's rejection in a banner", async () => {
    mocks.mutations[SAVE] = vi.fn(async () => {
      throw new ConvexError("Настройку для всех ресторанов может сохранить только пользователь с доступом ко всей сети")
    })
    renderAt("/office/payment-types/payment-type-qr", <PaymentTypesWorkspace />)
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Kaspi QR Gold" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить черновик" }))
    expect(await within(panel).findByText("Настройку для всех ресторанов может сохранить только пользователь с доступом ко всей сети")).toBeTruthy()
  })
})

describe("«Внесения и изъятия» — типы операций (W1-RTL-04)", () => {
  it("lists cash operation types with direction and limit", () => {
    mocks.paginated = { "domains/retail/queries:listSettings": [COLLECTION] }
    // «Журнал операций» is the first tab (W1-RTL-04); `?tab=types` opens the reference directly.
    renderAt("/office/cash-operations?tab=types", <CashOperationsWorkspace />)
    const table = screen.getByRole("table", { name: "Типы внесений и изъятий" })
    expect(within(table).getByText("Изъятие")).toBeTruthy()
    expect(within(table).getByText("Инкассация")).toBeTruthy()
    expect(mocks.paginatedArgs.at(-1)).toMatchObject({ kind: "cash-operation-type" })
  })
})

describe("Setting draft model", () => {
  const base = (data: SettingDraft["data"]): SettingDraft => ({ code: "x", name: "X", receiptName: "", effectiveFrom: "2026-09-24", effectiveTo: "", sortOrder: "1", restaurantExternalIds: [], data })

  it("mirrors the server's business rules", () => {
    const options = { network: true, isNew: true }
    expect(validateSettingDraft(base({ kind: "discount-type", mode: "percent", value: "10", minimumOrder: "0", priority: "0", managerApprovalAbove: "0", manual: false, automatic: false, combinable: false }), options).manual).toBe(
      "Скидка либо ручная, либо автоматическая",
    )
    expect(validateSettingDraft(base({ kind: "discount-type", mode: "percent", value: "120", minimumOrder: "0", priority: "0", managerApprovalAbove: "0", manual: true, automatic: false, combinable: false }), options).value).toBe("От 0 до 100 %")
    expect(
      validateSettingDraft(base({ kind: "payment-type", processorKind: "card", account: "bank", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: false, allowsChange: true, opensCashDrawer: false }), options).allowsChange,
    ).toBe("Сдача возможна только у наличных")
    expect(
      validateSettingDraft(base({ kind: "cash-operation-type", direction: "cash-out", cashAccount: "cash", correspondingAccount: "cash", cashflowCategory: "", maximumAmount: 1000, requireManager: false }), options).correspondingAccount,
    ).toBe("Счета операции должны различаться")
    expect(validateSettingDraft({ ...base({ kind: "order-type", serviceMode: "takeaway", promptStage: "start", isDefault: false, serviceChargePercent: "0" }), effectiveTo: "2026-09-24" }, options).effectiveTo).toBe(
      "Окончание должно быть позже начала",
    )
    expect(validateSettingDraft({ ...base({ kind: "order-type", serviceMode: "takeaway", promptStage: "start", isDefault: false, serviceChargePercent: "0" }), code: "касса" }, options).code).toBe("Латиница, цифры и дефис")
  })

  it("builds typed save arguments: numbers parsed, empty optional fields dropped", () => {
    const discount = saveSettingArgs("discount-type", undefined, base({ kind: "discount-type", mode: "fixed", value: "1 500", minimumOrder: "5000", priority: "2", managerApprovalAbove: "7,5", manual: true, automatic: false, combinable: true }))
    expect(discount).toEqual({
      kind: "discount-type",
      code: "x",
      name: "X",
      effectiveFrom: fromDateInput("2026-09-24"),
      sortOrder: 1,
      restaurantExternalIds: [],
      data: { kind: "discount-type", mode: "fixed", value: 1500, minimumOrder: 5000, priority: 2, managerApprovalAbove: 7.5, manual: true, automatic: false, combinable: true },
    })
    expect(saveSettingArgs("deletion-reason", "id", base({ kind: "deletion-reason", expenseAccount: "", writeOff: false, requireComment: true, requireManager: true })).data).toEqual({
      kind: "deletion-reason",
      writeOff: false,
      requireComment: true,
      requireManager: true,
    })
    expect(
      saveSettingArgs("cash-operation-type", "id", base({ kind: "cash-operation-type", direction: "cash-in", cashAccount: "cash", correspondingAccount: "bank", cashflowCategory: "", maximumAmount: 500000, requireManager: false })).data,
    ).not.toHaveProperty("cashflowCategory")
    expect(fromDateInput("2026-09-24")).toBe(Date.parse("2026-09-23T19:00:00Z"))
  })

  it("a published version's next draft starts today, not in the past", () => {
    const now = Date.parse("2026-09-24T08:00:00Z")
    expect(draftFromSetting("payment-type", CASH, now).effectiveFrom).toBe("2026-09-24")
    expect(draftFromSetting("payment-type", QR_DRAFT, now).effectiveFrom).toBe("2026-06-06")
    expect(draftFromSetting("payment-type", null, now)).toMatchObject({ code: "", effectiveFrom: "2026-09-24", restaurantExternalIds: [], data: { kind: "payment-type", processorKind: "cash" } })
  })
})
