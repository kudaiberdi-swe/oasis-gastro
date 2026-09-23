import { useState } from "react"

import { PinPad } from "@/pos/components/pin-pad"
import { Button } from "@/shared/components/ui/button"
import { errorMessage } from "@/shared/lib/error-message"

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
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-nav">
      <img src="/images/decor-ozen.svg" alt="" aria-hidden className="pointer-events-none absolute -left-24 top-1/2 h-[140%] -translate-y-1/2 opacity-[0.07]" />
      <img src="/images/decor-turanga.svg" alt="" aria-hidden className="pointer-events-none absolute -right-16 bottom-[-10%] h-[70%] opacity-[0.08]" />
      <div className="relative w-full max-w-sm rounded-[var(--radius-panel)] bg-card p-8 shadow-[var(--shadow-float)]">
        <div className="mb-7 flex flex-col items-center gap-3">
          <img
            src="/branding/sandyq-kz-logo.svg"
            alt="Sandyq"
            className="h-14"
            style={{ filter: "invert(14%) sepia(28%) saturate(1400%) hue-rotate(340deg)" }}
          />
          {restaurantHint && <p className="text-sm text-muted-foreground">{restaurantHint}</p>}
        </div>
        <p className="mb-2 text-sm text-muted-foreground">{stage === "code" ? "Код сотрудника" : "PIN-код"}</p>
        <div className="mb-4 flex h-14 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted text-2xl font-bold tracking-[0.3em]">
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
