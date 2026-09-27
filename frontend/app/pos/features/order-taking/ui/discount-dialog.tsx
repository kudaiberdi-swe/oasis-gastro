import { useRef, useState } from "react"

import { Button, Chip, Dialog, DialogContent, DialogHeader, DialogTitle, Field, Input, Money } from "@/shared/components/ui"
import { posErrorMessage, useT } from "@/pos/i18n"

const QUICK_PERCENTS = [5, 10, 15, 20]

/**
 * The check total with `percent` off, computed like the order draft (use-order-draft): the discount comes
 * off the subtotal, the service charge is taken from what remains. The server recomputes it on save.
 */
export function totalAfterDiscount(subtotal: number, percent: number, serviceChargePercent = 0) {
  const discount = Math.round(subtotal * (percent / 100))
  const service = Math.max(0, Math.round((subtotal - discount) * (serviceChargePercent / 100)))
  return subtotal - discount + service
}

export function DiscountDialog({
  open,
  onOpenChange,
  currentPercent,
  subtotal,
  serviceChargePercent = 0,
  onApply,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPercent: number
  /** The check's subtotal: with it the dialog previews «Итого после скидки» as the percent changes. */
  subtotal?: number
  serviceChargePercent?: number
  onApply: (percent: number, reason: string, managerApprovalToken?: string) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const t = useT()
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
      setError(t("discount.reasonRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (percent > 10) {
        const token = await onManagerRequired(t("discount.approval", { percent }))
        if (!token) {
          setSubmitting(false)
          return
        }
        managerApprovalToken = token
      }
      await onApply(percent, reason, managerApprovalToken)
      onOpenChange(false)
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("discount.failed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("discount.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1.5">
          {QUICK_PERCENTS.map((value) => (
            <Chip key={value} size="lg" active={percent === value} className="flex-1 justify-center tabular-nums" onClick={() => setPercent(value)}>
              {value}%
            </Chip>
          ))}
        </div>
        <Field label={t("discount.manual")}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              value={percent}
              onChange={(event) => setPercent(Math.max(0, Math.min(100, Math.round(Number(event.target.value)))))}
              className="h-[var(--control-h-pos)] text-right text-body font-semibold tabular-nums"
            />
          )}
        </Field>
        {percent > 0 && (
          <Field label={t("common.reason")}>
            {(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} className="h-[var(--control-h-pos)]" />}
          </Field>
        )}
        {subtotal !== undefined && (
          <div className="flex items-baseline justify-between rounded-control bg-muted px-4 py-3" aria-live="polite">
            <span className="text-body font-semibold">{t("discount.totalAfter")}</span>
            <Money value={totalAfterDiscount(subtotal, percent, serviceChargePercent)} size="lg" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setPercent(0)} disabled={submitting}>
            {t("discount.remove")}
          </Button>
          <Button size="lg" className="flex-1" onClick={submit} disabled={submitting}>
            {t("discount.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
