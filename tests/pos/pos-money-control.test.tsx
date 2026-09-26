// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OrderPanel } from "@/pos/components/order-panel"
import { CHECKOUT_TIMEOUT_MESSAGE, useCheckoutAttempt } from "@/pos/features/checkout/model/use-checkout-attempt"
import { PaymentComplete, paidCheckFrom } from "@/pos/features/checkout/ui/payment-complete"
import { PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import type { OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { DiscountDialog, totalAfterDiscount } from "@/pos/features/order-taking/ui/discount-dialog"
import type { PosPaymentType } from "@/pos/features/retail/data/use-retail-settings"
import { CashMovementForm, CloseShiftPanel } from "@/pos/features/shifts/ui/shift-dialog"
import { OFFLINE_MESSAGE, useServerOffline } from "@/pos/model/use-connection"
import { formatTenge } from "@/shared/lib/utils"

// POS redesign «Money & control»: blind shift count with a confirm step, explicit payment method,
// one idempotency key per payment attempt with a timeout, «Оплачено», offline blocking, discount preview,
// inline confirm for «−» on the last portion.

const connection = vi.hoisted(() => ({ state: { isWebSocketConnected: true, hasEverConnected: true, hasInflightRequests: false }, listeners: new Set<() => void>() }))

vi.mock("convex/react", () => ({
  useConvex: () => ({
    connectionState: () => connection.state,
    subscribeToConnectionState: (callback: () => void) => {
      connection.listeners.add(callback)
      return () => connection.listeners.delete(callback)
    },
  }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Money keeps its no-break and thin spaces; the default normalizer would turn them into plain spaces.
const exact = { normalizer: (text: string) => text.trim() }

const PAYMENT_TYPES = [
  { externalId: "pt-cash", code: "cash", name: "Наличные", receiptName: "Наличные", version: 1, data: { kind: "payment-type", processorKind: "cash", account: "cash", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: false, combinable: true, allowsChange: true, opensCashDrawer: true } },
  { externalId: "pt-card", code: "card", name: "Банковская карта", receiptName: "Банковская карта", version: 1, data: { kind: "payment-type", processorKind: "card", account: "inTransit", fiscal: true, revenue: true, manualEntry: false, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
  { externalId: "pt-qr", code: "kaspi-qr", name: "Kaspi QR", receiptName: "Kaspi QR", version: 1, data: { kind: "payment-type", processorKind: "qr", account: "inTransit", fiscal: true, revenue: true, manualEntry: true, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false } },
] as PosPaymentType[]

describe("blind shift count", () => {
  function renderClose(props: Partial<Parameters<typeof CloseShiftPanel>[0]> = {}) {
    const onClose = vi.fn(async () => undefined)
    const onManagerRequired = vi.fn(async () => "approval-token")
    render(<CloseShiftPanel expectedCash={22_300} blockers={[]} managerThreshold={1000} onClose={onClose} onManagerRequired={onManagerRequired} {...props} />)
    return { onClose, onManagerRequired }
  }
  const counted = () => screen.getByLabelText("Фактическая наличность") as HTMLInputElement

  it("hides the expected cash until «Сверить»; «Пересчитать» clears the count and hides it again", () => {
    renderClose()
    fireEvent.change(counted(), { target: { value: "22300" } })
    expect(screen.queryByText("Ожидается в кассе")).toBeNull()
    expect(screen.queryByText(formatTenge(22_300), exact)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Сверить" }))
    expect(screen.getByText("Ожидается в кассе")).toBeTruthy()
    expect(screen.getAllByText(formatTenge(22_300), exact)).toHaveLength(2) // counted and expected
    expect(screen.queryByLabelText("Фактическая наличность")).toBeNull() // the count is fixed on this step

    fireEvent.click(screen.getByRole("button", { name: /Пересчитать/ }))
    expect(counted().value).toBe("")
    expect(screen.queryByText("Ожидается в кассе")).toBeNull()
  })

  it("closes only after the explicit confirm, and «Отмена» goes back without closing", async () => {
    const { onClose, onManagerRequired } = renderClose()
    fireEvent.change(counted(), { target: { value: "22300" } })
    fireEvent.click(screen.getByRole("button", { name: "Сверить" }))
    fireEvent.click(screen.getByRole("button", { name: /Закрыть смену и Z-отчёт/ }))
    expect(onClose).not.toHaveBeenCalled()
    const confirm = screen.getByRole("group", { name: "Подтверждение закрытия" })
    expect(within(confirm).getByText("Закрыть смену и напечатать Z-отчёт? Действие необратимо.")).toBeTruthy()

    fireEvent.click(within(confirm).getByRole("button", { name: "Отмена" }))
    expect(screen.queryByRole("group", { name: "Подтверждение закрытия" })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Закрыть смену и Z-отчёт/ }))
    fireEvent.click(within(screen.getByRole("group", { name: "Подтверждение закрытия" })).getByRole("button", { name: /Закрыть смену/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(22_300, "", undefined))
    expect(onManagerRequired).not.toHaveBeenCalled()
  })

  it("a variance at the threshold needs a comment and the manager's PIN on confirm", async () => {
    const { onClose, onManagerRequired } = renderClose()
    fireEvent.change(counted(), { target: { value: "21300" } })
    fireEvent.click(screen.getByRole("button", { name: "Сверить" }))
    expect(screen.getByText(/закрытие подтверждает менеджер своим PIN/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Закрыть смену и Z-отчёт/ }))
    expect(screen.getByRole("alert").textContent).toBe("При расхождении укажите комментарий")

    fireEvent.change(screen.getByLabelText(/Комментарий/), { target: { value: "недостача, пересчитано дважды" } })
    fireEvent.click(screen.getByRole("button", { name: /Закрыть смену и Z-отчёт/ }))
    fireEvent.click(within(screen.getByRole("group", { name: "Подтверждение закрытия" })).getByRole("button", { name: /Закрыть смену/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(21_300, "недостача, пересчитано дважды", "approval-token"))
    expect(onManagerRequired).toHaveBeenCalledWith(expect.stringContaining(formatTenge(-1000)))
  })
})

describe("cash-out copy", () => {
  it("mentions the manager's PIN for a cash-out (every one needs it), not for a plain cash-in", () => {
    render(<CashMovementForm types={[]} onSubmit={vi.fn()} onManagerRequired={async () => null} onDone={() => {}} />)
    expect(screen.queryByText(/PIN/)).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: /Изъять наличные/ }))
    expect(screen.getByText(/Каждое изъятие подтверждает менеджер/)).toBeTruthy()
  })
})

describe("payment needs an explicit method", () => {
  const confirm = () => screen.getByRole("button", { name: /Подтвердить/ }) as HTMLButtonElement

  it("with several methods nothing is preselected and «Подтвердить» waits for a choice", () => {
    const onSubmit = vi.fn()
    render(<PaymentDialog open onOpenChange={() => {}} total={1650} paymentTypes={PAYMENT_TYPES} submitting={false} error={null} onSubmit={onSubmit} />)
    expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true)
    expect(confirm().disabled).toBe(true)
    expect(screen.getByText("Выберите способ оплаты слева.")).toBeTruthy()

    fireEvent.click(screen.getByRole("radio", { name: /Банковская карта/ }))
    expect(confirm().disabled).toBe(false)
    fireEvent.click(confirm())
    expect(onSubmit).toHaveBeenCalledWith([{ paymentTypeExternalId: "pt-card", amount: 1650 }])
  })

  it("the only method is preselected", () => {
    render(<PaymentDialog open onOpenChange={() => {}} total={1650} paymentTypes={[PAYMENT_TYPES[1]]} submitting={false} error={null} onSubmit={vi.fn()} />)
    expect(screen.getByRole("radio", { name: /Банковская карта/ }).getAttribute("aria-checked")).toBe("true")
    expect(confirm().disabled).toBe(false)
  })

  it("the tiles are a radio group: the arrows move the selection", async () => {
    render(<PaymentDialog open onOpenChange={() => {}} total={1650} paymentTypes={PAYMENT_TYPES} submitting={false} error={null} onSubmit={vi.fn()} />)
    const group = screen.getByRole("radiogroup", { name: "Способ оплаты" })
    const cash = within(group).getByRole("radio", { name: /Наличные/ })
    fireEvent.click(cash)
    cash.focus()
    fireEvent.keyDown(cash, { key: "ArrowDown" })
    const card = within(group).getByRole("radio", { name: /Банковская карта/ })
    await waitFor(() => expect(document.activeElement).toBe(card))
    expect(card.getAttribute("aria-checked")).toBe("true")
    expect(cash.getAttribute("tabindex")).toBe("-1")
  })

  it("a blocked payment (offline) keeps «Подтвердить» disabled with the reason", () => {
    render(<PaymentDialog open onOpenChange={() => {}} total={1650} paymentTypes={[PAYMENT_TYPES[1]]} blockedReason={OFFLINE_MESSAGE} submitting={false} error={null} onSubmit={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toBe(OFFLINE_MESSAGE)
    expect(confirm().disabled).toBe(true)
  })
})

describe("one idempotency key per payment attempt", () => {
  function setup(timeoutMs = 10_000) {
    let counter = 0
    const keys: string[] = []
    const onSuccess = vi.fn()
    const hook = renderHook(() => useCheckoutAttempt<string>({ timeoutMs, newKey: () => `key-${++counter}` }))
    const submit = (scope: string, run: () => Promise<string>) =>
      act(() =>
        hook.result.current.submit(
          scope,
          (key) => {
            keys.push(key)
            return run()
          },
          onSuccess,
        ),
      )
    return { hook, keys, onSuccess, submit }
  }

  it("a retry after an error reuses the key; success, another order or a cancel start a new one", async () => {
    const { hook, keys, onSuccess, submit } = setup()
    await submit("order-1", () => Promise.reject(new Error("Сеть недоступна")))
    expect(hook.result.current.error).toBe("Сеть недоступна")
    await submit("order-1", () => Promise.resolve("paid"))
    expect(onSuccess).toHaveBeenCalledWith("paid")
    expect(hook.result.current.error).toBeNull()
    await submit("order-1", () => Promise.reject(new Error("x")))
    await submit("order-2", () => Promise.reject(new Error("x")))
    act(() => hook.result.current.reset())
    await submit("order-2", () => Promise.reject(new Error("x")))
    expect(keys).toEqual(["key-1", "key-1", "key-2", "key-3", "key-4"])
  })

  it("no answer in 10 s surfaces the timeout, keeps the key for the retry and completes on a late answer", async () => {
    vi.useFakeTimers()
    const { hook, keys, onSuccess } = setup()
    const start = (run: () => Promise<string>) => {
      let done: Promise<void> = Promise.resolve()
      act(() => {
        done = hook.result.current.submit("order-1", (key) => (keys.push(key), run()), onSuccess)
      })
      return done
    }
    let answer: (value: string) => void = () => {}
    const pending = start(() => new Promise<string>((resolve) => (answer = resolve)))
    expect(hook.result.current.submitting).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      await pending
    })
    expect(hook.result.current.error).toBe(CHECKOUT_TIMEOUT_MESSAGE)
    expect(hook.result.current.submitting).toBe(false)
    expect(onSuccess).not.toHaveBeenCalled()

    const retry = start(() => new Promise<string>(() => {}))
    expect(keys).toEqual(["key-1", "key-1"])
    await act(async () => answer("paid"))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith("paid")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      await retry
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})

describe("«Оплачено»", () => {
  const result = {
    number: 100_004,
    receipt: {
      tableLabel: "Стол 7",
      payments: [
        { type: "sale" as const, method: "cash" as const, amount: 1000, tendered: 5000, change: 4000, paymentTypeName: "Наличные" },
        { type: "sale" as const, method: "card" as const, amount: 650 },
      ],
    },
  }

  it("shows the check number, the methods and the change, then prints or starts a new table", () => {
    const onPrint = vi.fn(() => true)
    const onNewTable = vi.fn()
    render(<PaymentComplete paid={paidCheckFrom(result)} onOpenChange={() => {}} onPrint={onPrint} onNewTable={onNewTable} />)
    const dialog = screen.getByRole("dialog", { name: "Оплачено" })
    expect(within(dialog).getByText("Заказ №100004 · Стол 7")).toBeTruthy()
    expect(within(dialog).getByText("Наличные")).toBeTruthy()
    expect(within(dialog).getByText("Карта")).toBeTruthy()
    expect(within(dialog).getByText("Сдача")).toBeTruthy()
    expect(within(dialog).getByText(formatTenge(4000), exact)).toBeTruthy()
    expect(dialog.textContent).not.toContain("!")

    fireEvent.click(within(dialog).getByRole("button", { name: /Печать чека/ }))
    expect(onPrint).toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Новый стол" }))
    expect(onNewTable).toHaveBeenCalled()
  })

  it("says so when the device cannot print", () => {
    render(<PaymentComplete paid={paidCheckFrom(result)} onOpenChange={() => {}} onPrint={() => false} onNewTable={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /Печать чека/ }))
    expect(screen.getByRole("alert").textContent).toMatch(/Печать недоступна/)
  })
})

const LINE: OrderDraftLine = { clientLineId: "l1", productId: "p1", name: "Бешбармак", nameKk: "Бешбармақ", unitPrice: 5990, quantity: 1, modifiers: [], modifierLabels: [] }

function renderPanel(props: Partial<Parameters<typeof OrderPanel>[0]> = {}) {
  const handlers = { onCheckout: vi.fn(), onSendToKitchen: vi.fn(), onDecrement: vi.fn(), onRemove: vi.fn(), onIncrement: vi.fn() }
  const view = render(
    <OrderPanel
      tableLabel="Стол 7"
      lines={[LINE]}
      itemCount={1}
      orderTypeOptions={[{ value: "dine-in", label: "В зале", mode: "dine-in" }]}
      orderTypeValue="dine-in"
      onOrderTypeChange={() => {}}
      subtotal={5990}
      discountPercent={0}
      discountAmount={0}
      serviceChargePercent={0}
      serviceChargeAmount={0}
      total={5990}
      saving={false}
      error={null}
      canSendToKitchen
      onVoid={() => {}}
      onHold={() => {}}
      onDiscount={() => {}}
      {...handlers}
      {...props}
    />,
  )
  return { ...handlers, view }
}

describe("offline", () => {
  it("disables «Оплатить» and «На кухню» with the reason shown beside them", () => {
    const { onCheckout } = renderPanel({ offlineReason: OFFLINE_MESSAGE })
    const pay = screen.getByRole("button", { name: /Оплатить/ }) as HTMLButtonElement
    const kitchen = screen.getByRole("button", { name: /На кухню/ }) as HTMLButtonElement
    expect(pay.disabled).toBe(true)
    expect(kitchen.disabled).toBe(true)
    expect(pay.title).toBe(OFFLINE_MESSAGE)
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeTruthy()
    expect(pay.getAttribute("aria-describedby")).toBe("order-offline-reason")
    fireEvent.click(pay)
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it("online the buttons work and no reason is shown", () => {
    renderPanel()
    expect((screen.getByRole("button", { name: /Оплатить/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(OFFLINE_MESSAGE)).toBeNull()
  })

  it("useServerOffline follows the Convex link and ignores the first connection", () => {
    connection.state = { isWebSocketConnected: false, hasEverConnected: false, hasInflightRequests: false }
    const { result } = renderHook(() => useServerOffline())
    expect(result.current).toBe(false)
    act(() => {
      connection.state = { isWebSocketConnected: false, hasEverConnected: true, hasInflightRequests: false }
      for (const listener of connection.listeners) listener()
    })
    expect(result.current).toBe(true)
    act(() => {
      connection.state = { isWebSocketConnected: true, hasEverConnected: true, hasInflightRequests: true }
      for (const listener of connection.listeners) listener()
    })
    expect(result.current).toBe(false)
  })
})

describe("«−» on the last portion asks inline", () => {
  it("«Убрать позицию?» with «Отмена» keeps the line, «Убрать» removes it", () => {
    const { onDecrement, onRemove } = renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Убрать одну порцию: Бешбармак" }))
    expect(onDecrement).not.toHaveBeenCalled()
    const ask = screen.getByRole("group", { name: "Убрать позицию: Бешбармак" })
    expect(within(ask).getByText("Убрать позицию?")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(within(ask).getByRole("button", { name: "Отмена" }))
    expect(screen.queryByRole("group", { name: "Убрать позицию: Бешбармак" })).toBeNull()
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Убрать одну порцию: Бешбармак" }))
    fireEvent.click(within(screen.getByRole("group", { name: "Убрать позицию: Бешбармак" })).getByRole("button", { name: "Убрать" }))
    expect(onRemove).toHaveBeenCalledWith("l1")
  })

  it("with more portions «−» takes one off at once", () => {
    const { onDecrement } = renderPanel({ lines: [{ ...LINE, quantity: 2 }], itemCount: 2 })
    fireEvent.click(screen.getByRole("button", { name: "Убрать одну порцию: Бешбармак" }))
    expect(onDecrement).toHaveBeenCalledWith("l1")
    expect(screen.queryByText("Убрать позицию?")).toBeNull()
  })
})

describe("discount preview", () => {
  it("shows «Итого после скидки» as the percent changes and the error as an alert", () => {
    expect(totalAfterDiscount(10_000, 10, 15)).toBe(10_350)
    render(<DiscountDialog open onOpenChange={() => {}} currentPercent={0} subtotal={10_000} serviceChargePercent={15} onApply={vi.fn()} onManagerRequired={async () => null} />)
    expect(screen.getByText("Итого после скидки")).toBeTruthy()
    expect(screen.getByText(formatTenge(11_500), exact)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "10%" }))
    expect(screen.getByText(formatTenge(10_350), exact)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Применить" }))
    expect(screen.getByRole("alert").textContent).toBe("Укажите причину скидки")
  })
})
