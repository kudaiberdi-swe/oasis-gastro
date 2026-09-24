import { useEffect, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Checkbox, Field, Input, Select, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { DIMENSION_LABELS, formatCoefficient, parseDecimal, useSaveUnit, useUnits, type SaveUnitArgs, type Unit, type UnitDimension } from "../data/use-stock-master"
import { MasterList } from "./master-list"
import { MasterPanel, useMasterSelection } from "./master-panel"

const BASE = "__base__"

/** «Единицы измерения» (/office/units/:id?, W1-STK-03): list + form in the right panel. */
export function UnitsPage() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <UnitsMaster />
    </PlatformErrorBoundary>
  )
}

/** «г · ×0,001 → кг»; a base unit is «кг · ×1». */
export function unitMeta(unit: Unit, units: readonly Unit[]) {
  const base = unit.baseUnitExternalId ? units.find((candidate) => candidate.externalId === unit.baseUnitExternalId) : undefined
  return `${unit.shortName} · ${formatCoefficient(unit.coefficient)}${base ? ` → ${base.shortName}` : ""}`
}

function UnitsMaster() {
  const canEdit = useCan("office.units.edit")
  const [search, setSearch] = useState("")
  const units = useUnits(search)
  const all = useUnits()
  const selection = useMasterSelection("units")
  const selected = selection.selectedId ? (units ?? []).find((unit) => unit.externalId === selection.selectedId) ?? null : null

  return (
    <div className="flex min-h-0 flex-1">
      <MasterList
        label="Единицы измерения"
        items={units?.map((unit) => ({ id: unit.externalId, title: unit.name, meta: unitMeta(unit, all ?? units), active: unit.active }))}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Название или сокращение"
        createLabel={canEdit ? "Новая единица" : undefined}
        onCreate={selection.openNew}
        emptyTitle="Единиц пока нет"
        emptyDescription="Создайте первую единицу — например «Килограмм, кг»."
      />
      {selection.isNew || selected ? (
        <UnitForm key={selected?.externalId ?? "new"} unit={selected} units={all ?? []} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} />
      ) : null}
    </div>
  )
}

interface UnitDraft {
  name: string
  shortName: string
  dimension: UnitDimension
  baseUnitExternalId: string
  coefficient: string
  precision: string
  active: boolean
}

function draftOf(unit: Unit | null): UnitDraft {
  return {
    name: unit?.name ?? "",
    shortName: unit?.shortName ?? "",
    dimension: unit?.dimension ?? "count",
    baseUnitExternalId: unit?.baseUnitExternalId ?? BASE,
    coefficient: String(unit?.coefficient ?? 1).replace(".", ","),
    precision: String(unit?.precision ?? 0),
    active: unit?.active ?? true,
  }
}

type UnitErrors = Partial<Record<"name" | "shortName" | "coefficient" | "precision", string>>

export function validateUnit(draft: UnitDraft): UnitErrors {
  const errors: UnitErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название"
  if (!draft.shortName.trim()) errors.shortName = "Укажите сокращение"
  const coefficient = parseDecimal(draft.coefficient)
  if (coefficient === null) errors.coefficient = "Укажите число"
  const precision = Number(draft.precision)
  if (!/^\d$/.test(draft.precision.trim()) || precision > 6) errors.precision = "От 0 до 6"
  return errors
}

function UnitForm({ unit, units, canEdit, onClose, onSaved }: { unit: Unit | null; units: readonly Unit[]; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const [baseline, setBaseline] = useState(() => draftOf(unit))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<UnitErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const save = useSaveUnit()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<UnitDraft>) => setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (savedId && !dirty && savedId !== unit?.externalId) onSaved(savedId)
  }, [savedId, dirty, unit?.externalId, onSaved])

  const baseOptions = useMemo(
    () => [
      { value: BASE, label: "Является базовой" },
      ...units.filter((candidate) => candidate.dimension === draft.dimension && candidate.externalId !== unit?.externalId).map((candidate) => ({ value: candidate.externalId, label: `${candidate.name} (${candidate.shortName})` })),
    ],
    [units, draft.dimension, unit?.externalId],
  )

  async function submit() {
    if (readOnly || saving) return
    const found = validateUnit(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    const args: SaveUnitArgs = {
      ...(unit ? { externalId: unit.externalId } : {}),
      name: draft.name.trim(),
      shortName: draft.shortName.trim(),
      dimension: draft.dimension,
      precision: Number(draft.precision),
      ...(draft.baseUnitExternalId !== BASE ? { baseUnitExternalId: draft.baseUnitExternalId } : {}),
      coefficient: draft.baseUnitExternalId === BASE ? 1 : parseDecimal(draft.coefficient)!,
      active: draft.active,
    }
    try {
      const externalId = await save(args)
      setBaseline(draft)
      toast("Единица сохранена", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить единицу"))
    } finally {
      setSaving(false)
    }
  }

  const isBase = draft.baseUnitExternalId === BASE
  return (
    <MasterPanel title={unit ? unit.name : "Новая единица"} formLabel="Единица измерения" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!unit} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <Field label="Название" error={errors.name}>
        {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="Килограмм" />}
      </Field>
      <Field label="Сокращение" error={errors.shortName}>
        {(control) => <Input {...control} value={draft.shortName} onChange={(event) => set({ shortName: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="кг" />}
      </Field>
      <Field label="Размерность">
        {(control) => (
          <Select
            {...control}
            value={draft.dimension}
            onValueChange={(value) => set({ dimension: value as UnitDimension, baseUnitExternalId: BASE, coefficient: "1" })}
            options={Object.entries(DIMENSION_LABELS).map(([value, label]) => ({ value, label }))}
            disabled={readOnly}
          />
        )}
      </Field>
      <Field label="Базовая единица">
        {(control) => <Select {...control} value={draft.baseUnitExternalId} onValueChange={(baseUnitExternalId) => set({ baseUnitExternalId, ...(baseUnitExternalId === BASE ? { coefficient: "1" } : {}) })} options={baseOptions} disabled={readOnly} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Коэффициент к базовой" error={errors.coefficient} hint={isBase ? "У базовой единицы — 1" : "Например 0,001 для грамма"}>
          {(control) => <Input {...control} inputMode="decimal" value={isBase ? "1" : draft.coefficient} onChange={(event) => set({ coefficient: event.target.value })} disabled={readOnly || isBase} />}
        </Field>
        <Field label="Знаков после запятой" error={errors.precision}>
          {(control) => <Input {...control} inputMode="numeric" value={draft.precision} onChange={(event) => set({ precision: event.target.value })} disabled={readOnly} />}
        </Field>
      </div>
      <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
        <Checkbox checked={draft.active} onCheckedChange={(value) => set({ active: value === true })} disabled={readOnly} />
        Активна
      </label>
    </MasterPanel>
  )
}
