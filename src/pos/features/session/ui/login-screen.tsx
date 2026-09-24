import { useState } from "react"

import { Banner, Button, OrnamentPair, PinPad } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export function LoginScreen({ onLogin, restaurantHint }: { onLogin: (code: string, pin: string) => Promise<unknown>; restaurantHint?: string }) {
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [stage, setStage] = useState<"code" | "pin">("code")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const active = stage === "code" ? code : pin
  const setActive = stage === "code" ? setCode : setPin

  function handleChange(next: string) {
    setError(null)
    setActive(next)
  }

  async function handleSubmit() {
    if (submitting) return
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
        <OrnamentPair className="text-nav-accent" />
        <p className="text-body-sm text-nav-muted">{restaurantHint ?? "Касса"}</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2 rounded-panel bg-card p-8 shadow-float">
        <p className="text-center text-body-sm font-medium text-muted-foreground">{stage === "code" ? "Код сотрудника" : "PIN-код"}</p>
        {/* Employee codes are 3–12 digits; PINs 4–6 (the server rule in domains/workforce). */}
        <PinPad
          key={stage}
          label={stage === "code" ? "Код сотрудника" : "PIN-код"}
          value={active}
          onValueChange={handleChange}
          maxLength={stage === "code" ? 12 : 6}
          secret={stage === "pin"}
          onSubmit={() => void handleSubmit()}
          disabled={submitting}
        />
        {error && <Banner tone="danger" title={error} className="mt-2" />}
        <div className="mt-4 flex gap-2">
          {stage === "pin" && (
            <Button
              type="button"
              variant="secondary"
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
