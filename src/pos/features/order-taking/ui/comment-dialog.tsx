import { useState } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Textarea } from "@/shared/components/ui"
import { posErrorMessage, useT } from "@/pos/i18n"

/** «Комментарий к заказу» (W1-POS-15): saved with the check (saveDraft comment), visible in the history. */
export function CommentDialog({
  open,
  onOpenChange,
  comment,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  comment: string
  onSave: (comment: string) => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">{open && <CommentForm comment={comment} onCancel={() => onOpenChange(false)} onSave={onSave} onSaved={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function CommentForm({ comment, onCancel, onSave, onSaved }: { comment: string; onCancel: () => void; onSave: (comment: string) => Promise<unknown>; onSaved: () => void }) {
  const t = useT()
  const [text, setText] = useState(comment)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(text.trim())
      onSaved()
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("comment.failed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("comment.title")}</DialogTitle>
        <DialogDescription>{t("comment.description")}</DialogDescription>
      </DialogHeader>
      <Field label={t("common.comment")}>
        {(control) => <Textarea {...control} rows={4} value={text} maxLength={500} onChange={(event) => setText(event.target.value)} placeholder={t("comment.placeholder")} className="text-body" />}
      </Field>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button size="lg" onClick={save} disabled={saving || text.trim() === comment.trim()}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  )
}
