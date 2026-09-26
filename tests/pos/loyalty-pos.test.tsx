// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { payableTotal } from "@/pos/features/checkout/model/payment-parts"
import { PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import { accrualFor, maskPhoneForPos, phoneMatchesMask, redemptionLimit, redemptionProblem } from "@/pos/features/loyalty/model/guest-loyalty"
import { GuestDialog, type GuestDialogProps } from "@/pos/features/loyalty/ui/guest-dialog"
import { formatTenge } from "@/shared/lib/format"

// W1-POS-16: «Гость и программа лояльности» with partial redemption; the payment covers total − points.

const mocks = vi.hoisted(() => ({ search: undefined as unknown, quote: undefined as unknown, quoteArgs: [] as unknown[] }))

vi.mock("@/pos/features/loyalty/data/use-loyalty", () => ({
  useGuestSearch: (sessionToken: string | null, query: string) => (sessionToken && query.trim().length >= 2 ? mocks.search : undefined),
  useLoyaltyQuote: (_token: string, _orderId: string, options: { guestId?: string; enabled?: boolean }) => {
    mocks.quoteArgs.push(options)
    return options.enabled === false ? undefined : mocks.quote
  },
}))

// formatTenge uses thin and no-break spaces; the default matcher would collapse them in the DOM text only.
const exact = { normalizer: (text: string) => text.trim() }

const QUOTE = { program: { externalId: "p-main", name: "Sandyq Bonus" }, balance: 1000, maxRedemption: 1000, accrual: 115, accrualWithout: 115, planned: 0 }

beforeEach(() => {
  mocks.search = undefined
  mocks.quote = QUOTE
  mocks.quoteArgs = []
})

afterEach(cleanup)

function renderDialog(overrides: Partial<GuestDialogProps> = {}) {
  const props: GuestDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    sessionToken: "token",
    orderId: "order-1" as GuestDialogProps["orderId"],
    total: 2300,
    currentGuest: { phone: "77011234567", name: "Айгерим", points: 1000 },
    onAttach: vi.fn(async () => undefined),
    onDetach: vi.fn(async () => undefined),
    onRedeem: vi.fn(async () => undefined),
    ...overrides,
  }
  render(<GuestDialog {...props} />)
  return props
}

describe("guest loyalty rules (W1-POS-16)", () => {
  it("earns on what is left to pay: exact for 0 and the planned value, proportional otherwise", () => {
    expect(accrualFor(QUOTE, 0, 2300)).toEqual({ points: 115, approximate: false })
    expect(accrualFor({ ...QUOTE, planned: 300, accrual: 100 }, 300, 2300)).toEqual({ points: 100, approximate: false })
    expect(accrualFor(QUOTE, 300, 2300)).toEqual({ points: 100, approximate: true })
    expect(accrualFor({ ...QUOTE, accrualWithout: undefined }, 0, 2300).points).toBe(115)
  })

  it("keeps a redemption within the program limit and at least 1 ₸ in money", () => {
    expect(redemptionProblem(500, 1000, 2300)).toBeNull()
    expect(redemptionProblem(1200, 1000, 2300)).toMatch(/не больше/)
    expect(redemptionProblem(2300, 5000, 2300)).toMatch(/хотя бы 1/)
    expect(redemptionLimit(5000, 2300)).toBe(2299)
    expect(redemptionLimit(1000, 2300)).toBe(1000)
  })

  it("masks phones on the POS and matches a typed phone to a masked one by its tail", () => {
    expect(maskPhoneForPos("77011234567")).toBe("+7 701 ••• •• 67")
    expect(maskPhoneForPos("7701•••••67")).toBe("+7701•••••67")
    expect(phoneMatchesMask("7701•••••67", "+7 701 123 45 67")).toBe(true)
    expect(phoneMatchesMask("7701•••••67", "+7 701 123 45 68")).toBe(false)
    expect(phoneMatchesMask("7701•••••67", "67")).toBe(false)
  })

  it("the payment covers the order total minus the planned points", () => {
    expect(payableTotal(2300, 300)).toBe(2000)
    expect(payableTotal(2300)).toBe(2300)
    expect(payableTotal(300, 500)).toBe(0)
  })
})

describe("«Гость и программа лояльности» dialog", () => {
  it("shows balance, «Можно списать» and «Будет начислено», and plans a partial redemption", async () => {
    const props = renderDialog()
    expect(screen.getByText("Гость и программа лояльности")).toBeTruthy()
    expect(screen.getByText("+7 701 ••• •• 67")).toBeTruthy()
    expect(screen.getByText("Можно списать")).toBeTruthy()
    expect(screen.getByText("Будет начислено")).toBeTruthy()
    expect(screen.getByText("+115 б.")).toBeTruthy()
    const redeem = () => screen.getByRole("button", { name: /^Списать/ }) as HTMLButtonElement
    expect(redeem().textContent).toBe(`Списать ${formatTenge(0)}`)
    expect(redeem().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText("Списать баллами"), { target: { value: "500" } })
    expect(redeem().textContent).toBe(`Списать ${formatTenge(500)}`)
    expect(screen.getByText("≈ +90 б.")).toBeTruthy() // 115 × 1800 / 2300
    fireEvent.click(redeem())
    await waitFor(() => expect(props.onRedeem).toHaveBeenCalledWith(500))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("refuses more than the program allows", () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText("Списать баллами"), { target: { value: "1500" } })
    expect(screen.getByText(`Можно списать не больше ${formatTenge(1000)}`, exact)).toBeTruthy()
    expect((screen.getByRole("button", { name: /^Списать/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("«Только начислить» clears a planned redemption; «Без гостя» detaches", async () => {
    mocks.quote = { ...QUOTE, planned: 300, accrual: 100 }
    const props = renderDialog()
    expect((screen.getByLabelText("Списать баллами") as HTMLInputElement).value).toBe("300")
    fireEvent.click(screen.getByRole("button", { name: "Только начислить" }))
    await waitFor(() => expect(props.onRedeem).toHaveBeenCalledWith(0))

    cleanup()
    const second = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: "Без гостя" }))
    await waitFor(() => expect(second.onDetach).toHaveBeenCalled())
  })

  it("a guest found by name is attached by id — no need to retype the masked phone", async () => {
    mocks.search = [{ guestId: "g1", name: "Айгерим", phone: "7701•••••67", points: 1000 }]
    const props = renderDialog({ currentGuest: null })
    const search = screen.getByPlaceholderText("Введите минимум 2 символа")
    fireEvent.change(search, { target: { value: "Айг" } })
    fireEvent.click(screen.getByRole("button", { name: /Айгерим/ }))
    expect(mocks.quoteArgs.at(-1)).toMatchObject({ guestId: "g1", enabled: true })

    expect(screen.queryByLabelText("Телефон гостя полностью")).toBeNull()
    fireEvent.change(screen.getByLabelText("Списать баллами"), { target: { value: "200" } })
    fireEvent.click(screen.getByRole("button", { name: `Списать ${formatTenge(200)}` }))
    await waitFor(() => expect(props.onRedeem).toHaveBeenCalledWith(200))
    expect(props.onAttach).toHaveBeenCalledWith({ guestId: "g1" })
  })

  it("a full phone with no match offers a new guest and only accrues", async () => {
    mocks.search = []
    mocks.quote = undefined
    const props = renderDialog({ currentGuest: null })
    fireEvent.change(screen.getByPlaceholderText("Введите минимум 2 символа"), { target: { value: "+7 701 555 11 22" } })
    expect(screen.getByText(/Новый гость/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Имя (необязательно)"), { target: { value: "Ерлан" } })
    expect((screen.getByRole("button", { name: /^Списать/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Только начислить" }))
    await waitFor(() => expect(props.onAttach).toHaveBeenCalledWith({ phone: "+7 701 555 11 22" }, "Ерлан"))
    expect(props.onRedeem).not.toHaveBeenCalled()
  })

  it("shows the failure of a redemption instead of closing", async () => {
    const props = renderDialog({ onRedeem: vi.fn(async () => Promise.reject(new Error("Списать можно от 0 до 800 баллов"))) })
    fireEvent.change(screen.getByLabelText("Списать баллами"), { target: { value: "900" } })
    fireEvent.click(screen.getByRole("button", { name: `Списать ${formatTenge(900)}` }))
    await waitFor(() => expect(screen.getByText("Списать можно от 0 до 800 баллов")).toBeTruthy())
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("payment with planned points", () => {
  it("asks for total − points and shows the points line", () => {
    const onSubmit = vi.fn()
    render(<PaymentDialog open onOpenChange={() => {}} total={2300} loyaltyRedemption={300} submitting={false} error={null} onSubmit={onSubmit} />)
    expect(screen.getByText(`Заказ ${formatTenge(2300)} · баллами`, exact)).toBeTruthy()
    expect(screen.getByText(formatTenge(-300), exact)).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: /Наличные/ }))
    fireEvent.click(screen.getByRole("button", { name: `Подтвердить · ${formatTenge(2000)}` }))
    expect(onSubmit).toHaveBeenCalledWith([{ method: "cash", amount: 2000, tendered: 2000 }])
  })

  it("a stale redemption blocks the confirmation with its reason", () => {
    render(<PaymentDialog open onOpenChange={() => {}} total={2300} loyaltyRedemption={300} blockedReason="Списание баллами больше допустимого" submitting={false} error={null} onSubmit={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toBe("Списание баллами больше допустимого")
    expect((screen.getByRole("button", { name: /Подтвердить/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
