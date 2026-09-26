import { useEffect, useMemo, useRef, useState } from "react"

import { useCan } from "@/office/components/can"
import { FormSection, RecordAudit } from "@/office/features/finance/ui/record-parts"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Banner, Field, Input, SegmentedControl, Select, StatusPill, Textarea, TonePill, useToast, type Column } from "@/shared/components/ui"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { formatTemplateError, LAYOUT_HINTS, PRINT_DOCUMENT_LABELS, PRINT_LANGUAGE_LABELS, PRINT_PLACEHOLDERS, PRINT_SAMPLES, renderPrintTemplate, type PrintDocumentType, type PrintLanguage } from "../../../../../convex/lib/printTemplate"
import { scopeLabel, scopeOptions, usePlatformRecord, usePlatformRecordMutations, usePlatformReferences, type PlatformRecord, type PlatformReferences } from "../data/use-platform-records"
import { DOCUMENT_TYPE_OPTIONS, nextVersionDraft, printTemplateDraftOf, printTemplateSaveArgs, starterTemplate, validatePrintTemplateDraft, type DraftErrors, type PrintTemplateDraft } from "../model/print-templates"
import { MissingRecordPanel, PlatformRegister, PlatformStatusActions, PUBLISH_TABS } from "./platform-records"
import { PrintPreview } from "./print-preview"

const MODULE = "print-templates"

/** «Шаблоны печати» (/office/print-templates/:id?, W3-ADM-10): publish register, editor and a live 80 mm preview. */
export function PrintTemplatesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <PrintTemplates />
    </PlatformErrorBoundary>
  )
}

function PrintTemplates() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = usePlatformReferences(MODULE)
  const record = usePlatformRecord(MODULE, selection.selectedId)
  // «Новая версия» opens a new draft filled from the published one.
  const [seed, setSeed] = useState<PrintTemplateDraft | null>(null)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<PlatformRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          <span className="truncate text-caption text-muted-foreground">{scopeLabel(references, row.restaurantExternalId)}</span>
        </div>
      ),
    },
    { key: "type", header: "Тип документа", cell: (row) => PRINT_DOCUMENT_LABELS[row.data.documentType as PrintDocumentType] ?? "—" },
    { key: "width", header: "Ширина", numeric: true, cell: (row) => `${row.data.widthMm === 58 ? 58 : 80} мм` },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const openNew = () => {
    setSeed(null)
    selection.openNew()
  }

  return (
    <div className="flex min-h-0 flex-1">
      <PlatformRegister
        moduleId={MODULE}
        caption="Шаблоны печати"
        tabs={PUBLISH_TABS}
        columns={columns}
        searchPlaceholder="Поиск: шаблоны печати"
        createLabel={canEdit ? "Новый шаблон" : undefined}
        onCreate={openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Шаблонов печати пока нет"
        emptyDescription="Пока шаблон не опубликован, касса печатает встроенные формы Sandyq."
        scopes={references ? scopeOptions(references) : []}
      />
      {selection.isNew && canEdit && references ? (
        <TemplateForm key={seed ? `new-${seed.name}` : "new"} record={null} seed={seed} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} onNewVersion={() => undefined} />
      ) : null}
      {selection.selectedId !== null && record && references ? (
        <TemplateForm
          key={record.externalId}
          record={record}
          seed={null}
          references={references}
          canEdit={canEdit}
          onClose={selection.close}
          onSaved={selection.select}
          onNewVersion={() => {
            setSeed(nextVersionDraft(record))
            selection.openNew()
          }}
        />
      ) : null}
      {selection.selectedId !== null && (!record || !references) ? <MissingRecordPanel title="Шаблон печати" missing={record === null} onClose={selection.close} /> : null}
    </div>
  )
}

function TemplateForm({
  record,
  seed,
  references,
  canEdit,
  onClose,
  onSaved,
  onNewVersion,
}: {
  record: PlatformRecord | null
  seed: PrintTemplateDraft | null
  references: PlatformReferences
  canEdit: boolean
  onClose: () => void
  onSaved: (externalId: string) => void
  onNewVersion: () => void
}) {
  const scopes = scopeOptions(references)
  const [baseline, setBaseline] = useState(() => seed ?? printTemplateDraftOf(record, scopes[0]?.value ?? ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof PrintTemplateDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const { save } = usePlatformRecordMutations()
  const toast = useToast()
  const breakpoint = useBreakpoint()
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const editable = canEdit && (!record || record.status === "draft")
  const set = (patch: Partial<PrintTemplateDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof PrintTemplateDraft]
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  // The preview follows the editor (debounced), rendered by the same code the POS prints with.
  const previewSource = useDebounced(draft.template, 150)
  const rendered = useMemo(() => renderPrintTemplate(previewSource, draft.documentType, PRINT_SAMPLES[draft.documentType]), [previewSource, draft.documentType])
  const catalog = PRINT_PLACEHOLDERS[draft.documentType]

  function insertPlaceholder(snippet: string) {
    const editor = editorRef.current
    const start = editor?.selectionStart ?? draft.template.length
    const end = editor?.selectionEnd ?? start
    set({ template: `${draft.template.slice(0, start)}${snippet}${draft.template.slice(end)}` })
    requestAnimationFrame(() => {
      editor?.focus()
      editor?.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  async function submit() {
    if (!editable || saving) return
    const found = validatePrintTemplateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(printTemplateSaveArgs(draft, record))
      setBaseline(draft)
      toast("Шаблон сохранён", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить шаблон"))
    } finally {
      setSaving(false)
    }
  }

  const preview = (
    <section aria-label="Превью" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-foreground">Превью на демо-данных</h3>
        {rendered.errors.length ? <TonePill tone="danger">Ошибок: {rendered.errors.length}</TonePill> : <TonePill tone="success">Без ошибок</TonePill>}
      </div>
      <PrintPreview lines={rendered.lines} widthMm={draft.widthMm} />
    </section>
  )
  const sideBySide = breakpoint === "desktop"

  return (
    <>
      {sideBySide ? <div className="w-[360px] shrink-0 overflow-y-auto border-l border-border bg-muted px-5 py-5">{preview}</div> : null}
      <MasterPanel title={record ? record.name : "Новый шаблон печати"} formLabel="Шаблон печати" dirty={editable && dirty} saving={saving} canEdit={editable} isNew={!record} error={error} onSubmit={() => void submit()} onClose={onClose}>
        {record && record.status !== "draft" ? (
          <Banner tone="info" title={record.status === "published" ? "Шаблон опубликован" : "Шаблон неактивен"}>
            Опубликованный шаблон не редактируется: создайте новую версию — она заменит эту после публикации.
          </Banner>
        ) : null}
        <FormSection title="Основные реквизиты">
          <Field label="Название" error={errors.name}>
            {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={!editable} autoComplete="off" />}
          </Field>
          {!record ? (
            <Field label="Область" error={errors.restaurantExternalId} hint="Шаблон ресторана важнее шаблона всей сети">
              {(control) => <Select {...control} value={draft.restaurantExternalId || undefined} onValueChange={(restaurantExternalId) => set({ restaurantExternalId })} options={scopes} disabled={!editable} />}
            </Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-muted-foreground">Область</span>
              <span className="flex h-11 items-center text-body-sm text-foreground">{scopeLabel(references, draft.restaurantExternalId)}</span>
            </div>
          )}
        </FormSection>
        <FormSection title="Параметры">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Тип документа">
              {(control) => (
                <Select
                  {...control}
                  value={draft.documentType}
                  onValueChange={(value) => {
                    const documentType = value as PrintDocumentType
                    // An untouched starter follows the type; an edited text stays.
                    set({ documentType, ...(draft.template === starterTemplate(draft.documentType) ? { template: starterTemplate(documentType) } : {}) })
                  }}
                  options={DOCUMENT_TYPE_OPTIONS}
                  disabled={!editable}
                />
              )}
            </Field>
            <Field label="Язык">
              {(control) => <Select {...control} value={draft.language} onValueChange={(language) => set({ language: language as PrintLanguage })} options={Object.entries(PRINT_LANGUAGE_LABELS).map(([value, label]) => ({ value, label }))} disabled={!editable} />}
            </Field>
            <Field label="Копий" error={errors.copies}>
              {(control) => <Input {...control} inputMode="numeric" value={draft.copies} onChange={(event) => set({ copies: event.target.value.replace(/\D/g, "") })} disabled={!editable} />}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-muted-foreground">Ширина ленты</span>
              {editable ? (
                <SegmentedControl
                  aria-label="Ширина ленты"
                  value={String(draft.widthMm)}
                  onValueChange={(value) => set({ widthMm: value === "58" ? 58 : 80 })}
                  options={[
                    { value: "80", label: "80 мм" },
                    { value: "58", label: "58 мм" },
                  ]}
                />
              ) : (
                <span className="flex h-11 items-center text-body-sm text-foreground">{draft.widthMm} мм</span>
              )}
            </div>
          </div>
        </FormSection>
        <FormSection title="Разметка шаблона">
          <Field label="Шаблон" error={errors.template} hint="Всё печатается как текст: HTML и скрипты в шаблоне не выполняются">
            {(control) => (
              <Textarea {...control} ref={editorRef} rows={16} spellCheck={false} className="font-mono text-body-sm" value={draft.template} onChange={(event) => set({ template: event.target.value })} disabled={!editable} />
            )}
          </Field>
          {rendered.errors.length ? (
            <ul aria-label="Ошибки шаблона" className="flex flex-col gap-1 text-body-sm text-destructive">
              {rendered.errors.slice(0, 8).map((problem, index) => (
                <li key={index}>{formatTemplateError(problem)}</li>
              ))}
            </ul>
          ) : null}
          <details className="rounded-control border border-border px-3 py-2 text-body-sm" open={editable}>
            <summary className="cursor-pointer font-medium text-foreground">Доступные плейсхолдеры · {PRINT_DOCUMENT_LABELS[draft.documentType]}</summary>
            <div className="mt-2 flex flex-col gap-3">
              <PlaceholderList title="Поля" fields={catalog.fields} disabled={!editable} onInsert={(path) => insertPlaceholder(`{{${path}}}`)} />
              {Object.entries(catalog.sections).map(([name, section]) => (
                <PlaceholderList key={name} title={`${section.label}: {{#${name}}} … {{/${name}}}`} fields={section.fields} disabled={!editable} onInsert={(path) => insertPlaceholder(`{{${path}}}`)} onInsertSection={() => insertPlaceholder(`{{#${name}}}\n\n{{/${name}}}`)} />
              ))}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
                {LAYOUT_HINTS.map(([syntax, meaning]) => (
                  <div key={syntax} className="contents">
                    <dt className="font-mono text-foreground">{syntax}</dt>
                    <dd className="text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        </FormSection>
        {!sideBySide ? preview : null}
        {record ? (
          <RecordAudit record={record}>
            <PlatformStatusActions moduleId={MODULE} record={record} disabled={editable && dirty} onNewVersion={onNewVersion} publishHint="После публикации касса печатает этот документ по шаблону; прежняя версия той же области станет неактивной." />
          </RecordAudit>
        ) : null}
      </MasterPanel>
    </>
  )
}

function PlaceholderList({ title, fields, disabled, onInsert, onInsertSection }: { title: string; fields: Record<string, string>; disabled: boolean; onInsert: (path: string) => void; onInsertSection?: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-muted-foreground">{title}</span>
        {onInsertSection && !disabled ? (
          <button type="button" className={cn("text-caption font-medium text-accent hover:underline", focusRingClass)} onClick={onInsertSection}>
            Вставить секцию
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(fields).map(([path, label]) => (
          <button
            key={path}
            type="button"
            title={label}
            disabled={disabled}
            onClick={() => onInsert(path)}
            className={cn("rounded-control border border-border bg-muted px-2 py-0.5 font-mono text-caption text-foreground hover:border-primary disabled:cursor-default disabled:hover:border-border", focusRingClass)}
          >
            {`{{${path}}}`}
          </button>
        ))}
      </div>
    </div>
  )
}
