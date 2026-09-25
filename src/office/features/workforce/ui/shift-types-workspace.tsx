import { Check } from "lucide-react"
import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { MasterPanel, useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { EmptyState, Field, Input, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useReferenceMutations, useShiftTypes, type ShiftTypeRow } from "../data/use-workforce-w2"
import {
  crossesMidnight,
  formatCoefficient,
  formatShiftHours,
  SHIFT_COLORS,
  shiftColor,
  shiftTypeArgs,
  shiftTypeDraftHours,
  shiftTypeDraftOf,
  timeToMinute,
  validateShiftType,
  type DraftErrors,
  type ShiftTypeDraft,
} from "../model/w2"
import { FormSection, ReadOnlyField, ReferenceRegister, ReferenceStatus, statusOfTab } from "./reference-parts"
import { TimeInput } from "./time-input"

// «Типы смен» (W2-HR-03): /office/shift-types/:id? — master register + card; time as ЧЧ:ММ, color from the tokens.

const SECTION = "shift-types"

export function ShiftTypesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <ShiftTypes />
    </PlatformErrorBoundary>
  )
}

export function ColorSwatch({ token, className }: { token: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-3 shrink-0 rounded-control", shiftColor(token).swatch, className)} />
}

/** Columns per OFFICE-DESIGN §5: time «09:00–21:00», duration in «ч», pay as coefficients. */
export const SHIFT_TYPE_COLUMNS: Column<ShiftTypeRow>[] = [
  { key: "code", header: "Код", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.code}</span> },
  {
    key: "name",
    header: "Название",
    cell: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <ColorSwatch token={row.colorToken} />
        <span className="truncate font-semibold">{row.name}</span>
      </div>
    ),
  },
  {
    key: "time",
    header: "Время",
    numeric: true,
    cell: (row) => (
      <span className="whitespace-nowrap">
        {row.timeLabel}
        {crossesMidnight(row.startMinute, row.endMinute) ? <span className="text-caption text-muted-foreground"> +1</span> : null}
      </span>
    ),
  },
  { key: "hours", header: "Длительность", numeric: true, cell: (row) => formatShiftHours(row.hours) },
  { key: "pay", header: "Оплата", cell: (row) => <span className="whitespace-nowrap">{`ночь ${formatCoefficient(row.nightCoefficient)} · праздник ${formatCoefficient(row.holidayCoefficient)}`}</span> },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.active ? "active" : "inactive"} /> },
]

function ShiftTypes() {
  const canEdit = useCan("office.shift-types.edit")
  const selection = useMasterSelection(SECTION)
  const [tab, setTab] = useState("all")
  const rows = useShiftTypes(statusOfTab(tab))
  const all = useShiftTypes(undefined)
  const selected = selection.selectedId ? all?.find((row) => row.externalId === selection.selectedId) : undefined
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  return (
    <div className="flex min-h-0 flex-1">
      <ReferenceRegister
        caption="Типы смен"
        rows={rows}
        columns={SHIFT_TYPE_COLUMNS}
        getRowId={(row) => row.externalId}
        searchText={(row) => `${row.code} ${row.name}`}
        searchLabel="Поиск: типы смен"
        tab={tab}
        onTabChange={setTab}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        createLabel={canEdit ? "Новый тип смены" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        description="Шаблоны смен для расписания: время, перерыв, коэффициенты оплаты и цвет блока в календаре."
        emptyTitle="Типов смен пока нет"
        emptyDescription="Записей пока нет. Создайте первую рабочую запись — например «День 09:00–21:00»."
      />
      {selection.isNew && canEdit ? <ShiftTypeForm key="new" row={null} canEdit onClose={selection.close} onSaved={selection.select} /> : null}
      {selected ? <ShiftTypeForm key={`${selected.externalId}:${selected.version}`} row={selected} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null && !selected ? (
        <RightPanel open onOpenChange={(next) => !next && selection.close()} title="Тип смены">
          {all === undefined ? <OfficeStatePage state={{ kind: "loading" }} /> : <EmptyState title="Тип смены не найден" description="Возможно, ссылка устарела." />}
        </RightPanel>
      ) : null}
    </div>
  )
}

function ShiftTypeForm({ row, canEdit, onClose, onSaved }: { row: ShiftTypeRow | null; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const { saveShiftType, setShiftTypeActive } = useReferenceMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState(() => shiftTypeDraftOf(row))
  const [draft, setDraft] = useState(baseline)
  const [errors, setErrors] = useState<DraftErrors<keyof ShiftTypeDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const readOnly = !canEdit
  const hours = shiftTypeDraftHours(draft)
  const start = timeToMinute(draft.start)
  const end = timeToMinute(draft.end)
  const overnight = start !== null && end !== null && start !== end && crossesMidnight(start, end)
  const set = (patch: Partial<ShiftTypeDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key as keyof ShiftTypeDraft]
      return next
    })
  }

  useEffect(() => {
    if (savedId && !dirty && savedId !== row?.externalId) onSaved(savedId)
  }, [savedId, dirty, row?.externalId, onSaved])

  async function submit() {
    if (readOnly || saving) return
    const found = validateShiftType(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      const externalId = await saveShiftType(shiftTypeArgs(row, draft))
      setBaseline(draft)
      toast("Тип смены сохранён", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить тип смены"))
    } finally {
      setSaving(false)
    }
  }

  const decimal = (value: string) => value.replace(/[^\d,.]/g, "").slice(0, 5)

  return (
    <MasterPanel title={row ? row.name : "Новый тип смены"} formLabel="Тип смены" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!row} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <FormSection title="Основные реквизиты">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Короткий код" error={errors.code} hint="Показывается в блоке смены">
          {(control) => <Input {...control} value={draft.code} onChange={(event) => set({ code: event.target.value })} disabled={readOnly} autoComplete="off" />}
        </Field>
      </FormSection>
      <FormSection title="Время">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Начало" error={errors.start}>
            {(control) => <TimeInput {...control} value={draft.start} onValueChange={(value) => set({ start: value })} disabled={readOnly} />}
          </Field>
          <Field label="Окончание" error={errors.end} hint={overnight ? "На следующий день" : undefined}>
            {(control) => <TimeInput {...control} value={draft.end} onValueChange={(value) => set({ end: value })} disabled={readOnly} />}
          </Field>
          <Field label="Перерыв, мин" error={errors.breakMinutes}>
            {(control) => <Input {...control} inputMode="numeric" autoComplete="off" className="text-right tabular-nums" value={draft.breakMinutes} onChange={(event) => set({ breakMinutes: event.target.value.replace(/\D/g, "").slice(0, 3) })} disabled={readOnly} />}
          </Field>
          <ReadOnlyField label="Длительность" value={hours === null ? "—" : formatShiftHours(hours)} />
        </div>
      </FormSection>
      <FormSection title="Оплата">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ночной коэффициент" error={errors.nightCoefficient} hint="Не меньше 1">
            {(control) => <Input {...control} inputMode="decimal" autoComplete="off" className="text-right tabular-nums" value={draft.nightCoefficient} onChange={(event) => set({ nightCoefficient: decimal(event.target.value) })} disabled={readOnly} />}
          </Field>
          <Field label="Праздничный коэффициент" error={errors.holidayCoefficient} hint="Не меньше 1">
            {(control) => <Input {...control} inputMode="decimal" autoComplete="off" className="text-right tabular-nums" value={draft.holidayCoefficient} onChange={(event) => set({ holidayCoefficient: decimal(event.target.value) })} disabled={readOnly} />}
          </Field>
        </div>
      </FormSection>
      <FormSection title="Цвет в расписании">
        <ColorPicker value={draft.colorToken} onChange={(colorToken) => set({ colorToken })} disabled={readOnly} error={errors.colorToken} />
      </FormSection>
      {row ? (
        <ReferenceStatus
          record={row}
          canEdit={canEdit}
          disabled={dirty}
          confirmTitle={`Отключить тип смены «${row.name}»?`}
          confirmDescription="Отключённый тип нельзя выбрать для новых смен; уже запланированные смены сохранятся."
          onSetActive={(active) => setShiftTypeActive({ externalId: row.externalId, active })}
        />
      ) : null}
    </MasterPanel>
  )
}

/** Palette of the category tokens (POS-DESIGN §2.3): radio buttons, the name is the accessible label. */
function ColorPicker({ value, onChange, disabled, error }: { value: string; onChange: (token: string) => void; disabled?: boolean; error?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Цвет" className="flex flex-wrap gap-2">
        {SHIFT_COLORS.map((color) => {
          const checked = color.token === value
          return (
            <button
              key={color.token}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange(color.token)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-control border px-3 text-body-sm transition-colors disabled:opacity-50",
                checked ? "border-foreground bg-muted font-semibold" : "border-input bg-card hover:bg-muted",
                focusRingClass,
              )}
            >
              <span aria-hidden className={cn("grid size-4 place-items-center rounded-control text-primary-foreground", color.swatch)}>
                {checked ? <Check className="size-3" /> : null}
              </span>
              {color.label}
            </button>
          )
        })}
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
