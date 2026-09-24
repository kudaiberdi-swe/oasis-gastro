// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { receiptTotals } from "@/office/features/receipts/model/receipt-draft"
import { ReceiptsWorkspace } from "@/office/features/receipts/ui/receipts-workspace"
import { documentTotals, inventoryDelta } from "@/office/features/stock-documents/model/document-lines"
import { WriteoffsWorkspace } from "@/office/features/stock-documents/ui/documents-workspace"
import { BalancesPage, balanceAt } from "@/office/features/stock/ui/balances-page"
import { SuppliersPage } from "@/office/features/stock/ui/suppliers-page"
import { UnitsPage } from "@/office/features/stock/ui/units-page"
import { WarehousesPage } from "@/office/features/stock/ui/warehouses-page"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W1-STK-03…07, -09, -11: units, warehouses, suppliers, balances, stock documents and receipts (office UI).

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) =>
    args === "skip"
      ? { results: [], status: "LoadingFirstPage", loadMore: vi.fn(), isLoading: true }
      : { results: mocks.paginated[getFunctionName(reference)] ?? [], status: "Exhausted", loadMore: vi.fn(), isLoading: false },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const CONTEXT = {
  adminRestaurants: [
    { externalId: "r1", name: "Sandyq Абая", organizationExternalId: "org" },
    { externalId: "r2", name: "Sandyq Достык", organizationExternalId: "org" },
  ],
  user: { restaurantScopes: ["*"] },
}

const UNITS = [
  { _id: "u1", externalId: "unit-kg", name: "Килограмм", shortName: "кг", dimension: "mass", precision: 3, coefficient: 1, active: true, searchText: "килограмм кг" },
  { _id: "u2", externalId: "unit-g", name: "Грамм", shortName: "г", dimension: "mass", precision: 0, baseUnitExternalId: "unit-kg", coefficient: 0.001, active: true, searchText: "грамм г" },
]

const WAREHOUSE = {
  _id: "w1",
  externalId: "wh-main",
  name: "Sandyq Абая · основной склад",
  shortName: "Основной",
  restaurantExternalId: "r1",
  organizationExternalId: "org",
  kind: "storage",
  responsibleName: "Заведующий смены",
  allowNegativeStock: false,
  internalTransfers: true,
  isSalesDefault: false,
  active: true,
  searchText: "sandyq абая основной склад",
}

const BALANCE = {
  warehouse: { externalId: "wh-main", name: "Sandyq Абая · основной склад" },
  item: { externalId: "ayran-bulk", name: "Айран", unit: "л" },
  quantity: 3.5,
  averageUnitCost: 720,
  amount: 2520,
  belowMinimum: true,
  aboveMaximum: false,
  negative: false,
}

const POSTED_WRITEOFF = {
  _id: "d1",
  externalId: "writeoffs-1",
  type: "writeoff",
  number: "СП-00001",
  date: Date.parse("2026-09-20T05:00:00Z"),
  status: "posted",
  organizationExternalId: "org",
  restaurantExternalId: "r1",
  sourceWarehouseExternalId: "wh-main",
  counterpartyName: "",
  reason: "Порча",
  comment: "",
  totalQuantity: 2,
  totalAmount: 1440,
  searchText: "сп-00001",
  createdAt: 0,
  updatedAt: 0,
  postedAt: Date.parse("2026-09-20T06:00:00Z"),
  lines: [{ _id: "l1", documentId: "d1", lineNo: 1, inventoryItemId: "i1", quantity: 2, unitCost: 720, vatRate: 0, itemExternalId: "ayran-bulk", itemName: "Айран", unit: "л" }],
}

const DRAFT_RECEIPT = {
  _id: "rc1",
  externalId: "receipt-1",
  number: "ПН-000001",
  date: Date.parse("2026-09-24T03:00:00Z"),
  supplierId: "s1",
  warehouseId: "w1",
  restaurantExternalId: "r1",
  organizationExternalId: "org",
  invoiceNumber: "INV-77",
  status: "draft",
  totalGross: 13700,
  totalVat: 1200,
  totalNet: 12500,
  searchText: "пн-000001",
  createdAt: 0,
  updatedAt: 0,
  warehouse: { externalId: "wh-main", name: "Sandyq Абая · основной склад" },
  supplier: { externalId: "sup-milk", name: "Молочный двор", vatPayer: true },
  lines: [
    { _id: "rl1", receiptId: "rc1", lineNo: 1, inventoryItemId: "i1", quantity: 10, unitCostGross: 1120, vatRate: 12, amountGross: 11200, itemExternalId: "milk", itemName: "Молоко", unit: "л" },
    { _id: "rl2", receiptId: "rc1", lineNo: 2, inventoryItemId: "i2", quantity: 5, unitCostGross: 500, vatRate: 0, amountGross: 2500, itemExternalId: "bread", itemName: "Лепёшка", unit: "шт" },
  ],
  priceChecks: [
    { lineNo: 1, itemName: "Молоко", unitCost: 1120, reference: 974, deviationPercent: 15, outcome: "warn" },
    { lineNo: 2, itemName: "Лепёшка", unitCost: 500, reference: 500, deviationPercent: 0, outcome: "ok" },
  ],
}

beforeEach(() => {
  mocks.queries = {
    "domains/office/queries:context": CONTEXT,
    "domains/stock/master:listUnits": UNITS,
    "domains/stock/master:listWarehouses": [WAREHOUSE],
    "domains/stock/master:listWarehouseOptions": [{ externalId: "wh-main", name: WAREHOUSE.name, restaurantExternalId: "r1", kind: "storage", isSalesDefault: false }],
    "domains/stock/master:listSuppliers": { page: [], isDone: true, continueCursor: "" },
    "domains/stockDocuments/queries:getDocument": POSTED_WRITEOFF,
    "domains/purchasing/receipts:getReceipt": DRAFT_RECEIPT,
  }
  mocks.paginated = {
    "domains/stock/master:listSuppliers": [],
    "domains/stock/master:listBalances": [BALANCE],
  }
  mocks.mutations = {
    "domains/stock/master:saveUnit": vi.fn(async () => {
      throw new ConvexError("Единица уже используется: размерность и коэффициент менять нельзя")
    }),
    "domains/stock/master:saveWarehouse": vi.fn(async () => "wh-main"),
    "domains/stock/master:saveSupplier": vi.fn(async () => "supplier-1"),
    "domains/stockDocuments/mutations:reverseDocument": vi.fn(async () => null),
    "domains/purchasing/receipts:saveReceipt": vi.fn(async () => ({ totalGross: 13700, totalVat: 1200, totalNet: 12500 })),
    "domains/purchasing/receipts:postReceipt": vi.fn(async () => ({ status: "posted", warnings: [] })),
  }
})

afterEach(cleanup)

/** Testing Library collapses the thin and no-break spaces of formatTenge into plain ones. */
const money = (value: number) => formatTenge(value).replace(/\s/g, " ")

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

describe("«Единицы измерения» (W1-STK-03)", () => {
  it("lists units with «г · ×0,001 → кг» and shows the server's validation message", async () => {
    renderAt("/office/units/unit-g", <UnitsPage />)
    expect(screen.getByText("г · ×0,001 → кг")).toBeTruthy()
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText(/Коэффициент к базовой/), { target: { value: "0,002" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(await within(panel).findByText("Единица уже используется: размерность и коэффициент менять нельзя")).toBeTruthy()
    expect(mocks.mutations["domains/stock/master:saveUnit"]).toHaveBeenCalledWith({
      externalId: "unit-g",
      name: "Грамм",
      shortName: "г",
      dimension: "mass",
      precision: 0,
      baseUnitExternalId: "unit-kg",
      coefficient: 0.002,
      active: true,
    })
  })
})

describe("«Склады» (W1-STK-04)", () => {
  it("sends the «Склад продаж по умолчанию» toggle", async () => {
    renderAt("/office/warehouses/wh-main", <WarehousesPage />)
    expect(screen.getByText("Склад · Заведующий смены", { exact: false })).toBeTruthy()
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getByRole("switch", { name: /Склад продаж по умолчанию/ }))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/stock/master:saveWarehouse"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/stock/master:saveWarehouse"]).toHaveBeenCalledWith(expect.objectContaining({ externalId: "wh-main", restaurantExternalId: "r1", isSalesDefault: true, allowNegativeStock: false, active: true }))
  })
})

describe("«Поставщики» (W1-STK-05)", () => {
  it("needs a 12-digit BIN before calling the server", async () => {
    renderAt("/office/suppliers/new", <SuppliersPage />)
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Молочный двор" } })
    fireEvent.change(within(panel).getByLabelText("БИН"), { target: { value: "12345678901" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(await within(panel).findByText("БИН — 12 цифр")).toBeTruthy()
    expect(mocks.mutations["domains/stock/master:saveSupplier"]).not.toHaveBeenCalled()

    fireEvent.change(within(panel).getByLabelText("БИН"), { target: { value: "123456789012" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/stock/master:saveSupplier"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/stock/master:saveSupplier"]).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Молочный двор", bin: "123456789012", supplierType: "external", vatPayer: false, priceDeviationPolicy: "warn", allowedDeviationPercent: 10, restaurantExternalIds: [], active: true }),
    )
  })
})

describe("«Остатки на складах» (W1-STK-07)", () => {
  it("flags a balance below the minimum", () => {
    renderAt("/office/stock", <BalancesPage />)
    const table = screen.getByRole("table", { name: "Остатки на складах" })
    expect(within(table).getByText("Айран")).toBeTruthy()
    expect(within(table).getByText("ayran-bulk")).toBeTruthy()
    expect(within(table).getByText("Ниже минимума")).toBeTruthy()
  })

  it("«на дату» is the end of the Almaty day; today means the current balance", () => {
    const now = Date.parse("2026-09-24T08:00:00Z")
    expect(balanceAt("2026-09-20", now)).toBe(Date.parse("2026-09-20T18:59:59.999Z"))
    expect(balanceAt("2026-09-24", now)).toBeUndefined()
    expect(balanceAt("", now)).toBeUndefined()
  })
})

describe("Stock documents (W1-STK-09)", () => {
  it("a posted document is read-only and «Сторно» asks for a reason", async () => {
    renderAt("/office/writeoffs/writeoffs-1", <WriteoffsWorkspace />)
    expect(screen.getByRole("heading", { name: "Акт списания СП-00001" })).toBeTruthy()
    expect(screen.getByText("Проведён")).toBeTruthy()
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Провести" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Сторно" }))
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Сторнировать" })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Причина сторно"), { target: { value: "Ошибка в количестве" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.mutations["domains/stockDocuments/mutations:reverseDocument"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/stockDocuments/mutations:reverseDocument"]).toHaveBeenCalledWith({ type: "writeoff", externalId: "writeoffs-1", reason: "Ошибка в количестве" })
  })

  it("hides «Сторно» without the reverse right", () => {
    renderAt("/office/writeoffs/writeoffs-1", <WriteoffsWorkspace />, ["office.writeoffs.view", "office.stock.view"])
    expect(screen.queryByRole("button", { name: "Сторно" })).toBeNull()
  })

  it("line model: inventory difference and totals", () => {
    const line = { key: "a", itemExternalId: "x", itemName: "Мука", unit: "кг", quantity: "", actualQuantity: "10", vatRate: "0", unitCost: 400, expectedQuantity: 12 }
    expect(inventoryDelta(line)).toBe(-2)
    expect(documentTotals([line], { inventory: true })).toEqual({ quantity: 10, amount: -800 })
    expect(documentTotals([{ ...line, quantity: "2,5", unitCost: 0 }], { inventory: false })).toEqual({ quantity: 2.5, amount: 0 })
  })
})

describe("«Приходные накладные» (W1-STK-11)", () => {
  it("computes the totals like the server", () => {
    expect(
      receiptTotals([
        { quantity: "10", unitCostGross: 1120, vatRate: "12" },
        { quantity: "5", unitCostGross: 500, vatRate: "0" },
      ]),
    ).toEqual({ gross: 13700, vat: 1200, net: 12500 })
  })

  it("the editor shows totals and the price warning of a line", async () => {
    renderAt("/office/receipts/receipt-1", <ReceiptsWorkspace />)
    expect(screen.getByRole("heading", { name: "Приходная накладная ПН-000001" })).toBeTruthy()
    expect(screen.getByText("Черновик")).toBeTruthy()
    expect(screen.getAllByText(money(13700)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(money(1200)).length).toBeGreaterThan(0)
    expect(screen.getByText(money(12500))).toBeTruthy()
    expect(screen.getByText("Цена «Молоко» отклоняется на +15 %")).toBeTruthy()
    expect(screen.queryByText(/Цена «Лепёшка» отклоняется/)).toBeNull()

    // Changing a quantity recomputes the totals before saving.
    fireEvent.change(screen.getByLabelText("Количество — Лепёшка"), { target: { value: "6" } })
    expect(screen.getAllByText(money(14200)).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    await waitFor(() => expect(mocks.mutations["domains/purchasing/receipts:postReceipt"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/purchasing/receipts:saveReceipt"]).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "receipt-1",
        supplierExternalId: "sup-milk",
        warehouseExternalId: "wh-main",
        invoiceNumber: "INV-77",
        lines: [
          { itemExternalId: "milk", quantity: 10, unitCostGross: 1120, vatRate: 12 },
          { itemExternalId: "bread", quantity: 6, unitCostGross: 500, vatRate: 0 },
        ],
      }),
    )
  })
})
