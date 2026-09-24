// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import type { Id } from "../../convex/_generated/dataModel"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CapabilitiesProvider } from "@/office/components/can"
import { draftFromCard, isDraftDirty, productDraftReducer, type DraftState } from "@/office/features/nomenclature/model/use-product-draft"
import { NomenclatureWorkspace } from "@/office/features/nomenclature/ui/nomenclature-workspace"
import { flattenGroupTree } from "@/office/features/product-groups/data/use-product-groups"
import { ProductGroupsWorkspace } from "@/office/features/product-groups/ui/product-groups-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

/** Testing Library collapses thin and no-break spaces into plain ones. */
const money = (value: number, prefix = "") => `${prefix}${formatTenge(value)}`.replace(/\s+/g, " ")

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: [] as unknown[],
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[getFunctionName(reference).split(":").pop()!]),
  usePaginatedQuery: () => ({ results: mocks.paginated, status: "Exhausted", loadMore: vi.fn(), isLoading: false }),
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = getFunctionName(reference).split(":").pop()!
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

const GROUPS = [
  { externalId: "hot", label: "Горячие блюда", shortLabel: "Горячее", sortOrder: 10, parentExternalId: null, active: true },
  { externalId: "soups", label: "Супы", shortLabel: "Супы", sortOrder: 20, parentExternalId: "hot", active: true },
  { externalId: "drinks", label: "Напитки", shortLabel: "Напитки", sortOrder: 5, parentExternalId: null, active: false },
  { externalId: "broths", label: "Сорпа", shortLabel: "Сорпа", sortOrder: 1, parentExternalId: "soups", active: true },
]

function row(overrides: Record<string, unknown> = {}) {
  return {
    _id: "id-beshbarmak",
    externalId: "beshbarmak",
    name: "Бешбармак",
    nameKk: "Бешбармақ",
    description: "",
    imageUrl: null,
    category: { externalId: "hot", label: "Горячие блюда" },
    basePrice: 3200,
    priceRange: { min: 1650, max: 3200 },
    settingsSummary: "стандарт",
    itemType: "dish",
    enabled: true,
    sku: "B-01",
    sourceSystem: "sandyq",
    ...overrides,
  }
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    productId: "id-beshbarmak" as Id<"products">,
    sizeScaleExternalId: null,
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
    source: "sandyq" as const,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.queries = { listProductGroups: GROUPS, getProductCard: card() }
  mocks.paginated = [row(), row({ _id: "id-ayran", externalId: "ayran", name: "Айран", nameKk: "Айран", itemType: "good", enabled: false, priceRange: { min: 600, max: 600 }, category: { externalId: "drinks", label: "Напитки" } })]
  mocks.mutations = {
    saveProductCard: vi.fn(async () => ({ changed: ["nameKk"] })),
    setProductPrice: vi.fn(async () => null),
    saveProductGroup: vi.fn(async () => "hot"),
    createProduct: vi.fn(async () => "id-new"),
    attachProductImage: vi.fn(async () => null),
    generateImageUploadUrl: vi.fn(async () => "https://upload.test"),
  }
})

afterEach(cleanup)

function renderAt(path: string, element: ReactNode, state?: unknown) {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element }], { initialEntries: [{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={["*"]}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  return router
}

describe("«Группы товаров» (W1-CAT-03)", () => {
  it("orders the tree depth-first by parent and «Порядок»", () => {
    expect(flattenGroupTree(GROUPS).map((node) => [node.externalId, node.depth])).toEqual([
      ["drinks", 0],
      ["hot", 0],
      ["soups", 1],
      ["broths", 2],
    ])
  })

  it("indents subgroups and shows «<короткое> · порядок N» with the status", () => {
    renderAt("/office/product-groups", <ProductGroupsWorkspace />)
    const list = screen.getByRole("region", { name: "Группы" })
    const item = (name: string) => within(list).getByRole("button", { name: new RegExp(name) })
    expect(item("Горячие блюда").dataset.depth).toBe("0")
    expect(item("Супы").dataset.depth).toBe("1")
    expect(item("Сорпа").dataset.depth).toBe("2")
    expect(Number.parseInt(item("Сорпа").style.paddingLeft)).toBeGreaterThan(Number.parseInt(item("Супы").style.paddingLeft))
    expect(within(item("Горячие блюда")).getByText("Горячее · порядок 10")).toBeTruthy()
    expect(within(item("Напитки")).getByText("Неактивно")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Новая группа" })).toBeTruthy()
  })
})

describe("«Номенклатура» register (W1-CAT-04)", () => {
  it("shows the register columns, «от N ₸» for different branch prices, type and status", () => {
    renderAt("/office/nomenclature", <NomenclatureWorkspace />)
    const table = screen.getByRole("table", { name: "Номенклатура" })
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent)
    expect(headers.slice(0, 6)).toEqual(["Наименование", "Категория", "Цена", "Настройки", "Тип", "Статус"])
    const [, beshbarmak, ayran] = within(table).getAllByRole("row")
    expect(within(beshbarmak).getByText(money(1650, "от "))).toBeTruthy()
    expect(within(beshbarmak).getByText("Бешбармақ")).toBeTruthy()
    expect(within(beshbarmak).getByText("Блюдо")).toBeTruthy()
    expect(within(beshbarmak).getByText("Активно")).toBeTruthy()
    expect(within(ayran).getByText(money(600))).toBeTruthy()
    expect(within(ayran).getByText("Товар")).toBeTruthy()
    expect(within(ayran).getByText("Скрыто")).toBeTruthy()
    expect(screen.getByPlaceholderText("Название, описание или артикул")).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Скрытые" })).toBeTruthy()
  })

  it("opens the card keeping the filters in the URL", () => {
    const router = renderAt("/office/nomenclature?status=active", <NomenclatureWorkspace />)
    fireEvent.click(screen.getByText("Бешбармак"))
    expect(router.state.location.pathname).toBe("/office/nomenclature/beshbarmak")
    expect(router.state.location.search).toBe("?status=active")
    expect(router.state.location.state).toEqual({ productId: "id-beshbarmak" })

    fireEvent.click(screen.getByRole("button", { name: "К списку" }))
    expect(router.state.location.pathname).toBe("/office/nomenclature")
    expect(router.state.location.search).toBe("?status=active")
  })
})

describe("product draft (W1-CAT-05)", () => {
  const initial = (): DraftState => {
    const draft = draftFromCard(card())
    return { saved: draft, current: draft }
  }

  it("is dirty after an edit and clean again after reset or save", () => {
    const edited = productDraftReducer(initial(), { type: "set", patch: { nameKk: "Бешбармақ (ет)" } })
    expect(isDraftDirty(initial())).toBe(false)
    expect(isDraftDirty(edited)).toBe(true)
    expect(isDraftDirty(productDraftReducer(edited, { type: "reset" }))).toBe(false)
    expect(productDraftReducer(edited, { type: "reset" }).current.nameKk).toBe("Бешбармақ")
    const saved = productDraftReducer(edited, { type: "saved" })
    expect(isDraftDirty(saved)).toBe(false)
    expect(saved.current.nameKk).toBe("Бешбармақ (ет)")
  })

  it("tracks branch prices; putting back the saved value is not a change", () => {
    const priced = productDraftReducer(initial(), { type: "setBranchPrice", restaurantExternalId: "r1", price: 2900 })
    expect(isDraftDirty(priced)).toBe(true)
    expect(isDraftDirty(productDraftReducer(priced, { type: "setBranchPrice", restaurantExternalId: "r1", price: null }))).toBe(false)
  })
})

describe("product card (W1-CAT-05)", () => {
  it("saves the edited fields with saveProductCard and a branch price with setProductPrice", async () => {
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />, { productId: "id-beshbarmak" })
    expect(screen.getByRole("heading", { name: "Бешбармак" })).toBeTruthy()
    expect(screen.getByText("Артикул B-01 · Горячие блюда")).toBeTruthy()
    const save = screen.getByRole("button", { name: "Сохранено" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText("Атауы (қаз)"), { target: { value: "Бешбармақ (ет)" } })
    fireEvent.change(screen.getByLabelText("Своя цена — Sandyq Абая"), { target: { value: "2900" } })
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))

    await waitFor(() => expect(mocks.mutations.saveProductCard).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveProductCard).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "beshbarmak", name: "Бешбармак", nameKk: "Бешбармақ (ет)", categoryExternalId: "hot", basePrice: 3200, baseUnit: "порц.", enabled: true }),
    )
    await waitFor(() => expect(mocks.mutations.setProductPrice).toHaveBeenCalledWith({ productId: "id-beshbarmak", restaurantExternalId: "r1", priceKzt: 2900 }))
    expect(await screen.findByText("Все изменения сохранены")).toBeTruthy()
  })

  it("shows the price in force with its source and all six tabs", () => {
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />, { productId: "id-beshbarmak" })
    const prices = screen.getByRole("table", { name: "Цена по филиалам" })
    const [, abaya, dostyk] = within(prices).getAllByRole("row")
    expect(within(abaya).getByText("базовая")).toBeTruthy()
    expect(within(dostyk).getByText(money(3500))).toBeTruthy()
    expect(within(dostyk).getByText("филиал")).toBeTruthy()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Основные свойства",
      "Единицы измерения",
      "Изображение",
      "Шкала размеров",
      "Технологическая карта",
      "Технология приготовления",
    ])
  })

  it("marks an iiko product: local edits live on top of iiko data", () => {
    mocks.queries.getProductCard = card({ source: "iiko-server" })
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />, { productId: "id-beshbarmak" })
    expect(screen.getByText("Товар из iiko: изменения хранятся в Sandyq поверх данных iiko")).toBeTruthy()
    expect((screen.getByLabelText("Артикул") as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText("Атауы (қаз)") as HTMLInputElement).disabled).toBe(false)

    cleanup()
    mocks.queries.getProductCard = card()
    renderAt("/office/nomenclature/beshbarmak", <NomenclatureWorkspace />, { productId: "id-beshbarmak" })
    expect(screen.queryByText(/Товар из iiko/)).toBeNull()
  })
})
