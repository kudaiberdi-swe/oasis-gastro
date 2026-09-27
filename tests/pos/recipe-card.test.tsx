// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName, type FunctionReference } from "convex/server"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Id } from "../../convex/_generated/dataModel"
import { almatyDayStart } from "../../convex/lib/time"
import { CapabilitiesProvider } from "@/office/components/can"
import type { IngredientOption } from "@/office/features/nomenclature/data/use-recipe"
import {
  computeRecipe,
  draftFromRecipe,
  emptyLine,
  emptyRecipeDraft,
  foodCostTone,
  isRecipeDirty,
  linePatchForOption,
  recipeDraftReducer,
  recipeSaveArgs,
  validateRecipe,
  type RecipeDraftState,
} from "@/office/features/nomenclature/model/use-recipe-draft"
import { NomenclatureWorkspace } from "@/office/features/nomenclature/ui/nomenclature-workspace"
import { ToastProvider } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

/** Testing Library collapses thin and no-break spaces into plain ones. */
const text = (value: string) => value.replace(/\s+/g, " ")
const money = (value: number) => text(formatTenge(value))
const day = (date: string) => almatyDayStart(date)

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paginated: {} as Record<string, unknown[]>,
  mutations: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
}))

const lastName = (reference: FunctionReference<"query" | "mutation">) => getFunctionName(reference).split(":").pop()!

vi.mock("convex/react", () => ({
  // One-shot reads (the iiko menu switch preview) are not exercised here.
  useConvex: () => ({ query: async () => null }),
  useQuery: (reference: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : mocks.queries[lastName(reference)]),
  usePaginatedQuery: (reference: FunctionReference<"query">, args: unknown) =>
    args === "skip"
      ? { results: [], status: "LoadingFirstPage", loadMore: () => undefined, isLoading: true }
      : { results: mocks.paginated[lastName(reference)] ?? [], status: "Exhausted", loadMore: () => undefined, isLoading: false },
  useMutation: (reference: FunctionReference<"mutation">) => {
    const name = lastName(reference)
    return (...args: unknown[]) => mocks.mutations[name](...args)
  },
}))

function card() {
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
    prepArea: "pickup",
    writeOffMethod: "ingredients" as const,
    sku: "B-01",
    basePrice: 3200,
    baseUnit: "порц." as const,
    unitWeightKg: null,
    technology: "Отварить мясо",
    enabled: true,
    imageUrl: null,
    branchPrices: [
      { restaurantExternalId: "r1", name: "Sandyq Абая", priceKzt: null, resolvedPriceNow: { price: 3200, source: "base" as const }, availability: { available: true, reason: null, until: null } },
      { restaurantExternalId: "r2", name: "Sandyq Достык", priceKzt: 4000, resolvedPriceNow: { price: 4000, source: "branch" as const }, availability: { available: true, reason: null, until: null } },
    ],
    modifierGroupCount: 0,
    source: "sandyq" as const,
  }
}

const VERSION_ACTIVE = { _id: "v1", version: 1, status: "active", effectiveFrom: day("2026-09-01"), batchYield: 1, createdBy: "chef@sandyq.test", createdAt: 1 }
const VERSION_DRAFT = { _id: "v2", version: 2, status: "draft", effectiveFrom: day("2026-09-15"), batchYield: 1, createdBy: "chef@sandyq.test", createdAt: 2 }

/** getRecipe for a version: the beshbarmak card, horse meat 0,35 kg with 30 % cold losses at 4000 ₸/kg. */
function recipe(version: typeof VERSION_ACTIVE) {
  const line = { unit: "кг" as const, quantity: 0.35, unitWeightKg: 1, coldLossPercent: 30, hotLossPercent: 0, unitCost: 4000, grossKg: 0.35, netKg: 0.245, outputKg: 0.245, cost: 1400 }
  return {
    product: { externalId: "beshbarmak", name: "Бешбармак" },
    version: { _id: version._id, version: version.version, status: version.status, effectiveFrom: version.effectiveFrom, batchYield: 1, technology: "" },
    lines: [{ ...line, name: "Конина", kind: "item" as const, inventoryItemId: "inv-horse", componentProductId: null }],
    summary: { grossKg: 0.35, netKg: 0.245, outputKg: 0.245, costPerBatch: 1400, costPerPortion: 1400, portionOutputG: 245, price: 3200, foodCostPercent: 43.8, lines: undefined },
    checks: [
      { code: "units", ok: true, message: "Единицы приведены к килограммам" },
      { code: "yield", ok: true, message: "Выход готового продукта рассчитан" },
      { code: "batch", ok: true, message: "Норма закладки указана" },
      { code: "costs", ok: true, message: "Себестоимость без нулевых ингредиентов" },
      { code: "date", ok: true, message: "Начало действия не позже первой продажи" },
    ],
  }
}

const HORSE = { _id: "inv-horse", externalId: "horse-meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", active: true }

beforeEach(() => {
  mocks.queries = { listProductGroups: [], getProductCard: card(), listRecipeVersions: [VERSION_DRAFT, VERSION_ACTIVE], getRecipe: recipe(VERSION_DRAFT) }
  mocks.paginated = { listInventoryItems: [HORSE], listNomenclature: [] }
  mocks.mutations = {
    saveProductCard: vi.fn(async () => ({ changed: [] })),
    setProductPrice: vi.fn(async () => null),
    saveRecipeDraft: vi.fn(async () => "v2"),
    activateRecipeVersion: vi.fn(async () => ({ warning: null })),
  }
})

afterEach(cleanup)

function renderCard() {
  const router = createMemoryRouter([{ path: "/office/:section/:id?", element: <NomenclatureWorkspace /> }], { initialEntries: [{ pathname: "/office/nomenclature/beshbarmak", state: { productId: "id-beshbarmak" } }] })
  render(
    <ToastProvider>
      <CapabilitiesProvider capabilities={["*"]}>
        <RouterProvider router={router} />
      </CapabilitiesProvider>
    </ToastProvider>,
  )
  const tab = screen.getByRole("tab", { name: "Технологическая карта" })
  fireEvent.mouseDown(tab, { button: 0 })
  fireEvent.click(tab)
}

const kpi = (label: string) => screen.getByText(label).parentElement as HTMLElement

describe("recipe draft (W1-RCP-02)", () => {
  const initial = (): RecipeDraftState => {
    const draft = draftFromRecipe(recipe(VERSION_DRAFT) as never, "2026-09-25")
    return { saved: draft, current: draft, fresh: false }
  }

  it("loads the server version as text fields and is clean", () => {
    const state = initial()
    expect(state.current).toMatchObject({ batchYield: "1", effectiveFrom: "2026-09-15" })
    expect(state.current.lines[0]).toMatchObject({ kind: "item", refId: "inv-horse", name: "Конина", quantity: "0,35", coldLossPercent: "30", unitCost: 4000 })
    expect(isRecipeDirty(state)).toBe(false)
    expect(draftFromRecipe(null, "2026-09-25")).toEqual(emptyRecipeDraft("2026-09-25"))
  })

  it("adds and removes lines; removing the added line is not a change", () => {
    const added = recipeDraftReducer(initial(), { type: "addLine" })
    expect(added.current.lines).toHaveLength(2)
    expect(isRecipeDirty(added)).toBe(true)
    const removed = recipeDraftReducer(added, { type: "removeLine", key: added.current.lines[1].key })
    expect(removed.current.lines).toHaveLength(1)
    expect(isRecipeDirty(removed)).toBe(false)
    expect(isRecipeDirty(recipeDraftReducer(initial(), { type: "startNew", effectiveFrom: "2026-09-25" }))).toBe(true)
  })

  it("recalculates gross, net, output, cost and food cost on the fly with recipeMath", () => {
    const state = initial()
    const edited = recipeDraftReducer(state, { type: "updateLine", key: state.current.lines[0].key, patch: { quantity: "0,5", hotLossPercent: "10" } })
    const computed = computeRecipe(edited.current, { price: 3200 })
    expect(computed.summary.grossKg).toBeCloseTo(0.5, 6)
    expect(computed.summary.netKg).toBeCloseTo(0.35, 6)
    expect(computed.summary.outputKg).toBeCloseTo(0.315, 6)
    expect(computed.summary.costPerPortion).toBe(2000)
    expect(computed.summary.portionOutputG).toBe(315)
    expect(computed.foodCost).toBe(62.5)

    const batch = computeRecipe(recipeDraftReducer(edited, { type: "set", patch: { batchYield: "4" } }).current, { price: 3200 })
    expect(batch.summary.costPerPortion).toBe(500)
    expect(batch.foodCost).toBe(15.6)
  })

  it("colours food cost: < 30 success, 30–35 warning, > 35 destructive", () => {
    expect(foodCostTone(29.9)).toBe("success")
    expect(foodCostTone(30)).toBe("warning")
    expect(foodCostTone(35)).toBe("warning")
    expect(foodCostTone(35.1)).toBe("danger")
    expect(foodCostTone(null)).toBe("neutral")
  })

  it("a new ingredient has no cost until saved; the checks say so", () => {
    const withNew = recipeDraftReducer(initial(), { type: "addLine" })
    const key = withNew.current.lines[1].key
    const option: IngredientOption = { value: "item:inv-onion", label: "Лук", hint: "шт", kind: "item", refId: "inv-onion", refExternalId: "onion", unit: "шт" }
    const picked = recipeDraftReducer(withNew, { type: "updateLine", key, patch: { ...linePatchForOption(option, withNew.current.lines[1], new Map()), quantity: "2" } })
    expect(picked.current.lines[1]).toMatchObject({ refExternalId: "onion", unit: "шт", unitWeightKg: "", unitCost: null })
    const computed = computeRecipe(picked.current, { price: 3200 })
    expect(computed.costsPending).toBe(true)
    expect(computed.checks.filter((check) => !check.ok).map((check) => check.code)).toEqual(["units", "costs"])
  })

  it("validates like saveRecipeDraft and builds its arguments with external ids", () => {
    const state = recipeDraftReducer(initial(), { type: "addLine", line: { ...emptyLine(), key: "new" } })
    const resolve = (line: { refId: string | null; refExternalId: string | null }) => line.refExternalId ?? (line.refId === "inv-horse" ? "horse-meat" : null)
    const errors = validateRecipe({ ...state.current, batchYield: "0" }, resolve)
    expect(errors.batchYield).toBe("Норма закладки должна быть больше нуля")
    expect(errors.byLine.new).toMatchObject({ ref: "Выберите складскую позицию", quantity: "Больше нуля" })
    expect(Object.keys(errors.byLine)).toEqual(["new"])
    expect(validateRecipe({ ...state.current, lines: [] }, resolve).lines).toBe("Добавьте хотя бы один ингредиент")

    const args = recipeSaveArgs({ productExternalId: "beshbarmak", versionId: undefined, technology: "Отварить мясо", draft: initial().current, resolve })
    expect(args).toEqual({
      productExternalId: "beshbarmak",
      versionId: undefined,
      batchYield: 1,
      effectiveFrom: day("2026-09-15"),
      technology: "Отварить мясо",
      lines: [{ kind: "item", inventoryItemExternalId: "horse-meat", unit: "кг", quantity: 0.35, unitWeightKg: 1, coldLossPercent: 30, hotLossPercent: 0 }],
    })
  })
})

describe("«Технологическая карта» tab (W1-RCP-02)", () => {
  it("shows the KPI tiles, all columns, the output block, checks and versions", () => {
    renderCard()
    expect(within(kpi("Цена продажи")).getByText(money(3200))).toBeTruthy()
    expect(within(kpi("Себестоимость порции")).getByText(money(1400))).toBeTruthy()
    expect(within(kpi("Себестоимость порции")).getByText(`${money(1400)} на всю закладку`)).toBeTruthy()
    const foodCost = within(kpi("Фудкост")).getByText("43,8 %")
    expect(foodCost.className).toContain("text-destructive")
    expect(within(kpi("Выход одной порции")).getByText("245 г")).toBeTruthy()
    expect(within(kpi("Выход одной порции")).getByText("0,245 кг из 1 порц.")).toBeTruthy()

    const table = screen.getByRole("table", { name: "Ингредиенты технологической карты" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "№",
      "Наименование продукта",
      "Тип",
      "Ед.",
      "Количество",
      "Вес ед., кг",
      "Брутто, кг",
      "Хол. потери, %",
      "Нетто, кг",
      "Гор. потери, %",
      "Выход, кг",
      "Себестоимость, ₸",
      "Удалить",
    ])
    expect(within(table).getByText("Итого на 1 порц.")).toBeTruthy()
    expect(screen.getByLabelText("Норма закладки")).toBeTruthy()
    expect((screen.getByLabelText("Начало действия техкарты") as HTMLInputElement).value).toBe("2026-09-15")
    expect(screen.getByText("Техкарта заполнена корректно")).toBeTruthy()

    const release = screen.getByRole("region", { name: "Выпуск и списание" })
    expect(within(release).getByText("По ингредиентам техкарты")).toBeTruthy()
    expect(within(release).getByText("Выдача")).toBeTruthy()
    const checks = screen.getByRole("region", { name: "Проверка техкарты" })
    expect(within(checks).getByText("Единицы приведены к килограммам")).toBeTruthy()
    expect(within(checks).getByText("Начало действия не позже первой продажи")).toBeTruthy()

    const versions = screen.getByRole("table", { name: "Версии технологической карты" })
    const [, v2, v1] = within(versions).getAllByRole("row")
    expect(within(v2).getByText("Черновик")).toBeTruthy()
    expect(within(v2).getByText("15.09.2026")).toBeTruthy()
    expect(within(v1).getByText("Активно")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Добавить ингредиент" })).toHaveLength(1)
  })

  it("a saved draft is activated from the header primary", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Активировать версию" }))
    await waitFor(() => expect(mocks.mutations.activateRecipeVersion).toHaveBeenCalledWith({ versionId: "v2" }))
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull()
  })

  it("recalculates while typing and saves the draft in place with external ids", async () => {
    renderCard()
    fireEvent.change(screen.getByLabelText("Количество — Конина"), { target: { value: "0,5" } })
    expect(within(kpi("Себестоимость порции")).getByText(money(2000))).toBeTruthy()
    expect(within(kpi("Фудкост")).getByText("62,5 %")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Ингредиенты технологической карты" })
    expect(within(table).getAllByText("0,5").length).toBeGreaterThan(0)

    expect(screen.queryByRole("button", { name: "Активировать версию" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations.saveRecipeDraft).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveRecipeDraft).toHaveBeenCalledWith({
      productExternalId: "beshbarmak",
      versionId: "v2",
      batchYield: 1,
      effectiveFrom: day("2026-09-15"),
      technology: "Отварить мясо",
      lines: [{ kind: "item", inventoryItemExternalId: "horse-meat", unit: "кг", quantity: 0.5, unitWeightKg: 1, coldLossPercent: 30, hotLossPercent: 0 }],
    })
    expect(mocks.mutations.saveProductCard).not.toHaveBeenCalled()
  })

  it("shows the line errors before calling the server; the added line can be removed", () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Добавить ингредиент" }))
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    expect(screen.getByText("Выберите складскую позицию")).toBeTruthy()
    expect(screen.getByText("Больше нуля")).toBeTruthy()
    expect(mocks.mutations.saveRecipeDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Удалить строку 2" }))
    expect(screen.queryByRole("button", { name: "Удалить строку 2" })).toBeNull()
    expect(screen.getByRole("button", { name: "Активировать версию" })).toBeTruthy()
  })

  it("editing the active version saves a new draft version", async () => {
    mocks.queries.listRecipeVersions = [VERSION_ACTIVE]
    mocks.queries.getRecipe = recipe(VERSION_ACTIVE)
    renderCard()
    expect(screen.queryByRole("button", { name: "Активировать версию" })).toBeNull()
    fireEvent.change(screen.getByLabelText("Холодные потери, % — Конина"), { target: { value: "20" } })
    expect(screen.getByText("Изменения сохранятся новой версией")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }))
    await waitFor(() => expect(mocks.mutations.saveRecipeDraft).toHaveBeenCalledTimes(1))
    expect(mocks.mutations.saveRecipeDraft).toHaveBeenCalledWith(expect.objectContaining({ versionId: undefined, lines: [expect.objectContaining({ coldLossPercent: 20 })] }))
  })

  it("a product without a recipe starts empty", () => {
    mocks.queries.listRecipeVersions = []
    mocks.queries.getRecipe = undefined
    renderCard()
    expect(screen.getByText(/Ингредиентов пока нет/)).toBeTruthy()
    expect(screen.getByText("Версий пока нет. Первая сохранённая техкарта станет черновиком версии 1.")).toBeTruthy()
    expect(within(kpi("Фудкост")).getByText("—")).toBeTruthy()
  })
})
