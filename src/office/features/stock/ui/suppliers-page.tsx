import { useQuery } from "convex/react"
import { useEffect, useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Button, Combobox, Field, Input, MoneyInput, Select, Switch, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { api } from "../../../../../convex/_generated/api"
import { parseDecimal, STOCK_PAGE_SIZE, SUPPLIER_POLICY, useDebounced, useSaveSupplier, useSuppliers, type SaveSupplierArgs, type Supplier, type SupplierPolicy } from "../data/use-stock-master"
import { MasterList, SwitchRow } from "./master-list"
import { MasterPanel, useMasterSelection } from "./master-panel"

/** «Поставщики» (/office/suppliers/:id?, W1-STK-05). */
export function SuppliersPage() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <SuppliersMaster />
    </PlatformErrorBoundary>
  )
}

export function supplierMeta(supplier: Pick<Supplier, "bin" | "supplierType">) {
  return `БИН ${supplier.bin} · ${supplier.supplierType === "internal" ? "внутренний" : "внешний"}`
}

function SuppliersMaster() {
  const canEdit = useCan("office.suppliers.edit")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const list = useSuppliers(search)
  const selection = useMasterSelection("suppliers")
  const selected = useQuery(api.domains.stock.master.getSupplier, selection.selectedId ? { externalId: selection.selectedId } : "skip")

  return (
    <div className="flex min-h-0 flex-1">
      <MasterList
        label="Поставщики"
        items={list.status === "LoadingFirstPage" ? undefined : list.results.map((supplier) => ({ id: supplier.externalId, title: supplier.name, meta: supplierMeta(supplier), active: supplier.active }))}
        selectedId={selection.selectedId}
        onSelect={selection.select}
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Название, БИН или контакт"
        createLabel={canEdit ? "Новый поставщик" : undefined}
        onCreate={selection.openNew}
        activeLabels={{ on: "Активен", off: "Неактивен" }}
        emptyTitle="Поставщиков пока нет"
        emptyDescription="Добавьте поставщика с БИН, условиями оплаты и политикой контроля цен."
        footer={
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-caption text-muted-foreground">
            <span>Загружено записей: {list.results.length}</span>
            {list.status === "CanLoadMore" || list.status === "LoadingMore" ? (
              <Button variant="ghost" size="sm" onClick={() => list.loadMore(STOCK_PAGE_SIZE)} disabled={list.status === "LoadingMore"}>
                {list.status === "LoadingMore" ? "Загрузка…" : "Показать ещё"}
              </Button>
            ) : null}
          </div>
        }
      />
      {selection.isNew ? <SupplierForm key="new" supplier={null} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
      {selected ? <SupplierForm key={selected.externalId} supplier={selected} canEdit={canEdit} onClose={selection.close} onSaved={selection.select} /> : null}
    </div>
  )
}

interface SupplierDraft {
  name: string
  bin: string
  supplierType: Supplier["supplierType"]
  vatPayer: boolean
  contactName: string
  phone: string
  email: string
  legalAddress: string
  bankAccount: string
  paymentDelayDays: string
  minimumOrder: number | null
  priceDeviationPolicy: SupplierPolicy
  allowedDeviationPercent: string
  restaurantExternalIds: string[]
  active: boolean
}

function draftOf(supplier: Supplier | null): SupplierDraft {
  return {
    name: supplier?.name ?? "",
    bin: supplier?.bin ?? "",
    supplierType: supplier?.supplierType ?? "external",
    vatPayer: supplier?.vatPayer ?? false,
    contactName: supplier?.contactName ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    legalAddress: supplier?.legalAddress ?? "",
    bankAccount: supplier?.bankAccount ?? "",
    paymentDelayDays: supplier?.paymentDelayDays === undefined ? "" : String(supplier.paymentDelayDays),
    minimumOrder: supplier?.minimumOrder ?? null,
    priceDeviationPolicy: supplier?.priceDeviationPolicy ?? "warn",
    allowedDeviationPercent: String(supplier?.allowedDeviationPercent ?? 10).replace(".", ","),
    restaurantExternalIds: [...(supplier?.restaurantExternalIds ?? [])],
    active: supplier?.active ?? true,
  }
}

export type SupplierErrors = Partial<Record<"name" | "bin" | "phone" | "email" | "paymentDelayDays" | "allowedDeviationPercent", string>>

/** The same rules as saveSupplier, checked before the call so a typo never reaches the server. */
export function validateSupplier(draft: Pick<SupplierDraft, "name" | "bin" | "phone" | "email" | "paymentDelayDays" | "allowedDeviationPercent">): SupplierErrors {
  const errors: SupplierErrors = {}
  if (!draft.name.trim()) errors.name = "Укажите название поставщика"
  if (!/^\d{12}$/.test(draft.bin.trim())) errors.bin = "БИН — 12 цифр"
  if (draft.email.trim() && !/^\S+@\S+\.\S+$/.test(draft.email.trim())) errors.email = "Некорректный email"
  if (draft.phone.trim() && !/^\+?[\d\s()-]{10,18}$/.test(draft.phone.trim())) errors.phone = "Некорректный телефон"
  if (draft.paymentDelayDays.trim() && !/^\d+$/.test(draft.paymentDelayDays.trim())) errors.paymentDelayDays = "Целое число дней"
  const percent = parseDecimal(draft.allowedDeviationPercent)
  if (percent === null || percent < 0 || percent > 100) errors.allowedDeviationPercent = "От 0 до 100 %"
  return errors
}

function SupplierForm({ supplier, canEdit, onClose, onSaved }: { supplier: Supplier | null; canEdit: boolean; onClose: () => void; onSaved: (externalId: string) => void }) {
  const scope = usePlatformScope()
  const [baseline, setBaseline] = useState(() => draftOf(supplier))
  const [draft, setDraft] = useState(baseline)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const [errors, setErrors] = useState<SupplierErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const save = useSaveSupplier()
  const toast = useToast()
  const readOnly = !canEdit
  const set = (patch: Partial<SupplierDraft>) => setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    if (savedId && !dirty && savedId !== supplier?.externalId) onSaved(savedId)
  }, [savedId, dirty, supplier?.externalId, onSaved])

  const restaurantOptions = scope.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))
  for (const externalId of draft.restaurantExternalIds) if (!restaurantOptions.some((option) => option.value === externalId)) restaurantOptions.push({ value: externalId, label: externalId })

  async function submit() {
    if (readOnly || saving) return
    const found = validateSupplier(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    const optional = (value: string) => (value.trim() ? value.trim() : undefined)
    const args: SaveSupplierArgs = {
      ...(supplier ? { externalId: supplier.externalId } : {}),
      name: draft.name.trim(),
      bin: draft.bin.trim(),
      supplierType: draft.supplierType,
      vatPayer: draft.vatPayer,
      contactName: optional(draft.contactName),
      phone: optional(draft.phone),
      email: optional(draft.email),
      legalAddress: optional(draft.legalAddress),
      bankAccount: optional(draft.bankAccount),
      paymentDelayDays: draft.paymentDelayDays.trim() ? Number(draft.paymentDelayDays) : undefined,
      minimumOrder: draft.minimumOrder ?? undefined,
      priceDeviationPolicy: draft.priceDeviationPolicy,
      allowedDeviationPercent: parseDecimal(draft.allowedDeviationPercent) ?? 0,
      restaurantExternalIds: draft.restaurantExternalIds,
      active: draft.active,
    }
    try {
      const externalId = await save(args)
      setBaseline(draft)
      toast("Поставщик сохранён", "success")
      setSavedId(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить поставщика"))
    } finally {
      setSaving(false)
    }
  }

  const text = (key: "name" | "contactName" | "phone" | "email" | "legalAddress" | "bankAccount", label: string, extra: { placeholder?: string; inputMode?: "tel" | "email"; error?: string } = {}) => (
    <Field label={label} error={extra.error}>
      {(control) => <Input {...control} value={draft[key]} onChange={(event) => set({ [key]: event.target.value } as Partial<SupplierDraft>)} disabled={readOnly} autoComplete="off" placeholder={extra.placeholder} inputMode={extra.inputMode} />}
    </Field>
  )

  return (
    <MasterPanel title={supplier ? supplier.name : "Новый поставщик"} formLabel="Поставщик" dirty={dirty} saving={saving} canEdit={canEdit} isNew={!supplier} error={error} onSubmit={() => void submit()} onClose={onClose}>
      {text("name", "Название", { error: errors.name })}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="БИН" error={errors.bin} hint="12 цифр">
          {(control) => <Input {...control} inputMode="numeric" maxLength={12} value={draft.bin} onChange={(event) => set({ bin: event.target.value.replace(/\D/g, "") })} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Тип">
          {(control) => (
            <Select
              {...control}
              value={draft.supplierType}
              onValueChange={(value) => set({ supplierType: value as Supplier["supplierType"] })}
              options={[
                { value: "external", label: "Внешний" },
                { value: "internal", label: "Внутренний" },
              ]}
              disabled={readOnly}
            />
          )}
        </Field>
      </div>
      <SwitchRow label="Плательщик НДС" hint="Себестоимость прихода считается без НДС, если НДС платят и организация, и поставщик">
        <Switch checked={draft.vatPayer} onCheckedChange={(vatPayer) => set({ vatPayer })} disabled={readOnly} />
      </SwitchRow>
      {text("contactName", "Контактное лицо")}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("phone", "Телефон", { placeholder: "+7 701 000 00 00", inputMode: "tel", error: errors.phone })}
        {text("email", "Email", { inputMode: "email", error: errors.email })}
      </div>
      {text("legalAddress", "Юридический адрес")}
      {text("bankAccount", "Банковский счёт", { placeholder: "KZ…" })}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Отсрочка (дней)" error={errors.paymentDelayDays}>
          {(control) => <Input {...control} inputMode="numeric" value={draft.paymentDelayDays} onChange={(event) => set({ paymentDelayDays: event.target.value })} disabled={readOnly} />}
        </Field>
        <Field label="Минимальный заказ (₸)">
          {(control) => <MoneyInput {...control} value={draft.minimumOrder} onValueChange={(minimumOrder) => set({ minimumOrder })} disabled={readOnly} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Отклонение цен" hint={SUPPLIER_POLICY[draft.priceDeviationPolicy].hint}>
          {(control) => (
            <Select
              {...control}
              value={draft.priceDeviationPolicy}
              onValueChange={(value) => set({ priceDeviationPolicy: value as SupplierPolicy })}
              options={Object.entries(SUPPLIER_POLICY).map(([value, policy]) => ({ value, label: policy.label }))}
              disabled={readOnly}
            />
          )}
        </Field>
        <Field label="Допустимое отклонение (%)" error={errors.allowedDeviationPercent}>
          {(control) => <Input {...control} inputMode="decimal" value={draft.allowedDeviationPercent} onChange={(event) => set({ allowedDeviationPercent: event.target.value })} disabled={readOnly} />}
        </Field>
      </div>
      <Field label="Рестораны" hint="Пусто — поставщик доступен всем ресторанам">
        {(control) => (
          <Combobox
            {...control}
            multiple
            value={draft.restaurantExternalIds}
            onValueChange={(restaurantExternalIds) => set({ restaurantExternalIds })}
            options={restaurantOptions}
            placeholder="Все рестораны"
            searchPlaceholder="Найти ресторан"
            disabled={readOnly}
          />
        )}
      </Field>
      <SwitchRow label="Активен">
        <Switch checked={draft.active} onCheckedChange={(active) => set({ active })} disabled={readOnly} />
      </SwitchRow>
    </MasterPanel>
  )
}
