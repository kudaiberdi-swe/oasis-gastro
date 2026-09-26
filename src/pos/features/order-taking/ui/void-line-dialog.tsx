import { useRef, useState } from "react"

import type { PosDeletionReason } from "@/pos/features/retail/data/use-retail-settings"
import { lineDetails, lineDetailsKk, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Money, RadioGroup, Textarea } from "@/shared/components/ui"
import { posErrorMessage, ruT, useT, type Translator } from "@/pos/i18n"

/** A manager confirms when the reason says so or the kitchen already has the line (voidLine on the server). */
export function voidNeedsManager(reason: PosDeletionReason | undefined, line: Pick<OrderDraftLine, "sentToKitchenAt">) {
  return Boolean(reason?.data.requireManager || line.sentToKitchenAt)
}

function reasonHint(reason: PosDeletionReason, t: Translator = ruT) {
  return [reason.data.requireComment && t("void.hintComment"), reason.data.requireManager && t("void.hintManager"), reason.data.writeOff && t("void.hintWriteOff")].filter(Boolean).join(" · ") || undefined
}

/**
 * «Удалить позицию» (W1-POS-15): reason from the deletion-reason list, a comment when the reason
 * requires one, then the manager PIN when needed. The line stays on the check, struck through.
 */
export function VoidLineDialog({
  line,
  reasons,
  onOpenChange,
  onVoid,
  onManagerRequired,
}: {
  /** The line to remove; null closes the dialog. */
  line: OrderDraftLine | null
  reasons: PosDeletionReason[]
  onOpenChange: (open: boolean) => void
  onVoid: (input: { deletionReasonExternalId: string; comment?: string; managerApprovalToken?: string }) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const t = useT()
  const [reasonId, setReasonId] = useState<string | undefined>(undefined)
  const [comment, setComment] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const shownLine = useRef<string | null>(null)

  // Fresh form for every line the dialog is opened for.
  const lineId = line?.clientLineId ?? null
  if (lineId !== shownLine.current) {
    shownLine.current = lineId
    setReasonId(reasons.length === 1 ? reasons[0].externalId : undefined)
    setComment("")
    setError(null)
    setSubmitting(false)
  }

  const reason = reasons.find((candidate) => candidate.externalId === reasonId)
  const commentRequired = Boolean(reason?.data.requireComment)
  const commentMissing = commentRequired && comment.trim().length < 3

  async function submit() {
    if (!line || !reason || submitting) return
    if (commentMissing) {
      setError(t("cancel.commentRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let managerApprovalToken: string | undefined
      if (voidNeedsManager(reason, line)) {
        const token = await onManagerRequired(t("void.approval", { name: t.locale === "kk" && line.nameKk?.trim() ? line.nameKk : line.name, reason: reason.name }))
        if (!token) {
          setSubmitting(false)
          return
        }
        managerApprovalToken = token
      }
      await onVoid({ deletionReasonExternalId: reason.externalId, comment: comment.trim() || undefined, managerApprovalToken })
      onOpenChange(false)
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("void.failed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={line !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("actions.void")}</DialogTitle>
          <DialogDescription>
            {line?.sentToKitchenAt ? t("void.kitchenDescription") : t("void.description")}
          </DialogDescription>
        </DialogHeader>
        {line && (
          <div className="flex items-start justify-between gap-3 rounded-control border border-border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-body font-semibold">
                {line.quantity} × <span lang={t.locale === "kk" && line.nameKk?.trim() ? "kk" : "ru"}>{t.locale === "kk" && line.nameKk?.trim() ? line.nameKk : line.name}</span>
              </p>
              {lineDetails(line) && <p className="text-body-sm text-muted-foreground">{t.locale === "kk" ? (lineDetailsKk(line) ?? lineDetails(line)) : lineDetails(line)}</p>}
            </div>
            <Money value={lineTotal(line)} size="sm" />
          </div>
        )}
        {reasons.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t("void.noReasons")}</p>
        ) : (
          <div className="grid gap-1.5">
            <p id="void-reason-label" className="text-body-sm font-medium text-muted-foreground">
              {t("cancel.basis")}
            </p>
            <RadioGroup
              aria-labelledby="void-reason-label"
              value={reasonId}
              onValueChange={(value) => {
                setReasonId(value)
                setError(null)
              }}
              options={reasons.map((candidate) => ({ value: candidate.externalId, label: candidate.name, description: reasonHint(candidate, t) }))}
            />
          </div>
        )}
        <Field label={commentRequired ? t("void.commentRequiredLabel") : t("common.comment")}>
          {(control) => <Textarea {...control} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("void.placeholder")} />}
        </Field>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.back")}
          </Button>
          <Button variant="danger" size="lg" onClick={submit} disabled={!reason || commentMissing || submitting}>
            {submitting ? t("void.submitting") : t("actions.void")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
