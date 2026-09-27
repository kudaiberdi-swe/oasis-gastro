import { Plus } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, Field, Input, MoneyInput, Select, Switch, Textarea, TonePill, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useDeliveryZones, useZoneMutations, type DeliveryZone } from "../data/use-delivery"
import { formatCoordinates, parseCoordinates, polygonProblem } from "../model/zone-polygon"
import { MasterDetail, MasterListBlock, MasterRow, MasterRows } from "./master-detail"
import { ZonePolygonPreview } from "./zone-polygon-preview"

const FORM_ID = "delivery-zone-editor"

/** «Зоны доставки» (/office/delivery-zones, W2-DLV-06, office/60): zones list + the zone card with an SVG preview. */
export function ZonesWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <ZonesContent />
    </PlatformErrorBoundary>
  )
}

type Selection = { kind: "new" } | { kind: "edit"; externalId: string } | null

function ZonesContent() {
  const zones = useDeliveryZones()
  const scope = usePlatformScope()
  const canEdit = useCan("office.delivery-zones.edit")
  const [selection, setSelection] = useState<Selection>(null)
  const selected = selection?.kind === "edit" ? zones?.find((zone) => zone.externalId === selection.externalId) : undefined
  const editing = selection?.kind === "new" || selected !== undefined

  return (
    <MasterDetail
      toolbar={
        canEdit ? (
          <Button variant={editing ? "secondary" : "primary"} onClick={() => setSelection({ kind: "new" })}>
            <Plus aria-hidden />
            Новая зона
          </Button>
        ) : null
      }
      list={
        zones === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : (
          <MasterListBlock title="Действующие зоны" caption="При пересечении используется больший приоритет">
            {zones.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">Зон пока нет — добавьте первую, чтобы заказы получали тариф по адресу.</p>
            ) : (
              <MasterRows>
                {zones.map((zone) => (
                  <MasterRow
                    key={zone.externalId}
                    active={zone.externalId === selected?.externalId}
                    onSelect={() => setSelection({ kind: "edit", externalId: zone.externalId })}
                    title={`${zone.name} · ${scope.restaurantName(zone.restaurantExternalId) ?? zone.restaurantExternalId}`}
                    meta={`Приоритет ${zone.priority} · ${zone.polygon.length} точек`}
                    trailing={
                      <>
                        <span className="text-right text-body-sm font-semibold tabular-nums">{formatTenge(zone.deliveryFee)}</span>
                        <span className="text-caption text-muted-foreground tabular-nums" title="Время в пути">
                          {zone.deliveryMinutes} мин
                        </span>
                        <TonePill tone={zone.active ? "success" : "neutral"}>{zone.active ? "Активна" : "Выключена"}</TonePill>
                      </>
                    }
                  />
                ))}
              </MasterRows>
            )}
          </MasterListBlock>
        )
      }
      cardTitle={selected ? selected.name : "Карточка зоны"}
      cardCaption="Одна координата latitude,longitude на строку"
      cardActions={
        canEdit ? (
          <Button type="submit" form={FORM_ID}>
            Сохранить
          </Button>
        ) : null
      }
      editing={editing}
      onClose={() => setSelection(null)}
      card={
        editing ? (
          <ZoneEditor
            key={selected?.externalId ?? "new"}
            zone={selected ?? null}
            restaurants={scope.restaurants}
            readOnly={!canEdit}
            onSaved={(externalId) => setSelection({ kind: "edit", externalId })}
          />
        ) : null
      }
    />
  )
}

type ZoneErrors = Partial<Record<"name" | "restaurant" | "priority" | "polygon" | "cookingMinutes" | "deliveryMinutes", string>>

const wholeMinutes = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

function ZoneEditor({ zone, restaurants, readOnly, onSaved }: { zone: DeliveryZone | null; restaurants: { externalId: string; name: string }[]; readOnly: boolean; onSaved: (externalId: string) => void }) {
  const { saveZone } = useZoneMutations()
  const toast = useToast()
  const [name, setName] = useState(zone?.name ?? "")
  const [restaurant, setRestaurant] = useState<string | undefined>(zone?.restaurantExternalId ?? (restaurants.length === 1 ? restaurants[0].externalId : undefined))
  const [priority, setPriority] = useState(String(zone?.priority ?? 0))
  const [deliveryFee, setDeliveryFee] = useState<number | null>(zone?.deliveryFee ?? 0)
  const [minimumOrder, setMinimumOrder] = useState<number | null>(zone?.minimumOrder ?? 0)
  const [cookingMinutes, setCookingMinutes] = useState(String(zone?.cookingMinutes ?? 20))
  const [deliveryMinutes, setDeliveryMinutes] = useState(String(zone?.deliveryMinutes ?? 30))
  const [active, setActive] = useState(zone?.active ?? true)
  const [coordinates, setCoordinates] = useState(zone ? formatCoordinates(zone.polygon) : "")
  const [errors, setErrors] = useState<ZoneErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const parsed = useMemo(() => parseCoordinates(coordinates), [coordinates])
  const problem = polygonProblem(parsed)
  const restaurantOptions = restaurantSelectOptions(restaurants)
  if (zone && !restaurantOptions.some((option) => option.value === zone.restaurantExternalId)) restaurantOptions.push({ value: zone.restaurantExternalId, label: zone.restaurantExternalId })

  function validate(): ZoneErrors {
    const next: ZoneErrors = {}
    if (name.trim().length < 2) next.name = "Укажите название зоны"
    if (!restaurant) next.restaurant = "Выберите ресторан"
    if (!/^-?\d+$/.test(priority.trim())) next.priority = "Приоритет — целое число"
    if (wholeMinutes(cookingMinutes) === null) next.cookingMinutes = "Целое число минут"
    if (wholeMinutes(deliveryMinutes) === null) next.deliveryMinutes = "Целое число минут"
    if (problem) next.polygon = problem
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
      const externalId = await saveZone({
        ...(zone ? { externalId: zone.externalId } : {}),
        restaurantExternalId: restaurant!,
        name: name.trim(),
        priority: Number(priority.trim()),
        polygon: parsed.points,
        deliveryFee: deliveryFee ?? 0,
        minimumOrder: minimumOrder ?? 0,
        cookingMinutes: wholeMinutes(cookingMinutes)!,
        deliveryMinutes: wholeMinutes(deliveryMinutes)!,
        active,
      })
      toast("Зона сохранена — тариф применится к новым заказам", "success")
      if (!zone) onSaved(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить зону"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id={FORM_ID} aria-label="Зона доставки" noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {error ? (
        <Banner tone="danger" title="Не удалось сохранить">
          {error}
        </Banner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Название" error={errors.name}>
          {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} disabled={readOnly} autoComplete="off" />}
        </Field>
        <Field label="Ресторан" error={errors.restaurant}>
          {(control) => <Select {...control} value={restaurant} onValueChange={setRestaurant} options={restaurantOptions} disabled={readOnly} placeholder="Выберите ресторан" />}
        </Field>
        <Field label="Приоритет" error={errors.priority} hint="Больше — важнее при пересечении зон">
          {(control) => <Input {...control} inputMode="numeric" value={priority} onChange={(event) => setPriority(event.target.value)} disabled={readOnly} className="text-right tabular-nums" />}
        </Field>
        <Field label="Стоимость доставки">
          {(control) => <MoneyInput {...control} value={deliveryFee} onValueChange={setDeliveryFee} disabled={readOnly} />}
        </Field>
        <Field label="Минимальная сумма заказа">
          {(control) => <MoneyInput {...control} value={minimumOrder} onValueChange={setMinimumOrder} disabled={readOnly} />}
        </Field>
        <Field label="Время приготовления, мин" error={errors.cookingMinutes}>
          {(control) => <Input {...control} inputMode="numeric" value={cookingMinutes} onChange={(event) => setCookingMinutes(event.target.value)} disabled={readOnly} className="text-right tabular-nums" />}
        </Field>
        <Field label="Время в пути, мин" error={errors.deliveryMinutes} hint="Кухня начинает за «приготовление + в пути» до обещанного времени">
          {(control) => <Input {...control} inputMode="numeric" value={deliveryMinutes} onChange={(event) => setDeliveryMinutes(event.target.value)} disabled={readOnly} className="text-right tabular-nums" />}
        </Field>
        <div className="flex items-center justify-between gap-3 self-end rounded-card border border-border px-4 py-3">
          <label htmlFor="zone-active" className="text-body-sm font-medium">
            Зона активна
          </label>
          <Switch id="zone-active" checked={active} onCheckedChange={setActive} disabled={readOnly} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <Field label="Координаты контура" error={errors.polygon} hint={problem ? undefined : `${parsed.points.length} точек`}>
          {(control) => (
            <Textarea
              {...control}
              rows={10}
              value={coordinates}
              onChange={(event) => setCoordinates(event.target.value)}
              disabled={readOnly}
              spellCheck={false}
              placeholder={"43.2567,76.9286\n43.2601,76.9530\n43.2402,76.9555"}
              className="font-mono text-body-sm"
            />
          )}
        </Field>
        <ZonePolygonPreview points={parsed.points} invalid={Boolean(problem) && parsed.points.length >= 3} />
      </div>
      <p className="text-caption text-muted-foreground">Провайдер карт ещё не выбран — контур задаётся координатами, превью показывает его форму.</p>
    </form>
  )
}
