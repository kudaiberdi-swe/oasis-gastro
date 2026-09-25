import { describe, expect, it } from "vitest"

import { serverRef, serverUnit } from "@/office/features/production/data/use-production"
import { checkStock, documentActions, documentTitle, ingredientDemand, PRODUCTION_TYPES, productionChecks, saveWarningsFromState, saveWarningsState, visibleSaveWarnings } from "@/office/features/production/model/production"
import { emptyActDraft, newActLine, toSaveArgs, validateActDraft, type ActDraft } from "@/office/features/production/model/use-act-draft"

// W2-PRD-01…06: pure models of the production / logistics documents (buttons by status and right,
// ingredient demand, line validation and the saveDocument payload). Synthetic data.

const all = () => true
const only = (...rights: string[]) => (capability: string) => rights.includes(capability)

describe("documentActions — buttons by status and right", () => {
  const production = PRODUCTION_TYPES.production
  const internal = PRODUCTION_TYPES["internal-order"]
  const purchase = PRODUCTION_TYPES["purchase-order"]

  it("a production draft: «Провести» is the one primary, «Сохранить» secondary, cancel only once saved", () => {
    expect(documentActions(production, "draft", all, { saved: true })).toEqual({ primary: "post", secondary: ["save"], danger: ["cancel"] })
    expect(documentActions(production, "draft", all, { saved: false })).toEqual({ primary: "post", secondary: ["save"], danger: [] })
  })

  it("without the post right «Сохранить» becomes the primary; without edit nothing is left", () => {
    expect(documentActions(production, "draft", only("office.production.edit"), { saved: true })).toEqual({ primary: "save", secondary: [], danger: [] })
    expect(documentActions(production, "draft", only("office.production.view"), { saved: true })).toEqual({ primary: null, secondary: [], danger: [] })
  })

  it("a posted act offers only «Сторнировать», and only with the reverse right", () => {
    expect(documentActions(production, "posted", all, { saved: true })).toEqual({ primary: null, secondary: [], danger: ["reverse"] })
    expect(documentActions(production, "posted", only("office.production.post"), { saved: true }).danger).toEqual([])
  })

  it("an internal order goes draft → submit → approve → post", () => {
    expect(documentActions(internal, "draft", all, { saved: true }).primary).toBe("submit")
    expect(documentActions(internal, "pending-approval", all, { saved: true })).toEqual({ primary: "approve", secondary: [], danger: ["cancel"] })
    expect(documentActions(internal, "pending-approval", only("office.internal-orders.edit"), { saved: true }).primary).toBeNull()
    expect(documentActions(internal, "approved", all, { saved: true }).primary).toBe("post")
  })

  it("an approved purchase order creates the receipt (receipts.edit), then only opens it", () => {
    expect(documentActions(purchase, "approved", all, { saved: true })).toEqual({ primary: "create-receipt", secondary: [], danger: ["cancel"] })
    expect(documentActions(purchase, "approved", only("office.purchase-orders.view"), { saved: true }).primary).toBeNull()
    expect(documentActions(purchase, "approved", all, { saved: true, receiptExternalId: "receipt-1" })).toEqual({ primary: "open-receipt", secondary: [], danger: [] })
    expect(documentActions(purchase, "completed", all, { saved: true, receiptExternalId: "receipt-1" }).secondary).toEqual(["open-receipt"])
    // A purchase order is never posted or reversed by itself.
    expect(documentActions(purchase, "posted", all, { saved: true }).danger).toEqual([])
  })
})

describe("ingredientDemand and checkStock (the «Ингредиенты к списанию» preview)", () => {
  const recipes = {
    sauce: { batchYield: 2, lines: [{ name: "Айран", unit: "л", quantity: 1.6, inventoryItemExternalId: "ayran", componentProductExternalId: null }, { name: "Укроп", unit: "кг", quantity: 0.1, inventoryItemExternalId: "dill", componentProductExternalId: null }] },
    dough: { batchYield: 1, lines: [{ name: "Айран", unit: "л", quantity: 0.2, inventoryItemExternalId: "ayran", componentProductExternalId: null }] },
  }

  it("recipe line × quantity / batch yield, summed per item and rounded to grams", () => {
    const demand = ingredientDemand(
      [
        { productExternalId: "sauce", quantity: 3 },
        { productExternalId: "dough", quantity: 2 },
        { productExternalId: "unknown", quantity: 5 },
        { productExternalId: "sauce", quantity: null },
      ],
      recipes,
    )
    expect(demand.map((row) => [row.name, row.quantity])).toEqual([
      ["Айран", 2.8],
      ["Укроп", 0.15],
    ])
  })

  it("marks a shortage against the source balances; unknown balances stay unknown", () => {
    const demand = ingredientDemand([{ productExternalId: "sauce", quantity: 2 }], recipes)
    const rows = checkStock(demand, new Map([["ayran", 1]]))
    expect(rows.find((row) => row.name === "Айран")).toMatchObject({ onHand: 1, short: true })
    expect(rows.find((row) => row.name === "Укроп")).toMatchObject({ onHand: 0, short: true })
    expect(checkStock(demand, null).every((row) => row.onHand === null && !row.short)).toBe(true)
  })
})

describe("productionChecks («Проверка проведения»)", () => {
  it("a preparation written off by ingredients blocks the act (double write-off)", () => {
    const checks = productionChecks({
      headerValid: true,
      lines: [{ ref: "sauce", name: "Соус айран", quantity: 2 }],
      stock: [],
      sourceName: "Основной склад",
      destinationName: "Кухня",
      sameWarehouse: false,
      methods: new Map([["sauce", "ingredients"]]),
    })
    const method = checks.find((check) => check.key === "method")!
    expect(method.tone).toBe("error")
    expect(method.detail).toContain("«Соус айран»")
    expect(checks.find((check) => check.key === "transfer")!.detail).toBe("Ингредиенты со склада «Основной склад», заготовка — на «Кухня»")
  })
})

describe("act draft: validation and the saveDocument payload", () => {
  const draft = (patch: Partial<ActDraft>): ActDraft => ({ ...emptyActDraft("r1", Date.parse("2026-09-24T05:00:00Z")), ...patch })

  it("production: preparations by productExternalId, concept kept, no client prices", () => {
    const line = { ...newActLine({ ref: "sauce", name: "Соус айран", unit: "кг" }, "output"), quantity: "2,5" }
    const value = draft({ sourceWarehouseExternalId: "wh-main", destinationWarehouseExternalId: "wh-kitchen", concept: " Горячий цех ", lines: [line] })
    const errors = validateActDraft(PRODUCTION_TYPES.production, value)
    expect(errors).toEqual({ header: {}, lines: {} })
    expect(toSaveArgs(PRODUCTION_TYPES.production, value, "production-1")).toEqual({
      externalId: "production-1",
      type: "production",
      restaurantExternalId: "r1",
      date: Date.parse("2026-09-24T05:00:00Z"),
      sourceWarehouseExternalId: "wh-main",
      destinationWarehouseExternalId: "wh-kitchen",
      concept: "Горячий цех",
      comment: "",
      lines: [{ productExternalId: "sauce", quantity: 2.5 }],
    })
  })

  it("processing needs inputs and outputs; costShare only on outputs", () => {
    const config = PRODUCTION_TYPES.processing
    const input = { ...newActLine({ ref: "carrot", name: "Морковь", unit: "кг" }, "input"), quantity: "10" }
    const output = { ...newActLine({ ref: "carrot-clean", name: "Морковь очищенная", unit: "кг" }, "output"), quantity: "8", costShare: "0" }
    expect(validateActDraft(config, draft({ sourceWarehouseExternalId: "a", destinationWarehouseExternalId: "b", lines: [input] })).header.lines).toBe("Нужны строки входа и выхода")
    const bad = validateActDraft(config, draft({ sourceWarehouseExternalId: "a", destinationWarehouseExternalId: "b", lines: [input, output] }))
    expect(bad.lines[output.key]).toBe("Доля себестоимости больше нуля")
    const ok = { ...output, costShare: "0,8" }
    expect(toSaveArgs(config, draft({ sourceWarehouseExternalId: "a", destinationWarehouseExternalId: "b", lines: [input, ok] })).lines).toEqual([
      { inventoryItemExternalId: "carrot", quantity: 10, direction: "input" },
      { inventoryItemExternalId: "carrot-clean", quantity: 8, direction: "output", costShare: 0.8 },
    ])
  })

  it("purchase order: supplier required, expected date at Almaty midnight, expected unit cost sent", () => {
    const config = PRODUCTION_TYPES["purchase-order"]
    const line = { ...newActLine({ ref: "milk", name: "Молоко", unit: "л" }, "output"), quantity: "20", expectedUnitCost: "450,5" }
    expect(validateActDraft(config, draft({ destinationWarehouseExternalId: "wh-main", lines: [line] })).header.supplier).toBe("Выберите поставщика")
    const args = toSaveArgs(config, draft({ destinationWarehouseExternalId: "wh-main", supplierExternalId: "sup-milk", expectedDate: "2026-09-26", lines: [line] }))
    expect(args).toMatchObject({ supplierExternalId: "sup-milk", destinationWarehouseExternalId: "wh-main", expectedDate: Date.parse("2026-09-25T19:00:00Z"), lines: [{ inventoryItemExternalId: "milk", quantity: 20, expectedUnitCost: 450.5 }] })
    expect(args).not.toHaveProperty("sourceWarehouseExternalId")
  })

  it("an internal order can't move to the same warehouse; an unmatched saved line must be re-added", () => {
    const config = PRODUCTION_TYPES["internal-order"]
    const lost = { ...newActLine({ ref: "", name: "Мука", unit: null }), quantity: "1" }
    const errors = validateActDraft(config, draft({ sourceWarehouseExternalId: "a", destinationWarehouseExternalId: "a", lines: [lost] }))
    expect(errors.header.destination).toBe("Склады источника и назначения совпадают")
    expect(errors.lines[lost.key]).toContain("не распознана")
  })

  it("the register title is the first comment line, else the first positions", () => {
    expect(documentTitle({ comment: "Переработка овощей\nна неделю", lines: [] })).toBe("Переработка овощей")
    expect(documentTitle({ comment: "", lines: [{ name: "Морковь" }, { name: "Лук" }, { name: "Свёкла" }] })).toBe("Морковь, Лук и ещё 1")
  })
})

describe("saveDocument warnings and saved-line refs", () => {
  const warning = "Минимальный заказ поставщика — 50000 ₸"

  it("warnings round-trip through the navigation state; anything else reads as none", () => {
    expect(saveWarningsFromState(saveWarningsState([warning]))).toEqual([warning])
    expect(saveWarningsState([])).toBeNull()
    expect(saveWarningsFromState(null)).toEqual([])
    expect(saveWarningsFromState({ saveWarnings: "x" })).toEqual([])
    expect(saveWarningsFromState({ saveWarnings: [warning, 5] })).toEqual([warning])
  })

  it("warnings stay visible after «Отправить на согласование», not on a closed order", () => {
    expect(visibleSaveWarnings("draft", [warning])).toEqual([warning])
    expect(visibleSaveWarnings("pending-approval", [warning])).toEqual([warning])
    expect(visibleSaveWarnings("approved", [warning])).toEqual([warning])
    expect(visibleSaveWarnings("completed", [warning])).toEqual([])
    expect(visibleSaveWarnings("cancelled", [warning])).toEqual([])
  })

  it("a saved line takes its external id and «Ед.» from getDocument", () => {
    expect(serverRef({ productExternalId: null, inventoryItemExternalId: "milk", unit: "л" })).toBe("milk")
    expect(serverRef({ productExternalId: "sauce", inventoryItemExternalId: null, unit: "кг" })).toBe("sauce")
    expect(serverRef({})).toBeNull()
    expect(serverUnit({ unit: "л" })).toBe("л")
    expect(serverUnit({ unit: null })).toBeNull()
  })
})
