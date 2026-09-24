import type { Blocker } from "react-router"

import type { SaveState } from "@/office/hooks/use-unsaved-changes"
import { ConfirmDialog } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

const LABELS: Record<Exclude<SaveState, "clean">, string> = {
  dirty: "Есть несохранённые изменения",
  saving: "Сохранение…",
  saved: "Все изменения сохранены",
}

/** The breadcrumb-row indicator (OFFICE-DESIGN §7). */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "clean") return null
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-caption", state === "dirty" ? "text-warning" : state === "saved" ? "text-success" : "text-muted-foreground")}>
      <span aria-hidden>●</span>
      {LABELS[state]}
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
