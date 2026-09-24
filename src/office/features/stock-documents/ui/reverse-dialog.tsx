import { useState } from "react"

import { ConfirmDialog } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

/** «Сторно» of a posted document (L-18): reverse movements and entries, the reason is required. */
export function ReverseDialog({ open, onOpenChange, title, onReverse }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; onReverse: (reason: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setError(null)
      }}
      title={title}
      description="Движения и проводки будут отменены обратными записями; сам документ останется в истории со статусом «Сторнирован»."
      confirmLabel="Сторнировать"
      reasonLabel="Причина сторно"
      submitting={busy}
      error={error}
      onConfirm={async (reason) => {
        if (reason.length < 3) {
          setError("Опишите причину — хотя бы несколько слов")
          return
        }
        setBusy(true)
        setError(null)
        try {
          await onReverse(reason)
          onOpenChange(false)
        } catch (caught) {
          setError(errorMessage(caught, "Не удалось сторнировать"))
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}
