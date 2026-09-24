import { useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router"

import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, ConfirmDialog } from "@/shared/components/ui"

export const NEW_ID = "new"

/** Master-detail selection lives in the URL: /office/<section>/:id? («new» — a new record). */
export function useMasterSelection(section: string) {
  const { id } = useParams()
  const navigate = useNavigate()
  const selectedId = id ?? null
  return {
    selectedId: selectedId === NEW_ID ? null : selectedId,
    isNew: selectedId === NEW_ID,
    open: selectedId !== null,
    select: (externalId: string) => navigate(`/office/${section}/${encodeURIComponent(externalId)}`),
    openNew: () => navigate(`/office/${section}/${NEW_ID}`),
    close: () => navigate(`/office/${section}`),
  }
}

export interface MasterPanelProps {
  title: string
  formLabel: string
  dirty: boolean
  saving: boolean
  canEdit: boolean
  isNew: boolean
  error: string | null
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}

/** The record form in the right panel: «Сохранить» is the one primary; closing with edits asks first. */
export function MasterPanel({ title, formLabel, dirty, saving, canEdit, isNew, error, onSubmit, onClose, children }: MasterPanelProps) {
  const blocker = useUnsavedChanges(dirty)
  const [confirmClose, setConfirmClose] = useState(false)
  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (!next) {
            if (dirty) setConfirmClose(true)
            else onClose()
          }
        }}
        title={title}
        footer={
          canEdit ? (
            <>
              <SaveStatus state={saving ? "saving" : dirty ? "dirty" : "clean"} />
              <Button onClick={onSubmit} disabled={saving || (!dirty && !isNew)}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </>
          ) : undefined
        }
      >
        <form
          aria-label={formLabel}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-caption text-muted-foreground">Все изменения сохраняются в Convex и записываются в аудит.</p>
          {error ? (
            <Banner tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}
          {children}
        </form>
      </RightPanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть без сохранения?"
        description="Изменения не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}
