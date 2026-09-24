import { useEffect, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { EmptyState, Field, Input, Select, StatusPill, TonePill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useFinanceMutations, useFinanceRecord, useFinanceReferences, type FinanceRecord, type FinanceReferences } from "../data/use-finance-records"
import {
  ACTIVITY_LABELS,
  cashflowDraftOf,
  cashflowSaveArgs,
  DIRECTION_LABELS,
  MASTER_TABS,
  validateCashflow,
  type CashflowActivity,
  type CashflowDirection,
  type CashflowDraft,
  type DraftErrors,
} from "../model/modules"
import { FinanceRegister } from "./finance-register"
import { FormSection, MasterStatusAction, RecordAudit } from "./record-parts"

const MODULE = "cashflow-categories"
const NO_PARENT = "none"

/** «Статьи ДДС» (/office/cashflow-categories/:id?, W1-FIN-03): master register + card. */
export function CashflowCategoriesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <CashflowCategories />
    </PlatformErrorBoundary>
  )
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

function directionTone(direction: string) {
  return direction === "incoming" ? "success" : direction === "outgoing" ? "warning" : "info"
}

function CashflowCategories() {
  const canEdit = useCan(`office.${MODULE}.edit`)
  const selection = useMasterSelection(MODULE)
  const references = useFinanceReferences(MODULE)
  const record = useFinanceRecord(MODULE, selection.selectedId)
  const categoryName = useMemo(() => {
    const names = new Map((references?.cashflowCategories ?? []).map((row) => [row.externalId, row.name]))
    return (externalId: string) => names.get(externalId)
  }, [references])
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<FinanceRecord>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          <span className="truncate text-caption text-muted-foreground">
            Код {text(row.data.code) || "—"} · {ACTIVITY_LABELS[text(row.data.activity) as CashflowActivity] ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "direction",
      header: "Тип",
      cell: (row) => {
        const direction = text(row.data.direction)
        return direction ? <TonePill tone={directionTone(direction)}>{DIRECTION_LABELS[direction as CashflowDirection] ?? direction}</TonePill> : "—"
      },
    },
    {
      key: "parent",
      header: "Родитель",
      cell: (row) => {
        const parent = text(row.data.parentExternalId)
        return parent ? (categoryName(parent) ?? <span className="text-muted-foreground">Неактивная статья</span>) : <span className="text-muted-foreground">—</span>
      },
    },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <FinanceRegister
        moduleId={MODULE}
        caption="Статьи ДДС"
        tabs={MASTER_TABS}
        columns={columns}
        searchPlaceholder="Поиск: статьи ДДС"
        createLabel={canEdit ? "Новая статья" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        emptyTitle="Статей ДДС пока нет"
        emptyDescription="Создайте статью движения денежных средств — например «Выручка от продаж» или «Оплата поставщикам»."
      />
      {selection.isNew && canEdit && references ? <CashflowForm key="new" record={null} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && record && references ? (
        <CashflowForm key={record.externalId} record={record} references={references} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} />
      ) : null}
      {selection.selectedId !== null && (!record || !references) ? (
        <RightPanel
          open
          onOpenChange={(next) => {
            if (!next) selection.close()
          }}
          title="Статья ДДС"
        >
          {record === null ? <EmptyState title="Статья не найдена" description="Возможно, она относится к ресторану вне вашего доступа или ссылка устарела." /> : <OfficeStatePage state={{ kind: "loading" }} />}
        </RightPanel>
      ) : null}
    </div>
  )
}

function CashflowForm({ record, references, canEdit, onClose, onSaved }: { record: FinanceRecord | null; references: FinanceReferences; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const [baseline, setBaseline] = useState(() => cashflowDraftOf(record, references.restaurants[0]?.externalId ?? ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof CashflowDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const { save } = useFinanceMutations()
  const toast = useToast()
  const parent = useFinanceRecord(MODULE, draft.parentExternalId || null)
  const readOnly = !canEdit
  const set = (patch: Partial<CashflowDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof CashflowDraft]
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== record?.externalId) onSaved(savedId)
  }, [savedId, dirty, record?.externalId, onSaved])

  const parentOptions = [
    { value: NO_PARENT, label: "Без родителя" },
    ...references.cashflowCategories.filter((category) => category.externalId !== record?.externalId).map((category) => ({ value: category.externalId, label: category.name })),
  ]
  if (draft.parentExternalId && !parentOptions.some((option) => option.value === draft.parentExternalId)) parentOptions.push({ value: draft.parentExternalId, label: "Неактивная статья" })
  const restaurantName = references.restaurants.find((restaurant) => restaurant.externalId === draft.restaurantExternalId)?.name ?? draft.restaurantExternalId

  async function submit() {
    if (readOnly || saving) return
    const found = validateCashflow(draft, parent ? text(parent.data.direction) : undefined)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(cashflowSaveArgs(draft, record))
      setBaseline(draft)
      toast("Статья сохранена", "success")
      setSavedId(saved.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить статью"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <MasterPanel title={record ? record.name : "Новая статья ДДС"} formLabel="Статья ДДС" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!record} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <FormSection title="Основные реквизиты">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Код" error={errors.code} hint="Для выгрузок и отчётов">
            {(control) => <Input {...control} value={draft.code} onChange={(event) => set({ code: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          {!record && references.restaurants.length > 1 ? (
            <Field label="Ресторан" error={errors.restaurantExternalId}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.restaurantExternalId || undefined}
                  onValueChange={(restaurantExternalId) => set({ restaurantExternalId })}
                  options={references.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))}
                  disabled={readOnly}
                />
              )}
            </Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-muted-foreground">Ресторан</span>
              <span className="flex h-11 items-center text-body-sm text-foreground">{restaurantName || "—"}</span>
            </div>
          )}
        </div>
      </FormSection>
      <FormSection title="Параметры">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Направление" error={errors.direction}>
            {(control) => (
              <Select
                {...control}
                value={draft.direction || undefined}
                onValueChange={(direction) => set({ direction: direction as CashflowDirection })}
                options={Object.entries(DIRECTION_LABELS).map(([value, label]) => ({ value, label }))}
                disabled={readOnly}
              />
            )}
          </Field>
          <Field label="Вид деятельности" error={errors.activity}>
            {(control) => (
              <Select
                {...control}
                value={draft.activity || undefined}
                onValueChange={(activity) => set({ activity: activity as CashflowActivity })}
                options={Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))}
                disabled={readOnly}
              />
            )}
          </Field>
        </div>
        <Field label="Родительская статья" error={errors.parentExternalId} hint="Того же направления или «Приход и расход»">
          {(control) => (
            <Select
              {...control}
              value={draft.parentExternalId || NO_PARENT}
              onValueChange={(value) => set({ parentExternalId: value === NO_PARENT ? "" : value })}
              options={parentOptions}
              disabled={readOnly}
            />
          )}
        </Field>
      </FormSection>
      {record ? (
        <RecordAudit record={record}>
          <MasterStatusAction moduleId={MODULE} record={record} disabled={dirty} />
        </RecordAudit>
      ) : null}
    </MasterPanel>
  )
}
