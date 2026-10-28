// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_PRINT_TEMPLATES } from "../../convex/lib/printTemplate"
import { CapabilitiesProvider } from "@/office/components/can"
import type { PlatformRecord } from "@/office/features/platform/data/use-platform-records"
import { EquipmentWorkspace } from "@/office/features/platform/ui/equipment-workspace"
import { PrintTemplatesWorkspace } from "@/office/features/platform/ui/print-templates-workspace"
import { SystemSettingsWorkspace } from "@/office/features/platform/ui/system-settings-workspace"
import type { OrderReceiptData } from "@/pos/features/checkout/model/order-receipt"
import { orderTemplateData, templateHtml } from "@/pos/features/print/template-print"
import { ToastProvider } from "@/shared/components/ui"

// W3-ADM-10…12: «Шаблоны печати» (live preview, no markup), «Оборудование» (routing table) and
// «Настройки системы» (registry-driven card); the POS prints by a published template.

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown>,
  paginatedArgs: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined
    const value = mocks.queries[getFunctionName(reference)]
    return typeof value === "function" ? (value as (args: unknown) => unknown)(args) : value
  },
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(reference)
    mocks.paginatedArgs.push({ name, args })
    const value = mocks.paginated[name]
    const results = typeof value === "function" ? (value as (args: unknown) => unknown[])(args) : ((value as unknown[]) ?? [])
    return { results, status: "Exhausted", loadMore: vi.fn(), isLoading: false }
  },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const LIST = "domains/platform/records:list"
const SAVE = "domains/platform/records:save"
const TRANSITION = "domains/platform/records:transition"

function record(overrides: Partial<PlatformRecord> & Pick<PlatformRecord, "externalId" | "moduleId" | "name" | "data">): PlatformRecord {
  return {
    _id: overrides.externalId as PlatformRecord["_id"],
    _creationTime: 0,
    number: "ШП-2026-00001",
    status: "published",
    organizationExternalId: "sandyq",
    restaurantExternalId: "organization:sandyq",
    businessDate: "2026-09-26",
    amount: 0,
    searchText: "",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const receiptSeed = DEFAULT_PRINT_TEMPLATES.find((seed) => seed.documentType === "receipt")!
const RECEIPT = record({ externalId: "pt-receipt", moduleId: "print-templates", name: "Чек продажи Sandyq", data: { documentType: "receipt", language: "ru", copies: 1, widthMm: 80, template: receiptSeed.template } })
const PRINTER = record({ externalId: "eq-hot", moduleId: "equipment", number: "ОБР-2026-00001", status: "active", restaurantExternalId: "r1", name: "Принтер горячего цеха", data: { type: "kitchen-printer", endpoint: "192.168.1.50:9100", terminalExternalId: "t1" }, routing: [{ station: "hot", printerExternalId: "self" }] })
const IDLE = record({ externalId: "ss-idle", moduleId: "system-settings", number: "НС-2026-00001", status: "draft", restaurantExternalId: "r1", name: "Автоблокировка кассы", data: { key: "security.posIdleLockMinutes", scope: "restaurant", scopeExternalId: "r1", value: 10, category: "security", valueType: "number" } })
const RECORDS = [RECEIPT, PRINTER, IDLE]

beforeEach(() => {
  mocks.paginatedArgs = []
  mocks.queries = {
    "domains/office/queries:context": { adminRestaurants: [{ externalId: "r1", name: "Sandyq Абая" }], user: { restaurantScopes: ["*"] } },
    "domains/platform/records:references": {
      restaurants: [{ externalId: "r1", name: "Sandyq Абая", organizationExternalId: "sandyq" }],
      organizations: [{ externalId: "sandyq", name: "Sandyq" }],
      network: true,
      terminals: [{ externalId: "t1", name: "Касса 1", restaurantExternalId: "r1", active: true }],
      printers: [{ externalId: "eq-hot", name: "Принтер горячего цеха", type: "kitchen-printer", restaurantExternalId: "r1" }],
      stations: [
        { value: "hot", label: "Горячий цех" },
        { value: "bar", label: "Бар" },
      ],
    },
    "domains/platform/records:get": (args: { moduleId: string; externalId: string }) => RECORDS.find((row) => row.externalId === args.externalId && row.moduleId === args.moduleId) ?? null,
  }
  mocks.paginated = { [LIST]: (args: { moduleId: string }) => RECORDS.filter((row) => row.moduleId === args.moduleId) }
  mocks.mutations = {
    [SAVE]: vi.fn(async () => ({ externalId: "new-1", number: "ШП-2026-00002", version: 1 })),
    [TRANSITION]: vi.fn(async () => ({ status: "published", version: 2 })),
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

describe("«Шаблоны печати» (W3-ADM-10)", () => {
  it("lists Название · Тип документа · Ширина · Статус with publish tabs", () => {
    renderAt("/office/print-templates", <PrintTemplatesWorkspace />)
    const table = screen.getByRole("table", { name: "Шаблоны печати" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Название", "Тип документа", "Ширина", "Статус"]))
    expect(within(table).getByText("Чек продажи")).toBeTruthy()
    expect(within(table).getByText("80 мм")).toBeTruthy()
    expect(within(table).getByText("Вся сеть · Sandyq")).toBeTruthy()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Все", "Черновики", "Опубликованные", "Неактивные"])
    expect(screen.getByPlaceholderText("Поиск: шаблоны печати")).toBeTruthy()
  })

  it("a published template is read-only, previews the Sandyq check and offers a new version", async () => {
    renderAt("/office/print-templates/pt-receipt", <PrintTemplatesWorkspace />)
    const panel = await screen.findByRole("dialog")
    expect((within(panel).getByLabelText("Шаблон") as HTMLTextAreaElement).disabled).toBe(true)
    const preview = within(panel).getByRole("img", { name: "Превью печати, лента 80 мм" })
    expect(within(preview).getByText("Қызмет ақысы 15 % / Обслуживание 15 %")).toBeTruthy()
    expect(within(preview).getByText("Ресторан Алматы")).toBeTruthy()
    expect(within(preview).queryByText(/DALA|Sandyq/i)).toBeNull()
    fireEvent.click(within(panel).getByRole("button", { name: "Снять с публикации" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Снять с публикации" }))
    await waitFor(() => expect(mocks.mutations[TRANSITION]).toHaveBeenCalledWith({ moduleId: "print-templates", externalId: "pt-receipt", action: "deactivate", expectedVersion: 1 }))
  })

  it("the preview follows the editor, prints markup as text and shows unknown placeholders", async () => {
    renderAt("/office/print-templates/new", <PrintTemplatesWorkspace />)
    const panel = await screen.findByRole("dialog")
    const editor = within(panel).getByLabelText("Шаблон")
    fireEvent.change(editor, { target: { value: "<script>alert(1)</script>\nСтол {{order.tabel}}" } })
    await waitFor(() => expect(within(panel).getByText("<script>alert(1)</script>")).toBeTruthy())
    expect(document.querySelector("script")).toBeNull()
    expect(within(panel).getByText("Строка 2: Неизвестный плейсхолдер {{order.tabel}}")).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Мой чек" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(within(panel).getByText("Исправьте ошибки шаблона: 1")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()

    fireEvent.change(editor, { target: { value: "[center]{{restaurant.name}}\nИтого || {{totals.total}}" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "print-templates", name: "Мой чек", restaurantExternalId: "organization:sandyq", data: { documentType: "receipt", language: "ru", copies: 1, widthMm: 80, template: "[center]{{restaurant.name}}\nИтого || {{totals.total}}" } }),
    )
  })
})

describe("«Оборудование» (W3-ADM-11)", () => {
  it("shows Тип · Терминал · Адрес/порт and the station → printer routing table", async () => {
    renderAt("/office/equipment", <EquipmentWorkspace />)
    const table = screen.getByRole("table", { name: "Оборудование" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Название", "Тип", "Терминал", "Адрес / порт", "Статус"]))
    expect(within(table).getByText("Кухонный принтер")).toBeTruthy()
    expect(within(table).getByText("192.168.1.50:9100")).toBeTruthy()
    fireEvent.click(within(table).getByText("Принтер горячего цеха"))
    const panel = await screen.findByRole("dialog")
    const routing = within(panel).getByRole("table", { name: "Станция → Принтер" })
    expect(within(routing).getAllByText("Горячий цех").length).toBeGreaterThan(0)
    expect(within(routing).getAllByText("Это устройство").length).toBeGreaterThan(0)
    fireEvent.click(within(panel).getByRole("button", { name: "Добавить станцию" }))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: "equipment",
        externalId: "eq-hot",
        routing: [
          { station: "hot", printerExternalId: "self" },
          { station: "bar", printerExternalId: "self" },
        ],
      }),
    )
  })
})

describe("«Настройки системы» (W3-ADM-12)", () => {
  it("shows Параметр · Значение · Область and checks the value by its type before saving", async () => {
    renderAt("/office/system-settings", <SystemSettingsWorkspace />)
    const table = screen.getByRole("table", { name: "Настройки системы" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["Номер", "Параметр", "Значение", "Область", "Статус"]))
    expect(within(table).getByText("10 мин")).toBeTruthy()
    expect(within(table).getByText("Ресторан · Sandyq Абая")).toBeTruthy()
    fireEvent.click(within(table).getByText("10 мин"))
    const panel = await screen.findByRole("dialog")
    const value = within(panel).getByLabelText("Значение, мин")
    fireEvent.change(value, { target: { value: "пять" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(within(panel).getByText("Значение должно быть числом")).toBeTruthy()
    expect(mocks.mutations[SAVE]).not.toHaveBeenCalled()
    fireEvent.change(value, { target: { value: "3" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations[SAVE]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations[SAVE]).toHaveBeenCalledWith(expect.objectContaining({ moduleId: "system-settings", externalId: "ss-idle", restaurantExternalId: "r1", data: { key: "security.posIdleLockMinutes", scope: "restaurant", scopeExternalId: "r1", value: 3 } }))
  })
})

describe("POS printing by a published template (W3-ADM-10)", () => {
  const receipt: OrderReceiptData = {
    kind: "precheck",
    orderNumber: 42,
    tableLabel: "Стол 3",
    restaurantName: "Sandyq Абая",
    terminalName: "Касса 1",
    operatorName: "Айгерим",
    createdAt: Date.UTC(2026, 8, 26, 8),
    lines: [{ name: "Бешбармак <b>", quantity: 2, amount: 10_000 }],
    subtotal: 10_000,
    discountAmount: 0,
    serviceChargePercent: 15,
    serviceChargeAmount: 1500,
    total: 11_500,
  }

  it("prints the pre-check by the published template, escaped, with copies", () => {
    const html = templateHtml({ externalId: "pt", number: "ШП-1", name: "Предчек", template: "[center][bold]ПРЕДЧЕК ПО ШАБЛОНУ\n{{#lines}}\n{{quantity}} × {{name}} || {{amount}}\n{{/lines}}\n[total]К ОПЛАТЕ || {{totals.total}}", widthMm: 58, copies: 2, language: "ru" }, "precheck", "Предчек", orderTemplateData(receipt))
    expect(html).toContain("ПРЕДЧЕК ПО ШАБЛОНУ")
    expect(html).toContain("Бешбармак &lt;b&gt;")
    expect(html).toContain("size: 58mm auto")
    expect(html!.match(/<main class="paper/g)).toHaveLength(2)
  })

  it("keeps the built-in form when there is no template or it no longer validates", () => {
    expect(templateHtml(null, "precheck", "Предчек", orderTemplateData(receipt))).toBeNull()
    expect(templateHtml({ externalId: "pt", number: "ШП-1", name: "Предчек", template: "{{order.gone}}", widthMm: 80, copies: 1, language: "ru" }, "precheck", "Предчек", orderTemplateData(receipt))).toBeNull()
  })
})
