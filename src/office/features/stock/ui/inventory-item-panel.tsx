import { useQuery } from "convex/react"
import { useEffect, useState, type ReactNode } from "react"

import { useCan } from "@/office/components/can"
import { RightPanel } from "@/office/components/right-panel"
import { SaveStatus } from "@/office/components/unsaved-changes"
import { Banner, Button, Checkbox, ConfirmDialog, Field, Input, Select, SkeletonRows, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity, formatTenge } from "@/shared/lib/format"

import { api } from "../../../../../convex/_generated/api"
import { ITEM_KIND_LABELS, parseDecimal, useInventoryItem, useSaveInventoryItem, type BalanceRow, type InventoryItem, type InventoryItemKind, type SaveInventoryItemArgs } from "../data/use-stock-master"
import { BalanceFlags } from "./balance-flags"

export interface InventoryItemPanelProps {
  /** The balance row the panel was opened from; null — «+ Новая позиция». */
  balance: BalanceRow | null
  onClose: () => void
}

/**
 * «Складская позиция» (W1-STK-06) from «Остатки»: the row's balance with minimum/maximum and the item
 * form. Recent movements are not exposed by a query yet, so the panel shows the current balance only.
 */
export function InventoryItemPanel({ balance, onClose }: InventoryItemPanelProps) {
  const item = useInventoryItem(balance?.item.externalId, balance?.item.name)
  const canEdit = useCan("office.nomenclature.edit")
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  return (
    <>
      <RightPanel
        open
        onOpenChange={(next) => {
          if (!next) {
            if (dirty) setConfirmClose(true)
            else onClose()
          }
        }}
        title={balance ? balance.item.name : "Новая позиция"}
      >
        <div className="flex flex-col gap-5">
          {balance ? <BalanceSummary balance={balance} item={item ?? null} /> : null}
          {balance && item === undefined ? (
            <SkeletonRows rows={4} />
          ) : (
            <InventoryItemForm key={item?.externalId ?? "new"} item={item ?? null} canEdit={canEdit} onDirtyChange={setDirty} onSaved={() => (balance ? undefined : onClose())} />
          )}
        </div>
      </RightPanel>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Закрыть без сохранения?"
        description="Изменения позиции не сохранены и будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Остаться"
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
    </>
  )
}

function BalanceSummary({ balance, item }: { balance: BalanceRow; item: InventoryItem | null }) {
  const unit = balance.item.unit
  const term = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body-sm font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  )
  return (
    <section aria-label="Остаток" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-title-sm font-semibold">{balance.warehouse.name}</h3>
        <BalanceFlags row={balance} />
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {term("Текущий остаток", formatQuantity(balance.quantity, unit))}
        {term("Средняя цена", formatTenge(balance.averageUnitCost))}
        {term("Стоимость", formatTenge(balance.amount))}
        {term("Код", <span className="font-normal">{balance.item.externalId}</span>)}
        {term("Минимум", item?.minimumStock === undefined || item === null ? "—" : formatQuantity(item.minimumStock, unit))}
        {term("Максимум", item?.maximumStock === undefined || item === null ? "—" : formatQuantity(item.maximumStock, unit))}
      </dl>
      <p className="text-caption text-muted-foreground">История движений позиции появится здесь позже; сейчас её видно в складских документах.</p>
    </section>
  )
}

interface ItemDraft {
  name: string
  kind: InventoryItemKind
  unitExternalId: string
  minimumStock: string
  maximumStock: string
  shelfLifeHours: string
  defaultVatRate: string
  active: boolean
}

function draftOf(item: InventoryItem | null): ItemDraft {
  const text = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","))
  return {
    name: item?.name ?? "",
    kind: item?.kind ?? "ingredient",
    unitExternalId: item?.unitExternalId ?? "",
    minimumStock: text(item?.minimumStock),
    maximumStock: text(item?.maximumStock),
    shelfLifeHours: text(item?.shelfLifeHours),
    defaultVatRate: String(item?.defaultVatRate ?? 0),
    active: item?.active ?? true,
  }
}

type ItemErrors = Partial<Record<"name" | "unit" | "minimumStock" | "maximumStock" | "shelfLifeHours", string>>

export function validateItem(draft: ItemDraft): ItemErrors {
  const errors: ItemErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название позиции"
  if (!draft.unitExternalId) errors.unit = "Выберите единицу"
  const number = (text: string) => (text.trim() ? parseDecimal(text) : undefined)
  const minimum = number(draft.minimumStock)
  const maximum = number(draft.maximumStock)
  if (minimum === null || (minimum !== undefined && minimum < 0)) errors.minimumStock = "Неотрицательное число"
  if (maximum === null || (maximum !== undefined && maximum < 0)) errors.maximumStock = "Неотрицательное число"
  if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) errors.maximumStock = "Максимум меньше минимума"
  const shelf = number(draft.shelfLifeHours)
  if (shelf === null || (shelf !== undefined && shelf < 0)) errors.shelfLifeHours = "Неотрицательное число"
  return errors
}

function InventoryItemForm({ item, canEdit, onDirtyChange, onSaved }: { item: InventoryItem | null; canEdit: boolean; onDirtyChange: (dirty: boolean) => void; onSaved: () => void }) {
  const canViewUnits = useCan("office.units.view")
  const units = useQuery(api.domains.stock.master.listUnits, canViewUnits ? { activeOnly: true } : "skip")
  const [baseline, setBaseline] = useState(() => draftOf(item))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<ItemErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = useSaveInventoryItem()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<ItemDraft>) => setDraft((current) => ({ ...current, ...patch }))
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const unitOptions = (units ?? []).map((unit) => ({ value: unit.externalId, label: `${unit.name} (${unit.shortName})` }))
  if (draft.unitExternalId && !unitOptions.some((option) => option.value === draft.unitExternalId)) unitOptions.push({ value: draft.unitExternalId, label: item?.unit ?? draft.unitExternalId })

  async function submit() {
    if (readOnly || saving) return
    const found = validateItem(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    const number = (text: string) => (text.trim() ? (parseDecimal(text) ?? undefined) : undefined)
    const args: SaveInventoryItemArgs = {
      ...(item ? { externalId: item.externalId } : {}),
      name: draft.name.trim(),
      kind: draft.kind,
      unitExternalId: draft.unitExternalId,
      minimumStock: number(draft.minimumStock),
      maximumStock: number(draft.maximumStock),
      shelfLifeHours: number(draft.shelfLifeHours),
      defaultVatRate: Number(draft.defaultVatRate),
      ...(item?.productExternalId ? { productExternalId: item.productExternalId } : {}),
      active: draft.active,
    }
    try {
      await save(args)
      setBaseline(draft)
      toast(item ? "Позиция сохранена" : "Позиция создана", "success")
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить позицию"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      aria-label="Складская позиция"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-4"
    >
      <h3 className="text-title-sm font-semibold">Складская позиция</h3>
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <Field label="Название" error={errors.name}>
        {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Тип">
          {(control) => <Select {...control} value={draft.kind} onValueChange={(kind) => set({ kind: kind as InventoryItemKind })} options={Object.entries(ITEM_KIND_LABELS).map(([value, label]) => ({ value, label }))} disabled={readOnly} />}
        </Field>
        <Field label="Единица" error={errors.unit}>
          {(control) => <Select {...control} value={draft.unitExternalId || undefined} onValueChange={(unitExternalId) => set({ unitExternalId })} options={unitOptions} placeholder="Выберите единицу" disabled={readOnly || !canViewUnits} />}
        </Field>
        <Field label="Минимальный остаток" error={errors.minimumStock}>
          {(control) => <Input {...control} inputMode="decimal" value={draft.minimumStock} onChange={(event) => set({ minimumStock: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Максимальный остаток" error={errors.maximumStock}>
          {(control) => <Input {...control} inputMode="decimal" value={draft.maximumStock} onChange={(event) => set({ maximumStock: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Срок хранения (ч)" error={errors.shelfLifeHours}>
          {(control) => <Input {...control} inputMode="decimal" value={draft.shelfLifeHours} onChange={(event) => set({ shelfLifeHours: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="НДС по умолчанию">
          {(control) => (
            <Select
              {...control}
              value={draft.defaultVatRate}
              onValueChange={(defaultVatRate) => set({ defaultVatRate })}
              options={[
                { value: "0", label: "Без НДС" },
                { value: "12", label: "12 %" },
              ]}
              disabled={readOnly}
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-3 text-body-sm font-medium text-foreground">
        <Checkbox checked={draft.active} onCheckedChange={(value) => set({ active: value === true })} disabled={readOnly} />
        Активна
      </label>
      {canEdit ? (
        <div className="flex items-center justify-end gap-3">
          <SaveStatus state={saving ? "saving" : dirty ? "dirty" : "clean"} />
          <Button type="submit" disabled={saving || (!dirty && item !== null)}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
