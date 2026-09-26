import { useEffect, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { ReadOnlyRows, RecordPanelFallback } from "@/office/features/finance/ui/record-editor"
import { FormSection } from "@/office/features/loyalty/ui/guest-editor"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { useReveal } from "@/shared/hooks/use-reveal"
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, SegmentedControl, Select, StatusPill, Textarea, TonePill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"

import { useIntegrationCard, useIntegrationCardMutations, useIntegrationReferences, useProviderKeys, type CardDetails } from "../data/use-integration-cards"
import { CARD_SECTIONS, cardDraftOf, cardSaveArgs, DIRECTION_OPTIONS, MODE_LABELS, mappingError, validateCard, type CardDraft, type CardMode, type CardModuleId, type SettingField } from "../model/cards"

// The integration card (OFFICE-DESIGN §3.4 in the right panel, publish lifecycle §3.5): common fields,
// the section's own fields and the Mapping JSON with a check. «Секрет» shows only the env variable's
// name and «задан / не задан». «Опубликовать» needs office.<section>.approve; production also needs the
// variable to exist (the server says so).

export interface IntegrationCardEditorProps {
  moduleId: CardModuleId
  /** null — a new card. */
  externalId: string | null
  onClose: () => void
  onSaved: (externalId: string) => void
}

export function IntegrationCardEditor({ moduleId, externalId, onClose, onSaved }: IntegrationCardEditorProps) {
  const card = useIntegrationCard(externalId)
  if (externalId && !card) return <RecordPanelFallback title="Подключение" missing={card === null} missingTitle="Карточка не найдена" onClose={onClose} />
  return <CardForm key={card ? `${card.externalId}:${card.version}` : "new"} moduleId={moduleId} card={card ?? null} onClose={onClose} onSaved={onSaved} />
}

function CardForm({ moduleId, card, onClose, onSaved }: { moduleId: CardModuleId; card: CardDetails | null; onClose: () => void; onSaved: (externalId: string) => void }) {
  const section = CARD_SECTIONS[moduleId]
  const canEdit = useCan(`office.${moduleId}.edit`)
  const canApprove = useCan(`office.${moduleId}.approve`)
  const status = card?.status ?? "draft"
  const editable = canEdit && status !== "published"
  const references = useIntegrationReferences(moduleId)
  const organizations = references?.organizations ?? []
  const keys = useProviderKeys(moduleId)
  const { saveCard, transitionCard } = useIntegrationCardMutations()
  const toast = useToast()

  const [baseline, setBaseline] = useState(() => cardDraftOf(moduleId, card, ""))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<Partial<Record<keyof CardDraft, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const errorRef = useReveal(error)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"close" | "deactivate" | null>(null)
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(baseline)
  const blocker = useUnsavedChanges(dirty)

  useEffect(() => {
    if (savedId && savedId !== card?.externalId) onSaved(savedId)
  }, [savedId, card?.externalId, onSaved])

  const set = (patch: Partial<CardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof CardDraft]
      return next
    })
  }
  const setSetting = (key: SettingField["key"], value: string | string[]) => set({ settings: { ...draft.settings, [key]: value } })

  const checked = () => {
    const found = validateCard(draft)
    setErrors(found)
    return Object.keys(found).length === 0
  }

  async function persist() {
    if (card && !dirty) return { externalId: card.externalId, version: card.version }
    const saved = await saveCard(cardSaveArgs(moduleId, draft, card))
    setBaseline(draft)
    return saved
  }

  async function save() {
    if (!editable || busy || !checked()) return
    setBusy(true)
    setError(null)
    try {
      const saved = await persist()
      toast(card ? "Карточка сохранена" : "Подключение создано", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить карточку"))
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (busy || !canApprove) return
    if (editable && !checked()) return
    setBusy(true)
    setError(null)
    try {
      const target = editable ? await persist() : { externalId: card!.externalId, version: card!.version }
      await transitionCard({ externalId: target.externalId, action: "publish", expectedVersion: target.version })
      toast("Карточка опубликована", "success")
      setSavedId(target.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось опубликовать карточку"))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (!card) return
    setBusy(true)
    try {
      await transitionCard({ externalId: card.externalId, action: "deactivate", expectedVersion: card.version })
      toast("Карточка отключена", "success")
      setConfirm(null)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось отключить карточку"))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const publishButton = canApprove && status !== "published" ? (
    <Button onClick={() => void publish()} disabled={busy}>
      {busy ? "Публикация…" : "Опубликовать"}
    </Button>
  ) : null
  const footer: ReactNode = editable ? (
    <>
      <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} />
      <Button variant={publishButton ? "secondary" : "primary"} onClick={() => void save()} disabled={busy || (!dirty && Boolean(card))}>
        Сохранить
      </Button>
      {publishButton}
    </>
  ) : canApprove && status === "published" ? (
    <Button variant="secondary" onClick={() => setConfirm("deactivate")} disabled={busy}>
      Отключить
    </Button>
  ) : (
    (publishButton ?? undefined)
  )

  const secretName = draft.secretRef.trim()
  const secretSet = card && card.secretRef === secretName ? card.secretConfigured : null
  const mappingProblem = mappingError(draft.mapping)
  const title = card ? `${section.label} ${card.number}` : `Новое подключение · ${section.label}`

  const settingControl = (field: SettingField) => {
    const value = draft.settings[field.key]
    if (field.kind === "select")
      return (
        <Field key={field.key} label={field.label}>
          {(control) => <Select {...control} value={typeof value === "string" && value ? value : undefined} placeholder="Не выбрано" onValueChange={(next) => setSetting(field.key, next)} options={field.options} />}
        </Field>
      )
    if (field.kind === "multi")
      return (
        <Field key={field.key} label={field.label}>
          {(control) => <Combobox {...control} multiple value={Array.isArray(value) ? value : []} onValueChange={(next) => setSetting(field.key, next)} options={field.options} placeholder="Выберите типы" searchPlaceholder="Поиск типа" emptyText="Нет типов" />}
        </Field>
      )
    if (field.kind === "textarea")
      return (
        <Field key={field.key} label={field.label}>
          {(control) => <Textarea {...control} rows={3} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(event) => setSetting(field.key, event.target.value)} />}
        </Field>
      )
    return (
      <Field key={field.key} label={field.label} hint={field.hint}>
        {(control) => <Input {...control} placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(event) => setSetting(field.key, event.target.value)} autoComplete="off" />}
      </Field>
    )
  }

  const settingRows = section.fields.map((field): [string, ReactNode] => {
    const value = card?.settings[field.key as keyof CardDetails["settings"]]
    const shown = Array.isArray(value) ? value.join(", ") : field.kind === "select" ? field.options.find((option) => option.value === value)?.label : value
    return [field.label, shown || "—"]
  })

  return (
    <>
      <RightPanel
        open
        onOpenChange={(open) => {
          if (open) return
          if (dirty) setConfirm("close")
          else onClose()
        }}
        title={title}
        footer={footer}
      >
        <form aria-label="Карточка интеграции" noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
          {card ? (
            <div className="flex items-center gap-2">
              <StatusPill domain="document" status={card.status} />
              <TonePill tone={card.mode === "production" ? "info" : "neutral"}>{MODE_LABELS[card.mode]}</TonePill>
            </div>
          ) : null}
          {status === "published" && canEdit ? <p className="text-caption text-muted-foreground">Чтобы изменить опубликованную карточку, отключите её — затем опубликуйте снова.</p> : null}
          {error ? (
            <Banner ref={errorRef} tabIndex={-1} tone="danger" title="Не удалось выполнить действие">
              {error}
            </Banner>
          ) : null}
          {keys && keys.length ? (
            <Banner tone={keys.every((key) => key.set) ? "info" : "warning"} title="Ключи провайдеров в Convex">
              <ul className="flex flex-col gap-0.5">
                {keys.map((key) => (
                  <li key={key.name}>
                    <span className="font-mono">{key.name}</span> — {key.set ? "задан" : "не задан"}
                  </li>
                ))}
              </ul>
              {keys.some((key) => !key.set) ? <span className="mt-1 block">Пока ключа нет, сообщения попадают в «Очередь интеграций» со статусом «Не доставлено».</span> : null}
            </Banner>
          ) : null}

          {editable ? (
            <>
              <FormSection title="Подключение">
                {!card && organizations.length > 1 ? (
                  <Field label="Организация">
                    {(control) => <Select {...control} value={draft.organizationExternalId || undefined} placeholder="Выберите организацию" onValueChange={(organizationExternalId) => set({ organizationExternalId })} options={organizations.map((row) => ({ value: row.externalId, label: row.name }))} />}
                  </Field>
                ) : null}
                <Field label="Название" error={errors.name}>
                  {(control) => <Input {...control} value={draft.name} placeholder={`Интеграция ${section.label}`} onChange={(event) => set({ name: event.target.value })} autoComplete="off" />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Провайдер" error={errors.provider}>
                    {(control) => <Input {...control} value={draft.provider} onChange={(event) => set({ provider: event.target.value })} autoComplete="off" />}
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-body-sm font-medium text-muted-foreground">Режим</span>
                    <SegmentedControl<CardMode>
                      aria-label="Режим"
                      value={draft.mode}
                      onValueChange={(mode) => set({ mode })}
                      options={[
                        { value: "sandbox", label: MODE_LABELS.sandbox },
                        { value: "production", label: MODE_LABELS.production },
                      ]}
                    />
                  </div>
                </div>
                <Field label="API endpoint" error={errors.endpoint}>
                  {(control) => <Input {...control} type="url" placeholder="https://…" value={draft.endpoint} onChange={(event) => set({ endpoint: event.target.value })} autoComplete="off" />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Направление">
                    {(control) => <Select {...control} value={draft.direction} onValueChange={(direction) => set({ direction: direction as CardDraft["direction"] })} options={DIRECTION_OPTIONS} />}
                  </Field>
                  <Field label="Расписание">
                    {(control) => <Input {...control} value={draft.schedule} placeholder="каждый день 02:00" onChange={(event) => set({ schedule: event.target.value })} />}
                  </Field>
                </div>
                <Field label="Попыток до «Не доставлено»" error={errors.maxAttempts}>
                  {(control) => <Input {...control} inputMode="numeric" className="w-32" value={draft.maxAttempts} onChange={(event) => set({ maxAttempts: event.target.value.replace(/\D/g, "") })} />}
                </Field>
              </FormSection>

              <FormSection title="Секрет">
                <Field label="Ссылка на секрет" error={errors.secretRef} hint={`Имя переменной окружения Convex, не сам ключ. ${section.secretHint}`}>
                  {(control) => <Input {...control} className="font-mono" value={draft.secretRef} onChange={(event) => set({ secretRef: event.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} />}
                </Field>
                {secretName ? (
                  <p className="text-caption text-muted-foreground">
                    {secretSet === null ? "Задана ли переменная, станет видно после сохранения." : secretSet ? `Переменная ${secretName} задана.` : `Переменная ${secretName} не задана — опубликовать можно только в sandbox.`}
                  </p>
                ) : null}
              </FormSection>

              {section.fields.length ? <FormSection title={section.label}>{section.fields.map(settingControl)}</FormSection> : null}

              <FormSection title="Mapping JSON">
                <Field label="Правила сопоставления" error={errors.mapping} hint={mappingProblem ? undefined : "JSON-объект; ключи с токенами и паролями не принимаются"}>
                  {(control) => <Textarea {...control} rows={6} className="font-mono" spellCheck={false} value={draft.mapping} onChange={(event) => set({ mapping: event.target.value })} />}
                </Field>
                {mappingProblem && !errors.mapping ? <p className="text-caption text-destructive">{mappingProblem}</p> : null}
              </FormSection>
            </>
          ) : card ? (
            <>
              <FormSection title="Подключение">
                <ReadOnlyRows
                  rows={[
                    ["Название", card.name],
                    ["Провайдер", card.provider],
                    ["Режим", MODE_LABELS[card.mode]],
                    ["API endpoint", card.endpoint || "—"],
                    ["Направление", DIRECTION_OPTIONS.find((option) => option.value === card.direction)?.label ?? card.direction],
                    ["Расписание", card.schedule || "—"],
                    ["Попыток", formatQuantity(card.maxAttempts)],
                  ]}
                />
              </FormSection>
              <FormSection title="Секрет">
                <ReadOnlyRows rows={[["Ссылка на секрет", card.secretRef ? <span className="font-mono">{card.secretRef}</span> : "—"], ["Переменная", card.secretRef ? (card.secretConfigured ? "задана" : "не задана") : "—"]]} />
              </FormSection>
              {section.fields.length ? (
                <FormSection title={section.label}>
                  <ReadOnlyRows rows={settingRows} />
                </FormSection>
              ) : null}
              <FormSection title="Mapping JSON">
                <pre className="overflow-x-auto rounded-control border border-border bg-muted p-3 font-mono text-caption">{card.mapping}</pre>
              </FormSection>
            </>
          ) : null}

          {card ? (
            <FormSection title="Обмен и аудит">
              <ReadOnlyRows
                rows={[
                  ["Номер", <span className="font-semibold">{card.number}</span>],
                  ["Последняя синхронизация", card.lastSyncAt ? formatAlmatyDateTime(card.lastSyncAt) : "—"],
                  ["Ошибок в очереди", card.errors ? `${formatQuantity(card.errors)}${card.errorsCapped ? "+" : ""}` : "0"],
                  ["Создано", `${formatAlmatyDateTime(card.createdAt)} · ${card.createdBy}`],
                  ...(card.publishedAt ? ([["Опубликовано", formatAlmatyDateTime(card.publishedAt)]] as [string, ReactNode][]) : []),
                  ["Версия", `v${card.version}`],
                ]}
              />
            </FormSection>
          ) : null}
        </form>
      </RightPanel>
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
        open={confirm === "deactivate"}
        onOpenChange={(open) => setConfirm(open ? "deactivate" : null)}
        title="Отключить карточку?"
        description="Адаптер раздела перестанет брать настройки из этой карточки. Карточку можно изменить и опубликовать снова."
        confirmLabel="Отключить"
        cancelLabel="Оставить"
        submitting={busy}
        onConfirm={() => void deactivate()}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  )
}
