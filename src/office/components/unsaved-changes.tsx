import type { Blocker } from "react-router"

import type { SaveState } from "@/office/hooks/use-unsaved-changes"
import { ConfirmDialog } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

const LABELS: Record<Exclude<SaveState, "clean">, string> = {
  dirty: "Есть несохранённые изменения",
  saving: "Сохранение…",
  saved: "Все изменения сохранены",
}

/**
 * The breadcrumb-row / card-footer indicator (OFFICE-DESIGN §7). Always one line: in a tight footer
 * (long buttons like «Отправить на согласование») the label shrinks to an ellipsis and then to the dot
 * alone — the full text stays in `title` and for screen readers — instead of wrapping or overflowing.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "clean") return null
  return (
    <span
      role="status"
      title={LABELS[state]}
      className={cn("inline-flex min-w-0 items-center gap-1.5 overflow-hidden text-caption whitespace-nowrap", state === "dirty" ? "text-warning" : state === "saved" ? "text-success" : "text-muted-foreground")}
    >
      <span aria-hidden className="shrink-0">
        ●
      </span>
      <span className="min-w-0 truncate">{LABELS[state]}</span>
    </span>
  )
}

export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.state === "blocked") blocker.reset()
      }}
      title="Уйти без сохранения?"
      description="Изменения на этой странице не сохранены и будут потеряны."
      confirmLabel="Уйти без сохранения"
      cancelLabel="Остаться"
      onConfirm={() => blocker.proceed?.()}
    />
  )
}
