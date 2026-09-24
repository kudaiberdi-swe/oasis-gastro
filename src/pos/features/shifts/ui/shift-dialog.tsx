import { useState } from "react"

import { Banner, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Field, Input, MoneyInput } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, formatTenge } from "@/shared/lib/utils"

export function OpenShiftDialog({ open, onOpen }: { open: boolean; onOpen: (openingCash: number, note: string) => Promise<unknown> }) {
  const [openingCash, setOpeningCash] = useState<number | null>(0)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await onOpen(Math.max(0, Math.round(openingCash ?? 0)), note)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось открыть смену"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent hideClose className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Открытие смены</DialogTitle>
        </DialogHeader>
        <Field label="Наличность в кассе на начало смены">
          {(control) => <MoneyInput {...control} value={openingCash} onValueChange={setOpeningCash} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        <Field label="Комментарий">
          {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} className="h-[var(--control-h-pos)]" />}
        </Field>
        {error && <p className="text-body-sm font-semibold text-destructive">{error}</p>}
        <Button size="lg" onClick={submit} disabled={submitting}>
          {submitting ? "Открытие…" : "Открыть смену"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export function CloseShiftDialog({
  open,
  onOpenChange,
  expectedCash,
  blockers,
  onClose,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expectedCash: number
  blockers: Array<{ number: number; tableLabel?: string }>
  onClose: (countedCash: number, note: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  // Blind count (POS-DESIGN §6.2): the cashier enters what is in the drawer first; the expected
  // amount and the variance appear only after that.
  const [counted, setCounted] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variance = counted === null ? 0 : counted - expectedCash

  async function submit() {
    if (blockers.length) {
      setError("Закройте или отложите все открытые заказы")
      return
    }
    if (counted === null) {
      setError("Введите фактическую наличность")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (Math.abs(variance) >= 1000) {
        const token = await onManagerRequired(`Подтвердите расхождение ${formatTenge(variance, { explicitPlus: true })}`)
        if (!token) {
          setSubmitting(false)
          return
        }
        managerApprovalToken = token
      }
      await onClose(counted, note, managerApprovalToken)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось закрыть смену"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Закрытие смены</DialogTitle>
        </DialogHeader>
        {blockers.length > 0 && <Banner tone="danger" title="Есть незакрытые заказы">{blockers.map((b) => b.tableLabel || `№${b.number}`).join(", ")}</Banner>}
        <Field id="close-shift-counted" label="Фактическая наличность">
          {(control) => <MoneyInput {...control} value={counted} onValueChange={setCounted} className="h-[var(--control-h-pos)] text-body font-semibold" />}
        </Field>
        {counted !== null && (
          <>
            <p className="text-body-sm text-muted-foreground">Ожидается в кассе: {formatTenge(expectedCash)}</p>
            <p className={cn("text-body-sm font-semibold tabular-nums", variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-success" : "text-destructive")}>
              Расхождение: {formatTenge(variance, { explicitPlus: true })}
            </p>
          </>
        )}
        <Field id="close-shift-note" label="Комментарий">
          {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} className="h-[var(--control-h-pos)]" />}
        </Field>
        {error && <p className="text-body-sm font-semibold text-destructive">{error}</p>}
        <Button size="lg" onClick={submit} disabled={submitting || counted === null}>
          {submitting ? "Закрытие…" : "Закрыть смену"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
