import { useState } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, MoneyInput, Textarea } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { AccountReference, ShiftCandidate } from "../data/use-finance-records"
import { formatBusinessDate, validateAcceptance, variancePosting } from "../model/modules"

export interface AcceptShiftDialogProps {
  shift: ShiftCandidate
  accounts: readonly AccountReference[]
  onOpenChange: (open: boolean) => void
  onAccept: (args: { shiftId: ShiftCandidate["shiftId"]; recountedCash: number; note: string }) => Promise<unknown>
  /** Prefills «Комментарий» (the «Комментарий при принятии» field of «Кассовые смены»). */
  defaultNote?: string
}

/**
 * «Принять смену» (W1-FIN-06): the accountant's recount is required — never `countedCash ?? expectedCash`;
 * a variance needs a comment and shows the posting it will write.
 */
export function AcceptShiftDialog({ shift, accounts, onOpenChange, onAccept, defaultNote = "" }: AcceptShiftDialogProps) {
  const [recounted, setRecounted] = useState<number | null>(null)
  const [note, setNote] = useState(defaultNote)
  const [errors, setErrors] = useState<{ recountedCash?: string; note?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const posting = variancePosting(shift.expectedCash, recounted, accounts)

  async function submit() {
    const found = validateAcceptance(shift.expectedCash, recounted, note)
    setErrors(found)
    if (Object.keys(found).length || recounted === null) return
    setBusy(true)
    setError(null)
    try {
      await onAccept({ shiftId: shift.shiftId, recountedCash: recounted, note: note.trim() })
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось принять смену"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Принять смену №{shift.shiftNumber}</DialogTitle>
          <DialogDescription>
            {shift.terminalName} · {shift.restaurantName} · {formatBusinessDate(shift.businessDate)}
            {shift.closedAt ? ` · закрыта ${formatAlmatyDateTime(shift.closedAt)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          aria-label="Приёмка смены"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-border bg-muted p-3 text-body-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">Ожидалось в кассе</dt>
              <dd className="font-semibold tabular-nums">{formatTenge(shift.expectedCash)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">Пересчитано кассиром</dt>
              <dd className="font-semibold tabular-nums">{formatTenge(shift.countedCash)}</dd>
            </div>
          </dl>
          <Field label="Пересчитанная наличность" error={errors.recountedCash} hint="Сумма, которую насчитала бухгалтерия">
            {(control) => (
              <MoneyInput
                {...control}
                autoFocus
                value={recounted}
                onValueChange={(value) => {
                  setRecounted(value)
                  setErrors((current) => ({ ...current, recountedCash: undefined }))
                }}
              />
            )}
          </Field>
          <Field label="Комментарий" error={errors.note} hint="Обязателен при расхождении">
            {(control) => (
              <Textarea
                {...control}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value)
                  setErrors((current) => ({ ...current, note: undefined }))
                }}
              />
            )}
          </Field>
          <div aria-live="polite" className="flex flex-col gap-1 rounded-card border border-border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-sm text-muted-foreground">Расхождение</span>
              <span
                className={cn(
                  "sq-price text-title-sm font-semibold tabular-nums",
                  !posting ? "text-muted-foreground" : posting.kind === "none" ? "text-success" : "text-destructive",
                )}
              >
                {posting ? formatTenge(posting.variance, { explicitPlus: true }) : "—"}
              </span>
            </div>
            <p className="text-caption text-muted-foreground">
              {!posting
                ? "Введите пересчитанную наличность."
                : posting.kind === "none"
                  ? "Наличность сходится — проводка не создаётся."
                  : `${posting.kind === "surplus" ? "Излишек" : "Недостача"}: проводка Дт ${posting.debit.code} ${posting.debit.name} — Кт ${posting.credit.code} ${posting.credit.name} на ${formatTenge(Math.abs(posting.variance))}.`}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-body-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Принимаем…" : "Принять"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
