import { useState } from "react"

import type { PosDeletionReason } from "@/pos/features/retail/data/use-retail-settings"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, Textarea } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

export type CancelInput = { deletionReasonExternalId?: string; comment?: string; reason?: string; managerApprovalToken: string }

/** Minimum comment the server accepts (orders/mutations.ts cancel). */
const MIN_COMMENT = 3

/** Why «Отменить заказ» cannot be sent yet, or null. With no published reasons the free reason is required. */
export function cancelProblem(reasons: PosDeletionReason[], reason: PosDeletionReason | undefined, comment: string) {
  if (reasons.length === 0) return comment.trim().length < MIN_COMMENT ? "Укажите причину отмены" : null
  if (!reason) return "Выберите основание"
  if (reason.data.requireComment && comment.trim().length < MIN_COMMENT) return "Для этой причины нужен комментарий"
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
  const [reasonId, setReasonId] = useState<string | undefined>(reasons.length === 1 ? reasons[0].externalId : undefined)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const reason = reasons.find((candidate) => candidate.externalId === reasonId)
  const problem = cancelProblem(reasons, reason, comment)
  const legacy = reasons.length === 0

  async function submit() {
    if (problem || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const what = orderNumber !== undefined ? `заказа №${orderNumber}` : "заказа"
      const token = await onManagerRequired(`Отмена ${what}${reason ? ` (${reason.name})` : ""} требует подтверждения менеджера`)
      if (!token) return
      await onCancel(legacy ? { reason: comment.trim(), managerApprovalToken: token } : { deletionReasonExternalId: reason!.externalId, comment: comment.trim() || undefined, managerApprovalToken: token })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось отменить заказ"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Отменить заказ{orderNumber !== undefined ? ` №${orderNumber}` : ""}</DialogTitle>
        <DialogDescription>
          Заказ закроется без оплаты, запись с причиной останется в журнале кассы.{sentToKitchen ? " Кухня получит отмену." : ""}
        </DialogDescription>
      </DialogHeader>
      {!legacy && (
        <Field label="Основание" hint={reason?.data.writeOff && sentToKitchen ? "Отправленные на кухню блюда спишутся по техкарте" : undefined}>
          {(control) => (
            <Select
              {...control}
              value={reasonId}
              onValueChange={(value) => {
                setReasonId(value)
                setError(null)
              }}
              placeholder="Выберите основание"
              options={reasons.map((candidate) => ({ value: candidate.externalId, label: candidate.data.writeOff ? `${candidate.name} · со списанием` : candidate.name }))}
              className="h-[var(--control-h-pos)] text-body"
            />
          )}
        </Field>
      )}
      <Field label={legacy || reason?.data.requireComment ? "Причина (обязательно)" : "Комментарий"}>
        {(control) => <Textarea {...control} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например, гость ушёл до подачи" className="text-body" />}
      </Field>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          Назад
        </Button>
        <Button variant="danger" size="lg" onClick={submit} disabled={Boolean(problem) || submitting}>
          {submitting ? "Отмена…" : "Отменить заказ"}
        </Button>
      </DialogFooter>
    </>
  )
}
