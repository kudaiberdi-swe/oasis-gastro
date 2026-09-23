import { useState } from "react"

import { PinPad } from "@/pos/components/pin-pad"
import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"

function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 40" width="72" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M60 6 L66 20 L60 34 L54 20 Z" />
      <path d="M66 20 C76 20 82 12 90 12 C98 12 102 18 100 23 C98 28 91 28 90 23 C89 19 94 18 95 21" />
      <path d="M54 20 C44 20 38 12 30 12 C22 12 18 18 20 23 C22 28 29 28 30 23 C31 19 26 18 25 21" />
      <path d="M66 20 C76 20 82 28 90 28" />
      <path d="M54 20 C44 20 38 28 30 28" />
      <path d="M104 20 H118" />
      <path d="M16 20 H2" />
      <circle cx="60" cy="20" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function LoginScreen({ onLogin, restaurantHint }: { onLogin: (code: string, pin: string) => Promise<unknown>; restaurantHint?: string }) {
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [stage, setStage] = useState<"code" | "pin">("code")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const active = stage === "code" ? code : pin
  const setActive = stage === "code" ? setCode : setPin

  function handleDigit(digit: string) {
    setError(null)
    if (active.length >= 6) return
    setActive(active + digit)
  }

  function handleBackspace() {
    setError(null)
    setActive(active.slice(0, -1))
  }

  async function handleSubmit() {
    if (stage === "code") {
      if (!code) return
      setStage("pin")
      return
    }
    if (!pin) return
    setSubmitting(true)
    setError(null)
    try {
      await onLogin(code, pin)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось войти"))
      setPin("")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-3 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-12" />
        <div className="flex items-center gap-3 text-[color:var(--brass)]">
          <Ornament />
          <Ornament className="-scale-x-100" />
        </div>
        <p className="text-sm text-nav-foreground/65">{restaurantHint ?? "Касса"}</p>
      </div>

      <div className="w-full max-w-sm rounded-[var(--radius-panel)] bg-card p-8 shadow-[var(--shadow-float)]">
        <p className="mb-2 text-sm text-muted-foreground">{stage === "code" ? "Код сотрудника" : "PIN-код"}</p>
        <div className="mb-4 flex h-14 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted text-2xl font-semibold tracking-[0.3em]">
          {stage === "pin" ? "•".repeat(pin.length) || " " : code || " "}
        </div>
        {error && <p className="mb-3 text-center text-sm font-semibold text-destructive">{error}</p>}
        <PinPad onDigit={handleDigit} onBackspace={handleBackspace} disabled={submitting} />
        <div className="mt-4 flex gap-2">
          {stage === "pin" && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => {
                setStage("code")
                setPin("")
                setError(null)
              }}
              disabled={submitting}
            >
              Назад
            </Button>
          )}
          <Button type="button" size="lg" className="flex-1" onClick={handleSubmit} disabled={submitting || !active}>
            {stage === "code" ? "Далее" : submitting ? "Вход…" : "Войти"}
          </Button>
        </div>
      </div>
    </div>
  )
}
