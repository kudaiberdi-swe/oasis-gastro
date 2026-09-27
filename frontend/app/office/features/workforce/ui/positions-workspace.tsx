import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { EmptyState, Field, Input, MoneyInput, Select, StatusPill, Textarea, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatHours } from "@/shared/lib/format"

import { useDepartmentOptions, usePositions, useReferenceMutations, type DepartmentOption, type PositionRow } from "../data/use-workforce-w2"
import { formatRate, PAY_TYPE_LABEL, PAY_TYPE_OPTIONS, rateUnitLabel, ROLE_LABEL, ROLE_OPTIONS, type PayType, type Role } from "../model/modules"
import { positionArgs, positionDraftOf, POS_ROLE_NONE, validatePosition, type DraftErrors, type PositionDraft } from "../model/w2"
import { FormSection, ReferenceRegister, ReferenceStatus, statusOfTab } from "./reference-parts"

// «Должности» (W2-HR-02): /office/positions/:id? — master register + card in the right panel.

const SECTION = "positions"
const NO_DEPARTMENT = "none"

export function PositionsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Positions />
    </PlatformErrorBoundary>
  )
}

/** Columns per OFFICE-DESIGN §5; the rate carries its unit («1 500 ₸/ч», never «1 ₸», L-10). */
export const POSITION_COLUMNS: Column<PositionRow>[] = [
  { key: "code", header: "Код", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.code}</span> },
  {
    key: "name",
    header: "Название",
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{row.name}</span>
        <span className="truncate text-caption text-muted-foreground">{[PAY_TYPE_LABEL[row.payType], `${formatHours(row.weeklyHours)} в неделю`, row.posRole ? `роль POS: ${ROLE_LABEL[row.posRole]}` : null].filter(Boolean).join(" · ")}</span>
      </div>
    ),
  },
  { key: "rate", header: "Ставка по умолчанию", numeric: true, cell: (row) => formatRate(row.defaultRate, row.payType) },
  { key: "employees", header: "Сотрудников", numeric: true, cell: (row) => row.employeeCount },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
]

function Positions() {
  const canEdit = useCan("office.positions.edit")
  const selection = useMasterSelection(SECTION)
  const [tab, setTab] = useState("all")
  const rows = usePositions(statusOfTab(tab))
  // The selected card may sit on another tab: read it from the full list.
  const all = usePositions(undefined)
  const selected = selection.selectedId ? all?.find((row) => row.externalId === selection.selectedId) : undefined
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  return (
    <div className="flex min-h-0 flex-1">
      <ReferenceRegister
        caption="Должности"
        rows={rows}
        columns={POSITION_COLUMNS}
        getRowId={(row) => row.externalId}
        searchText={(row) => `${row.code} ${row.name}`}
        searchLabel="Поиск: должности"
        tab={tab}
        onTabChange={setTab}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        createLabel={canEdit ? "Новая должность" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        description="Тарифы, нормы часов и роль на кассе. Должность назначается сотруднику в его карточке."
        emptyTitle="Должностей пока нет"
        emptyDescription="Создайте первую должность — например «Кассир» или «Повар»."
      />
      {selection.isNew && canEdit ? <PositionForm key="new" position={null} canEdit onClose={selection.close} onSaved={selection.select} /> : null}
      {selected ? <PositionForm key={`${selected.externalId}:${selected.version}`} position={selected} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && !selected ? (
        <RightPanel open onOpenChange={(next) => !next && selection.close()} title="Должность">
          {all === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : <EmptyState title="Должность не найдена" description="Возможно, ссылка устарела." />}
        </RightPanel>
      ) : null}
    </div>
  )
}

function PositionForm({ position, canEdit, onClose, onSaved }: { position: PositionRow | null; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const canSeeDepartments = useCan("office.departments.view")
  const departments = useDepartmentOptions(canSeeDepartments)
  const { savePosition, setPositionActive } = useReferenceMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState(() => positionDraftOf(position))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof PositionDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const readOnly = !canEdit
  const set = (patch: Partial<PositionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof PositionDraft]
      return next
    })
  }

  // Navigate once the saved draft is the baseline, so the unsaved-changes guard does not stop it.
  useEffect(() => {
    if (savedId && !dirty && savedId !== position?.externalId) onSaved(savedId)
  }, [savedId, dirty, position?.externalId, onSaved])

  async function submit() {
    if (readOnly || saving) return
    const found = validatePosition(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const externalId = await savePosition(positionArgs(position, draft))
      setBaseline(draft)
      toast("Должность сохранена", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить должность"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <MasterPanel title={position ? position.name : "Новая должность"} formLabel="Должность" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!position} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <FormSection title="Основные реквизиты">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Код" error={errors.code} hint="Уникален в сети">
            {(control) => <Input {...control} value={draft.code} onChange={(event) => set({ code: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <DepartmentField draft={draft} departments={departments} available={canSeeDepartments} readOnly={readOnly} onChange={(departmentExternalId) => set({ departmentExternalId })} />
        </div>
      </FormSection>
      <FormSection title="Оплата и нормы">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Тип оплаты" error={errors.payType}>
            {(control) => <Select {...control} value={draft.payType} onValueChange={(payType) => set({ payType: payType as PayType })} options={PAY_TYPE_OPTIONS} disabled={readOnly} />}
          </Field>
          <Field label="Ставка по умолчанию" error={errors.defaultRate} hint={rateUnitLabel(draft.payType)}>
            {(control) => <MoneyInput {...control} value={draft.defaultRate} onValueChange={(defaultRate) => set({ defaultRate })} disabled={readOnly} />}
          </Field>
          <Field label="Норма часов в неделю" error={errors.weeklyHours} hint="Сверх нормы расписание подсветит предупреждение">
            {(control) => (
              <div className="relative">
                <Input {...control} inputMode="decimal" autoComplete="off" className="pr-8 text-right tabular-nums" value={draft.weeklyHours} onChange={(event) => set({ weeklyHours: event.target.value.replace(/[^\d,.]/g, "").slice(0, 5) })} disabled={readOnly} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body-sm text-muted-foreground">
                  ч
                </span>
              </div>
            )}
          </Field>
          <Field label="Роль POS" hint="Права на кассе у сотрудников этой должности">
            {(control) => (
              <Select
                {...control}
                value={draft.posRole || POS_ROLE_NONE}
                onValueChange={(value) => set({ posRole: value === POS_ROLE_NONE ? "" : (value as Role) })}
                options={[{ value: POS_ROLE_NONE, label: "Без роли на кассе" }, ...ROLE_OPTIONS]}
                disabled={readOnly}
              />
            )}
          </Field>
        </div>
        <Field label="Обязанности">
          {(control) => <Textarea {...control} value={draft.description} onChange={(event) => set({ description: event.target.value })} disabled={readOnly} />}
        </Field>
      </FormSection>
      {position ? (
        <>
          <p className="text-body-sm text-muted-foreground">Сотрудников на должности: {position.employeeCount}</p>
          <ReferenceStatus
            record={position}
            canEdit={canEdit}
            disabled={dirty}
            confirmTitle={`Отключить должность «${position.name}»?`}
            confirmDescription="Отключённую должность нельзя выбрать в карточке сотрудника и в расписании. Должность с активными сотрудниками отключить нельзя."
            onSetActive={(active) => setPositionActive({ externalId: position.externalId, active })}
          />
        </>
      ) : null}
    </MasterPanel>
  )
}

function DepartmentField({ draft, departments, available, readOnly, onChange }: { draft: PositionDraft; departments: DepartmentOption[] | undefined; available: boolean; readOnly: boolean; onChange: (externalId: string) => void }) {
  if (!available) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">Подразделение</span>
        <span className="flex h-11 items-center text-body-sm text-foreground">{draft.departmentExternalId || "—"}</span>
      </div>
    )
  }
  const options = [{ value: NO_DEPARTMENT, label: "Без подразделения" }, ...(departments ?? []).map((department) => ({ value: department.externalId, label: `${" ".repeat(department.level)}${department.name}` }))]
  if (draft.departmentExternalId && !options.some((option) => option.value === draft.departmentExternalId)) options.push({ value: draft.departmentExternalId, label: "Неактивное подразделение" })
  return (
    <Field label="Подразделение">
      {(control) => <Select {...control} value={draft.departmentExternalId || NO_DEPARTMENT} onValueChange={(value) => onChange(value === NO_DEPARTMENT ? "" : value)} options={options} disabled={readOnly || departments === undefined} />}
    </Field>
  )
}
