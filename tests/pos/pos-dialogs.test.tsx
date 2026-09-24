// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { cashPresets, PaymentDialog } from "@/pos/features/checkout/ui/payment-dialog"
import { GuestDialog } from "@/pos/features/loyalty/ui/guest-dialog"
import { DiscountDialog } from "@/pos/features/order-taking/ui/discount-dialog"
import { CloseShiftPanel } from "@/pos/features/shifts/ui/shift-dialog"
import { formatTenge } from "@/shared/lib/utils"

vi.mock("@/pos/features/loyalty/data/use-loyalty", () => ({ useFindGuestByPhone: () => undefined }))

afterEach(cleanup)

describe("shift close is a blind count (S-12)", () => {
  it("starts empty and reveals the expected cash and variance only after input", () => {
    const onClose = vi.fn()
    render(<CloseShiftPanel expectedCash={22_300} blockers={[]} onClose={onClose} onManagerRequired={async () => null} />)

    const counted = screen.getByLabelText("Фактическая наличность") as HTMLInputElement
    expect(counted.value).toBe("")
    expect(screen.queryByText(/Ожидается в кассе/)).toBeNull()
    expect(screen.getByRole("button", { name: /Закрыть смену и сформировать Z-отчёт/ })).toHaveProperty("disabled", true)

    fireEvent.change(counted, { target: { value: "22000" } })
    expect(screen.getByText(/Ожидается в кассе/)).toBeTruthy()
    expect(screen.getByText(/Расхождение: \u2212300\s₸/)).toBeTruthy()
    expect(formatTenge(-300)).toBe("\u2212300\u00a0₸")
  })
})

describe("discount dialog follows the selected check (S-13)", () => {
  it("shows the new check's percent when reopened for another check", () => {
    const props = { onOpenChange: () => {}, onApply: vi.fn(), onManagerRequired: async () => null }
    const { rerender } = render(<DiscountDialog open currentPercent={5} {...props} />)
    const manual = () => screen.getByRole("spinbutton") as HTMLInputElement
    expect(manual().value).toBe("5")

    rerender(<DiscountDialog open={false} currentPercent={5} {...props} />)
    rerender(<DiscountDialog open currentPercent={15} {...props} />)
    expect(manual().value).toBe("15")
  })
})

describe("guest detach errors are shown (S-21)", () => {
  it("renders the failure instead of swallowing it", async () => {
    render(
      <GuestDialog
        open
        onOpenChange={() => {}}
        currentGuest={{ phone: "77010000000", name: "Айгерим", points: 40 }}
        sessionToken="token"
        onAttach={vi.fn()}
        onDetach={() => Promise.reject(new Error("Заказ уже оплачен"))}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Убрать гостя" }))
    await waitFor(() => expect(screen.getByText("Заказ уже оплачен")).toBeTruthy())
  })
})

describe("payment dialog (S-15, S-22)", () => {
  it("labels cash presets with what they do", () => {
    expect(cashPresets(5750).map((preset) => preset.label)).toEqual(["Без сдачи", formatTenge(6000), formatTenge(10_000)])
    expect(cashPresets(6000).map((preset) => preset.tendered)).toEqual([6000, 10_000])
  })

  it("keeps each part's own amount when a middle split part is removed", () => {
    const onSubmit = vi.fn()
    render(<PaymentDialog open onOpenChange={() => {}} total={3000} submitting={false} error={null} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: /Смешанная оплата/ }))
    const parts = () => screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-label")?.startsWith("Часть"))
    const amount = (part: HTMLElement) => within(part).getAllByRole("textbox")[0] as HTMLInputElement

    fireEvent.change(amount(parts()[0]), { target: { value: "1000" } }) // two parts: the other takes 2000
    fireEvent.click(screen.getByRole("button", { name: /Добавить часть/ })) // third part, nothing left
    fireEvent.change(amount(parts()[1]), { target: { value: "500" } })
    fireEvent.change(amount(parts()[2]), { target: { value: "1500" } })

    fireEvent.click(within(parts()[1]).getByRole("button", { name: /Убрать часть/ }))
    expect(parts()).toHaveLength(2)
    expect(amount(parts()[1]).value).toBe("1\u2009500")
  })
})
