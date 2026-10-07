// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEMO_KITCHEN_LOGIN, DEMO_OFFICE_LOGINS, DEMO_OFFICE_PASSWORD, DEMO_POS_LOGINS } from "@/shared/demo/demo-logins"

// The demo build (VITE_DEMO_MODE=true): role buttons sign in through the existing paths; without the flag nothing changes.

const login = vi.fn()
vi.mock("convex/react", () => ({ useAction: () => login, useMutation: () => vi.fn(), useQuery: () => undefined }))
const signIn = vi.fn()
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn }) }))

const { LoginScreen } = await import("@/pos/features/session/ui/login-screen")
const { usePosSession } = await import("@/pos/features/session/model/use-pos-session")
const { OfficeSignIn } = await import("@/office/features/session/ui/office-sign-in")

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  login.mockReset()
  signIn.mockReset()
  window.localStorage.clear()
})

describe("demo sign-in buttons", () => {
  it("are absent without VITE_DEMO_MODE: the PIN pad and the office form stay", () => {
    render(<LoginScreen onLogin={vi.fn()} />)
    expect(screen.queryByText("Демо-вход: выберите роль")).toBeNull()
    expect(screen.getByRole("button", { name: "Далее" })).toBeTruthy()
    cleanup()
    render(<OfficeSignIn />)
    expect(screen.queryByText("Демо-вход: выберите роль")).toBeNull()
    expect(screen.getByLabelText("Email")).toBeTruthy()
  })

  it("POS: Кассир / Менеджер / Администратор replace the pad; a click logs in with the demo code and PIN", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true")
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<LoginScreen onLogin={onLogin} onChangeTerminal={vi.fn()} />)
    await userEvent.click(await screen.findByRole("button", { name: /^Кассир/ }))
    expect(screen.getByRole("button", { name: /^Менеджер/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Администратор/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Далее" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Сменить рабочее место" })).toBeNull()
    expect(onLogin).toHaveBeenCalledWith(DEMO_POS_LOGINS[0].code, DEMO_POS_LOGINS[0].pin)
  })

  it("POS session: a demo build defaults to the Almaty register and logs in through the existing login action", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true")
    login.mockResolvedValue({ sessionToken: "s", expiresAt: Date.now() + 60_000, employee: {}, terminal: {}, restaurant: {} })
    const { result } = renderHook(() => usePosSession())
    expect(result.current.terminalExternalId).toBe("sandyq-almaty-01")
    await result.current.signIn(DEMO_POS_LOGINS[0].code, DEMO_POS_LOGINS[0].pin)
    expect(login).toHaveBeenCalledWith({ employeeCode: DEMO_POS_LOGINS[0].code, pin: DEMO_POS_LOGINS[0].pin, terminalExternalId: "sandyq-almaty-01", purpose: "operator" })
  })

  it("kitchen: one «Кухня» button with the kitchen employee", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true")
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<LoginScreen surface="kitchen" onLogin={onLogin} />)
    await userEvent.click(await screen.findByRole("button", { name: /^Кухня/ }))
    expect(screen.queryByRole("button", { name: /^Кассир/ })).toBeNull()
    expect(onLogin).toHaveBeenCalledWith(DEMO_KITCHEN_LOGIN.code, DEMO_KITCHEN_LOGIN.pin)
  })

  it("office: Администратор calls signIn(\"password\") with the demo e-mail; no form, no sign-up", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true")
    signIn.mockResolvedValue(undefined)
    render(<OfficeSignIn />)
    await userEvent.click(await screen.findByRole("button", { name: /^Администратор/ }))
    expect(screen.getByRole("button", { name: /^Управляющий рестораном/ })).toBeTruthy()
    expect(screen.queryByLabelText("Email")).toBeNull()
    expect(screen.queryByRole("radio", { name: "Регистрация" })).toBeNull()
    expect(signIn).toHaveBeenCalledWith("password", { email: DEMO_OFFICE_LOGINS[0].email, password: DEMO_OFFICE_PASSWORD, flow: "signIn" })
  })
})
