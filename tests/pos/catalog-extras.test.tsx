// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Id } from "../../convex/_generated/dataModel"
import { CapabilitiesProvider } from "@/office/components/can"
import { rulesDraftFrom, validateGroupRules } from "@/office/features/modifiers/model/use-modifier-draft"
import { ModifiersWorkspace } from "@/office/features/modifiers/ui/modifiers-workspace"
import { untilFromDate } from "@/office/features/nomenclature/ui/product-editor/availability-block"
import { NomenclatureWorkspace } from "@/office/features/nomenclature/ui/nomenclature-workspace"
import { fromAlmatyInput, markupPercent, toAlmatyInput } from "@/office/features/price-orders/model/use-price-order-draft"
import { PriceOrdersWorkspace } from "@/office/features/price-orders/ui/price-orders-workspace"
import { draftFromScale, validateScaleDraft } from "@/office/features/size-scales/model/use-size-scale-draft"
import { SizeScalesWorkspace } from "@/office/features/size-scales/ui/size-scales-workspace"
import { ToastProvider } from "@/shared/components/ui"

// W1-CAT-08 (modifiers), W1-CAT-09 (size scales), W1-CAT-11 (price orders), W1-CAT-14 (stop list, office).

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  // One-shot reads (the iiko menu switch preview) are not exercised here.
  useConvex: () => ({ query: async () => null }),
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

function productCard(overrides: Record<string, unknown> = {}) {
  return {
    productId: "id-beshbarmak" as Id<"products">,
    externalId: "beshbarmak",
    name: "Бешбармак",
    nameKk: "Бешбармақ",
    description: "",
    categoryExternalId: "hot",
    categoryLabel: "Горячие блюда",
    itemType: "dish" as const,
    prepArea: "hot",
    writeOffMethod: "ingredients" as const,
    sku: "B-01",
    basePrice: 3200,
    baseUnit: "порц." as const,
    unitWeightKg: null,
    technology: "",
    enabled: true,
    imageUrl: null,
    branchPrices: [
      { restaurantExternalId: "r1", name: "Sandyq Абая", priceKzt: null, resolvedPriceNow: { price: 3200, source: "base" as const }, availability: { available: true, reason: null, until: null } },
      { restaurantExternalId: "r2", name: "Sandyq Достык", priceKzt: 3500, resolvedPriceNow: { price: 3500, source: "branch" as const }, availability: { available: true, reason: null, until: null } },
    ],
    modifierGroupCount: 0,
    sizeScaleExternalId: null,
    source: "sandyq" as const,
    ...overrides,
  }
}

const NOMENCLATURE_ROW = {
  _id: "id-beshbarmak",
  externalId: "beshbarmak",
  name: "Бешбармак",
  nameKk: "Бешбармақ",
  description: "",
  imageUrl: null,
  category: { externalId: "hot", label: "Горячие блюда" },
  basePrice: 3200,
  priceRange: { min: 3200, max: 3200 },
  settingsSummary: "стандарт",
  itemType: "dish",
  enabled: true,
  sku: "B-01",
  sourceSystem: "sandyq",
}

function priceOrder(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "po-1",
    number: "ЦЕН-2026-01",
    name: "Осеннее меню",
    status: "draft",
    effectiveFrom: Date.parse("2026-10-01T00:00:00Z") - 5 * 60 * 60 * 1000,
    effectiveTo: null,
    restaurantExternalIds: [],
    posName: "",
    lineCount: 2,
    updatedAt: 0,
    comment: "",
    replacesPreviousMenu: false,
    cancelReason: null,
    schedule: null,
    lines: [
      { productExternalId: "beshbarmak", productName: "Бешбармак", sizeOptionExternalId: null, sizeLabel: null, included: true, previousPrice: 3200, newPrice: 3500, costAtSave: 0, markupPercent: null },
      { productExternalId: "shubat", productName: "Шұбат", sizeOptionExternalId: "size-05", sizeLabel: "0,5 л", included: true, previousPrice: 800, newPrice: 900, costAtSave: 300, markupPercent: 200 },
    ],
    ...overrides,
  }
}

const RULES = [
  {
    groupExternalId: "sauces",
    groupName: "Соусы",
    required: false,
    minQuantity: 0,
    maxQuantity: 2,
    freeQuantity: 1,
    enforceItemLimits: true,
    sortOrder: 0,
    rules: [{ modifierExternalId: "m-ayran", name: "Айран соус", price: 300, minQuantity: 0, maxQuantity: 2, defaultQuantity: 0, freeQuantity: 1, sortOrder: 10 }],
  },
]

const MODIFIER_ROW = {
  externalId: "m-ayran",
  groupExternalId: "sauces",
  groupName: "Соусы",
  name: "Айран соус",
  nameKk: null,
  price: 300,
  ingredientName: "Айран",
  ingredientQuantity: 0.05,
  unit: "л",
  available: true,
  sortOrder: 10,
}

beforeEach(() => {
  mocks.queries = {
    "domains/office/queries:context": CONTEXT,
    "domains/catalog/office:getProductCard": productCard(),
    "domains/catalog/office:listProductGroups": [],
    "domains/modifiers/queries:listGroups": [{ externalId: "sauces", name: "Соусы", nameKk: null, sortOrder: 10, active: true }],
    "domains/modifiers/queries:getProductRules": RULES,
    "domains/pricing/queries:get": priceOrder(),
  }
  mocks.paginated = {
    "domains/catalog/office:listNomenclature": [NOMENCLATURE_ROW],
    "domains/modifiers/queries:list": [MODIFIER_ROW],
    "domains/sizeScales/queries:list": [],
    "domains/pricing/queries:list": [],
  }
  mocks.mutations = {
    "domains/sizeScales/mutations:save": vi.fn(async () => "scale-1"),
    "domains/sizeScales/mutations:assignScale": vi.fn(async () => null),
    "domains/sizeScales/mutations:setAvailability": vi.fn(async () => null),
    "domains/modifiers/mutations:saveProductRules": vi.fn(async () => null),
    "domains/modifiers/mutations:assignGroup": vi.fn(async () => null),
    "domains/modifiers/mutations:unassignGroup": vi.fn(async () => null),
    "domains/modifiers/mutations:save": vi.fn(async () => "m-1"),
    "domains/modifiers/mutations:saveGroup": vi.fn(async () => "g-1"),
    "domains/pricing/mutations:save": vi.fn(async () => ({ lineCount: 2 })),
    "domains/pricing/mutations:publish": vi.fn(async () => "scheduled"),
    "domains/pricing/mutations:cancel": vi.fn(async () => null),
    "domains/pricing/mutations:createDraft": vi.fn(async () => ({ externalId: "po-2", number: "ЦЕН-2026-02" })),
    "domains/catalog/pos:setAvailability": vi.fn(async () => null),
    "domains/catalog/office:saveProductCard": vi.fn(async () => ({ changed: [] })),
    "domains/catalog/office:attachProductImage": vi.fn(async () => null),
    "domains/catalog/mutations:setProductPrice": vi.fn(async () => null),
    "domains/catalog/mutations:createProduct": vi.fn(async () => "id-new"),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode) {
  const [pathname, search] = path.split("?")
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element }], { initialEntries: [{ pathname, search: search ? `?${search}` : "" }] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={["*"]}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Шкалы размеров» (W1-CAT-09)", () => {
  it("shows «Шкалы не найдены» for an empty register", () => {
    renderAt("/office/size-scales", <SizeScalesWorkspace />)
    expect(screen.getByText("Шкалы не найдены")).toBeTruthy()
    expect(screen.getByPlaceholderText("Название шкалы или размер")).toBeTruthy()
  })

  it("validates exactly one default size", () => {
    const draft = draftFromScale(null)
    expect(validateScaleDraft({ ...draft, name: "Шұбат", options: [{ ...draft.options[0], label: "0,5 л", kitchenLabel: "0,5", isDefault: false }] }).options).toBe("Отметьте ровно один размер по умолчанию")
    expect(validateScaleDraft({ ...draft, name: "Шұбат", options: [{ ...draft.options[0], label: "0,5 л", kitchenLabel: "0,5", coefficient: "0" }] }).rows[draft.options[0].key]?.coefficient).toBe("Больше нуля")
  })

  it("the editor needs exactly one default before calling save", async () => {
    renderAt("/office/size-scales", <SizeScalesWorkspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /Новая шкала/ })[0])
    const panel = await screen.findByRole("dialog")
    fireEvent.change(within(panel).getByLabelText("Название"), { target: { value: "Шұбат" } })
    fireEvent.change(within(panel).getByLabelText("Для кассира"), { target: { value: "0,2 л" } })
    fireEvent.change(within(panel).getByLabelText("Для кухни"), { target: { value: "0,2" } })
    fireEvent.click(within(panel).getByRole("button", { name: "Размер" }))
    fireEvent.change(within(panel).getAllByLabelText("Для кассира")[1], { target: { value: "1 л" } })
    fireEvent.change(within(panel).getAllByLabelText("Для кухни")[1], { target: { value: "1" } })
    fireEvent.change(within(panel).getAllByLabelText("Коэффициент цены")[1], { target: { value: "4,5" } })
    // The default size is removed: none is left.
    fireEvent.click(within(panel).getByRole("button", { name: "Удалить — 0,2 л" }))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    expect(await within(panel).findByText("Отметьте ровно один размер по умолчанию")).toBeTruthy()
    expect(mocks.mutations["domains/sizeScales/mutations:save"]).not.toHaveBeenCalled()

    fireEvent.click(within(panel).getByRole("radio"))
    fireEvent.click(within(panel).getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/sizeScales/mutations:save"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/sizeScales/mutations:save"]).toHaveBeenCalledWith({
      name: "Шұбат",
      options: [{ label: "1 л", kitchenLabel: "1", coefficient: 4.5, sortOrder: 10, isDefault: true, available: true }],
      productExternalIds: [],
    })
  })
})

describe("Product card: «Шкала размеров» tab and «Наличие по филиалам» (W1-CAT-09, W1-CAT-14)", () => {
  it("the availability switch calls setAvailability with the restaurant and the reason", async () => {
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />)
    const block = screen.getByRole("region", { name: "Наличие по филиалам" })
    fireEvent.change(within(block).getByLabelText("Причина — Sandyq Достык"), { target: { value: "Закончилось" } })
    fireEvent.click(within(block).getByRole("switch", { name: "В продаже — Sandyq Достык" }))
    await waitFor(() => expect(mocks.mutations["domains/catalog/pos:setAvailability"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/catalog/pos:setAvailability"]).toHaveBeenCalledWith({ productExternalId: "beshbarmak", restaurantExternalId: "r2", available: false, reason: "Закончилось" })
    await waitFor(() => expect(within(block).getByRole("switch", { name: "В продаже — Sandyq Достык" }).getAttribute("aria-checked")).toBe("false"))
  })

  it("«до» is the next Almaty midnight after the chosen day", () => {
    expect(untilFromDate("2026-09-25")).toBe(Date.parse("2026-09-25T19:00:00Z"))
    expect(untilFromDate("")).toBeUndefined()
  })

  it("the size tab says no scale is assigned and links to the catalog", () => {
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />)
    const tab = screen.getByRole("tab", { name: "Шкала размеров" })
    fireEvent.mouseDown(tab, { button: 0 })
    fireEvent.click(tab)
    expect(screen.getByText("Для «Бешбармак» шкала не назначена")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Настроить шкалу/ }).getAttribute("href")).toBe("/office/size-scales")
  })
})

describe("«Модификаторы» — правила для блюда (W1-CAT-08)", () => {
  it("validates min ≤ default ≤ max in the draft", () => {
    const draft = rulesDraftFrom(RULES[0], [MODIFIER_ROW])
    expect(validateGroupRules(draft).rows).toEqual({})
    const bad = { ...draft, rows: draft.rows.map((row) => ({ ...row, defaultQuantity: 3 })) }
    expect(validateGroupRules(bad).rows["m-ayran"]).toBe("Нужно: минимум ≤ по умолчанию ≤ максимум")
    expect(validateGroupRules({ ...draft, minQuantity: 3 }).group).toBe("Минимум группы не больше максимума")
  })

  it("shows the rule error before calling the server, then saves the fixed rules", async () => {
    renderAt("/office/modifiers?tab=rules&product=beshbarmak", <ModifiersWorkspace />)
    const group = await screen.findByRole("region", { name: "Группа «Соусы»" })
    expect(within(group).getByText("от 0 до 2 · 1 бесплатно")).toBeTruthy()
    fireEvent.change(within(group).getByLabelText("По умолчанию — Айран соус"), { target: { value: "3" } })
    fireEvent.click(within(group).getByRole("button", { name: "Сохранить правила" }))
    expect(await within(group).findByText("Нужно: минимум ≤ по умолчанию ≤ максимум")).toBeTruthy()
    expect(mocks.mutations["domains/modifiers/mutations:saveProductRules"]).not.toHaveBeenCalled()

    fireEvent.change(within(group).getByLabelText("По умолчанию — Айран соус"), { target: { value: "1" } })
    fireEvent.click(within(group).getByRole("button", { name: "Сохранить правила" }))
    await waitFor(() => expect(mocks.mutations["domains/modifiers/mutations:saveProductRules"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/modifiers/mutations:saveProductRules"]).toHaveBeenCalledWith({
      productExternalId: "beshbarmak",
      groupExternalId: "sauces",
      required: false,
      minQuantity: 0,
      maxQuantity: 2,
      freeQuantity: 1,
      enforceItemLimits: true,
      rules: [{ modifierExternalId: "m-ayran", minQuantity: 0, maxQuantity: 2, defaultQuantity: 1, freeQuantity: 1, sortOrder: 10 }],
    })
  })

  it("lists modifiers with group, price, composition and status", () => {
    renderAt("/office/modifiers", <ModifiersWorkspace />)
    const table = screen.getByRole("table", { name: "Модификаторы" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 5)).toEqual(["Название", "Группа", "Цена", "Состав", "Статус"])
    expect(within(table).getByText("В продаже")).toBeTruthy()
    expect(within(table).getByText(/Айран · 0,05/)).toBeTruthy()
  })
})

describe("«Приказы об изменении цен» (W1-CAT-11)", () => {
  it("markup is over the portion cost, «—» without a recipe card", () => {
    expect(markupPercent(1650, 580)).toBe(184)
    expect(markupPercent(1650, 0)).toBeNull()
    expect(fromAlmatyInput(toAlmatyInput(1_790_000_000_000))).toBe(1_790_000_000_000 - (1_790_000_000_000 % 60_000))
  })

  it("the draft editor sends the edited lines on save", async () => {
    renderAt("/office/price-orders/po-1", <PriceOrdersWorkspace />)
    expect(screen.getByRole("heading", { name: "Приказ ЦЕН-2026-01" })).toBeTruthy()
    expect(screen.getByText("Черновик")).toBeTruthy()
    const lines = screen.getByRole("region", { name: "Позиции прайс-листа" })
    expect(within(lines).getByText("200 %")).toBeTruthy()
    fireEvent.change(within(lines).getByLabelText("Новая цена — Бешбармак"), { target: { value: "3 600" } })
    fireEvent.click(within(lines).getByRole("checkbox", { name: "Включить «Шұбат, 0,5 л»" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations["domains/pricing/mutations:save"]).toHaveBeenCalledTimes(1))
    expect(mocks.mutations["domains/pricing/mutations:save"]).toHaveBeenCalledWith({
      externalId: "po-1",
      name: "Осеннее меню",
      effectiveFrom: priceOrder().effectiveFrom,
      comment: "",
      posName: "",
      replacesPreviousMenu: false,
      restaurantExternalIds: [],
      schedule: null,
      lines: [
        { productExternalId: "beshbarmak", included: true, newPrice: 3600 },
        { productExternalId: "shubat", sizeOptionExternalId: "size-05", included: false, newPrice: 900 },
      ],
    })
  })

  it("publishes a draft", async () => {
    renderAt("/office/price-orders/po-1", <PriceOrdersWorkspace />)
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }))
    await waitFor(() => expect(mocks.mutations["domains/pricing/mutations:publish"]).toHaveBeenCalledWith({ externalId: "po-1" }))
    expect(mocks.mutations["domains/pricing/mutations:save"]).not.toHaveBeenCalled()
  })

  it("an active order is read-only and can only be cancelled with a reason", async () => {
    mocks.queries["domains/pricing/queries:get"] = priceOrder({ status: "active" })
    renderAt("/office/price-orders/po-1", <PriceOrdersWorkspace />)
    expect(screen.getByText("Действует")).toBeTruthy()
    expect(screen.getByText("Приказ действует — только чтение")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Опубликовать" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Сохранить приказ" })).toBeNull()
    expect(screen.queryByLabelText("Название")).toBeNull()
    expect(screen.queryByLabelText("Новая цена — Бешбармак")).toBeNull()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Отменить приказ" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Причина отмены"), { target: { value: "Ошибка в ценах" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить приказ" }))
    await waitFor(() => expect(mocks.mutations["domains/pricing/mutations:cancel"]).toHaveBeenCalledWith({ externalId: "po-1", reason: "Ошибка в ценах" }))
  })

  it("«Новый приказ» creates a draft and opens it", async () => {
    const router = renderAt("/office/price-orders", <PriceOrdersWorkspace />)
    expect(screen.getByRole("tab", { name: "Действующие" })).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: /Новый приказ/ })[0])
    await waitFor(() => expect(router.state.location.pathname).toBe("/office/price-orders/po-2"))
  })
})
