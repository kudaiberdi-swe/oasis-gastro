import { useState } from "react"

import type { PosDeletionReason } from "@/pos/features/retail/data/use-retail-settings"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, Textarea } from "@/shared/components/ui"
import { posErrorMessage, ruT, useT, type Translator } from "@/pos/i18n"

export type CancelInput = { deletionReasonExternalId?: string; comment?: string; reason?: string; managerApprovalToken: string }

/** Minimum comment the server accepts (orders/mutations.ts cancel). */
const MIN_COMMENT = 3

/** Why «Отменить заказ» cannot be sent yet, or null. With no published reasons the free reason is required. */
export function cancelProblem(reasons: PosDeletionReason[], reason: PosDeletionReason | undefined, comment: string, t: Translator = ruT) {
  if (reasons.length === 0) return comment.trim().length < MIN_COMMENT ? t("cancel.reasonRequired") : null
  if (!reason) return t("cancel.chooseBasis")
  if (reason.data.requireComment && comment.trim().length < MIN_COMMENT) return t("cancel.commentRequired")
  return null
}

/**
 * «Отменить заказ» (W1-POS-06/15): the reason comes from the deletion reasons published for POS (a
 * free reason while the list is empty); the manager PIN is always required. What the kitchen already
 * cooked is written off when the reason says so.
 */
export function CancelOrderDialog({
  open,
  onOpenChange,
  orderNumber,
  sentToKitchen,
  reasons,
  onCancel,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderNumber?: number
  sentToKitchen: boolean
  reasons: PosDeletionReason[]
  onCancel: (input: CancelInput) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open && (
          <CancelForm
            orderNumber={orderNumber}
            sentToKitchen={sentToKitchen}
            reasons={reasons}
            onBack={() => onOpenChange(false)}
            onCancel={onCancel}
            onDone={() => onOpenChange(false)}
            onManagerRequired={onManagerRequired}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CancelForm({
  orderNumber,
  sentToKitchen,
  reasons,
  onBack,
  onCancel,
  onDone,
  onManagerRequired,
}: {
  orderNumber?: number
  sentToKitchen: boolean
  reasons: PosDeletionReason[]
  onBack: () => void
  onCancel: (input: CancelInput) => Promise<unknown>
  onDone: () => void
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const t = useT()
  const [reasonId, setReasonId] = useState<string | undefined>(reasons.length === 1 ? reasons[0].externalId : undefined)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const reason = reasons.find((candidate) => candidate.externalId === reasonId)
  const problem = cancelProblem(reasons, reason, comment, t)
  const legacy = reasons.length === 0

  async function submit() {
    if (problem || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const because = reason ? ` (${reason.name})` : ""
      const token = await onManagerRequired(orderNumber !== undefined ? t("cancel.approvalNumber", { number: orderNumber, reason: because }) : t("cancel.approval", { reason: because }))
      if (!token) return
      await onCancel(legacy ? { reason: comment.trim(), managerApprovalToken: token } : { deletionReasonExternalId: reason!.externalId, comment: comment.trim() || undefined, managerApprovalToken: token })
      onDone()
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("cancel.failed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{orderNumber !== undefined ? t("cancel.titleNumber", { number: orderNumber }) : t("cancel.title")}</DialogTitle>
        <DialogDescription>
          {t("cancel.description")}
          {sentToKitchen ? ` ${t("cancel.kitchen")}` : ""}
        </DialogDescription>
      </DialogHeader>
      {!legacy && (
        <Field label={t("cancel.basis")} hint={reason?.data.writeOff && sentToKitchen ? t("cancel.writeOffHint") : undefined}>
          {(control) => (
            <Select
              {...control}
              value={reasonId}
              onValueChange={(value) => {
                setReasonId(value)
                setError(null)
              }}
              placeholder={t("cancel.chooseBasis")}
              options={reasons.map((candidate) => ({ value: candidate.externalId, label: candidate.data.writeOff ? t("cancel.withWriteOff", { name: candidate.name }) : candidate.name }))}
              className="h-[var(--control-h-pos)] text-body"
            />
          )}
        </Field>
      )}
      <Field label={legacy || reason?.data.requireComment ? t("cancel.reasonRequiredLabel") : t("common.comment")}>
        {(control) => <Textarea {...control} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("cancel.placeholder")} className="text-body" />}
      </Field>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          {t("common.back")}
        </Button>
        <Button variant="danger" size="lg" onClick={submit} disabled={Boolean(problem) || submitting}>
          {submitting ? t("cancel.submitting") : t("cancel.title")}
        </Button>
      </DialogFooter>
    </>
  )
}
