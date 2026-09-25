// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { InternalOrdersWorkspace, ProductionWorkspace, PurchaseOrdersWorkspace } from "@/office/features/production/ui/production-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-PRD-01, 03, 05, 06 (office UI): production acts with the shortage dialog, preparations,
// internal and purchase orders by status and right. Synthetic restaurants, warehouses and items.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

const resolve = (name: string, args: unknown) => {
  const value = mocks.queries[name]
  return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
}

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : resolve(getFunctionName(reference), args)),
  useQueries: (request: Record<string, { query: FunctionReference<"query">; args: unknown }>) =>
    Object.fromEntries(Object.entries(request).map(([key, item]) => [key, resolve(getFunctionName(item.query), item.args)])),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) =>
    args === "skip"
      ? { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
      : { results: mocks.paginated[getFunctionName(reference)] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const GET = "domains/production/documents:getDocument"
const LIST = "domains/production/documents:listDocuments"
const SAVE = "domains/production/documents:saveDocument"
const POST = "domains/production/documents:postDocument"
const TRANSITION = "domains/production/documents:transitionDocument"
const REVERSE = "domains/production/documents:reverseDocument"
const CREATE_RECEIPT = "domains/production/documents:createReceiptFromPurchaseOrder"
const PREPARATIONS = "domains/production/preparations:listPreparations"

const SAUCE = { productExternalId: "sauce", name: "Соус айран", writeOffMethod: "finished-product", inventoryItemExternalId: "prep-sauce", unit: "кг", onHand: 1.5, recipeVersion: { version: 2, batchYield: 1, status: "active" } }

function act(overrides: Record<string, unknown> = {}) {
  return {
    _id: "pd1",
    _creationTime: 0,
    externalId: "production-1",
    type: "production",
    number: "АП-0001",
    date: Date.parse("2026-09-24T05:00:00Z"),
    status: "draft",
    organizationExternalId: "org",
    restaurantExternalId: "r1",
    sourceWarehouseId: "w1",
    destinationWarehouseId: "w2",
    concept: "Горячий цех",
    comment: "",
    lines: [{ lineNo: 1, productId: "p1", name: "Соус айран", quantity: 2, direction: "output" }],
    totalAmount: 0,
    searchText: "",
    version: 1,
    createdBy: "chef@sandyq.test",
    createdAt: 0,
    updatedAt: 0,
    sourceWarehouse: { externalId: "wh-main", name: "Основной склад" },
    destinationWarehouse: { externalId: "wh-kitchen", name: "Горячий цех" },
    supplier: null,
    ...overrides,
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая", organizationExternalId: "org" }], user: { restaurantScopes: ["*"] } },
    "domains/stock/master:listWarehouseOptions": [
      { externalId: "wh-main", name: "Основной склад", restaurantExternalId: "r1", kind: "storage", isSalesDefault: false },
      { externalId: "wh-kitchen", name: "Горячий цех", restaurantExternalId: "r1", kind: "kitchen", isSalesDefault: true },
    ],
    "domains/stock/master:listWarehouses": [
      { _id: "w1", externalId: "wh-main", name: "Основной склад", restaurantExternalId: "r1" },
      { _id: "w2", externalId: "wh-kitchen", name: "Горячий цех", restaurantExternalId: "r1" },
    ],
    "domains/stock/master:listSuppliers": { page: [{ _id: "s1", externalId: "sup-milk", name: "Молочный двор", bin: "123456789012" }], isDone: true, continueCursor: "" },
    "domains/stock/master:listBalances": { page: [{ item: { externalId: "ayran", name: "Айран", unit: "л" }, quantity: 0.5 }], isDone: true, continueCursor: "" },
    "domains/stock/master:listInventoryItems": { page: [{ _id: "i1", externalId: "milk", name: "Молоко", unit: "л" }], isDone: true, continueCursor: "" },
    "domains/recipes/queries:getRecipe": () => ({
      product: { externalId: "sauce", name: "Соус айран" },
      version: { batchYield: 1, version: 2, status: "active" },
      lines: [{ name: "Айран", unit: "л", quantity: 0.8, inventoryItemExternalId: "ayran", componentProductExternalId: null }],
      summary: { costPerPortion: 640, costPerBatch: 640 },
    }),
    [PREPARATIONS]: { page: [SAUCE], isDone: true, continueCursor: "" },
    [GET]: act(),
  }
  mocks.paginated = { [LIST]: [], [PREPARATIONS]: [SAUCE] }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "production-1", warnings: [] })),
    [POST]: vi.fn(async (args: unknown) =>
      (args as { confirmShortage?: boolean }).confirmShortage ? { kind: "posted", totalAmount: 1280 } : { kind: "shortage-confirmation", shortages: [{ inventoryItemExternalId: "ayran", name: "Айран", needed: 1.6, onHand: 0.5 }] },
    ),
    [TRANSITION]: vi.fn(async () => null),
    [REVERSE]: vi.fn(async () => null),
    [CREATE_RECEIPT]: vi.fn(async () => "receipt-9"),
  }
})

afterEach(cleanup)

function renderAt(path: string | { pathname: string; state: unknown }, element: ReactNode, capabilities: string[] = ["*"]) {
  const router = createMemoryRouter(
    [
      { path: "/office/:section/:id?", element },
      { path: "/office/:section/:id/:subId", element },
    ],
    { initialEntries: [path] },
  )
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Акты приготовления» (W2-PRD-03)", () => {
  it("the empty register: tabs, search, «Все статусы», the columns and «Все записи загружены»", () => {
    mocks.paginated[LIST] = [act({ status: "posted", totalAmount: 1280 })]
    renderAt("/office/production", <ProductionWorkspace />)
    expect(screen.getByRole("tab", { name: "Акты приготовления" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tab", { name: "Заготовки" })).toBeTruthy()
    expect(screen.getByPlaceholderText("Номер, концепция или комментарий")).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Статус" }).textContent).toContain("Все статусы")
    const table = screen.getByRole("table", { name: "Акты приготовления" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent).filter(Boolean)).toEqual(["Номер", "Дата", "Со склада", "На склад", "Количество", "Стоимость, ₸", "Статус"])
    expect(within(table).getByText("Основной склад")).toBeTruthy()
    expect(within(table).getByText("Проведён")).toBeTruthy()
    expect(screen.getByText("Загружено записей: 1")).toBeTruthy()
    expect(screen.getByText("Все записи загружены")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Новый акт/ })).toBeTruthy()
  })

  it("«+ Новый акт» is hidden without the edit right", () => {
    renderAt("/office/production", <ProductionWorkspace />, ["office.production.view"])
    expect(screen.queryByRole("button", { name: /Новый акт/ })).toBeNull()
    expect(screen.getByText("Записей пока нет")).toBeTruthy()
  })

  it("a shortage opens the confirmation; «Провести с отрицательным остатком» repeats with confirmShortage", async () => {
    renderAt("/office/production/production-1", <ProductionWorkspace />)
    expect(screen.getByRole("heading", { name: "Акт приготовления АП-0001" })).toBeTruthy()
    // The saved line was matched back to its preparation; the preview shows the recipe demand and the shortage.
    const preview = screen.getByRole("region", { name: "Ингредиенты к списанию" })
    expect(within(preview).getByText("Айран")).toBeTruthy()
    expect(within(preview).getByText("1,6")).toBeTruthy()
    expect(screen.getByText(/Не хватает: 1 позиция/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    const dialog = await screen.findByRole("dialog", { name: "Не хватает ингредиентов" })
    const rows = within(dialog).getAllByRole("row")
    expect(rows.map((row) => row.textContent)).toEqual(["ПозицияНужноНа складе", "Айран1,60,5"])
    expect(mocks.mutations[POST]).toHaveBeenCalledWith({ externalId: "production-1" })
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Провести с отрицательным остатком" }))
    await waitFor(() => expect(mocks.mutations[POST]).toHaveBeenCalledTimes(2))
    expect(mocks.mutations[POST]).toHaveBeenLastCalledWith({ externalId: "production-1", confirmShortage: true })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Не хватает ингредиентов" })).toBeNull())
  })

  it("an edited draft is saved with the matched preparation before posting", async () => {
    renderAt("/office/production/production-1", <ProductionWorkspace />)
    fireEvent.change(screen.getByLabelText("Количество — Соус айран"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "production-1", type: "production", restaurantExternalId: "r1", sourceWarehouseExternalId: "wh-main", destinationWarehouseExternalId: "wh-kitchen", concept: "Горячий цех", lines: [{ productExternalId: "sauce", quantity: 3 }] }),
    )
  })

  it("a posted act is read-only; «Сторнировать» only with the reverse right", async () => {
    mocks.queries[GET] = act({ status: "posted", totalAmount: 1280, postedAt: Date.parse("2026-09-24T06:00:00Z"), lines: [{ lineNo: 1, productId: "p1", name: "Соус айран", quantity: 2, direction: "output", amount: 1280 }] })
    renderAt("/office/production/production-1", <ProductionWorkspace />)
    expect(screen.getByText("Документ проведён — только чтение")).toBeTruthy()
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Провести" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Сторнировать" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Причина сторно"), { target: { value: "Ошибка в количестве" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Сторнировать" }))
    await waitFor(() => expect(mocks.mutations[REVERSE]).toHaveBeenCalledWith({ externalId: "production-1", reason: "Ошибка в количестве" }))
    cleanup()

    renderAt("/office/production/production-1", <ProductionWorkspace />, ["office.production.view", "office.production.post"])
    expect(screen.queryByRole("button", { name: "Сторнировать" })).toBeNull()
  })
})

describe("«Заготовки» (W2-PRD-01)", () => {
  it("the tab lists preparations with the configured columns and opens the card", async () => {
    const router = renderAt("/office/production?tab=preparations", <ProductionWorkspace />)
    const table = screen.getByRole("table", { name: "Заготовки" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent).filter(Boolean)).toEqual(["Название", "Ед. выпуска", "Выход", "Метод списания", "Себестоимость ед., ₸", "Остаток", "Статус"])
    expect(within(table).getByText("Готовой продукцией")).toBeTruthy()
    expect(within(table).getByText("640")).toBeTruthy()
    fireEvent.click(within(table).getByText("Соус айран"))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/production/preparations/sauce"))
    expect(screen.getByRole("region", { name: "Основные свойства" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Технологическая карта" })).toBeTruthy()
    expect(screen.getByText("Себестоимость единицы")).toBeTruthy()
  })

  it("the card saves the write-off method", async () => {
    mocks.mutations["domains/production/preparations:savePreparation"] = vi.fn(async () => "prep-sauce")
    renderAt("/office/production/preparations/sauce", <ProductionWorkspace />)
    fireEvent.click(screen.getByRole("radio", { name: /По составу/ }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/production/preparations:savePreparation"]).toHaveBeenCalledWith({ productExternalId: "sauce", unit: "кг", writeOffMethod: "ingredients" }))
  })
})

describe("«Внутренние заказы» (W2-PRD-05)", () => {
  const order = (status: string) => act({ externalId: "internal-order-1", type: "internal-order", number: "ВЗ-0001", status, concept: undefined, lines: [{ lineNo: 1, inventoryItemId: "i1", name: "Молоко", quantity: 5, direction: "input" }] })

  it("approval tabs and the Domain columns", () => {
    mocks.paginated[LIST] = [order("approved")]
    renderAt("/office/internal-orders", <InternalOrdersWorkspace />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "На согласовании", "Согласованные", "Проведённые"])
    expect(screen.getByPlaceholderText("Поиск: внутренние заказы")).toBeTruthy()
    expect(screen.getByText("1 запись")).toBeTruthy()
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent).filter(Boolean)).toEqual(["Номер", "Дата", "Откуда → Куда", "Позиций", "Сумма, ₸", "Статус"])
    expect(within(table).getByText("Основной склад → Горячий цех")).toBeTruthy()
    expect(within(table).getByText("Согласовано")).toBeTruthy()
  })

  it("«Согласовать» needs the approve right", async () => {
    mocks.queries[GET] = order("pending-approval")
    renderAt("/office/internal-orders/internal-order-1", <InternalOrdersWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Согласовать" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "internal-order-1", action: "approve" }))
    cleanup()
    renderAt("/office/internal-orders/internal-order-1", <InternalOrdersWorkspace />, ["office.internal-orders.view", "office.internal-orders.edit", "office.stock.view"])
    expect(screen.queryByRole("button", { name: "Согласовать" })).toBeNull()
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
  })
})

describe("«Заказы поставщикам» (W2-PRD-06)", () => {
  const order = (overrides: Record<string, unknown> = {}) =>
    act({
      externalId: "purchase-order-1",
      type: "purchase-order",
      number: "ЗП-0001",
      status: "approved",
      concept: undefined,
      sourceWarehouseId: undefined,
      sourceWarehouse: null,
      destinationWarehouseId: "w1",
      destinationWarehouse: { externalId: "wh-main", name: "Основной склад" },
      supplierId: "s1",
      supplier: { externalId: "sup-milk", name: "Молочный двор" },
      expectedDate: Date.parse("2026-09-25T19:00:00Z"),
      totalAmount: 9000,
      lines: [{ lineNo: 1, inventoryItemId: "i1", name: "Молоко", quantity: 20, direction: "output", expectedUnitCost: 450 }],
      ...overrides,
    })

  it("the register row has «Создать приход» for an approved order", async () => {
    mocks.paginated[LIST] = [order()]
    const router = renderAt("/office/purchase-orders", <PurchaseOrdersWorkspace />)
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent).filter(Boolean)).toEqual(["Номер", "Дата", "Поставщик", "Склад", "Ожидаемая дата", "Сумма, ₸", "Статус", "Приход"])
    expect(within(table).getByText("Молочный двор")).toBeTruthy()
    expect(within(table).getByText("26.09.2026")).toBeTruthy()
    fireEvent.click(within(table).getByRole("button", { name: "Создать приход" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/receipts/receipt-9"))
    expect(mocks.mutations[CREATE_RECEIPT]).toHaveBeenCalledWith({ externalId: "purchase-order-1" })
  })

  it("the approved order's card creates the receipt and opens its editor; no «Провести»", async () => {
    mocks.queries[GET] = order()
    const router = renderAt("/office/purchase-orders/purchase-order-1", <PurchaseOrdersWorkspace />)
    expect(screen.queryByRole("button", { name: "Провести" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Создать приходную накладную" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/receipts/receipt-9"))
  })

  it("a saved draft shows the minimum-order warning", async () => {
    mocks.queries[GET] = order({ status: "draft" })
    mocks.mutations[SAVE] = vi.fn(async () => ({ externalId: "purchase-order-1", warnings: ["Минимальный заказ поставщика — 50000 ₸"] }))
    renderAt("/office/purchase-orders/purchase-order-1", <PurchaseOrdersWorkspace />)
    fireEvent.change(screen.getByLabelText("Ожидаемая цена — Молоко"), { target: { value: "400" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(await screen.findByText("Минимальный заказ поставщика — 50000 ₸")).toBeTruthy()
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ supplierExternalId: "sup-milk", destinationWarehouseExternalId: "wh-main", expectedDate: Date.parse("2026-09-25T19:00:00Z"), lines: [{ inventoryItemExternalId: "milk", quantity: 20, expectedUnitCost: 400 }] }))
  })

  it("«Отправить на согласование» saves first and shows the minimum-order warning", async () => {
    mocks.queries[GET] = order({ status: "draft" })
    mocks.mutations[SAVE] = vi.fn(async () => ({ externalId: "purchase-order-1", warnings: ["Минимальный заказ поставщика — 50000 ₸"] }))
    renderAt("/office/purchase-orders/purchase-order-1", <PurchaseOrdersWorkspace />)
    fireEvent.change(screen.getByLabelText("Ожидаемая цена — Молоко"), { target: { value: "400" } })
    fireEvent.click(screen.getByRole("button", { name: "Отправить на согласование" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ externalId: "purchase-order-1", action: "submit" }))
    expect(await screen.findByText("Минимальный заказ поставщика — 50000 ₸")).toBeTruthy()
  })

  it("a new order brings the save's warnings to its URL; they stay while on approval", () => {
    mocks.queries[GET] = order({ status: "pending-approval" })
    renderAt({ pathname: "/office/purchase-orders/purchase-order-1", state: { saveWarnings: ["Минимальный заказ поставщика — 50000 ₸"] } }, <PurchaseOrdersWorkspace />)
    expect(screen.getByText("Минимальный заказ поставщика — 50000 ₸")).toBeTruthy()
  })

  it("«Ед.» of a saved line comes from the server (getDocument returns the unit and external id)", () => {
    mocks.queries["domains/stock/master:listInventoryItems"] = { page: [], isDone: true, continueCursor: "" }
    mocks.queries[GET] = order({
      status: "pending-approval",
      lines: [{ lineNo: 1, inventoryItemId: "i1", name: "Молоко", quantity: 20, direction: "output", expectedUnitCost: 450, productExternalId: null, inventoryItemExternalId: "milk", unit: "л" }],
    })
    renderAt("/office/purchase-orders/purchase-order-1", <PurchaseOrdersWorkspace />)
    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes("Молоко"))!
    expect(within(row).getByText("л")).toBeTruthy()
  })
})
