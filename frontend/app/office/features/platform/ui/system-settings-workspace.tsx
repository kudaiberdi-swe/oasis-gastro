import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { FormSection, RecordAudit } from "@/office/features/finance/ui/record-parts"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Banner, Combobox, Field, Input, Select, StatusPill, Switch, Textarea, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { SETTING_CATEGORY_LABELS, SETTING_SCOPE_LABELS, settingDefinition, type SettingCategory, type SettingKey, type SettingScope } from "@convex/lib/settings"
import { scopeOptions, usePlatformRecord, usePlatformRecordMutations, usePlatformReferences, type PlatformRecord, type PlatformReferences } from "../data/use-platform-records"
import {
  defaultScope,
  defaultScopeObject,
  formatSettingValue,
  scopeObjectOptions,
  scopesFor,
  scopeText,
  SETTING_KEYS,
  settingDraftOf,
  settingSaveArgs,
  validateSetting,
  type SettingDraft,
} from "../model/system-settings"
import { MissingRecordPanel, PlatformRegister, PlatformStatusActions, PUBLISH_TABS } from "./platform-records"

const MODULE = "system-settings"

const text = (value: unknown) => (typeof value === "string" ? value : "")

/** «Настройки системы» (/office/system-settings/:id?, W3-ADM-12): typed settings, terminal → restaurant → organization → default. */
export function SystemSettingsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <SystemSettings />
    </PlatformErrorBoundary>
  )
}

function SystemSettings() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = usePlatformReferences(MODULE)
  const record = usePlatformRecord(MODULE, selection.selectedId)
  const [seed, setSeed] = useState<SettingDraft | null>(null)
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<PlatformRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Параметр",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          <span className="truncate font-mono text-caption text-muted-foreground">{text(row.data.key)}</span>
        </div>
      ),
    },
    { key: "value", header: "Значение", cell: (row) => formatSettingValue(text(row.data.key), row.data.value) },
    { key: "scope", header: "Область", cell: (row) => scopeText(row, references) },
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
        caption="Настройки системы"
        tabs={PUBLISH_TABS}
        columns={columns}
        searchPlaceholder="Поиск: настройки системы"
        createLabel={canEdit ? "Новая настройка" : undefined}
        onCreate={openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Настроек пока нет"
        emptyDescription="Пока настройка не опубликована, действует значение по умолчанию: автоблокировка кассы — 5 мин, пороги фудкоста — 30 и 35 %."
        scopes={references ? scopeOptions(references) : []}
      />
      {selection.isNew && canEdit && references ? <SettingForm key={seed ? `new-${seed.key}-${seed.scopeExternalId}` : "new"} record={null} seed={seed} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} onNewVersion={() => undefined} /> : null}
      {selection.selectedId !== null && record && references ? (
        <SettingForm
          key={record.externalId}
          record={record}
          seed={null}
          references={references}
          canEdit={canEdit}
          onClose={selection.close}
          onSaved={selection.select}
          onNewVersion={() => {
            setSeed(settingDraftOf(record, references))
            selection.openNew()
          }}
        />
      ) : null}
      {selection.selectedId !== null && (!record || !references) ? <MissingRecordPanel title="Настройка системы" missing={record === null} onClose={selection.close} /> : null}
    </div>
  )
}

function SettingForm({
  record,
  seed,
  references,
  canEdit,
  onClose,
  onSaved,
  onNewVersion,
}: {
  record: PlatformRecord | null
  seed: SettingDraft | null
  references: PlatformReferences
  canEdit: boolean
  onClose: () => void
  onSaved: (externalId: string) => void
  onNewVersion: () => void
}) {
  const [baseline, setBaseline] = useState(() => seed ?? settingDraftOf(record, references))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<ReturnType<typeof validateSetting>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const { save } = usePlatformRecordMutations()
  const toast = useToast()
  const editable = canEdit && (!record || record.status === "draft")
  const isNew = !record
  const definition = settingDefinition(draft.key)
  const set = (patch: Partial<SettingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors({})
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  // Keys a user can set: a branch user cannot set an organization-only key.
  const keys = SETTING_KEYS.filter((key) => settingDefinition(key).category === draft.category && scopesFor(key, references).length > 0)
  const categories = (Object.keys(SETTING_CATEGORY_LABELS) as SettingCategory[]).filter((category) => SETTING_KEYS.some((key) => settingDefinition(key).category === category && scopesFor(key, references).length > 0))
  const chooseKey = (key: SettingKey) => {
    const scope = scopesFor(key, references).includes(draft.scope) ? draft.scope : defaultScope(key, references)
    const fallback = settingDefinition(key).defaultValue
    set({
      key,
      category: settingDefinition(key).category,
      scope,
      scopeExternalId: scope === draft.scope ? draft.scopeExternalId : defaultScopeObject(scope, references),
      value: typeof fallback === "object" ? JSON.stringify(fallback) : String(fallback),
      flag: fallback === true,
    })
  }

  async function submit() {
    if (!editable || saving) return
    const found = validateSetting(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(settingSaveArgs(draft, record, references))
      setBaseline(draft)
      toast("Настройка сохранена", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить настройку"))
    } finally {
      setSaving(false)
    }
  }

  const unit = "unit" in definition ? definition.unit : undefined
  return (
    <MasterPanel title={record ? record.name : "Новая настройка"} formLabel="Настройка системы" dirty={editable && dirty} saving={saving} canEdit={editable} isNew={isNew} error={error} onSubmit={() => void submit()} onClose={onClose}>
      {record && record.status !== "draft" ? (
        <Banner tone="info" title={record.status === "published" ? "Настройка действует" : "Настройка неактивна"}>
          Опубликованное значение не редактируется: создайте новую версию — после публикации она заменит это значение в той же области.
        </Banner>
      ) : null}
      <FormSection title="Основные реквизиты">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Категория">
            {(control) => (
              <Select
                {...control}
                value={draft.category}
                onValueChange={(value) => {
                  const first = SETTING_KEYS.find((key) => settingDefinition(key).category === value && scopesFor(key, references).length > 0)
                  if (first) chooseKey(first)
                }}
                options={categories.map((category) => ({ value: category, label: SETTING_CATEGORY_LABELS[category] }))}
                disabled={!editable || !isNew}
              />
            )}
          </Field>
          <Field label="Тип значения">
            {(control) => <Input {...control} value={{ string: "Строка", number: "Число", boolean: "Да / нет", json: "JSON" }[definition.valueType]} disabled readOnly />}
          </Field>
        </div>
        <Field label="Ключ" hint={definition.description}>
          {(control) => (
            <Combobox
              {...control}
              value={draft.key}
              onValueChange={(key) => chooseKey(key as SettingKey)}
              options={keys.map((key) => ({ value: key, label: settingDefinition(key).label, hint: key }))}
              searchPlaceholder="Найти настройку"
              disabled={!editable || !isNew}
            />
          )}
        </Field>
      </FormSection>
      <FormSection title="Параметры">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Область">
            {(control) => (
              <Select
                {...control}
                value={draft.scope}
                onValueChange={(value) => {
                  const scope = value as SettingScope
                  set({ scope, scopeExternalId: defaultScopeObject(scope, references) })
                }}
                options={scopesFor(draft.key, references).map((scope) => ({ value: scope, label: SETTING_SCOPE_LABELS[scope] }))}
                disabled={!editable || !isNew}
              />
            )}
          </Field>
          <Field label={SETTING_SCOPE_LABELS[draft.scope]} error={errors.scopeExternalId}>
            {(control) => <Select {...control} value={draft.scopeExternalId || undefined} onValueChange={(scopeExternalId) => set({ scopeExternalId })} options={scopeObjectOptions(draft.scope, references)} disabled={!editable || !isNew} />}
          </Field>
        </div>
        {definition.valueType === "boolean" ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-sm font-medium text-muted-foreground">Значение</span>
            <Switch aria-label="Значение" checked={draft.flag} onCheckedChange={(flag) => set({ flag })} disabled={!editable} />
          </div>
        ) : definition.valueType === "json" ? (
          <Field label="Значение (JSON)" error={errors.value} hint={`По умолчанию: ${JSON.stringify(definition.defaultValue)}`}>
            {(control) => <Textarea {...control} rows={4} spellCheck={false} className="font-mono text-body-sm" value={draft.value} onChange={(event) => set({ value: event.target.value })} disabled={!editable} />}
          </Field>
        ) : (
          <Field label={unit ? `Значение, ${unit}` : "Значение"} error={errors.value} hint={`По умолчанию: ${formatSettingValue(draft.key, definition.defaultValue)}`}>
            {(control) => (
              <Input {...control} inputMode={definition.valueType === "number" ? "decimal" : undefined} value={draft.value} onChange={(event) => set({ value: event.target.value })} disabled={!editable} autoComplete="off" />
            )}
          </Field>
        )}
      </FormSection>
      {record ? (
        <RecordAudit record={record}>
          <PlatformStatusActions moduleId={MODULE} record={record} disabled={editable && dirty} onNewVersion={onNewVersion} publishHint="После публикации значение действует для выбранной области; прежняя версия той же области станет неактивной." />
        </RecordAudit>
      ) : null}
    </MasterPanel>
  )
}
