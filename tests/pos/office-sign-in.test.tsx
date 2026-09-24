// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConvexError } from "convex/values"
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver; Radix RadioGroup (SegmentedControl) measures its items with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const signIn = vi.fn()
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn }) }))

const { OfficeAccessDenied, OfficeSignIn } = await import("@/office/features/session/ui/office-sign-in")

afterEach(() => {
  cleanup()
  signIn.mockReset()
})

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Email"), "admin@sandyq.kz")
  await userEvent.type(screen.getByLabelText("Пароль"), "correct-horse")
  await userEvent.click(screen.getByRole("button", { name: "Войти" }))
}

describe("OfficeSignIn", () => {
  it("keeps the password field a password with the right autocomplete per flow", async () => {
    render(<OfficeSignIn />)
    const password = screen.getByLabelText("Пароль")
    expect(password.getAttribute("type")).toBe("password")
    expect(password.getAttribute("autocomplete")).toBe("current-password")
    await userEvent.click(screen.getByRole("radio", { name: "Регистрация" }))
    expect(screen.getByLabelText("Пароль").getAttribute("autocomplete")).toBe("new-password")
    expect(screen.getByLabelText("Имя")).toBeTruthy()
  })

  it("shows the fallback for a masked server error and the real text for a ConvexError", async () => {
    signIn.mockRejectedValueOnce(new Error("[CONVEX A(auth:signIn)] Server Error"))
    render(<OfficeSignIn />)
    await fillAndSubmit()
    expect(await screen.findByText("Неверный email или пароль")).toBeTruthy()
    expect(signIn).toHaveBeenCalledWith("password", { email: "admin@sandyq.kz", password: "correct-horse", name: "", flow: "signIn" })

    signIn.mockRejectedValueOnce(new ConvexError("Пароль слишком короткий"))
    await userEvent.click(screen.getByRole("button", { name: "Войти" }))
    expect(await screen.findByText("Пароль слишком короткий")).toBeTruthy()
  })
})

describe("OfficeAccessDenied", () => {
  it("offers sign-out", async () => {
    const onSignOut = vi.fn()
    render(<OfficeAccessDenied onSignOut={onSignOut} />)
    expect(screen.getByText("Доступ не настроен")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }))
    expect(onSignOut).toHaveBeenCalled()
  })
})
