import { useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, MoneyInput, Select, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { MODIFIER_UNITS, useIngredientOptions, useModifierMutations, type ModifierGroup, type ModifierRow, type ModifierUnit } from "../data/use-modifiers"
import { modifierDraftFrom, saveModifierArgs, validateModifierDraft, type ModifierDraft, type ModifierErrors } from "../model/use-modifier-draft"

const NO_INGREDIENT = "__none"
const UNIT_OPTIONS = MODIFIER_UNITS.map((unit) => ({ value: unit, label: unit }))

/** The modifier editor in the right panel: names, group, price, ingredient and its quantity, availability. */
export function ModifierEditorPanel({
  modifier,
  groups,
  defaultGroup,
  canEdit,
  onClose,
}: {
  modifier: ModifierRow | null
  groups: readonly ModifierGroup[]
  defaultGroup?: string
  canEdit: boolean
  onClose: () => void
}) {
  const canViewStock = useCan("office.stock.view")
  const ingredients = useIngredientOptions(canViewStock)
  const { save } = useModifierMutations()
  const toast = useToast()
  // The modifier query returns the ingredient's name only; it is matched back to the stock item.
  const ingredientByName = useMemo(() => (modifier ? ingredients.find((item) => item.label === modifier.ingredientName)?.value : undefined), [ingredients, modifier])
  const [baseline] = useState(() => modifierDraftFrom(modifier, { groupExternalId: defaultGroup ?? groups[0]?.externalId }))
  const [draft, setDraft] = useState<ModifierDraft>(baseline)
  /** null until the user picks: then the saved ingredient (matched by name) stays selected. */
  const [ingredientChoice, setIngredientChoice] = useState<string | null>(null)
  const ingredientExternalId = ingredientChoice ?? ingredientByName ?? ""
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || (ingredientChoice !== null && ingredientChoice !== (ingredientByName ?? ""))
  const blocker = useUnsavedChanges(dirty)
  const [errors, setErrors] = useState<ModifierErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const readOnly = !canEdit
  const set = (patch: Partial<ModifierDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const groupOptions = groups.map((group) => ({ value: group.externalId, label: group.name }))
  const ingredientOptions = [{ value: NO_INGREDIENT, label: "Без складской позиции" }, ...ingredients]

  async function submit() {
    if (readOnly || saving) return
    const found = validateModifierDraft(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setError(null)
    try {
      await save(saveModifierArgs(modifier?.externalId, { ...draft, ingredientExternalId }))
      toast("Модификатор сохранён", "success")
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить модификатор"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (!next) (dirty ? setConfirmClose(true) : onClose())
        }}
        title={modifier ? modifier.name : "Новый модификатор"}
        footer={
          canEdit ? (
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          ) : undefined
        }
      >
        <form
          aria-label="Модификатор"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-4"
        >
          {error ? (
            <Banner tone="danger" title="Не удалось сохранить">
              {error}
            </Banner>
          ) : null}
          <Field label="Название" error={errors.name}>
            {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Атауы (қаз)">
            {(control) => <Input {...control} value={draft.nameKk} onChange={(event) => set({ nameKk: event.target.value })} disabled={readOnly} autoComplete="off" />}
          </Field>
          <Field label="Группа" error={errors.groupExternalId}>
            {(control) => (
              <Select {...control} value={draft.groupExternalId || undefined} onValueChange={(groupExternalId) => set({ groupExternalId })} options={groupOptions} placeholder="Выберите группу" disabled={readOnly} />
            )}
          </Field>
          <Field label="Цена" error={errors.price} hint="0 — бесплатная добавка">
            {(control) => <MoneyInput {...control} value={draft.price} onValueChange={(price) => set({ price })} disabled={readOnly} />}
          </Field>
          {canViewStock ? (
            <Field label="Ингредиент" hint="Списывается со склада при продаже">
              {(control) => (
                <Combobox
                  {...control}
                  value={ingredientExternalId || NO_INGREDIENT}
                  onValueChange={(value) => {
                    const item = ingredients.find((option) => option.value === value)
                    setIngredientChoice(value === NO_INGREDIENT ? "" : value)
                    if (item) set({ unit: item.unit as ModifierUnit })
                  }}
                  options={ingredientOptions}
                  placeholder="Складская позиция"
                  searchPlaceholder="Найти позицию"
                  disabled={readOnly}
                />
              )}
            </Field>
          ) : (
            <p className="text-caption text-muted-foreground">Ингредиент: {modifier?.ingredientName ?? "—"} (выбор складской позиции доступен с правом просмотра остатков)</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Количество ингредиента" error={errors.ingredientQuantity}>
              {(control) => (
                <Input {...control} inputMode="decimal" value={draft.ingredientQuantity} onChange={(event) => set({ ingredientQuantity: event.target.value })} disabled={readOnly} />
              )}
            </Field>
            <Field label="Единица">{(control) => <Select {...control} value={draft.unit} onValueChange={(unit) => set({ unit: unit as ModifierUnit })} options={UNIT_OPTIONS} disabled={readOnly} />}</Field>
          </div>
          <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
            <Switch checked={draft.available} onCheckedChange={(available) => set({ available })} disabled={readOnly} />
            Доступен
            <span className="font-normal text-muted-foreground">— предлагается на кассе</span>
          </label>
        </form>
      </RightPanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть без сохранения?"
        description="Изменения модификатора не сохранены и будут потеряны."
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
