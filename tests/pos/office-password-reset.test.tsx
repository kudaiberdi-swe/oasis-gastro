// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConvexError } from "convex/values"
import { afterEach, describe, expect, it, vi } from "vitest"

import { officePasswordProblem } from "@/office/features/session/model/password"

// W2-ACL-08: «Забыли пароль?» on the office sign-in → «Email» → «Код и новый пароль». Step 1 answers the
// same for any outcome (no account enumeration); the code field is an 8-digit one-time-code input; the
// password rule is checked before sending.

const signIn = vi.fn()
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn }) }))

const { OfficeSignIn } = await import("@/office/features/session/ui/office-sign-in")
const { RESET_CODE_FAILED, RESET_SENT } = await import("@/office/features/session/ui/office-password-reset")

afterEach(() => {
  cleanup()
  signIn.mockReset()
})

const TEST_PASSWORD = "TestPassw0rd"

async function openReset(email = "admin@sandyq.test") {
  render(<OfficeSignIn />)
  await userEvent.type(screen.getByLabelText("Email"), email)
  await userEvent.click(screen.getByRole("button", { name: "Забыли пароль?" }))
  expect(screen.getByRole("heading", { name: "Восстановление пароля" })).toBeTruthy()
}

describe("office password reset", () => {
  it("step 1 asks Convex Auth for a code with the typed email", async () => {
    signIn.mockResolvedValueOnce({ signingIn: false })
    await openReset()
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("admin@sandyq.test")
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    expect(signIn).toHaveBeenCalledWith("password", { flow: "reset", email: "admin@sandyq.test" })
    expect(await screen.findByText(RESET_SENT)).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Код и новый пароль" })).toBeTruthy()
  })

  it.each([
    ["a masked server error", new Error("[CONVEX A(auth:signIn)] Server Error")],
    ["a ConvexError", new ConvexError("Учётная запись не найдена")],
  ])("step 1 shows the same neutral text after %s", async (_, error) => {
    signIn.mockRejectedValueOnce(error)
    await openReset("nobody@sandyq.test")
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    expect(await screen.findByText(RESET_SENT)).toBeTruthy()
    expect(screen.queryByText(/не найдена|Server Error/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("the code field is an 8-digit one-time code", async () => {
    signIn.mockResolvedValueOnce({ signingIn: false })
    await openReset()
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    const code = (await screen.findByLabelText("Код из письма")) as HTMLInputElement
    expect(code.getAttribute("autocomplete")).toBe("one-time-code")
    expect(code.getAttribute("inputmode")).toBe("numeric")
    expect(code.getAttribute("maxlength")).toBe("8")
    await userEvent.type(code, "12ab345678999")
    expect(code.value).toBe("12345678")
    expect(screen.getByLabelText("Новый пароль").getAttribute("autocomplete")).toBe("new-password")
  })

  it("checks the code, the password rule and the repeat before sending", async () => {
    signIn.mockResolvedValueOnce({ signingIn: false })
    await openReset()
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    await screen.findByLabelText("Код из письма")
    signIn.mockClear()

    await userEvent.type(screen.getByLabelText("Код из письма"), "1234")
    await userEvent.type(screen.getByLabelText("Новый пароль"), "short")
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль и войти" }))
    expect(screen.getByText("Введите 8 цифр из письма")).toBeTruthy()
    expect(screen.getByText(/Ещё нужно: не меньше 10 символов, заглавная буква, цифра/)).toBeTruthy()
    expect(signIn).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText("Код из письма"), "5678")
    await userEvent.clear(screen.getByLabelText("Новый пароль"))
    await userEvent.type(screen.getByLabelText("Новый пароль"), TEST_PASSWORD)
    await userEvent.type(screen.getByLabelText("Повторите пароль"), "TestPassw0rX")
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль и войти" }))
    expect(screen.getByText("Пароли не совпадают")).toBeTruthy()
    expect(signIn).not.toHaveBeenCalled()
  })

  it("step 2 sends the code with the new password; a wrong code gets a generic message", async () => {
    signIn.mockResolvedValueOnce({ signingIn: false })
    await openReset()
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    await userEvent.type(await screen.findByLabelText("Код из письма"), "12345678")
    await userEvent.type(screen.getByLabelText("Новый пароль"), TEST_PASSWORD)
    await userEvent.type(screen.getByLabelText("Повторите пароль"), TEST_PASSWORD)

    signIn.mockRejectedValueOnce(new Error("[CONVEX A(auth:signIn)] Server Error"))
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль и войти" }))
    expect(signIn).toHaveBeenLastCalledWith("password", { flow: "reset-verification", email: "admin@sandyq.test", code: "12345678", newPassword: TEST_PASSWORD })
    expect(await screen.findByText(RESET_CODE_FAILED)).toBeTruthy()

    signIn.mockResolvedValueOnce({ signingIn: true })
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль и войти" }))
    await waitFor(() => expect(screen.queryByText(RESET_CODE_FAILED)).toBeNull())
  })

  it("can resend the code and go back to sign-in", async () => {
    signIn.mockResolvedValue({ signingIn: false })
    await openReset()
    await userEvent.click(screen.getByRole("button", { name: "Получить код" }))
    await userEvent.click(await screen.findByRole("button", { name: "Отправить код ещё раз" }))
    expect(signIn).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole("button", { name: "Вернуться ко входу" }))
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy()
  })

  it("the sign-up tab has no «Забыли пароль?»", async () => {
    render(<OfficeSignIn />)
    await userEvent.click(screen.getByRole("radio", { name: "Регистрация" }))
    expect(screen.queryByRole("button", { name: "Забыли пароль?" })).toBeNull()
  })
})

describe("officePasswordProblem", () => {
  it("matches assertOfficePassword: 10+ chars, upper, lower, digit (Latin or Cyrillic)", () => {
    expect(officePasswordProblem(TEST_PASSWORD)).toBeNull()
    expect(officePasswordProblem("ТестовыйПароль1")).toBeNull()
    expect(officePasswordProblem("testpassw0rd")).toMatch(/заглавная буква/)
    expect(officePasswordProblem("TESTPASSW0RD")).toMatch(/строчная буква/)
    expect(officePasswordProblem("TestPassword")).toMatch(/цифра/)
    expect(officePasswordProblem("Tp1")).toMatch(/не меньше 10 символов/)
  })
})
