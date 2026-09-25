// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { effectiveFromTimestamp, validatePriceList, emptyPriceListDraft } from "@/office/features/price-lists/model/price-list-draft"
import { PriceListsWorkspace } from "@/office/features/price-lists/ui/price-lists-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W2-CAT-15 «Прайс-листы» (office/15): master-detail, versions, publish. Suppliers and items are synthetic.

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

const LIST = "domains/stock/priceLists:listPriceLists"
const GET = "domains/stock/priceLists:getPriceList"
const SAVE = "domains/stock/priceLists:savePriceList"
const PUBLISH = "domains/stock/priceLists:publishPriceList"
const EFFECTIVE = Date.parse("2026-09-24T00:00:00+05:00")

const SUPPLIER = { externalId: "sup-meat", name: "Мясной партнёр Алматы" }

function priceList(overrides: Record<string, unknown> = {}) {
  return {
    _id: "pl1",
    _creationTime: 0,
    externalId: "pl-v1",
    seriesExternalId: "pl-v1",
    version: 1,
    name: "Закупочные цены · модель",
    kind: "supplier",
    supplierId: "s1",
    effectiveFrom: EFFECTIVE,
    status: "published",
    deviationPolicy: "warn",
    deviationPercent: 5,
    lineCount: 1,
    searchText: "",
    createdBy: "admin@sandyq.test",
    createdAt: 0,
    updatedAt: 1,
    publishedAt: EFFECTIVE,
    supplier: SUPPLIER,
    kindLabel: "Поставщика",
    ...overrides,
  }
}

const LINE = { _id: "l1", _creationTime: 0, priceListId: "pl1", lineNo: 1, inventoryItemId: "i1", supplierSku: "BEEF-01", supplierName: "Говядина лопатка", packageCoefficient: 10, price: 45000, inventoryItemExternalId: "item-beef", itemName: "Говядина", itemUnit: "кг", unitPrice: 4500 }

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mocks.paginatedArgs = []
  const published = { ...priceList(), lines: [LINE], versions: [{ externalId: "pl-v1", version: 1, status: "published", effectiveFrom: EFFECTIVE }] }
  const draft = { ...priceList({ externalId: "pl-v2", version: 2, status: "draft", publishedAt: undefined }), lines: [LINE], versions: [{ externalId: "pl-v2", version: 2, status: "draft", effectiveFrom: EFFECTIVE }, { externalId: "pl-v1", version: 1, status: "published", effectiveFrom: EFFECTIVE }] }
  mocks.queries = {
    [GET]: (args: { externalId: string }) => (args.externalId === "pl-v1" ? published : args.externalId === "pl-v2" ? draft : null),
    "domains/stock/master:listSuppliers": { page: [{ ...SUPPLIER, bin: "123456789012", active: true }], isDone: true, continueCursor: "" },
    "domains/stock/master:listUnits": [{ externalId: "unit-kg", shortName: "кг" }],
    "domains/stock/master:listInventoryItems": { page: [{ externalId: "item-onion", name: "Лук репчатый", unit: "кг", kind: "ingredient" }], isDone: true, continueCursor: "" },
  }
  mocks.paginated = { [LIST]: [priceList(), priceList({ externalId: "pl-internal", name: "Внутренние цены", kind: "internal", supplier: null, kindLabel: "Внутренний", status: "draft" })] }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "pl-v2", version: 2 })),
    [PUBLISH]: vi.fn(async () => null),
  }
})

afterEach(cleanup)

function renderPage(capabilities: string[] = ["*"]) {
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={capabilities}>
        <PriceListsWorkspace />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
}

describe("«Прайс-листы» (W2-CAT-15, office/15)", () => {
  it("lists price lists as «<поставщик> · v<версия>» with Russian statuses", () => {
    renderPage()
    const list = screen.getByRole("region", { name: "Прайс-листы" })
    expect(within(list).getByText("Закупочные цены · модель")).toBeTruthy()
    expect(within(list).getByText("Мясной партнёр Алматы · v1")).toBeTruthy()
    expect(within(list).getByText("Внутренний · v1")).toBeTruthy()
    expect(within(list).getByText("Опубликован")).toBeTruthy()
    expect(within(list).getByText("Черновик")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Черновики" }))
    expect(mocks.paginatedArgs.at(-1)).toMatchObject({ status: "draft" })
  })

  it("opens the new record form with the parity fields and defaults", () => {
    renderPage()
    fireEvent.click(screen.getByRole("button", { name: /Новая запись/ }))
    for (const label of ["Название", "Вид", "Поставщик", "Начало действия", "Контроль отклонений", "Допуск, %"]) expect(screen.getByLabelText(label)).toBeTruthy()
    expect((screen.getByLabelText("Допуск, %") as HTMLInputElement).value).toBe("5")
    expect(screen.getByText("Статус")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Товары поставщика" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "+ Добавить" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Опубликовать" })).toBeNull()
  })

  it("saving a published version opens the next draft and selects it", async () => {
    renderPage()
    fireEvent.click(screen.getByText("Закупочные цены · модель"))
    expect(await screen.findByText("Опубликованная версия не меняется")).toBeTruthy()
    expect(screen.getByText(/«Сохранить» откроет черновик v2/)).toBeTruthy()
    expect(screen.getByText("4 500 ₸ за кг", { normalizer: (text) => text.replace(/\s+/g, " ").trim() })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Цена — Говядина"), { target: { value: "47000" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить как v2" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith({
      externalId: "pl-v1",
      name: "Закупочные цены · модель",
      kind: "supplier",
      supplierExternalId: "sup-meat",
      effectiveFrom: EFFECTIVE,
      deviationPolicy: "warn",
      deviationPercent: 5,
      lines: [{ inventoryItemExternalId: "item-beef", supplierSku: "BEEF-01", supplierName: "Говядина лопатка", packageCoefficient: 10, price: 47000 }],
    })
    expect(await screen.findByText("Открыт черновик v2 — опубликуйте его, чтобы заменить v1")).toBeTruthy()
    // The new draft is the selected record: it has «Опубликовать» and the versions list.
    expect(await screen.findByRole("button", { name: "Опубликовать" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Версии" })).toBeTruthy()
  })

  it("publishes a draft and hides publishing without the post right", async () => {
    mocks.paginated[LIST] = [priceList({ externalId: "pl-v2", version: 2, status: "draft", name: "Закупочные цены · v2" })]
    renderPage()
    fireEvent.click(screen.getByText("Закупочные цены · v2"))
    expect(screen.getByRole("region", { name: "Версии" })).toBeTruthy()
    fireEvent.click(await screen.findByRole("button", { name: "Опубликовать" }))
    await waitFor(() => expect(mocks.mutations[PUBLISH]).toHaveBeenCalledWith({ externalId: "pl-v2" }))
    expect(await screen.findByText("Опубликован v2, v1 истёк")).toBeTruthy()

    cleanup()
    renderPage(["office.price-lists.view", "office.price-lists.edit", "office.suppliers.view", "office.stock.view"])
    fireEvent.click(screen.getByText("Закупочные цены · v2"))
    expect(await screen.findByRole("button", { name: "Сохранить" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Опубликовать" })).toBeNull()
  })

  it("validates the form like the server", () => {
    const draft = { ...emptyPriceListDraft(EFFECTIVE), name: "П", deviationPercent: "120" }
    expect(validatePriceList(draft)).toMatchObject({ name: "Укажите название", supplier: "Выберите поставщика", deviationPercent: "Допуск — от 0 до 100 %" })
    expect(effectiveFromTimestamp("2026-09-24")).toBe(EFFECTIVE)
    expect(effectiveFromTimestamp("24.09.2026")).toBeNull()
  })
})
