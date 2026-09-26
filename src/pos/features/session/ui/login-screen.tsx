import { Lock, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { posErrorMessage, useT } from "@/pos/i18n"
import { LanguageLink } from "@/pos/i18n/language-switch"
import { Banner, Button, OrnamentPair, PinPad } from "@/shared/components/ui"

// The server rule (convex/lib/policy.ts): employee codes up to 12 digits, PINs 4–6.
const CODE_MAX = 12
const PIN_MIN = 4
const PIN_MAX = 6

export interface LoginScreenProps {
  onLogin: (code: string, pin: string) => Promise<unknown>
  /** «Sandyq · <филиал> · <касса>», from the terminal record — never a constant (L-6). */
  terminalLabel?: string
  /** After an idle lock: same screen, «Касса заблокирована». */
  locked?: boolean
  onChangeTerminal?: () => void
}

/** Employee code, then PIN; both from the pad or the physical keyboard, Enter submits (S-14, L-15). */
export function LoginScreen({ onLogin, terminalLabel, locked = false, onChangeTerminal }: LoginScreenProps) {
  const t = useT()
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [stage, setStage] = useState<"code" | "pin">("code")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const active = stage === "code" ? code : pin
  const setActive = stage === "code" ? setCode : setPin
  const canSubmit = stage === "code" ? code.length > 0 : pin.length >= PIN_MIN

  function handleChange(next: string) {
    setError(null)
    setActive(next)
  }

  async function handleSubmit() {
    if (submitting || !canSubmit) return
    if (stage === "code") {
      setStage("pin")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onLogin(code, pin)
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("login.failed")))
      setPin("")
    } finally {
      setSubmitting(false)
    }
  }

  const Icon = locked ? Lock : ShieldCheck

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-nav px-6">
      <div className="flex flex-col items-center gap-3 text-nav-foreground">
        <img src="/branding/sandyq-kz-logo.svg" alt="Sandyq" className="h-12" />
        <OrnamentPair className="text-nav-accent" />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-card p-8 shadow-float">
        <div className="flex flex-col items-center gap-1 text-center">
          <Icon aria-hidden className="size-6 text-accent" />
          <h1 className="font-display text-title font-semibold">{locked ? t("login.locked") : t("login.title")}</h1>
          {terminalLabel ? <p className="text-body text-muted-foreground">{terminalLabel}</p> : null}
        </div>
        <p className="text-center text-body-sm font-medium text-muted-foreground">{stage === "code" ? t("login.code") : t("login.pin")}</p>
        <PinPad
          key={stage}
          label={stage === "code" ? t("login.code") : t("login.pin")}
          value={active}
          onValueChange={handleChange}
          maxLength={stage === "code" ? CODE_MAX : PIN_MAX}
          secret={stage === "pin"}
          onSubmit={() => void handleSubmit()}
          disabled={submitting}
        />
        {error && <Banner tone="danger" title={error} />}
        <div className="mt-1 flex gap-2">
          {stage === "pin" && (
            <Button
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
              {t("common.back")}
            </Button>
          )}
          <Button size="lg" className="flex-1" onClick={() => void handleSubmit()} disabled={submitting || !canSubmit}>
            {stage === "code" ? t("common.next") : submitting ? t("login.signingIn") : t("login.signIn")}
          </Button>
        </div>
        <p className="text-center text-body-sm text-muted-foreground">{t("login.hint")}</p>
        {onChangeTerminal && !locked ? (
          <Button variant="link" className="self-center" onClick={onChangeTerminal}>
            {t("login.changeTerminal")}
          </Button>
        ) : null}
        <LanguageLink label={t("common.switchLanguage")} />
      </div>
    </div>
  )
}
