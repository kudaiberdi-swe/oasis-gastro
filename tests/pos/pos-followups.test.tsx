// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OrderPanel, type OrderTypeOption } from "@/pos/components/order-panel"
import { configurationLabelsKk, modifierLabelKk, modifierLabelsKk, withoutKk, type ConfigurationGroup } from "@/pos/features/catalog/model/modifier-selection"
import { fromServerLine, lineDetailsKk, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { useOrderDraft } from "@/pos/features/order-taking/model/use-order-draft"
import { FloorGrid, isCurrentTable, type FloorData } from "@/pos/features/order-taking/ui/floor-grid"
import { GuestCountControl } from "@/pos/features/order-taking/ui/guest-count-control"
import { cashMovementProblem } from "@/pos/features/shifts/model/cash-operations"
import { ShiftDialog } from "@/pos/features/shifts/ui/shift-dialog"

// POS follow-ups: blind cash for cashiers, «Гостей» on the check, Kazakh modifier lines, hall-aware move.

const backend = vi.hoisted(() => ({ saveDraft: vi.fn() }))

vi.mock("@/pos/features/order-taking/data/use-orders", () => ({ useOrderMutations: () => backend }))
vi.mock("convex/react", () => ({ useQuery: vi.fn(), useMutation: vi.fn(), usePaginatedQuery: vi.fn(() => ({ results: [], status: "Exhausted", loadMore: vi.fn() })), useConvex: vi.fn() }))

afterEach(cleanup)

type Shift = Parameters<typeof ShiftDialog>[0]["shift"]

function shift(cashVisible: boolean): Shift {
  const cash = cashVisible ? { cashSales: 30_000, cashRefunds: 0, grossSales: 45_000, refunds: 0, netSales: 45_000, expectedCash: 50_000 } : { cashSales: null, cashRefunds: null, grossSales: null, refunds: null, netSales: null, expectedCash: null }
  return { _id: "s1", number: 12, openedAt: Date.UTC(2026, 8, 26, 4, 0), openedByName: "Айгерим", openingCash: 20_000, cashVisible, openedOver24h: false, summary: { card: 10_000, qr: 5_000, cashIn: 0, cashOut: 0, paymentCount: 9, ...cash } } as unknown as Shift
}

function renderShift(cashVisible: boolean) {
  render(
    <ShiftDialog
      open
      onOpenChange={() => {}}
      tab="summary"
      onTabChange={() => {}}
      sessionToken="token"
      shift={shift(cashVisible)}
      restaurantName="Sandyq Алматы"
      closePreview={undefined}
      cashOperationTypes={[]}
      onCashMovement={async () => undefined}
      onReconcile={async () => ({ expectedCash: 0, variance: 0, managerThreshold: 1000 })}
      onCloseShift={async () => undefined}
      onPrintX={async () => undefined}
      onPrintZ={async () => undefined}
      onOpenOrderHistory={() => {}}
      onManagerRequired={async () => null}
    />,
  )
}

describe("blind cash for cashiers", () => {
  it("a cashier's «Текущая смена» has no expected cash, revenue or cash sales", () => {
    renderShift(false)
    expect(screen.queryByText("Ожидается в кассе")).toBeNull()
    expect(screen.queryByText("Выручка")).toBeNull()
    expect(screen.queryByText("Наличные")).toBeNull()
    expect(screen.getByText(/Ожидаемую сумму вы увидите при закрытии смены/)).toBeTruthy()
    expect(screen.getByText("Карта")).toBeTruthy()
  })

  it("a manager sees them", () => {
    renderShift(true)
    expect(screen.getByText("Ожидается в кассе")).toBeTruthy()
    expect(screen.getByText("Выручка")).toBeTruthy()
  })

  it("the cash-out limit copy never names the drawer's amount", () => {
    expect(cashMovementProblem({ legacy: true, type: undefined, amount: 70_000, comment: "Инкассация", expectedCash: 60_000, direction: "cash-out" })).toBe("Сумма больше, чем учтено в кассе")
    // A cashier's shift passes no expected cash: the server checks the limit.
    expect(cashMovementProblem({ legacy: true, type: undefined, amount: 70_000, comment: "Инкассация", direction: "cash-out" })).toBeNull()
  })
})

describe("«Гостей» on the check", () => {
  it("shows «—» when unset, steps within 1–30 on 48px targets and saves on «Готово»", () => {
    const onChange = vi.fn()
    render(<GuestCountControl onChange={onChange} />)
    const trigger = screen.getByRole("button", { name: "Гостей: не указано" })
    expect(trigger.textContent).toContain("Гостей: —")
    fireEvent.click(trigger)
    const minus = screen.getByRole("button", { name: "Меньше гостей" }) as HTMLButtonElement
    const plus = screen.getByRole("button", { name: "Больше гостей" })
    expect(minus.disabled).toBe(true) // starts at 1, not at the table's capacity
    expect(plus.className).toContain("size-12")
    fireEvent.click(plus)
    fireEvent.click(plus)
    fireEvent.click(screen.getByRole("button", { name: "Готово" }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it("stops at 30 and does not save an unchanged count", () => {
    const onChange = vi.fn()
    render(<GuestCountControl value={30} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Гостей: 30" }))
    expect((screen.getByRole("button", { name: "Больше гостей" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Готово" }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("the order panel shows the control beside the title for a table check", () => {
    renderPanel({ guestSlot: <GuestCountControl value={4} onChange={() => {}} /> })
    expect(screen.getByRole("button", { name: "Гостей: 4" })).toBeTruthy()
  })
})

describe("useOrderDraft — guests and hall", () => {
  beforeEach(() => {
    backend.saveDraft.mockReset()
    backend.saveDraft.mockImplementation(async (args: { orderId?: string }) => ({ _id: args.orderId ?? "order-n", version: 2, discountPercent: 0, lines: [] }))
  })

  const hydrated = { _id: "order-a" as never, version: 1, tableLabel: "Стол 1", hallLabel: "Терраса", discountPercent: 0, comment: "", lines: [{ productId: "p1" as never, productName: "Плов", unitPrice: 2500, quantity: 1, modifiers: [], product: { nameKk: "Палау" } }] }

  it("exposes the check's hall and guests and saves a new guest count through saveDraft", async () => {
    const { result } = renderHook(() => useOrderDraft({ sessionToken: "s", terminalExternalId: "t1", orderType: "dine-in", hydrated, initialOrderId: "order-a" as never, selectionKey: 1 }))
    expect(result.current.hallLabel).toBe("Терраса")
    expect(result.current.guestCount).toBeUndefined()
    await act(async () => {
      await result.current.setGuestCount(5)
    })
    expect(result.current.guestCount).toBe(5)
    expect(backend.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-a", guestCount: 5, hallLabel: "Терраса", tableLabel: "Стол 1" }))
  })

  it("a new empty check keeps the count for its first save instead of saving an empty order", async () => {
    const { result } = renderHook(() => useOrderDraft({ sessionToken: "s", terminalExternalId: "t1", orderType: "dine-in", hydrated: undefined, initialOrderId: null, initialTableLabel: "Стол 4", initialSeat: { hallLabel: "Основной зал" }, selectionKey: 1 }))
    expect(result.current.hallLabel).toBe("Основной зал")
    await act(async () => {
      await result.current.setGuestCount(2)
    })
    expect(backend.saveDraft).not.toHaveBeenCalled()
    act(() => result.current.addItem({ productId: "p1", name: "Плов", nameKk: "Палау", price: 2500 }))
    await vi.waitFor(() => expect(backend.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ guestCount: 2, hallLabel: "Основной зал", tableLabel: "Стол 4" })))
  })
})

describe("«Перенести на стол» matches hall + label", () => {
  const twoHalls: FloorData = {
    halls: [
      { name: "Основной зал", tables: [{ tableId: "a1", label: "Стол 1", capacity: 4, checks: [] }] },
      { name: "Терраса", tables: [{ tableId: "b1", label: "Стол 1", capacity: 4, checks: [] }] },
    ],
    orphans: [],
    tableCount: 2,
    truncated: false,
  }

  it("marks only the draft's own hall's table and opens on that hall", () => {
    render(<FloorGrid open mode="move" floor={twoHalls} activeOrderId={null} currentTable={{ tableLabel: "Стол 1", hallLabel: "Терраса" }} onOpenChange={() => {}} onOpenTable={() => {}} onSelectCheck={() => {}} onMove={async () => undefined} />)
    const terrace = within(screen.getByRole("tabpanel", { name: "Столы: Терраса" })).getByRole("button", { name: /^Стол 1/ })
    expect(terrace.getAttribute("aria-current")).toBe("true")
    fireEvent.click(screen.getByRole("tab", { name: /Основной зал/ }))
    const main = within(screen.getByRole("tabpanel", { name: "Столы: Основной зал" })).getByRole("button", { name: /^Стол 1/ }) as HTMLButtonElement
    expect(main.getAttribute("aria-current")).toBeNull()
    expect(main.disabled).toBe(false)
  })

  it("a check without a hall still matches by label", () => {
    expect(isCurrentTable({ tableLabel: "Стол 1" }, "Стол 1", "Терраса")).toBe(true)
    expect(isCurrentTable({ tableLabel: "Стол 1", hallLabel: "Основной зал" }, "Стол 1", "Терраса")).toBe(false)
    expect(isCurrentTable({}, "Стол 1", "Терраса")).toBe(false)
  })
})

describe("Kazakh modifier lines", () => {
  it("composes «без …» with the privative suffix by vowel harmony, and «+…» like the Russian", () => {
    expect(withoutKk("Пияз")).toBe("пиязсыз")
    expect(withoutKk("Ірімшік")).toBe("ірімшіксіз")
    expect(withoutKk("Қызыл бұрыш")).toBe("қызыл бұрышсыз")
    expect(modifierLabelKk("Ірімшік", 3, 1)).toBe("+ірімшік ×2")
    expect(modifierLabelKk("Тұздық", 1, 0)).toBe("Тұздық")
    expect(modifierLabelsKk([{ nameKk: "Пияз", quantity: 0, defaultQuantity: 1 }, { nameKk: null, quantity: 1, defaultQuantity: 0 }])).toBeUndefined() // never a mixed line
  })

  const groups: ConfigurationGroup[] = [
    {
      groupExternalId: "g",
      name: "Добавки",
      required: false,
      minQuantity: 0,
      maxQuantity: 5,
      freeQuantity: 0,
      enforceItemLimits: true,
      options: [
        { externalId: "onion", name: "Лук", nameKk: "Пияз", price: 0, minQuantity: 0, maxQuantity: 1, defaultQuantity: 1, freeQuantity: 0, available: true },
        { externalId: "cheese", name: "Сыр", nameKk: "Ірімшік", price: 300, minQuantity: 0, maxQuantity: 3, defaultQuantity: 1, freeQuantity: 0, available: true },
      ],
    },
  ]

  it("the modifier dialog's choice gets its Kazakh labels", () => {
    expect(configurationLabelsKk(groups, { onion: 0, cheese: 2 })).toEqual(["пиязсыз", "+ірімшік"])
    expect(configurationLabelsKk(groups, { onion: 1, cheese: 1 })).toBeUndefined()
  })

  it("a stored line takes them from the names getCheck resolves", () => {
    const stored = fromServerLine({
      _id: "line-1",
      productId: "p1",
      productName: "Бургер",
      unitPrice: 2500,
      quantity: 1,
      modifiers: [],
      kitchenModifiers: [{ externalId: "onion", label: "БЕЗ ЛУК", quantity: 0, defaultQuantity: 1 }],
      modifierNamesKk: [{ externalId: "onion", nameKk: "Пияз" }],
      product: { nameKk: "Бургер" },
    })
    expect(stored.modifierLabels).toEqual(["без лук"])
    expect(stored.modifierLabelsKk).toEqual(["пиязсыз"])
    expect(fromServerLine({ productId: "p1", productName: "Бургер", unitPrice: 2500, quantity: 1, modifiers: [], kitchenModifiers: [{ externalId: "onion", label: "БЕЗ ЛУК", quantity: 0, defaultQuantity: 1 }], product: null }).modifierLabelsKk).toBeUndefined()
  })

  it("the order line shows the Kazakh modifier line under the Russian one, lang=kk", () => {
    renderPanel({ lines: [panelLine({ modifierLabels: ["без лука", "+сыр ×2"], modifierLabelsKk: ["пиязсыз", "+ірімшік ×2"] })] })
    expect(screen.getByText("без лука · +сыр ×2")).toBeTruthy()
    expect(screen.getByText("пиязсыз · +ірімшік ×2").getAttribute("lang")).toBe("kk")
    expect(lineDetailsKk(panelLine({ modifierLabels: ["без лука"] }))).toBeNull()
  })
})

const DINE_IN: OrderTypeOption = { value: "dine-in", label: "В зале", mode: "dine-in" }

function panelLine(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return { clientLineId: "l1", productId: "p1", name: "Бургер", nameKk: "Бургер", unitPrice: 2500, quantity: 1, modifiers: [], modifierLabels: [], ...overrides }
}

function renderPanel(props: Partial<Parameters<typeof OrderPanel>[0]> = {}) {
  return render(
    <OrderPanel
      tableLabel="Стол 7"
      lines={[panelLine()]}
      itemCount={1}
      orderTypeOptions={[DINE_IN]}
      orderTypeValue="dine-in"
      onOrderTypeChange={() => {}}
      subtotal={2500}
      discountPercent={0}
      discountAmount={0}
      serviceChargePercent={15}
      serviceChargeAmount={375}
      total={2875}
      saving={false}
      error={null}
      canSendToKitchen
      onIncrement={() => {}}
      onDecrement={() => {}}
      onRemove={() => {}}
      onVoid={() => {}}
      onSendToKitchen={() => {}}
      onHold={() => {}}
      onCheckout={() => {}}
      onDiscount={() => {}}
      {...props}
    />,
  )
}
