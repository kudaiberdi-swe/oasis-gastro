// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildOrderReceiptHtml, precheckFromDraft } from "@/pos/features/checkout/model/order-receipt"
import { receiptFromOrder } from "@/pos/features/history/model/history-receipt"
import { linesRefundAmount, refundProblem, refundWays, type HistoryPayment } from "@/pos/features/history/model/refund"
import { RefundPanel } from "@/pos/features/history/ui/refund-panel"
import { NotificationsDialog, opensShift } from "@/pos/features/notifications/ui/notifications-dialog"
import type { OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { useOrderDraft } from "@/pos/features/order-taking/model/use-order-draft"
import { CancelOrderDialog, cancelProblem } from "@/pos/features/order-taking/ui/cancel-dialog"
import { OrderActionsDialog } from "@/pos/features/order-taking/ui/order-actions-dialog"
import { orderActionBlocks } from "@/pos/features/order-taking/ui/pos-workspace"
import { SplitDialog, splitProblem } from "@/pos/features/order-taking/ui/split-dialog"
import { FloorGrid } from "@/pos/features/order-taking/ui/floor-grid"
import type { PosCashOperationType, PosDeletionReason } from "@/pos/features/retail/data/use-retail-settings"
import { MainMenuDialog } from "@/pos/features/session/ui/main-menu-dialog"
import { ProfileDialog } from "@/pos/features/session/ui/profile-dialog"
import { cashMovementProblem, cashNeedsManager, toCashMovement } from "@/pos/features/shifts/model/cash-operations"
import { buildXReportHtml, type ShiftReportSnapshot, type XReportData } from "@/pos/features/shifts/model/x-report"
import { buildZReportHtml } from "@/pos/features/shifts/model/z-report"
import { CashMovementForm } from "@/pos/features/shifts/ui/shift-dialog"
import { AppHeader } from "@/pos/components/app-header"
import { ThemeProvider } from "@/shared/components/theme-provider"
import { formatTenge } from "@/shared/lib/format"

// W1-POS-14 (menu, profile, notifications), W1-POS-15 (order actions), W1-POS-18 (history, refund),
// W1-POS-19 (shift: cash operations, X/Z print).

const backend = vi.hoisted(() => ({ saveDraft: vi.fn(), moveToTable: vi.fn(), split: vi.fn(), cancel: vi.fn() }))

vi.mock("@/pos/features/order-taking/data/use-orders", () => ({ useOrderMutations: () => backend }))
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}))

afterEach(cleanup)

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return { clientLineId: "l1", productId: "p1", name: "Бешбармак", nameKk: "Бешбармақ", unitPrice: 5000, quantity: 2, modifiers: [], modifierLabels: [], serverLineId: "ol1", ...overrides }
}

const SNAPSHOT: ShiftReportSnapshot = {
  catalogGrossSales: 20_000,
  discounts: 1_000,
  serviceCharge: 2_850,
  sales: 21_850,
  refunds: 850,
  netSales: 21_000,
  averageCheck: 10_925,
  expectedCash: 60_000,
  payments: {
    cash: { sales: 11_000, refunds: 850, net: 10_150, saleCount: 1, refundCount: 1 },
    card: { sales: 10_850, refunds: 0, net: 10_850, saleCount: 1, refundCount: 0 },
    qr: { sales: 0, refunds: 0, net: 0, saleCount: 0, refundCount: 0 },
  },
  cashMovements: { cashIn: 5_000, cashOut: 5_150, cashInCount: 1, cashOutCount: 1 },
  orderCounts: { paid: 1, partiallyRefunded: 1, refunded: 0, cancelled: 0, draft: 1, held: 0, discounted: 1 },
  openOrders: { count: 1, total: 3_000 },
  heldOrders: { count: 0, total: 0 },
  cancelledAmount: 0,
  saleOrderCount: 2,
  refundOrderCount: 1,
}

describe("print forms (W1-POS-15/19)", () => {
  it("prints the pre-check of the check on screen without fiscal data and escapes names", () => {
    const html = buildOrderReceiptHtml(
      precheckFromDraft(
        { orderNumber: 12, tableLabel: "Стол 7", lines: [line({ name: "Плов <узбекский>" }), line({ clientLineId: "l2", name: "Удалено", voidedAt: 1 })], subtotal: 10_000, discountPercent: 10, discountAmount: 1_000, serviceChargePercent: 15, serviceChargeAmount: 1_350, total: 10_350, comment: "без лука" },
        { restaurantName: "Sandyq Алматы", terminalName: "Главная касса", operatorName: "Айгерим" },
        Date.UTC(2026, 8, 24, 6, 0),
      ),
    )
    expect(html).toContain("ПРЕДЧЕК")
    expect(html).toContain("НЕ ЯВЛЯЕТСЯ ЧЕКОМ")
    expect(html).toContain("Плов &lt;узбекский&gt;")
    expect(html).not.toContain("Удалено")
    expect(html).toContain("Қызмет ақысы 15 %")
    expect(html).toContain(formatTenge(10_350))
    expect(html).toContain("без лука")
  })

  it("prints a paid history order as a check with its payments and refunds", () => {
    const receipt = receiptFromOrder(
      {
        number: 7,
        status: "partially_refunded",
        createdAt: 1,
        subtotal: 3000,
        discountAmount: 0,
        discountPercent: 0,
        serviceChargePercent: 0,
        serviceChargeAmount: 0,
        total: 3000,
        createdByName: "Касса",
        lines: [{ productName: "Лагман", quantity: 1, unitPrice: 3000, lineTotal: 3000 }],
        payments: [
          { type: "sale", method: "cash", amount: 3000, tendered: 5000, change: 2000, paymentTypeName: "Наличные" },
          { type: "refund", method: "cash", amount: 1000, paymentTypeName: "Наличные" },
        ],
      },
      { restaurantName: "Sandyq", terminalName: "Касса 1" },
    )
    expect(receipt.kind).toBe("receipt")
    const html = buildOrderReceiptHtml(receipt)
    expect(html).toContain("ЧЕК ЗАКАЗА")
    expect(html).toContain("Частичный возврат")
    expect(html).toContain("Возврат · Наличные")
    expect(html).toContain("Сдача")
  })

  it("prints X and Z as normal forms, not JSON", () => {
    const x: XReportData = {
      ...SNAPSHOT,
      reportNumber: "X-20260924-01-003-001",
      sequence: 1,
      shiftNumber: 3,
      terminalName: "Главная касса",
      restaurantName: "Sandyq <Алматы>",
      businessDate: "2026-09-24",
      openedAt: 0,
      generatedAt: 3 * 3_600_000 + 5 * 60_000,
      openedByName: "Айгерим",
      generatedByName: "Айгерим",
      generatedByRole: "cashier",
      openingCash: 50_000,
    }
    const xHtml = buildXReportHtml(x)
    expect(xHtml).toContain("X-ОТЧЁТ")
    expect(xHtml).toContain("Sandyq &lt;Алматы&gt;")
    expect(xHtml).toContain("3 ч 05 мин")
    expect(xHtml).toContain("Незавершённых заказов: 1")
    expect(xHtml).toContain(formatTenge(60_000))

    const zHtml = buildZReportHtml(
      { number: "Z-20260924-01-003", businessDate: "2026-09-24", shiftNumber: 3, openedAt: 0, closedAt: 3_600_000, closedByName: "Айгерим", openingCash: 50_000, countedCash: 59_500, variance: -500, snapshot: SNAPSHOT },
      { restaurantName: "Sandyq", terminalName: "Главная касса" },
    )
    expect(zHtml).toContain("Z-ОТЧЁТ")
    expect(zHtml).toContain("Z-20260924-01-003")
    expect(zHtml).toContain(formatTenge(-500))
    const body = zHtml.slice(zHtml.indexOf("<body>"))
    expect(body).not.toContain('"snapshot"')
    expect(body).not.toContain("{")
  })
})

describe("refund model (W1-POS-18)", () => {
  const payments: HistoryPayment[] = [
    { type: "sale", method: "cash", amount: 4000, paymentTypeExternalId: "pt-cash", paymentTypeName: "Наличные" },
    { type: "sale", method: "card", amount: 6000, paymentTypeExternalId: "pt-card", paymentTypeName: "Банковская карта" },
    { type: "refund", method: "card", amount: 1500, paymentTypeExternalId: "pt-card", paymentTypeName: "Банковская карта" },
  ]

  it("offers each original payment type with what is left on it", () => {
    const ways = refundWays(payments)
    expect(ways.map((way) => [way.label, way.available])).toEqual([
      ["Наличные", 4000],
      ["Банковская карта", 4500],
    ])
    expect(ways[1].target).toEqual({ paymentTypeExternalId: "pt-card" })
    expect(refundWays([{ type: "sale", method: "qr", amount: 900 }])[0].target).toEqual({ method: "qr" })
  })

  it("returns the lines' share of the paid total, like the server", () => {
    // Subtotal 10 000, 10 % discount and 15 % service: total 10 350. One of two plov portions.
    const order = { subtotal: 10_000, total: 10_350, lines: [{ _id: "a", productName: "Плов", quantity: 2, unitPrice: 2500, lineTotal: 5000 }, { _id: "b", productName: "Чай", quantity: 1, unitPrice: 5000 }] }
    expect(linesRefundAmount(order, { a: 1 })).toBe(Math.round((2500 * 10_350) / 10_000))
    expect(linesRefundAmount(order, { a: 2, b: 1 })).toBe(10_350)
  })

  it("never refunds more than is left on the chosen way", () => {
    const [cash] = refundWays(payments)
    expect(refundProblem({ way: cash, amount: 5000, reason: "Гость вернул блюдо" })).toMatch(/не больше/)
    expect(refundProblem({ way: cash, amount: 4000, reason: "" })).toBe("Укажите причину возврата")
    expect(refundProblem({ way: cash, amount: 4000, reason: "Гость вернул блюдо" })).toBeNull()
  })

  it("sends a refund by lines with the computed amount, the original way and the manager token", async () => {
    const onRefund = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "manager-token")
    render(
      <RefundPanel
        order={{ _id: "order-1", number: 100_001, subtotal: 3300, total: 3300, lines: [{ _id: "ol-1", productName: "Бургер", quantity: 2, unitPrice: 1650, lineTotal: 3300 }], payments: [{ type: "sale", method: "card", amount: 3300, paymentTypeExternalId: "pt-card", paymentTypeName: "Карта" }] }}
        onClose={() => {}}
        onRefund={onRefund}
        onManagerRequired={onManagerRequired}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Больше: Бургер" }))
    fireEvent.change(screen.getByLabelText("Причина возврата"), { target: { value: "Холодное блюдо" } })
    fireEvent.click(screen.getByRole("button", { name: `Вернуть ${formatTenge(1650)}` }))
    await waitFor(() => expect(onRefund).toHaveBeenCalled())
    expect(onManagerRequired).toHaveBeenCalled()
    expect(onRefund).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-1", amount: 1650, target: { paymentTypeExternalId: "pt-card" }, lines: [{ orderLineId: "ol-1", quantity: 1 }], reason: "Холодное блюдо", managerApprovalToken: "manager-token" }))
  })
})

const CASH_TYPES = [
  { externalId: "co-change", code: "change", name: "Размен", receiptName: "Размен", version: 1, data: { kind: "cash-operation-type", direction: "cash-in", cashAccount: "cash", correspondingAccount: "safe", maximumAmount: 20_000, requireManager: false } },
  { externalId: "co-collect", code: "collect", name: "Инкассация", receiptName: "Инкассация", version: 1, data: { kind: "cash-operation-type", direction: "cash-out", cashAccount: "cash", correspondingAccount: "bank", maximumAmount: 500_000, requireManager: false } },
] as PosCashOperationType[]

describe("cash in / cash out (W1-POS-19)", () => {
  it("takes the limit and the manager rule from the operation type; cash-out always needs a manager", () => {
    const [change, collect] = CASH_TYPES
    expect(cashMovementProblem({ legacy: false, type: change, amount: 25_000, comment: "", direction: "cash-in" })).toBe(`Лимит операции — ${formatTenge(20_000)}`)
    expect(cashMovementProblem({ legacy: false, type: change, amount: 5_000, comment: "", direction: "cash-in" })).toBeNull()
    expect(cashNeedsManager("cash-in", change)).toBe(false)
    expect(cashNeedsManager("cash-out", collect)).toBe(true)
    expect(toCashMovement({ legacy: false, type: change, direction: "cash-in", amount: 5000, comment: " " })).toEqual({ cashOperationTypeExternalId: "co-change", amount: 5000 })
  })

  it("falls back to direction + reason while no types are published", () => {
    expect(cashMovementProblem({ legacy: true, type: undefined, amount: 1000, comment: "ок", direction: "cash-in" })).toBe("Укажите причину операции")
    expect(toCashMovement({ legacy: true, type: undefined, direction: "cash-out", amount: 1000, comment: "Инкассация" })).toEqual({ direction: "cash-out", amount: 1000, reason: "Инкассация" })
  })

  it("asks for the manager PIN before a cash-out and sends the type", async () => {
    const onSubmit = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "manager-token")
    render(<CashMovementForm types={CASH_TYPES} expectedCash={40_000} onSubmit={onSubmit} onManagerRequired={onManagerRequired} onDone={() => {}} />)
    fireEvent.click(screen.getByRole("radio", { name: /Изъять наличные/ }))
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "30000" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить операцию" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onManagerRequired).toHaveBeenCalledWith(expect.stringContaining("Изъятие"))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cashOperationTypeExternalId: "co-collect", amount: 30_000, managerApprovalToken: "manager-token" }))
  })
})

const REASON = [{ externalId: "r-guest", code: "guest", name: "Гость ушёл", receiptName: "Гость ушёл", version: 1, data: { kind: "deletion-reason", writeOff: true, requireComment: false, requireManager: false } }] as PosDeletionReason[]

describe("order actions (W1-POS-15)", () => {
  it("keeps unavailable tiles visible with the reason", () => {
    const blocks = orderActionBlocks({ orderId: "order-1", lines: [line({ quantity: 1 })], transferTargets: [] })
    expect(blocks.split).toBe("Нужно минимум две порции")
    expect(blocks.transfer).toBe("Нет других касс с открытой сменой")
    expect(blocks.cancel).toBeUndefined()
    expect(orderActionBlocks({ orderId: null, lines: [], transferTargets: undefined }).cancel).toBe("Заказ ещё не сохранён")

    const onAction = vi.fn()
    render(<OrderActionsDialog open onOpenChange={() => {}} blocks={blocks} lines={[line()]} onAction={onAction} onVoidLine={() => {}} />)
    const transfer = screen.getByRole("button", { name: /Перенести на кассу/ })
    expect(transfer).toHaveProperty("disabled", true)
    expect(within(transfer).getByText("Нет других касс с открытой сменой")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Перенести на стол/ }))
    expect(onAction).toHaveBeenCalledWith("move-table")
  })

  it("cancels with the published reason and a manager PIN", async () => {
    const onCancel = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "manager-token")
    render(<CancelOrderDialog open onOpenChange={() => {}} orderNumber={12} sentToKitchen reasons={REASON} onCancel={onCancel} onManagerRequired={onManagerRequired} />)
    fireEvent.click(screen.getByRole("button", { name: "Отменить заказ" }))
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith({ deletionReasonExternalId: "r-guest", comment: undefined, managerApprovalToken: "manager-token" }))
  })

  it("asks for a free reason while no deletion reasons are published", () => {
    expect(cancelProblem([], undefined, "ок")).toBe("Укажите причину отмены")
    expect(cancelProblem([], undefined, "Гость ушёл")).toBeNull()
    expect(cancelProblem(REASON, undefined, "")).toBe("Выберите основание")
  })

  it("splits only part of the check into a new one", async () => {
    expect(splitProblem([line()], { l1: 2 })).toBe("В этом чеке должна остаться хотя бы одна порция")
    const onSplit = vi.fn(async () => undefined)
    render(<SplitDialog open onOpenChange={() => {}} lines={[line(), line({ clientLineId: "l2", name: "Чай", quantity: 1, unitPrice: 800 })]} onSplit={onSplit} />)
    const split = screen.getByRole("button", { name: "Разделить" })
    expect(split).toHaveProperty("disabled", true)
    fireEvent.click(screen.getByRole("button", { name: "Больше в новый чек: Бешбармак" }))
    fireEvent.click(split)
    await waitFor(() => expect(onSplit).toHaveBeenCalledWith([{ clientLineId: "l1", quantity: 1 }]))
  })

  it("shows the server's refusal of an occupied table", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("За столом «Стол 3» уже открыт чек №15 — объедините чеки или выберите другой стол")
    })
    // A table taken meanwhile at another terminal (the grid still showed it free).
    const floor = { halls: [{ name: "Зал", tables: [{ tableId: "t3", label: "Стол 3", capacity: 4, checks: [] }] }], orphans: [], tableCount: 1, truncated: false }
    render(<FloorGrid open onOpenChange={() => {}} mode="move" floor={floor} activeOrderId="o7" currentTable={{ tableLabel: "Стол 7" }} onOpenTable={() => {}} onSelectCheck={() => {}} onMove={onSubmit} />)
    fireEvent.click(screen.getByRole("button", { name: /^Стол 3: свободен/ }))
    expect(await screen.findByText(/уже открыт чек №15/)).toBeTruthy()
    expect(onSubmit).toHaveBeenCalledWith({ tableLabel: "Стол 3", hallLabel: "Зал" })
  })
})

describe("order draft actions keep the version chain (W1-POS-15)", () => {
  beforeEach(() => {
    for (const mock of Object.values(backend)) mock.mockReset()
  })

  const hydrated = {
    _id: "order-1" as never,
    number: 12,
    version: 3,
    tableLabel: "Стол 7",
    discountPercent: 0,
    comment: "",
    lines: [{ _id: "ol-1", clientLineId: "c-1", productId: "p1", productName: "Плов", unitPrice: 2500, quantity: 2, modifiers: [], product: { nameKk: "Палау" } }],
  }

  function renderDraft() {
    return renderHook(() => useOrderDraft({ sessionToken: "s", terminalExternalId: "t", orderType: "dine-in", hydrated, initialOrderId: "order-1" as never, selectionKey: 1 }))
  }

  it("moves to a table with the current version, and the next save keeps the new table", async () => {
    backend.moveToTable.mockResolvedValue({ ...hydrated, version: 4, tableLabel: "Стол 3" })
    backend.saveDraft.mockResolvedValue({ ...hydrated, version: 5, tableLabel: "Стол 3" })
    const { result } = renderDraft()
    await act(() => result.current.moveToTable({ tableLabel: "Стол 3" }))
    expect(backend.moveToTable).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-1", expectedVersion: 3, tableLabel: "Стол 3" }))
    expect(result.current.tableLabel).toBe("Стол 3")
    await act(() => result.current.saveComment("без лука"))
    expect(backend.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, tableLabel: "Стол 3", comment: "без лука" }))
  })

  it("splits by server line ids and keeps only what stayed", async () => {
    backend.split.mockResolvedValue({ orderId: "order-2", original: { ...hydrated, version: 4, lines: [{ ...hydrated.lines[0], quantity: 1 }] }, created: { number: 13, tableLabel: "Стол 7 /2" } })
    const { result } = renderDraft()
    let created: unknown
    await act(async () => {
      created = await result.current.split([{ clientLineId: "c-1", quantity: 1 }])
    })
    expect(backend.split).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, lines: [{ orderLineId: "ol-1", quantity: 1 }] }))
    expect(created).toEqual({ orderId: "order-2", number: 13, tableLabel: "Стол 7 /2" })
    expect(result.current.lines.map((row) => row.quantity)).toEqual([1])
  })

  it("cancels with the version of the last answer", async () => {
    backend.cancel.mockResolvedValue(null)
    const { result } = renderDraft()
    await act(() => result.current.cancel({ deletionReasonExternalId: "r-guest", managerApprovalToken: "m" }))
    expect(backend.cancel).toHaveBeenCalledWith({ sessionToken: "s", orderId: "order-1", expectedVersion: 3, deletionReasonExternalId: "r-guest", managerApprovalToken: "m" })
  })
})

describe("main menu, profile, notifications (W1-POS-14)", () => {
  it("opens a new check from the menu; signing out is a danger action", () => {
    const onNewOrder = vi.fn()
    const onLogout = vi.fn()
    render(<MainMenuDialog open onOpenChange={() => {}} onNewOrder={onNewOrder} onHistory={() => {}} onShift={() => {}} onLock={() => {}} onLogout={onLogout} />)
    fireEvent.click(screen.getByRole("button", { name: /Новый заказ/ }))
    expect(onNewOrder).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Завершить вход сотрудника/ }))
    expect(onLogout).toHaveBeenCalled()
  })

  it("clocks in and, once in, offers clocking out", async () => {
    const onClockIn = vi.fn(async () => undefined)
    const access = { employee: { id: "e", code: "101", displayName: "Айгерим", role: "cashier" as const }, restaurant: { id: "r", externalId: "almaty", name: "Sandyq Алматы", city: "Алматы" }, terminal: { id: "t", externalId: "t1", name: "Главная касса", terminalNumber: 1 } }
    const props = { open: true, onOpenChange: () => {}, access, onClockIn, onClockOut: vi.fn(async () => undefined), onLock: () => {}, onLogout: () => {} }
    const { rerender } = render(
      <ThemeProvider>
        <ProfileDialog {...props} attendance={null} />
      </ThemeProvider>,
    )
    expect(screen.getByText("Кассир · код 101")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Отметить приход" }))
    await waitFor(() => expect(onClockIn).toHaveBeenCalled())
    rerender(
      <ThemeProvider>
        <ProfileDialog {...props} attendance={{ clockIn: Date.UTC(2026, 8, 24, 4, 0) }} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Отметить уход" })).toBeTruthy()
    expect(screen.getByText("На работе с 09:00")).toBeTruthy()
  })

  it("counts unread notifications and marks one read", async () => {
    render(
      <ThemeProvider>
        <AppHeader restaurantName="Sandyq Алматы" employeeName="Айгерим" shiftNumber={3} unreadNotifications={12} onOpenShiftInfo={() => {}} onNotifications={() => {}} onLock={() => {}} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Уведомления: 12 новых" })).toBeTruthy()
    expect(screen.getByText("9+")).toBeTruthy()
    cleanup()

    const onRead = vi.fn(async () => undefined)
    const item = { _id: "n1" as never, _creationTime: 0, terminalId: "t" as never, title: "Смена открыта больше 24 часов", message: "Закройте смену", severity: "critical" as const, dedupeKey: "long-shift:s1", createdAt: 0, read: false }
    expect(opensShift(item)).toBe(true)
    render(<NotificationsDialog open onOpenChange={() => {}} items={[item]} canLoadMore={false} onLoadMore={() => {}} onRead={onRead} onOpenShift={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Прочитано" }))
    await waitFor(() => expect(onRead).toHaveBeenCalledWith("n1"))
  })
})
