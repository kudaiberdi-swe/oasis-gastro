// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { TerminalPicker } from "@/pos/features/session/ui/terminal-picker"

afterEach(cleanup)

const OPTIONS = [
  {
    restaurantExternalId: "almaty",
    restaurantName: "Sandyq Алматы",
    city: "Алматы",
    address: "ул. Абылай хана, 1",
    terminals: [
      { externalId: "almaty-01", name: "Главная касса", terminalNumber: 1 },
      { externalId: "almaty-02", name: "Касса выдачи", terminalNumber: 2 },
    ],
  },
]

describe("TerminalPicker (W0-POS-01)", () => {
  it("keeps «Продолжить к входу» disabled until a terminal is chosen", async () => {
    const onChoose = vi.fn()
    render(<TerminalPicker options={OPTIONS} onChoose={onChoose} />)
    const proceed = screen.getByRole("button", { name: "Продолжить к входу" })
    expect(proceed).toHaveProperty("disabled", true)
    await userEvent.click(screen.getByRole("radio", { name: /Касса выдачи/ }))
    expect(proceed).toHaveProperty("disabled", false)
    await userEvent.click(proceed)
    expect(onChoose).toHaveBeenCalledWith("almaty-02")
  })

  it("explains a remembered terminal that is gone", () => {
    render(<TerminalPicker options={OPTIONS} onChoose={() => {}} staleTerminal="shymkent-01" />)
    expect(screen.getByText("Сохранённая касса недоступна")).toBeTruthy()
  })
})

describe("LoginScreen (W0-POS-02)", () => {
  it("takes code and PIN from the keyboard, Enter submits, Войти waits for 4 digits", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<LoginScreen onLogin={onLogin} terminalLabel="Sandyq · Sandyq Алматы · Главная касса" />)
    expect(screen.getByText("Sandyq · Sandyq Алматы · Главная касса")).toBeTruthy()
    await userEvent.keyboard("3383{Backspace}95{Enter}")
    expect(screen.getByRole("button", { name: "Войти" })).toHaveProperty("disabled", true)
    await userEvent.keyboard("595")
    expect(screen.getByRole("button", { name: "Войти" })).toHaveProperty("disabled", true)
    await userEvent.keyboard("0{Enter}")
    expect(onLogin).toHaveBeenCalledWith("33895", "5950")
  })

  it("clears the PIN after a failed login and shows the error", async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error("Неверный код сотрудника или PIN"))
    render(<LoginScreen onLogin={onLogin} />)
    await userEvent.keyboard("101{Enter}1234{Enter}")
    expect(await screen.findByText("Неверный код сотрудника или PIN")).toBeTruthy()
    expect(screen.getByRole("status", { name: /PIN-код: введено 0/ })).toBeTruthy()
  })

  it("shows the locked state after an idle lock", () => {
    render(<LoginScreen onLogin={vi.fn()} locked />)
    expect(screen.getByRole("heading", { name: "Касса заблокирована" })).toBeTruthy()
  })
})

describe("terminal caption (L-6)", () => {
  it("does not repeat the brand or the branch", async () => {
    const { terminalLabel } = await import("@/pos/features/order-taking/ui/pos-workspace")
    expect(terminalLabel("Sandyq Шымкент", "Sandyq Шымкент · Касса 1")).toBe("Sandyq Шымкент · Касса 1")
    expect(terminalLabel("Алматы", "Главная касса")).toBe("Sandyq · Алматы · Главная касса")
  })
})
