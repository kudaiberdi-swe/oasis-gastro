// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { saveLines, validateLines } from "@/office/features/stock-documents/model/document-lines"
import { DOCUMENT_TYPES } from "@/office/features/stock-documents/model/document-types"
import { OutgoingInvoicesWorkspace, SupplierReturnsWorkspace } from "@/office/features/stock-documents/ui/documents-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

// W2-STK-13 (office UI): «Покупатель / получатель» and «Цена продажи» of an outgoing invoice,
// «На основании прихода» of a supplier return. Synthetic suppliers, counterparties and receipts.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference)]),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn(), isLoading: false }),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const GET = "domains/stockDocuments/queries:getDocument"
const SAVE = "domains/stockDocuments/mutations:saveDocument"

function document(overrides: Record<string, unknown> = {}) {
  return {
    _id: "d1",
    externalId: "outgoing-invoices-1",
    type: "outgoing-invoice",
    number: "РН-00001",
    date: Date.parse("2026-09-24T05:00:00Z"),
    status: "draft",
    organizationExternalId: "org",
    restaurantExternalId: "r1",
    sourceWarehouseExternalId: "wh-main",
    counterpartyName: "",
    reason: "",
    comment: "",
    totalQuantity: 2,
    totalAmount: 0,
    searchText: "",
    createdAt: 0,
    updatedAt: 0,
    lines: [{ _id: "l1", documentId: "d1", lineNo: 1, inventoryItemId: "i1", quantity: 2, unitCost: 0, vatRate: 12, salePrice: 1500, itemExternalId: "ayran-bulk", itemName: "Айран", unit: "л" }],
    ...overrides,
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая", organizationExternalId: "org" }], user: { restaurantScopes: ["*"] } },
    "domains/stock/master:listWarehouseOptions": [{ externalId: "wh-main", name: "Основной склад", restaurantExternalId: "r1", kind: "storage", isSalesDefault: false }],
    "domains/stock/master:listWarehouses": [{ _id: "w1", externalId: "wh-main", name: "Основной склад", restaurantExternalId: "r1" }],
    "domains/stock/master:listSuppliers": {
      page: [
        { _id: "s1", externalId: "sup-milk", name: "Молочный двор", bin: "123456789012" },
        { _id: "s2", externalId: "sup-meat", name: "Мясной партнёр", bin: "210987654321" },
      ],
      isDone: true,
      continueCursor: "",
    },
    "domains/finance/records:references": { accounts: [], cashflowCategories: [], counterparties: [{ externalId: "cp-catering", name: "ТОО «Кейтеринг Плюс»" }], restaurants: [], truncated: false },
    "domains/purchasing/receipts:listReceipts": {
      page: [
        { externalId: "receipt-1", number: "ПН-000001", date: Date.parse("2026-09-20T05:00:00Z"), totalGross: 13700, supplierId: "s1", warehouseId: "w1", status: "posted" },
        { externalId: "receipt-2", number: "ПН-000002", date: Date.parse("2026-09-21T05:00:00Z"), totalGross: 50000, supplierId: "s2", warehouseId: "w1", status: "posted" },
      ],
      isDone: true,
      continueCursor: "",
    },
    [GET]: document(),
  }
  mocks.mutations = { [SAVE]: vi.fn(async () => null) }
})

afterEach(cleanup)

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
}

describe("line model: «Цена продажи» (W2-STK-13)", () => {
  it("sends salePrice only for an outgoing invoice and checks it", () => {
    const line = { key: "a", itemExternalId: "x", itemName: "Айран", unit: "л", quantity: "2", actualQuantity: "", vatRate: "12", salePrice: "1 500,5", unitCost: 0, expectedQuantity: null }
    expect(saveLines([line], DOCUMENT_TYPES["outgoing-invoice"])).toEqual([{ itemExternalId: "x", quantity: 2, vatRate: 12, salePrice: 1500.5 }])
    expect(saveLines([line], DOCUMENT_TYPES["supplier-return"])).toEqual([{ itemExternalId: "x", quantity: 2, vatRate: 12 }])
    expect(saveLines([{ ...line, salePrice: "" }], DOCUMENT_TYPES["outgoing-invoice"])).toEqual([{ itemExternalId: "x", quantity: 2, vatRate: 12 }])
    expect(validateLines([{ ...line, salePrice: "-5" }], DOCUMENT_TYPES["outgoing-invoice"])).toEqual({ a: "Проверьте цену продажи" })
  })
})

describe("«Расходные накладные» (W2-STK-13)", () => {
  it("picks the buyer among FIN counterparties and saves the sale price per line", async () => {
    renderAt("/office/outgoing-invoices/outgoing-invoices-1", <OutgoingInvoicesWorkspace />)
    expect(screen.getByRole("columnheader", { name: "Цена продажи, ₸" })).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Покупатель / получатель" }))
    fireEvent.click(await screen.findByRole("option", { name: /Кейтеринг Плюс/ }))
    fireEvent.change(screen.getByLabelText("Покупатель / получатель текстом"), { target: { value: "Банкет 25.09" } })
    fireEvent.change(screen.getByLabelText("Цена продажи — Айран"), { target: { value: "1600" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ type: "outgoing-invoice", counterpartyExternalId: "cp-catering", counterpartyName: "Банкет 25.09", lines: [{ itemExternalId: "ayran-bulk", quantity: 2, vatRate: 12, salePrice: 1600 }] }),
    )
  })

  it("without the counterparties right only the free-text buyer is offered", () => {
    renderAt("/office/outgoing-invoices/outgoing-invoices-1", <OutgoingInvoicesWorkspace />, ["office.outgoing-invoices.view", "office.outgoing-invoices.edit", "office.stock.view"])
    expect(screen.queryByRole("combobox", { name: "Покупатель / получатель" })).toBeNull()
    expect(screen.getByLabelText("Покупатель / получатель")).toBeTruthy()
  })

  it("a posted invoice shows the server's cost and sale total, read-only", () => {
    mocks.queries[GET] = document({ status: "posted", totalAmount: 1440, saleTotal: 3200, counterpartyName: "ТОО «Кейтеринг Плюс»", postedAt: Date.parse("2026-09-24T06:00:00Z") })
    renderAt("/office/outgoing-invoices/outgoing-invoices-1", <OutgoingInvoicesWorkspace />)
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    expect(screen.getByText("Сумма продажи", { selector: "p" })).toBeTruthy()
    expect(screen.getAllByText(money(3200)).length).toBeGreaterThan(0)
    expect(screen.getByText("ТОО «Кейтеринг Плюс»")).toBeTruthy()
  })
})

describe("«Возвраты поставщикам» (W2-STK-13)", () => {
  beforeEach(() => {
    mocks.queries[GET] = document({ externalId: "supplier-returns-1", type: "supplier-return", number: "ВП-00001", supplierId: "s1", lines: [{ _id: "l1", documentId: "d1", lineNo: 1, inventoryItemId: "i1", quantity: 2, unitCost: 0, vatRate: 12, itemExternalId: "milk", itemName: "Молоко", unit: "л" }] })
  })

  it("«На основании прихода» offers only posted receipts of this supplier and warehouse", async () => {
    renderAt("/office/supplier-returns/supplier-returns-1", <SupplierReturnsWorkspace />)
    fireEvent.click(screen.getByRole("combobox", { name: "На основании прихода" }))
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent?.replace(/\s/g, " "))).toEqual(["Без основания", `ПН-000001 · 20.09.2026 · ${money(13700)}`])
    fireEvent.click(within(listbox).getByRole("option", { name: /ПН-000001/ }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ type: "supplier-return", supplierExternalId: "sup-milk", receiptExternalId: "receipt-1" }))
  })

  it("changing the supplier drops the chosen receipt", async () => {
    mocks.queries[GET] = { ...(mocks.queries[GET] as object), receiptExternalId: "receipt-1" }
    renderAt("/office/supplier-returns/supplier-returns-1", <SupplierReturnsWorkspace />)
    expect(screen.getByRole("combobox", { name: "На основании прихода" }).textContent).toContain("ПН-000001")
    fireEvent.click(screen.getByRole("combobox", { name: "Поставщик" }))
    fireEvent.click(await screen.findByRole("option", { name: /Мясной партнёр/ }))
    expect(screen.getByRole("combobox", { name: "На основании прихода" }).textContent).toContain("Без основания")
  })

  it("the posting error disappears once the draft is corrected", async () => {
    const POST = "domains/stockDocuments/mutations:postDocument"
    mocks.mutations[POST] = vi.fn(async () => {
      throw new Error("Возврат больше полученного по приходу: Молоко")
    })
    renderAt("/office/supplier-returns/supplier-returns-1", <SupplierReturnsWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    expect(await screen.findByText(/Возврат больше полученного/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Количество — Молоко"), { target: { value: "1" } })
    expect(screen.queryByText(/Возврат больше полученного/)).toBeNull()
  })

  it("a field's own error disappears once the field is filled", async () => {
    mocks.queries[GET] = { ...(mocks.queries[GET] as object), supplierId: undefined }
    renderAt("/office/supplier-returns/supplier-returns-1", <SupplierReturnsWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Провести" }))
    const supplier = screen.getByRole("combobox", { name: "Поставщик" })
    await waitFor(() => expect(supplier.getAttribute("aria-invalid")).toBe("true"))
    fireEvent.click(supplier)
    fireEvent.click(await screen.findByRole("option", { name: /Молочный двор/ }))
    expect(screen.getByRole("combobox", { name: "Поставщик" }).getAttribute("aria-invalid")).not.toBe("true")
  })
})
