import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Combobox, Field, Input, Select, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useSaveWarehouse, useWarehouses, WAREHOUSE_KIND_LABELS, type SaveWarehouseArgs, type Warehouse, type WarehouseKind } from "../data/use-stock-master"
import { MasterList, SwitchRow } from "./master-list"
import { MasterPanel, useMasterSelection } from "./master-panel"

/** «Склады» (/office/warehouses/:id?, W1-STK-04). */
export function WarehousesPage() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <WarehousesMaster />
    </PlatformErrorBoundary>
  )
}

export function warehouseMeta(warehouse: Pick<Warehouse, "kind" | "responsibleName">) {
  return `${WAREHOUSE_KIND_LABELS[warehouse.kind]} · ${warehouse.responsibleName || "МОЛ не указан"}`
}

function WarehousesMaster() {
  const canEdit = useCan("office.warehouses.edit")
  const scope = usePlatformScope()
  const [search, setSearch] = useState("")
  const warehouses = useWarehouses()
  const selection = useMasterSelection("warehouses")
  const needle = search.trim().toLocaleLowerCase("ru")
  const visible = warehouses?.filter((warehouse) => !needle || warehouse.searchText.includes(needle) || warehouse.name.toLocaleLowerCase("ru").includes(needle))
  const selected = selection.selectedId ? (warehouses ?? []).find((warehouse) => warehouse.externalId === selection.selectedId) ?? null : null

  return (
    <div className="flex min-h-0 flex-1">
      <MasterList
        label="Склады"
        items={visible?.map((warehouse) => ({
          id: warehouse.externalId,
          title: warehouse.name,
          meta: scope.restaurants.length > 1 ? `${scope.restaurantName(warehouse.restaurantExternalId)} · ${warehouseMeta(warehouse)}` : warehouseMeta(warehouse),
          active: warehouse.active,
        }))}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Название склада или МОЛ"
        createLabel={canEdit ? "Новый склад" : undefined}
        onCreate={selection.openNew}
        activeLabels={{ on: "Активен", off: "Неактивен" }}
        emptyTitle="Складов пока нет"
        emptyDescription="Создайте склад ресторана — основной склад, кухню или бар."
      />
      {selection.isNew || selected ? <WarehouseForm key={selected?.externalId ?? "new"} warehouse={selected} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
    </div>
  )
}

interface WarehouseDraft {
  name: string
  shortName: string
  restaurantExternalId: string
  kind: WarehouseKind
  responsibleName: string
  allowNegativeStock: boolean
  internalTransfers: boolean
  isSalesDefault: boolean
  active: boolean
}

function draftOf(warehouse: Warehouse | null, restaurantExternalId: string): WarehouseDraft {
  return {
    name: warehouse?.name ?? "",
    shortName: warehouse?.shortName ?? "",
    restaurantExternalId: warehouse?.restaurantExternalId ?? restaurantExternalId,
    kind: warehouse?.kind ?? "storage",
    responsibleName: warehouse?.responsibleName ?? "",
    allowNegativeStock: warehouse?.allowNegativeStock ?? false,
    internalTransfers: warehouse?.internalTransfers ?? true,
    isSalesDefault: warehouse?.isSalesDefault ?? false,
    active: warehouse?.active ?? true,
  }
}

function WarehouseForm({ warehouse, canEdit, onClose, onSaved }: { warehouse: Warehouse | null; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const scope = usePlatformScope()
  const [baseline, setBaseline] = useState(() => draftOf(warehouse, scope.restaurants.length === 1 ? scope.restaurants[0].externalId : ""))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<{ name?: string; restaurant?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const save = useSaveWarehouse()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<WarehouseDraft>) => setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (savedId && !dirty && savedId !== warehouse?.externalId) onSaved(savedId)
  }, [savedId, dirty, warehouse?.externalId, onSaved])

  const restaurantOptions = restaurantSelectOptions(scope.restaurants)
  if (draft.restaurantExternalId && !restaurantOptions.some((option) => option.value === draft.restaurantExternalId)) restaurantOptions.push({ value: draft.restaurantExternalId, label: draft.restaurantExternalId })

  async function submit() {
    if (readOnly || saving) return
    const found: typeof errors = {}
    if (!draft.name.trim()) found.name = "Укажите название склада"
    if (!draft.restaurantExternalId) found.restaurant = "Выберите ресторан"
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    const args: SaveWarehouseArgs = {
      ...(warehouse ? { externalId: warehouse.externalId } : {}),
      name: draft.name.trim(),
      shortName: draft.shortName.trim(),
      restaurantExternalId: draft.restaurantExternalId,
      kind: draft.kind,
      ...(draft.responsibleName.trim() ? { responsibleName: draft.responsibleName.trim() } : {}),
      allowNegativeStock: draft.allowNegativeStock,
      internalTransfers: draft.internalTransfers,
      isSalesDefault: draft.isSalesDefault,
      active: draft.active,
    }
    try {
      const externalId = await save(args)
      setBaseline(draft)
      toast("Склад сохранён", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить склад"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <MasterPanel title={warehouse ? warehouse.name : "Новый склад"} formLabel="Склад" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!warehouse} error={error} onSubmit={() => void submit()} onClose={onClose}>
      <Field label="Название" error={errors.name}>
        {(control) => <Input {...control} value={draft.name} onChange={(event) => set({ name: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="Sandyq Абая · основной склад" />}
      </Field>
      <Field label="Короткое название" hint="Пусто — как название">
        {(control) => <Input {...control} value={draft.shortName} onChange={(event) => set({ shortName: event.target.value })} disabled={readOnly} autoComplete="off" />}
      </Field>
      <Field label="Ресторан" error={errors.restaurant} hint={warehouse ? "Ресторан склада менять нельзя" : undefined}>
        {(control) => (
          <Combobox
            {...control}
            value={draft.restaurantExternalId || undefined}
            onValueChange={(restaurantExternalId) => set({ restaurantExternalId })}
            options={restaurantOptions}
            placeholder="Выберите ресторан"
            searchPlaceholder="Найти ресторан"
            disabled={readOnly || warehouse !== null}
          />
        )}
      </Field>
      <Field label="Тип склада">
        {(control) => <Select {...control} value={draft.kind} onValueChange={(kind) => set({ kind: kind as WarehouseKind })} options={Object.entries(WAREHOUSE_KIND_LABELS).map(([value, label]) => ({ value, label }))} disabled={readOnly} />}
      </Field>
      <Field label="Материально ответственное лицо">
        {(control) => <Input {...control} value={draft.responsibleName} onChange={(event) => set({ responsibleName: event.target.value })} disabled={readOnly} autoComplete="off" placeholder="Заведующий смены" />}
      </Field>
      <div className="flex flex-col gap-3">
        <SwitchRow label="Разрешить отрицательные остатки" hint="Списание сверх остатка не блокируется">
          <Switch checked={draft.allowNegativeStock} onCheckedChange={(allowNegativeStock) => set({ allowNegativeStock })} disabled={readOnly} />
        </SwitchRow>
        <SwitchRow label="Участвует во внутренних перемещениях">
          <Switch checked={draft.internalTransfers} onCheckedChange={(internalTransfers) => set({ internalTransfers })} disabled={readOnly} />
        </SwitchRow>
        <SwitchRow label="Склад продаж по умолчанию" hint="С него списываются продажи ресторана; у других складов флаг снимется">
          <Switch checked={draft.isSalesDefault} onCheckedChange={(isSalesDefault) => set({ isSalesDefault })} disabled={readOnly || !draft.active} />
        </SwitchRow>
        <SwitchRow label="Активен">
          <Switch checked={draft.active} onCheckedChange={(active) => set({ active, ...(active ? {} : { isSalesDefault: false }) })} disabled={readOnly} />
        </SwitchRow>
      </div>
    </MasterPanel>
  )
}
