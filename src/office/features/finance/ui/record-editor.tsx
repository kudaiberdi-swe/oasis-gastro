import { useEffect, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, ConfirmDialog, EmptyState, useToast } from "@/shared/components/ui"
import { useReveal } from "@/shared/hooks/use-reveal"
import { errorMessage } from "@/shared/lib/error-message"

import { useFinanceMutations, type FinanceAction, type FinanceModuleId, type FinanceRecord, type SaveFinanceRecordArgs } from "../data/use-finance-records"
import type { DraftErrors } from "../model/modules"

// The card of a finance document on the document or approval lifecycle (OFFICE-DESIGN §3.4/§3.5):
// a draft is edited and saved; the one primary moves it on — «Провести» (document) or «Отправить на
// согласование» → «Согласовать» → «Провести» (approval); a posted one is read-only with «Сторно» (L-18).

export type RecordLifecycle = "document" | "approval"

export interface RecordEditorOptions<D> {
  moduleId: FinanceModuleId
  lifecycle: RecordLifecycle
  record: FinanceRecord | null
  /** What the saved record holds (the form compares against it). */
  baseline: D
  /** A new card prefilled from elsewhere («Оплатить»): dirty until saved. */
  initialDraft?: D
  validate: (draft: D) => DraftErrors<Extract<keyof D, string>>
  toArgs: (draft: D, record: FinanceRecord | null) => SaveFinanceRecordArgs
  /** Runs after every save of the record (a payment's allocation table). */
  afterSave?: (externalId: string, draft: D) => Promise<void>
  onSaved: (externalId: string) => void
  /** «Сторно» is hidden with this explanation instead (e.g. a document-created obligation). */
  reverseBlocked?: string
  /** «Отменить» is hidden (records the office never cancels by hand). */
  cancelBlocked?: boolean
  /** A draft the card shows as wrong right away (e.g. allocated above the payment): saving and moving it on wait until fixed. */
  blockedReason?: (draft: D) => string | null
}

const ADVANCE_LABELS: Record<"submit" | "approve" | "post", { idle: string; busy: string; done: string; failed: string }> = {
  submit: { idle: "Отправить на согласование", busy: "Отправка…", done: "Отправлено на согласование", failed: "Не удалось отправить на согласование" },
  approve: { idle: "Согласовать", busy: "Согласование…", done: "Согласовано", failed: "Не удалось согласовать" },
  post: { idle: "Провести", busy: "Проведение…", done: "Проведено", failed: "Не удалось провести" },
}

const CANCELLABLE: Record<RecordLifecycle, string[]> = { document: ["draft"], approval: ["draft", "pending-approval", "approved"] }

export function useRecordEditor<D>({ moduleId, lifecycle, record, baseline: initialBaseline, initialDraft, validate, toArgs, afterSave, onSaved, reverseBlocked, cancelBlocked, blockedReason }: RecordEditorOptions<D>) {
  const canEdit = useCan(`office.${moduleId}.edit`)
  const canApprove = useCan(`office.${moduleId}.approve`)
  const canPost = useCan(`office.${moduleId}.post`)
  const canReverse = useCan(`office.${moduleId}.reverse`)
  const canCancel = useCan(`office.${moduleId}.cancel`)
  const status = record?.status ?? "draft"
  const editable = canEdit && status === "draft"
  const [baseline, setBaseline] = useState(initialBaseline)
  const [draft, setDraft] = useState(initialDraft ?? initialBaseline)
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline)
  const blocked = editable ? (blockedReason?.(draft) ?? null) : null
  const [errors, setErrors] = useState<DraftErrors<Extract<keyof D, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"close" | "reverse" | "cancel" | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { save, transition } = useFinanceMutations()
  const toast = useToast()
  const blocker = useUnsavedChanges(dirty)

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  const set = (patch: Partial<D>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as Extract<keyof D, string>]
      return next
    })
  }

  const checked = () => {
    const found = validate(draft)
    setErrors(found)
    return Object.keys(found).length === 0
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught, fallback))
    } finally {
      setBusy(false)
    }
  }

  /** Saves the draft when it has changes (or is new); returns what the next transition needs. */
  async function persist() {
    if (record && !dirty) return { externalId: record.externalId, version: record.version }
    const saved = await save(toArgs(draft, record))
    await afterSave?.(saved.externalId, draft)
    setBaseline(draft)
    return { externalId: saved.externalId, version: saved.version }
  }

  const saveDraft = () => {
    if (!editable || busy || blocked || !checked()) return
    void run(async () => {
      const saved = await persist()
      toast("Черновик сохранён", "success")
      setSavedId(saved.externalId)
    }, "Не удалось сохранить черновик")
  }

  const advance = (action: "submit" | "approve" | "post") => {
    if (busy) return
    if (status === "draft" && (blocked || !checked())) return
    const labels = ADVANCE_LABELS[action]
    void run(async () => {
      const target = status === "draft" ? await persist() : { externalId: record!.externalId, version: record!.version }
      await transition({ moduleId, externalId: target.externalId, action, expectedVersion: target.version })
      toast(labels.done, "success")
      setSavedId(target.externalId)
    }, labels.failed)
  }

  async function confirmTransition(action: "reverse" | "cancel", reason: string) {
    if (!record) return
    if (reason.trim().length < 3) {
      setDialogError("Опишите причину — хотя бы несколько слов")
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      await transition({ moduleId, externalId: record.externalId, action: action satisfies FinanceAction, expectedVersion: record.version, reason })
      toast(action === "reverse" ? "Запись сторнирована" : "Запись отменена", "success")
      setConfirm(null)
    } catch (caught) {
      setDialogError(errorMessage(caught, action === "reverse" ? "Не удалось сторнировать" : "Не удалось отменить"))
    } finally {
      setBusy(false)
    }
  }

  // The one primary of the card: what moves the record on from its status.
  const next: "submit" | "approve" | "post" | null =
    status === "draft" ? (lifecycle === "approval" ? (canEdit ? "submit" : null) : canPost ? "post" : null) : status === "pending-approval" ? (canApprove ? "approve" : null) : status === "approved" ? (canPost ? "post" : null) : null

  const advanceButton = next ? (
    <Button onClick={() => advance(next)} disabled={busy || (status === "draft" && Boolean(blocked))} title={status === "draft" ? (blocked ?? undefined) : undefined}>
      {busy ? ADVANCE_LABELS[next].busy : ADVANCE_LABELS[next].idle}
    </Button>
  ) : null

  const footer: ReactNode = editable ? (
    <>
      <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} />
      <Button variant={advanceButton ? "secondary" : "primary"} onClick={saveDraft} disabled={busy || Boolean(blocked) || (!dirty && Boolean(record))} title={blocked ?? undefined}>
        Сохранить черновик
      </Button>
      {advanceButton}
    </>
  ) : status === "posted" && canReverse && !reverseBlocked ? (
    <Button variant="danger" onClick={() => setConfirm("reverse")} disabled={busy}>
      Сторно
    </Button>
  ) : (
    (advanceButton ?? undefined)
  )

  const cancelAction =
    record && canCancel && !cancelBlocked && CANCELLABLE[lifecycle].includes(status) ? (
      <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirm("cancel")} disabled={busy || dirty}>
        {status === "draft" ? "Отменить черновик" : "Отменить"}
      </Button>
    ) : null

  const note = !record || editable ? null : status === "posted" ? (reverseBlocked ?? "Проведённая запись меняется только сторнированием.") : status === "pending-approval" ? "Запись на согласовании; изменить её можно после отмены." : status === "approved" ? "Запись согласована и ждёт проведения." : "Запись закрыта для изменений."

  return { draft, set, errors, setErrors, dirty, editable, busy, error, footer, cancelAction, note, confirm, setConfirm, dialogError, setDialogError, confirmTransition, blocker }
}

export type RecordEditor<D> = ReturnType<typeof useRecordEditor<D>>

/** RightPanel + form + dialogs around a card's sections. */
export function RecordEditorPanel<D>({ editor, title, formLabel, onClose, children }: { editor: RecordEditor<D>; title: ReactNode; formLabel: string; onClose: () => void; children: ReactNode }) {
  const { setConfirm } = editor
  const errorRef = useReveal(editor.error)
  return (
    <>
      <RightPanel
        open
        onOpenChange={(open) => {
          if (open) return
          if (editor.dirty) setConfirm("close")
          else onClose()
        }}
        title={title}
        footer={editor.footer}
      >
        <form
          aria-label={formLabel}
          noValidate
          // Enter never posts: every transition is an explicit click.
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-col gap-4"
        >
          {editor.note ? <p className="text-caption text-muted-foreground">{editor.note}</p> : null}
          {editor.error ? (
            <Banner ref={errorRef} tabIndex={-1} tone="danger" title="Не удалось выполнить действие">
              {editor.error}
            </Banner>
          ) : null}
          {children}
        </form>
      </RightPanel>
      <RecordEditorDialogs editor={editor} onClose={onClose} />
    </>
  )
}

/** «Закрыть без сохранения?», the reverse / cancel reason and the unsaved-changes guard of a card or a full-page editor. */
export function RecordEditorDialogs<D>({ editor, onClose }: { editor: RecordEditor<D>; onClose: () => void }) {
  const { confirm, setConfirm, setDialogError } = editor
  return (
    <>
      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => setConfirm(open ? "close" : null)}
        title="Закрыть без сохранения?"
        description="Изменения не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirm(null)
          onClose()
        }}
      />
      <ConfirmDialog
        open={confirm === "reverse" || confirm === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null)
            setDialogError(null)
          }
        }}
        title={confirm === "cancel" ? "Отменить запись?" : "Сторнировать запись?"}
        description={confirm === "cancel" ? "Запись останется в истории со статусом «Отменён»." : "Будут записаны обратные проводки; запись останется в истории со статусом «Сторнирован»."}
        confirmLabel={confirm === "cancel" ? "Отменить запись" : "Сторнировать"}
        reasonLabel={confirm === "cancel" ? "Причина отмены" : "Причина сторно"}
        submitting={editor.busy}
        error={editor.dialogError}
        onConfirm={(reason) => (confirm === "reverse" || confirm === "cancel" ? editor.confirmTransition(confirm, reason) : undefined)}
      />
      <UnsavedChangesDialog blocker={editor.blocker} />
    </>
  )
}

/** Label / value rows of a read-only card. */
export function ReadOnlyRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The card while its record loads, or when the link points to nothing in the user's scope. */
export function RecordPanelFallback({ title, missing, missingTitle, onClose }: { title: string; missing: boolean; missingTitle: string; onClose: () => void }) {
  return (
    <RightPanel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
    >
      {missing ? <EmptyState title={missingTitle} description="Возможно, запись относится к ресторану вне вашего доступа или ссылка устарела." /> : <OfficeStatePage state={{ kind: "loading" }} />}
    </RightPanel>
  )
}

/** Name of a counterparty from the pick list; «—» when it is not there (inactive or outside the list). */
export function counterpartyName(counterparties: { externalId: string; name: string }[] | undefined, externalId: string | undefined) {
  if (!externalId) return "—"
  return counterparties?.find((row) => row.externalId === externalId)?.name ?? "—"
}
