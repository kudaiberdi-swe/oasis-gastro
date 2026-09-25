import { Plus } from "lucide-react"
import { useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, Combobox, Field, Input, Select, Switch, TonePill, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatPercent } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useDeliveryReferences, useDeliverySources, useSourceMutations, type DeliverySource, type DeliverySourceKind } from "../data/use-delivery"
import { SETTLEMENT_LABELS, SOURCE_KIND_LABELS, type SettlementMode } from "../model/statuses"
import { MasterDetail, MasterListBlock, MasterRow, MasterRows } from "./master-detail"

const FORM_ID = "delivery-source-editor"
const ALL_RESTAURANTS = "*"
const NO_PAYMENT = "__none__"

const KIND_OPTIONS = (Object.keys(SOURCE_KIND_LABELS) as DeliverySourceKind[]).map((value) => ({ value, label: SOURCE_KIND_LABELS[value] }))
const SETTLEMENT_OPTIONS = (Object.keys(SETTLEMENT_LABELS) as SettlementMode[]).map((value) => ({ value, label: SETTLEMENT_LABELS[value] }))

/** «Источники заказов» (/office/delivery-sources, W2-DLV-08, office/64): channels and the source card. */
export function SourcesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <SourcesContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function SourcesContent() {
  const sources = useDeliverySources()
  const canEdit = useCan("office.delivery-sources.edit")
  const [selection, setSelection] = useState<Selection>(null)
  const selected = selection?.kind === "edit" ? sources?.find((source) => source.externalId === selection.externalId) : undefined
  const editing = selection?.kind === "new" || selected !== undefined

  return (
    <MasterDetail
      toolbar={
        canEdit ? (
          <Button variant={editing ? "secondary" : "primary"} onClick={() => setSelection({ kind: "new" })}>
            <Plus aria-hidden />
            Новый источник
          </Button>
        ) : null
      }
      list={
        sources === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : (
          <MasterListBlock title="Каналы" caption="Комиссия учитывается в аналитике доставки">
            {sources.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">Источников пока нет.</p>
            ) : (
              <MasterRows>
                {sources.map((source) => (
                  <MasterRow
                    key={source.externalId}
                    active={source.externalId === selected?.externalId}
                    onSelect={() => setSelection({ kind: "edit", externalId: source.externalId })}
                    title={source.name}
                    meta={`${SOURCE_KIND_LABELS[source.kind]} · расчёт ${SETTLEMENT_LABELS[source.settlementMode].toLocaleLowerCase("ru")}`}
                    trailing={
                      <>
                        <span className="text-body-sm font-semibold tabular-nums">{formatPercent(source.commissionPercent)}</span>
                        <TonePill tone={source.active ? "success" : "neutral"}>{source.active ? "Активен" : "Выключен"}</TonePill>
                      </>
                    }
                  />
                ))}
              </MasterRows>
            )}
          </MasterListBlock>
        )
      }
      cardTitle={selected ? selected.name : "Карточка источника"}
      cardCaption="Секреты задаются в разделе Обмен"
      cardActions={
        canEdit ? (
          <Button type="submit" form={FORM_ID}>
            Сохранить
          </Button>
        ) : null
      }
      editing={editing}
      onClose={() => setSelection(null)}
      card={editing ? <SourceEditor key={selected?.externalId ?? "new"} source={selected ?? null} readOnly={!canEdit} onSaved={(externalId) => setSelection({ kind: "edit", externalId })} /> : null}
    />
  )
}

type SourceErrors = Partial<Record<"name" | "restaurants" | "commission", string>>

function SourceEditor({ source, readOnly, onSaved }: { source: DeliverySource | null; readOnly: boolean; onSaved: (externalId: string) => void }) {
  const scope = usePlatformScope()
  const { saveSource } = useSourceMutations()
  const toast = useToast()
  const [name, setName] = useState(source?.name ?? "")
  const [kind, setKind] = useState<DeliverySourceKind>(source?.kind ?? "phone")
  const [restaurants, setRestaurants] = useState<string[]>(source?.restaurantExternalIds ?? [])
  const [commission, setCommission] = useState(String(source?.commissionPercent ?? 0))
  const [confirmationRequired, setConfirmationRequired] = useState(source?.confirmationRequired ?? false)
  const [settlementMode, setSettlementMode] = useState<SettlementMode>(source?.settlementMode ?? "on-delivered")
  const [paymentType, setPaymentType] = useState(source?.defaultPaymentTypeExternalId ?? NO_PAYMENT)
  const [active, setActive] = useState(source?.active ?? true)
  const [errors, setErrors] = useState<SourceErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Payment types are per restaurant: the first chosen one (or the first in scope for «все»).
  const paymentRestaurant = restaurants.find((id) => id !== ALL_RESTAURANTS) ?? scope.restaurants[0]?.externalId
  const canSeeReferences = useCan("office.delivery-orders.view")
  const references = useDeliveryReferences(paymentRestaurant, Boolean(paymentRestaurant) && canSeeReferences, "delivery")
  const paymentOptions = [{ value: NO_PAYMENT, label: "Не задан — спросить при оплате" }, ...(references?.paymentTypes ?? []).map((row) => ({ value: row.externalId, label: row.name }))]
  if (paymentType !== NO_PAYMENT && !paymentOptions.some((option) => option.value === paymentType)) paymentOptions.push({ value: paymentType, label: paymentType })

  const restaurantOptions = [
    ...(scope.network ? [{ value: ALL_RESTAURANTS, label: "Все рестораны" }] : []),
    ...restaurantSelectOptions(scope.restaurants),
  ]
  for (const id of restaurants) if (!restaurantOptions.some((option) => option.value === id)) restaurantOptions.push({ value: id, label: id === ALL_RESTAURANTS ? "Все рестораны" : id })

  function validate(): SourceErrors {
    const next: SourceErrors = {}
    if (name.trim().length < 2) next.name = "Укажите название источника"
    if (restaurants.length === 0) next.restaurants = "Выберите рестораны"
    const percent = parseDecimal(commission)
    if (percent === null || percent < 0 || percent > 100) next.commission = "Комиссия — от 0 до 100 %"
    return next
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (readOnly || submitting) return
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setSubmitting(true)
    setError(null)
    try {
      const externalId = await saveSource({
        ...(source ? { externalId: source.externalId } : {}),
        name: name.trim(),
        kind,
        restaurantExternalIds: restaurants,
        commissionPercent: parseDecimal(commission)!,
        confirmationRequired,
        settlementMode,
        defaultPaymentTypeExternalId: paymentType === NO_PAYMENT ? undefined : paymentType,
        active,
      })
      toast("Источник сохранён", "success")
      if (!source) onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить источник"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id={FORM_ID} aria-label="Источник заказов" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly} />}
        </Field>
        <Field label="Тип">
          {(control) => <Select {...control} value={kind} onValueChange={(value) => setKind(value as DeliverySourceKind)} options={KIND_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Рестораны" error={errors.restaurants} className="md:col-span-2">
          {(control) => <Combobox {...control} multiple value={restaurants} onValueChange={setRestaurants} options={restaurantOptions} disabled={readOnly} placeholder="Выберите рестораны" searchPlaceholder="Ресторан" />}
        </Field>
        <Field label="Комиссия, %" error={errors.commission} hint={kind === "aggregator" ? "Проводка комиссии создаётся при оплате заказа" : "Комиссия проводится только для агрегаторов"}>
          {(control) => <Input {...control} inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} disabled={readOnly} className="text-right tabular-nums" />}
        </Field>
        <Field label="Расчёт при">
          {(control) => <Select {...control} value={settlementMode} onValueChange={(value) => setSettlementMode(value as SettlementMode)} options={SETTLEMENT_OPTIONS} disabled={readOnly} />}
        </Field>
        <Field label="Тип оплаты по умолчанию" hint="Подставляется в диалог «Оплата при доставке»">
          {(control) => <Select {...control} value={paymentType} onValueChange={setPaymentType} options={paymentOptions} disabled={readOnly} />}
        </Field>
        <div className="flex flex-col gap-3 self-end">
          <SwitchRow id="source-confirmation" label="Требовать подтверждение" hint="Заказ ждёт подтверждения оператора" checked={confirmationRequired} onChange={setConfirmationRequired} disabled={readOnly} />
          <SwitchRow id="source-active" label="Активен" checked={active} onChange={setActive} disabled={readOnly} />
        </div>
      </div>
    </form>
  )
}

function SwitchRow({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-border px-4 py-3">
      <span className="flex flex-col">
        <label htmlFor={id} className="text-body-sm font-medium">
          {label}
        </label>
        {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
