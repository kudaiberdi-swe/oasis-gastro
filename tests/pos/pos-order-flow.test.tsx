// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  changeQuantity,
  chooseSingle,
  defaultQuantities,
  modifierLabels,
  modifiersPrice,
  selectionProblems,
  toModifierSelections,
  unitPrice,
  type ConfigurationGroup,
  type ProductConfiguration,
} from "@/pos/features/catalog/model/modifier-selection"
import { ModifierDialog } from "@/pos/features/catalog/ui/modifier-dialog"
import { addPart, initialSplit, paymentOptions, paymentProblem, refundTarget, setPartAmount, toCheckoutPayments, type PaymentPart } from "@/pos/features/checkout/model/payment-parts"
import { PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import { addCatalogItem, mergeServerLines, setLineQuantity, toDraftLineInputs, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { useOrderDraft } from "@/pos/features/order-taking/model/use-order-draft"
import { VoidLineDialog } from "@/pos/features/order-taking/ui/void-line-dialog"
import type { PosDeletionReason, PosOrderType, PosPaymentType } from "@/pos/features/retail/data/use-retail-settings"
import { orderTypeOptions } from "@/pos/features/order-taking/ui/pos-workspace"

// W1-POS-12 (modifiers), W1-POS-13 (draft lines, «На кухню»), W1-POS-15 (void line), W1-POS-17 (payment).

const backend = vi.hoisted(() => ({ saveDraft: vi.fn(), sendToKitchen: vi.fn(), voidLine: vi.fn(), configuration: undefined as unknown }))

vi.mock("@/pos/features/order-taking/data/use-orders", () => ({ useOrderMutations: () => backend }))
vi.mock("@/pos/features/catalog/data/use-catalog", () => ({ useProductConfiguration: () => backend.configuration }))
// pos-workspace imports the kitchen board and loyalty hooks; the helpers under test do not need them.
vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useAction: () => vi.fn(), usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }) }))

afterEach(cleanup)

const ADDONS: ConfigurationGroup = {
  groupExternalId: "addons",
  name: "Добавки",
  required: false,
  minQuantity: 0,
  maxQuantity: 4,
  freeQuantity: 1,
  enforceItemLimits: true,
  options: [
    { externalId: "cheese", name: "Сыр гауда", price: 250, minQuantity: 0, maxQuantity: 3, defaultQuantity: 0, freeQuantity: 0, available: true },
    { externalId: "onion", name: "Лук", price: 100, minQuantity: 0, maxQuantity: 2, defaultQuantity: 1, freeQuantity: 1, available: true },
  ],
}

const SAUCE: ConfigurationGroup = {
  groupExternalId: "sauce",
  name: "Соус",
  required: true,
  minQuantity: 1,
  maxQuantity: 1,
  freeQuantity: 0,
  enforceItemLimits: false,
  options: [
    { externalId: "garlic", name: "Чесночный", price: 0, minQuantity: 0, maxQuantity: 1, defaultQuantity: 0, freeQuantity: 0, available: true },
    { externalId: "spicy", name: "Острый", price: 200, minQuantity: 0, maxQuantity: 1, defaultQuantity: 0, freeQuantity: 0, available: true },
  ],
}

const CONFIGURATION: ProductConfiguration = {
  product: { externalId: "burger", name: "Бургер", nameKk: "Бургер", imageUrl: null, price: 2000, available: true },
  sizes: [
    { externalId: "std", label: "Стандарт", labelKk: null, price: 2000, isDefault: true, available: true },
    { externalId: "big", label: "Большой", labelKk: null, price: 2600, isDefault: false, available: true },
  ],
  groups: [ADDONS, SAUCE],
}

describe("modifier selection model (W1-POS-12)", () => {
  it("prices free portions from the option first, then the group pool, like the server", () => {
    let quantities = defaultQuantities([ADDONS])
    expect(modifiersPrice([ADDONS], quantities)).toBe(0) // default onion is free by its own rule
    quantities = changeQuantity(ADDONS, ADDONS.options[0], quantities, 1)
    expect(modifiersPrice([ADDONS], quantities)).toBe(0) // first cheese from the group pool
    quantities = changeQuantity(ADDONS, ADDONS.options[0], quantities, 1)
    expect(modifiersPrice([ADDONS], quantities)).toBe(250)
  })

  it("stops at the option and group maximum", () => {
    let quantities = defaultQuantities([ADDONS])
    for (let i = 0; i < 5; i += 1) quantities = changeQuantity(ADDONS, ADDONS.options[0], quantities, 1)
    expect(quantities.cheese).toBe(3) // option max 3 (group: 3 + 1 onion = 4)
    const more = changeQuantity(ADDONS, ADDONS.options[1], quantities, 1)
    expect(more.onion).toBe(1) // group max 4 reached
  })

  it("a size changes the price and a required group blocks adding until chosen", () => {
    const quantities = defaultQuantities(CONFIGURATION.groups)
    expect(unitPrice(CONFIGURATION, "std", quantities)).toBe(2000)
    expect(unitPrice(CONFIGURATION, "big", quantities)).toBe(2600)
    expect(selectionProblems(CONFIGURATION, "big", quantities)).toEqual({ sauce: "Выберите вариант" })
    const chosen = chooseSingle(SAUCE, SAUCE.options[1], quantities)
    expect(selectionProblems(CONFIGURATION, "big", chosen)).toEqual({})
    expect(unitPrice(CONFIGURATION, "big", chosen)).toBe(2800)
  })

  it("sends chosen options and removed defaults, labels only the changes", () => {
    let quantities = defaultQuantities(CONFIGURATION.groups)
    quantities = changeQuantity(ADDONS, ADDONS.options[1], quantities, -1) // без лука
    quantities = changeQuantity(ADDONS, ADDONS.options[0], quantities, 1)
    quantities = chooseSingle(SAUCE, SAUCE.options[0], quantities)
    expect(toModifierSelections(CONFIGURATION.groups, quantities)).toEqual([
      { modifierExternalId: "cheese", quantity: 1 },
      { modifierExternalId: "onion", quantity: 0 },
      { modifierExternalId: "garlic", quantity: 1 },
    ])
    expect(modifierLabels(CONFIGURATION.groups, quantities)).toEqual(["Сыр гауда", "без лук", "Чесночный"])
  })
})

describe("modifier dialog (W1-POS-12)", () => {
  it("cannot add a dish with a required group until it is chosen, then adds with the size and selections", () => {
    backend.configuration = CONFIGURATION
    const onAdd = vi.fn()
    render(<ModifierDialog sessionToken="s" product={{ productId: "p1", externalId: "burger", name: "Бургер", nameKk: "Бургер", price: 2000 }} onOpenChange={() => {}} onAdd={onAdd} />)

    fireEvent.click(screen.getByRole("button", { name: /Добавить в заказ/ }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/обязательные/)

    fireEvent.click(screen.getByRole("radio", { name: /Большой/ }))
    fireEvent.click(screen.getByRole("radio", { name: /Острый/ }))
    fireEvent.click(screen.getByRole("button", { name: "Больше: Количество порций" }))
    expect(screen.getByRole("button", { name: /Добавить в заказ/ }).textContent).toMatch(/5 600/)
    fireEvent.click(screen.getByRole("button", { name: /Добавить в заказ/ }))
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "p1", quantity: 2, price: 2800, sizeExternalId: "big", sizeLabel: "Большой", modifierSelections: [{ modifierExternalId: "onion", quantity: 1 }, { modifierExternalId: "spicy", quantity: 1 }] }),
    )
  })
})

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return { clientLineId: "l1", productId: "p1", name: "Плов", nameKk: "Палау", unitPrice: 2500, quantity: 1, modifiers: [], modifierLabels: [], ...overrides }
}

describe("draft lines (W1-POS-13/15)", () => {
  it("merges the same configuration into an editable line only", () => {
    const sent = line({ sentToKitchenAt: 1 })
    const added = addCatalogItem([sent], { productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }, () => "l2")
    expect(added.map((row) => [row.clientLineId, row.quantity])).toEqual([["l1", 1], ["l2", 1]])
    const again = addCatalogItem(added, { productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 })
    expect(again.map((row) => row.quantity)).toEqual([1, 2])
    const sized = addCatalogItem(again, { productId: "p1", name: "Плов", nameKk: "Палау", price: 3000, sizeExternalId: "big" }, () => "l3")
    expect(sized).toHaveLength(3)
  })

  it("never changes a sent or voided line, never resends a voided one, repeats a sent one", () => {
    const lines = [line({ sentToKitchenAt: 1, serverLineId: "srv1" }), line({ clientLineId: "l2", voidedAt: 2 }), line({ clientLineId: "l3", sizeExternalId: "big", modifierSelections: [{ modifierExternalId: "m", quantity: 1 }] })]
    expect(setLineQuantity(lines, "l1", 0)).toBe(lines)
    expect(setLineQuantity(lines, "l2", 3)).toBe(lines)
    expect(toDraftLineInputs(lines)).toEqual([
      { clientLineId: "l1", productId: "p1", quantity: 1, modifiers: [] },
      { clientLineId: "l3", productId: "p1", quantity: 1, modifiers: [], sizeExternalId: "big", modifierSelections: [{ modifierExternalId: "m", quantity: 1 }] },
    ])
  })

  it("takes the server's price and kitchen/void marks by clientLineId, keeping local quantity", () => {
    const local = [line({ quantity: 3 }), line({ clientLineId: "l2" })]
    const merged = mergeServerLines(local, [
      { _id: "a", clientLineId: "l1", productId: "p1", productName: "Плов", unitPrice: 2400, quantity: 2, modifiers: [], lineTotal: 4800, product: { nameKk: "Палау" } },
      {
        _id: "b",
        clientLineId: "l2",
        productId: "p1",
        productName: "Плов",
        unitPrice: 2000,
        quantity: 1,
        modifiers: [],
        modifierSelections: [{ externalId: "cheese", name: "Сыр", quantity: 2, unitPrice: 125 }],
        kitchenModifiers: [{ externalId: "cheese", label: "+СЫР ×2", quantity: 2, defaultQuantity: 0 }],
        sentToKitchenAt: 5,
        product: { nameKk: "Палау" },
      },
    ])
    expect(merged[0]).toMatchObject({ quantity: 3, unitPrice: 2400, serverLineId: "a" })
    expect(merged[1]).toMatchObject({ unitPrice: 2250, sentToKitchenAt: 5, serverLineId: "b", modifierLabels: ["Сыр ×2"] })
  })
})

const ORDER_TYPES = [
  { externalId: "ot-hall", code: "dine-in", name: "В зале", receiptName: "В зале", version: 1, data: { kind: "order-type", serviceMode: "dine-in", promptStage: "start", isDefault: true, serviceChargePercent: 10 } },
  { externalId: "ot-away", code: "takeaway", name: "С собой", receiptName: "С собой", version: 1, data: { kind: "order-type", serviceMode: "takeaway", promptStage: "start", isDefault: false, serviceChargePercent: 0 } },
] as PosOrderType[]

function serverOrder(overrides: Record<string, unknown> = {}) {
  return { _id: "order-1", number: 12, version: 1, orderType: "dine-in", serviceChargePercent: 10, subtotal: 2500, discountAmount: 0, serviceChargeAmount: 250, total: 2750, discountPercent: 0, lines: [], ...overrides }
}

describe("useOrderDraft with the new backend (W1-POS-13)", () => {
  beforeEach(() => {
    backend.saveDraft.mockReset()
    backend.sendToKitchen.mockReset()
    backend.voidLine.mockReset()
  })

  function renderDraft(orderTypes: PosOrderType[]) {
    return renderHook(() => useOrderDraft({ sessionToken: "s", terminalExternalId: "t", orderType: "dine-in", orderTypes, hydrated: undefined, initialOrderId: null, selectionKey: 1 }))
  }

  it("sends orderTypeExternalId from the directory, the legacy orderType when it is empty", async () => {
    backend.saveDraft.mockResolvedValue(serverOrder())
    const withTypes = renderDraft(ORDER_TYPES)
    await act(async () => withTypes.result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    expect(backend.saveDraft.mock.calls[0][0]).toMatchObject({ orderTypeExternalId: "ot-hall" })
    expect(backend.saveDraft.mock.calls[0][0]).not.toHaveProperty("orderType")
    expect(withTypes.result.current.serviceChargePercent).toBe(10)

    const legacy = renderDraft([])
    await act(async () => legacy.result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    expect(backend.saveDraft.mock.calls[1][0]).toMatchObject({ orderType: "dine-in" })
    expect(backend.saveDraft.mock.calls[1][0]).not.toHaveProperty("orderTypeExternalId")
  })

  it("«На кухню» marks the lines and its version is what the next save expects", async () => {
    const { result } = renderDraft([])
    backend.saveDraft.mockImplementation(async (input: { lines: Array<{ clientLineId: string }> }) =>
      serverOrder({ version: 2, lines: input.lines.map((row) => ({ _id: `srv-${row.clientLineId}`, clientLineId: row.clientLineId, productId: "p1", productName: "Плов", unitPrice: 2500, quantity: 1, modifiers: [], product: null })) }),
    )
    await act(async () => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    const clientLineId = result.current.lines[0].clientLineId
    expect(result.current.hasUnsentLines).toBe(true)

    backend.sendToKitchen.mockResolvedValue({
      ticketId: "ticket",
      version: 3,
      order: serverOrder({ version: 3, lines: [{ _id: "srv-1", clientLineId, productId: "p1", productName: "Плов", unitPrice: 2500, quantity: 1, modifiers: [], sentToKitchenAt: 99, product: null }] }),
    })
    await act(async () => {
      await result.current.sendToKitchen()
    })
    expect(backend.sendToKitchen).toHaveBeenCalledWith({ sessionToken: "s", orderId: "order-1", expectedVersion: 2 })
    expect(result.current.lines[0].sentToKitchenAt).toBe(99)
    expect(result.current.hasUnsentLines).toBe(false)

    // The sent line cannot be decreased; adding another portion makes a new line saved with version 3.
    act(() => result.current.setQuantity(clientLineId, 0))
    expect(result.current.lines).toHaveLength(1)
    expect(result.current.error).toMatch(/Удалить позицию/)
    await act(async () => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    const last = backend.saveDraft.mock.calls.at(-1)![0]
    expect(last.expectedVersion).toBe(3)
    expect(last.lines).toHaveLength(2)
    expect(last.lines[0]).toMatchObject({ clientLineId, quantity: 1 })
  })

  it("voids a sent line by its server id and never resends it", async () => {
    const { result } = renderDraft([])
    backend.saveDraft.mockImplementation(async (input: { lines: Array<{ clientLineId: string }> }) =>
      serverOrder({ version: 2, lines: input.lines.map((row) => ({ _id: "srv-1", clientLineId: row.clientLineId, productId: "p1", productName: "Плов", unitPrice: 2500, quantity: 1, modifiers: [], sentToKitchenAt: 5, product: null })) }),
    )
    await act(async () => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    const clientLineId = result.current.lines[0].clientLineId
    backend.voidLine.mockResolvedValue({ version: 4, order: serverOrder({ version: 4, total: 0, lines: [{ _id: "srv-1", clientLineId, productId: "p1", productName: "Плов", unitPrice: 2500, quantity: 1, modifiers: [], sentToKitchenAt: 5, voidedAt: 6, product: null }] }) })
    await act(async () => {
      await result.current.voidLine(clientLineId, { deletionReasonExternalId: "reason", comment: "гость ушёл", managerApprovalToken: "m" })
    })
    expect(backend.voidLine).toHaveBeenCalledWith({ sessionToken: "s", orderId: "order-1", orderLineId: "srv-1", expectedVersion: 2, deletionReasonExternalId: "reason", comment: "гость ушёл", managerApprovalToken: "m" })
    expect(result.current.lines[0].voidedAt).toBe(6)
    expect(result.current.itemCount).toBe(0)

    backend.saveDraft.mockResolvedValue(serverOrder({ version: 5 }))
    await act(async () => result.current.addItem({ productId: "p2", name: "Шай", nameKk: "Шай", price: 500 }))
    const last = backend.saveDraft.mock.calls.at(-1)![0]
    expect(last.expectedVersion).toBe(4)
    expect(last.lines.map((row: { productId: string }) => row.productId)).toEqual(["p2"])
  })

  it("runs saves one after another so the second uses the first answer's version", async () => {
    const { result } = renderDraft([])
    let release: () => void = () => {}
    backend.saveDraft.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(serverOrder({ version: 7 })))))
    backend.saveDraft.mockResolvedValue(serverOrder({ version: 8 }))
    act(() => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    act(() => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    await waitFor(() => expect(backend.saveDraft).toHaveBeenCalledTimes(1))
    await act(async () => await Promise.resolve())
    expect(backend.saveDraft).toHaveBeenCalledTimes(1)
    await act(async () => release())
    await waitFor(() => expect(backend.saveDraft).toHaveBeenCalledTimes(2))
    expect(backend.saveDraft.mock.calls[1][0]).toMatchObject({ orderId: "order-1", expectedVersion: 7 })
  })
})

describe("order type switch (W1-POS-13)", () => {
  it("is built from the directory, or the three legacy modes", () => {
    expect(orderTypeOptions(ORDER_TYPES).map((option) => option.value)).toEqual(["ot-hall", "ot-away"])
    expect(orderTypeOptions([]).map((option) => option.label)).toEqual(["В зале", "С собой", "Доставка"])
  })
})

const REASONS = [
  { externalId: "r-refused", code: "guest-refused", name: "Отказ гостя", receiptName: "Отказ гостя", version: 1, data: { kind: "deletion-reason", writeOff: false, requireComment: false, requireManager: false } },
  { externalId: "r-error", code: "cashier-error", name: "Ошибка кассира", receiptName: "Ошибка кассира", version: 1, data: { kind: "deletion-reason", writeOff: false, requireComment: true, requireManager: false } },
] as PosDeletionReason[]

describe("void line dialog (W1-POS-15)", () => {
  it("requires the comment when the reason says so", async () => {
    const onVoid = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "token")
    render(<VoidLineDialog line={line({ serverLineId: "srv" })} reasons={REASONS} onOpenChange={() => {}} onVoid={onVoid} onManagerRequired={onManagerRequired} />)
    fireEvent.click(screen.getByRole("radio", { name: /Ошибка кассира/ }))
    const submit = screen.getByRole("button", { name: "Удалить позицию" })
    expect(submit).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText(/Комментарий/), { target: { value: "пробил дважды" } })
    fireEvent.click(submit)
    await waitFor(() => expect(onVoid).toHaveBeenCalledWith({ deletionReasonExternalId: "r-error", comment: "пробил дважды", managerApprovalToken: undefined }))
    expect(onManagerRequired).not.toHaveBeenCalled()
  })

  it("asks the manager PIN for a line already on the kitchen", async () => {
    const onVoid = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "manager-token")
    render(<VoidLineDialog line={line({ serverLineId: "srv", sentToKitchenAt: 1 })} reasons={REASONS} onOpenChange={() => {}} onVoid={onVoid} onManagerRequired={onManagerRequired} />)
    fireEvent.click(screen.getByRole("radio", { name: /Отказ гостя/ }))
    fireEvent.click(screen.getByRole("button", { name: "Удалить позицию" }))
    await waitFor(() => expect(onVoid).toHaveBeenCalledWith({ deletionReasonExternalId: "r-refused", comment: undefined, managerApprovalToken: "manager-token" }))
    expect(onManagerRequired).toHaveBeenCalledTimes(1)
  })
})

const PAYMENT_TYPES = [
  { externalId: "pt-cash", code: "cash", name: "Наличные", receiptName: "Наличные", version: 1, data: { kind: "payment-type", processorKind: "cash", account: "cash", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: true, allowsChange: true, opensCashDrawer: true } },
  { externalId: "pt-card", code: "card", name: "Банковская карта", receiptName: "Банковская карта", version: 1, data: { kind: "payment-type", processorKind: "card", account: "inTransit", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
  { externalId: "pt-qr", code: "kaspi-qr", name: "Kaspi QR", receiptName: "Kaspi QR", version: 1, data: { kind: "payment-type", processorKind: "qr", account: "inTransit", fiscal: true, revenue: true, manualEntry: true, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
  { externalId: "pt-cert", code: "certificate", name: "Сертификат", receiptName: "Сертификат", version: 1, data: { kind: "payment-type", processorKind: "card", account: "inTransit", fiscal: false, revenue: true, manualEntry: true, externalAcceptance: false, combinable: false, allowsChange: false, opensCashDrawer: false } },
] as PosPaymentType[]

describe("payment parts (W1-POS-17)", () => {
  const options = paymentOptions(PAYMENT_TYPES)

  it("splits into three parts with a live remainder and pays by payment type", () => {
    let parts: PaymentPart[] = initialSplit(options, 9000)
    expect(parts.map((part) => [part.optionKey, part.amount])).toEqual([["pt-cash", null], ["pt-card", 9000]])
    parts = setPartAmount(parts, parts[0].id, 5000, 9000)
    expect(parts.map((part) => part.amount)).toEqual([5000, 4000])
    parts = setPartAmount(parts, parts[1].id, 3000, 9000)
    parts = addPart(parts, options, 9000)
    expect(parts.map((part) => [part.optionKey, part.amount])).toEqual([["pt-cash", 6000], ["pt-card", 3000], ["pt-qr", null]])
    parts = setPartAmount(parts, parts[0].id, 4000, 9000)
    expect(paymentProblem(parts, options, 9000)).toMatch(/Укажите сумму/)
    parts = setPartAmount(parts, parts[2].id, 2000, 9000)
    expect(paymentProblem(parts, options, 9000)).toBeNull()
    parts = parts.map((part, index) => (index === 0 ? { ...part, tendered: 5000 } : part))
    expect(toCheckoutPayments(parts, options)).toEqual([
      { paymentTypeExternalId: "pt-cash", amount: 4000, tendered: 5000 },
      { paymentTypeExternalId: "pt-card", amount: 3000 },
      { paymentTypeExternalId: "pt-qr", amount: 2000 },
    ])
  })

  it("rejects a non-combinable type in a split and falls back to methods when the directory is empty", () => {
    const parts: PaymentPart[] = [
      { id: "a", optionKey: "pt-cert", amount: 1000 },
      { id: "b", optionKey: "pt-card", amount: 1000 },
    ]
    expect(paymentProblem(parts, options, 2000)).toMatch(/«Сертификат» нельзя сочетать/)
    const legacy = paymentOptions([])
    expect(toCheckoutPayments([{ id: "x", optionKey: "method:card", amount: 2000 }], legacy)).toEqual([{ method: "card", amount: 2000 }])
    expect(refundTarget({ paymentTypeExternalId: "pt-qr", method: "qr" })).toEqual({ paymentTypeExternalId: "pt-qr" })
    expect(refundTarget({ method: "cash" })).toEqual({ method: "cash" })
  })
})

describe("payment dialog from the directory (W1-POS-17)", () => {
  it("gives change only on a change-allowing type and submits the payment type id", () => {
    const onSubmit = vi.fn()
    render(<PaymentDialog open onOpenChange={() => {}} total={1650} orderNumber={100004} itemCount={1} paymentTypes={PAYMENT_TYPES} submitting={false} error={null} onSubmit={onSubmit} />)
    expect(screen.getByText("Заказ №100004")).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: /Наличные/ }))
    fireEvent.click(screen.getByRole("button", { name: /^5\s000/ }))
    expect(screen.getAllByText(/3\s350/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/ }))
    expect(onSubmit).toHaveBeenLastCalledWith([{ paymentTypeExternalId: "pt-cash", amount: 1650, tendered: 5000 }])

    fireEvent.click(screen.getByRole("radio", { name: /Kaspi QR/ }))
    expect(screen.getByText("Учёт оплаты через Kaspi QR")).toBeTruthy()
    expect(screen.queryByLabelText("Полученная сумма")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/ }))
    expect(onSubmit).toHaveBeenLastCalledWith([{ paymentTypeExternalId: "pt-qr", amount: 1650 }])
  })

  it("keeps a non-combinable type out of the mixed payment", () => {
    render(<PaymentDialog open onOpenChange={() => {}} total={3000} paymentTypes={PAYMENT_TYPES} submitting={false} error={null} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole("radio", { name: /Смешанная оплата/ }))
    expect(screen.getByText(/Только отдельно: Сертификат/)).toBeTruthy()
    const first = screen.getAllByRole("listitem")[0]
    expect(within(first).getByRole("combobox").textContent).toMatch(/Наличные/)
  })
})
