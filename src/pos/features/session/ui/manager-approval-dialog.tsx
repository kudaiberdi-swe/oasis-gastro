import { useAction } from "convex/react"
import { useCallback, useRef, useState } from "react"

import { api } from "../../../../../convex/_generated/api"
import { PinPad } from "@/pos/components/pin-pad"
import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"

/**
 * Imperative manager-PIN approval. `requestApproval(reason)` opens the dialog and resolves
 * to a one-shot approval token (or null if cancelled) — pass that token straight into the
 * mutation that needed it. The server revokes the token the instant it's used, so it's never
 * stored beyond the single call site that requested it.
 */
export function useManagerApproval(terminalExternalId: string) {
  const login = useAction(api.domains.auth.actions.login)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [stage, setStage] = useState<"code" | "pin">("code")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const resolver = useRef<((token: string | null) => void) | null>(null)

  const reset = useCallback(() => {
    setCode("")
    setPin("")
    setStage("code")
    setError(null)
    setSubmitting(false)
  }, [])

  const requestApproval = useCallback((approvalReason: string) => {
    setReason(approvalReason)
    reset()
    setOpen(true)
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve
    })
  }, [reset])

  const cancel = useCallback(() => {
    setOpen(false)
    resolver.current?.(null)
    resolver.current = null
  }, [])

  const active = stage === "code" ? code : pin
  const setActive = stage === "code" ? setCode : setPin

  async function submit() {
    if (stage === "code") {
      if (!code) return
      setStage("pin")
      return
    }
    if (!pin) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await login({ employeeCode: code, pin, terminalExternalId, purpose: "manager-approval" })
      setOpen(false)
      resolver.current?.(result.sessionToken)
      resolver.current = null
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось подтвердить"))
      setPin("")
      setSubmitting(false)
    }
  }

  const dialog = (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>Подтверждение менеджера</DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{stage === "code" ? "Код менеджера" : "PIN-код"}</p>
        <div className="flex h-14 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted text-2xl font-bold tracking-[0.3em]">
          {stage === "pin" ? "•".repeat(pin.length) || " " : code || " "}
        </div>
        {error && <p className="text-center text-sm font-semibold text-destructive">{error}</p>}
        <PinPad
          onDigit={(digit) => {
            setError(null)
            if (active.length < 6) setActive(active + digit)
          }}
          onBackspace={() => {
            setError(null)
            setActive(active.slice(0, -1))
          }}
          disabled={submitting}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={cancel} disabled={submitting}>
            Отмена
          </Button>
          <Button type="button" size="lg" className="flex-1" onClick={submit} disabled={submitting || !active}>
            {stage === "code" ? "Далее" : submitting ? "Проверка…" : "Подтвердить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { requestApproval, dialog }
}
