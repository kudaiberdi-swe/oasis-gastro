import { Minus, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useProductPicker } from "@/office/features/nomenclature/data/use-nomenclature"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Checkbox, Combobox, ConfirmDialog, EmptyState, Field, Select, Switch, TonePill, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { GROUP_MODIFIERS_SIZE, useModifierGroups, useModifierMutations, useModifiers, useProductRules, type GroupAssignment, type ModifierRow } from "../data/use-modifiers"
import {
  describeLimits,
  hasRulesErrors,
  MAX_QUANTITY,
  rulesDraftFrom,
  saveRulesArgs,
  validateGroupRules,
  type GroupRulesDraft,
  type GroupRulesErrors,
  type RuleRowDraft,
} from "../model/use-modifier-draft"

/** «Правила для блюда»: the groups attached to a dish, their limits and the per-modifier rules. */
export function ProductRulesTab({ productExternalId, onProductChange }: { productExternalId: string | undefined; onProductChange: (externalId: string | undefined) => void }) {
  const canEdit = useCan("office.modifiers.edit")
  const products = useProductPicker(useCan("office.nomenclature.view"))
  const rules = useProductRules(productExternalId)
  const groups = useModifierGroups()
  const { assignGroup } = useModifierMutations()
  const toast = useToast()
  const [groupToAssign, setGroupToAssign] = useState<string | undefined>()
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirtyGroups, setDirtyGroups] = useState<ReadonlySet<string>>(new Set())
  const blocker = useUnsavedChanges(dirtyGroups.size > 0)
  const productName = products.rows.find((row) => row.externalId === productExternalId)?.name

  const options = useMemo(() => {
    const list = [...products.options]
    if (productExternalId && !list.some((option) => option.value === productExternalId)) list.push({ value: productExternalId, label: productExternalId, hint: undefined })
    return list
  }, [products.options, productExternalId])

  const assigned = new Set((rules ?? []).map((assignment) => assignment.groupExternalId))
  const available = (groups ?? []).filter((group) => group.active && !assigned.has(group.externalId))

  const markDirty = useCallback((groupExternalId: string, dirty: boolean) => {
    setDirtyGroups((current) => {
      if (current.has(groupExternalId) === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(groupExternalId)
      else next.delete(groupExternalId)
      return next
    })
  }, [])

  async function assign() {
    if (!productExternalId || !groupToAssign || assigning) return
    setAssigning(true)
    setError(null)
    try {
      await assignGroup({ productExternalId, groupExternalId: groupToAssign })
      setGroupToAssign(undefined)
      toast("Группа назначена", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось назначить группу"))
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Блюдо" className="w-full sm:w-[420px]">
        {(control) => (
          <Combobox
            {...control}
            value={productExternalId}
            onValueChange={(value) => {
              setDirtyGroups(new Set())
              onProductChange(value)
            }}
            options={options}
            placeholder="Выберите блюдо…"
            searchPlaceholder="Название или артикул"
          />
        )}
      </Field>
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      {!productExternalId ? (
        <EmptyState title="Выберите блюдо" description="Назначьте ему группы модификаторов и задайте, сколько добавок можно выбрать и сколько из них бесплатно." />
      ) : rules === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : rules === null ? (
        <EmptyState title="Блюдо не найдено" description="Возможно, его удалили. Выберите другое блюдо." />
      ) : (
        <>
          {rules.length === 0 ? <EmptyState title={`У «${productName ?? "блюда"}» нет модификаторов`} description="Назначьте группу — например «Соусы» — и включите нужные добавки." /> : null}
          {rules.map((assignment) => (
            <GroupRulesCard key={assignment.groupExternalId ?? "missing"} productExternalId={productExternalId} assignment={assignment} canEdit={canEdit} onDirtyChange={markDirty} />
          ))}
          {canEdit ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Группа модификаторов" className="w-full sm:w-72">
                {(control) => (
                  <Select
                    {...control}
                    value={groupToAssign}
                    onValueChange={setGroupToAssign}
                    options={available.map((group) => ({ value: group.externalId, label: group.name }))}
                    placeholder={available.length ? "Выберите группу" : "Все группы назначены"}
                    disabled={available.length === 0}
                  />
                )}
              </Field>
              <Button variant="secondary" onClick={() => void assign()} disabled={!groupToAssign || assigning}>
                <Plus aria-hidden />
                Назначить группу
              </Button>
            </div>
          ) : null}
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

function GroupRulesCard({
  productExternalId,
  assignment,
  canEdit,
  onDirtyChange,
}: {
  productExternalId: string
  assignment: GroupAssignment
  canEdit: boolean
  onDirtyChange: (groupExternalId: string, dirty: boolean) => void
}) {
  const modifiers = useModifiers({ groupExternalId: assignment.groupExternalId ?? undefined }, GROUP_MODIFIERS_SIZE)
  if (!assignment.groupExternalId) return null
  if (modifiers.status === "LoadingFirstPage") return <OfficeStatePage state={{ kind: "loading" }} />
  // A new server state (after saving, or a modifier added to the group) starts a fresh draft.
  const key = JSON.stringify([assignment, modifiers.results.map((modifier) => modifier.externalId)])
  return (
    <GroupRulesForm
      key={key}
      productExternalId={productExternalId}
      groupExternalId={assignment.groupExternalId}
      assignment={assignment}
      modifiers={modifiers.results}
      canEdit={canEdit}
      onDirtyChange={onDirtyChange}
    />
  )
}

function GroupRulesForm({
  productExternalId,
  groupExternalId,
  assignment,
  modifiers,
  canEdit,
  onDirtyChange,
}: {
  productExternalId: string
  groupExternalId: string
  assignment: GroupAssignment
  modifiers: readonly ModifierRow[]
  canEdit: boolean
  onDirtyChange: (groupExternalId: string, dirty: boolean) => void
}) {
  const { saveProductRules, unassignGroup } = useModifierMutations()
  const toast = useToast()
  const [baseline, setBaseline] = useState(() => rulesDraftFrom(assignment, modifiers))
  const [draft, setDraftState] = useState<GroupRulesDraft>(baseline)
  const [errors, setErrors] = useState<GroupRulesErrors>({ rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const readOnly = !canEdit
  const groupName = assignment.groupName ?? "Группа"

  const setDraft = (update: (current: GroupRulesDraft) => GroupRulesDraft) => setDraftState(update)
  const setGroup = (patch: Partial<Omit<GroupRulesDraft, "rows">>) => setDraft((current) => ({ ...current, ...patch }))
  const setRow = (modifierExternalId: string, patch: Partial<RuleRowDraft>) =>
    setDraft((current) => ({ ...current, rows: current.rows.map((row) => (row.modifierExternalId === modifierExternalId ? { ...row, ...patch } : row)) }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  // The page-level leave guard knows which groups have unsaved rules.
  useEffect(() => {
    onDirtyChange(groupExternalId, dirty)
  }, [dirty, groupExternalId, onDirtyChange])
  useEffect(() => () => onDirtyChange(groupExternalId, false), [groupExternalId, onDirtyChange])

  async function save() {
    if (readOnly || saving) return
    const found = validateGroupRules(draft)
    setErrors(found)
    if (hasRulesErrors(found)) return
    setSaving(true)
    setError(null)
    try {
      await saveProductRules(saveRulesArgs(productExternalId, groupExternalId, draft))
      setBaseline(draft)
      toast(`Правила «${groupName}» сохранены`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить правила"))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setError(null)
    try {
      await unassignGroup({ productExternalId, groupExternalId })
      toast(`Группа «${groupName}» снята с блюда`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось снять группу"))
    } finally {
      setConfirmRemove(false)
    }
  }

  return (
    <section aria-label={`Группа «${groupName}»`} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title-sm font-semibold">{groupName}</h3>
            {draft.required ? <TonePill tone="warning">обязательно</TonePill> : null}
          </div>
          <p className="text-caption text-muted-foreground">{describeLimits(draft)}</p>
        </div>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
            <Trash2 aria-hidden />
            Снять группу
          </Button>
        ) : null}
      </header>

      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex h-11 items-center gap-3 text-body-sm font-medium text-foreground">
          <Switch checked={draft.required} onCheckedChange={(required) => setGroup({ required })} disabled={readOnly} />
          Обязательная группа
        </label>
        <QuantityStepper label="Минимум" value={draft.minQuantity} onChange={(minQuantity) => setGroup({ minQuantity })} disabled={readOnly} />
        <QuantityStepper label="Максимум" value={draft.maxQuantity} onChange={(maxQuantity) => setGroup({ maxQuantity })} disabled={readOnly} />
        <QuantityStepper label="Бесплатно" value={draft.freeQuantity} onChange={(freeQuantity) => setGroup({ freeQuantity })} disabled={readOnly} />
        <label className="flex h-11 items-center gap-3 text-body-sm font-medium text-foreground">
          <Switch checked={draft.enforceItemLimits} onCheckedChange={(enforceItemLimits) => setGroup({ enforceItemLimits })} disabled={readOnly} />
          Ограничивать каждую добавку
        </label>
      </div>
      {errors.group ? (
        <p role="alert" className="text-caption text-destructive">
          {errors.group}
        </p>
      ) : null}

      {draft.rows.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">В группе пока нет модификаторов — добавьте их в справочнике.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-card border border-border">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">Модификаторы группы «{groupName}»</caption>
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th scope="col" className="h-10 w-12 px-3 text-left font-semibold">
                  Вкл.
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  Модификатор
                </th>
                <th scope="col" className="px-3 text-right font-semibold">
                  Цена
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  Мин.
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  По умолч.
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  Макс.
                </th>
                <th scope="col" className="px-3 text-left font-semibold">
                  Бесплатно
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((row) => {
                const rowError = errors.rows[row.modifierExternalId]
                const disabled = readOnly || !row.included
                return (
                  <tr key={row.modifierExternalId} className="border-b border-border align-top last:border-b-0">
                    <td className="px-3 py-3">
                      <Checkbox checked={row.included} onCheckedChange={(value) => setRow(row.modifierExternalId, { included: value === true })} disabled={readOnly} aria-label={`Включить «${row.name}»`} />
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn("font-semibold", !row.included && "text-muted-foreground")}>{row.name}</span>
                      {rowError ? (
                        <p role="alert" className="mt-1 text-caption text-destructive">
                          {rowError}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{row.price > 0 ? formatTenge(row.price) : "—"}</td>
                    <td className="px-3 py-2">
                      <QuantityStepper label={`Минимум — ${row.name}`} compact value={row.minQuantity} onChange={(minQuantity) => setRow(row.modifierExternalId, { minQuantity })} disabled={disabled} invalid={Boolean(rowError)} />
                    </td>
                    <td className="px-3 py-2">
                      <QuantityStepper label={`По умолчанию — ${row.name}`} compact value={row.defaultQuantity} onChange={(defaultQuantity) => setRow(row.modifierExternalId, { defaultQuantity })} disabled={disabled} invalid={Boolean(rowError)} />
                    </td>
                    <td className="px-3 py-2">
                      <QuantityStepper label={`Максимум — ${row.name}`} compact value={row.maxQuantity} onChange={(maxQuantity) => setRow(row.modifierExternalId, { maxQuantity })} disabled={disabled} invalid={Boolean(rowError)} />
                    </td>
                    <td className="px-3 py-2">
                      <QuantityStepper label={`Бесплатно — ${row.name}`} compact value={row.freeQuantity} onChange={(freeQuantity) => setRow(row.modifierExternalId, { freeQuantity })} disabled={disabled} invalid={Boolean(rowError)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Сохранение…" : "Сохранить правила"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Снять «${groupName}» с блюда?`}
        description="Правила этой группы для блюда будут удалены; сами модификаторы останутся в справочнике."
        confirmLabel="Снять группу"
        onConfirm={() => void remove()}
      />
    </section>
  )
}

/** − [n] + stepper for whole quantities 0…99; typing is allowed too. */
function QuantityStepper({ label, value, onChange, disabled, compact = false, invalid = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; compact?: boolean; invalid?: boolean }) {
  const buttonClass = cn("grid size-9 shrink-0 place-items-center rounded-control border border-input bg-card text-foreground hover:bg-muted disabled:opacity-40", focusRingClass)
  const control = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Меньше — ${label}`} className={buttonClass} disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>
        <Minus className="size-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "")
          onChange(digits ? Math.min(MAX_QUANTITY, Number(digits)) : 0)
        }}
        className={cn(
          "h-9 w-12 rounded-control border border-input bg-card text-center text-body-sm tabular-nums text-foreground disabled:opacity-50 aria-invalid:border-destructive",
          focusRingClass,
        )}
      />
      <button type="button" aria-label={`Больше — ${label}`} className={buttonClass} disabled={disabled || value >= MAX_QUANTITY} onClick={() => onChange(Math.min(MAX_QUANTITY, value + 1))}>
        <Plus className="size-4" />
      </button>
    </div>
  )
  if (compact) return control
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
      {control}
    </div>
  )
}
