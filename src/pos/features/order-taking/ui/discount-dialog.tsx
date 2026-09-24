import { useRef, useState } from "react"

import { Button } from "@/shared/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

const QUICK_PERCENTS = [5, 10, 15, 20]

export function DiscountDialog({
  open,
  onOpenChange,
  currentPercent,
  onApply,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPercent: number
  onApply: (percent: number, reason: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const [percent, setPercent] = useState(currentPercent)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wasOpen = useRef(open)

  // Re-sync with the selected check every time the dialog opens — switching checks between two
  // openings used to keep the previous check's percent (S-13).
  if (open && !wasOpen.current) {
    setPercent(currentPercent)
    setReason("")
    setError(null)
  }
  wasOpen.current = open

  async function submit() {
    if (percent > 0 && reason.trim().length < 3) {
      setError("Укажите причину скидки")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (percent > 10) {
        const token = await onManagerRequired(`Скидка ${percent}% требует подтверждения менеджера`)
        if (!token) {
          setSubmitting(false)
          return
        }
        managerApprovalToken = token
      }
      await onApply(percent, reason, managerApprovalToken)
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось применить скидку"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Скидка на заказ</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1.5">
          {QUICK_PERCENTS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPercent(value)}
              className={`flex-1 rounded-[var(--radius-control)] border py-2 text-sm font-bold ${percent === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {value}%
            </button>
          ))}
        </div>
        <label className="text-sm text-muted-foreground">Процент вручную</label>
        <input
          type="number"
          value={percent}
          onChange={(event) => setPercent(Math.max(0, Math.min(100, Math.round(Number(event.target.value)))))}
          className={cn("h-11 rounded-[var(--radius-control)] border border-border bg-card px-3 text-right text-lg font-bold", focusRingClass)}
        />
        {percent > 0 && (
          <>
            <label className="text-sm text-muted-foreground">Причина</label>
            <input value={reason} onChange={(event) => setReason(event.target.value)} className={cn("h-11 rounded-[var(--radius-control)] border border-border bg-card px-3", focusRingClass)} />
          </>
        )}
        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setPercent(0)} disabled={submitting}>
            Убрать
          </Button>
          <Button size="lg" className="flex-1" onClick={submit} disabled={submitting}>
            Применить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
