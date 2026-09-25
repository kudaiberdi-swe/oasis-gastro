import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { SaveStatus, UnsavedChangesDialog } from "@/office/components/unsaved-changes"
import { useUnsavedChanges } from "@/office/hooks/use-unsaved-changes"
import { Banner, Button, EmptyState, Field, Input, Select, StatusPill, Textarea, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime, formatAlmatyTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"
import { formatPhoneNumber } from "@/shared/lib/phone"
import { describeStatus } from "@/shared/lib/status-dictionary"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useDeliveryMutations, useDeliveryOrder, useDeliveryReferences, useGuestLookup, type DeliveryChannel, type DeliveryOrder } from "../data/use-delivery"
import { addProduct, draftFromOrder, draftSignature, emptyDraft, hasErrors, isMaskedPhone, reconfigureLine, saveArgs, validateDraft, type DeliveryDraft, type DeliveryErrors } from "../model/order-draft"
import { COURIER_ASSIGNABLE_STATUSES, courierOptions as courierChoices, defaultSourceFor, EDITABLE_STATUSES, SOURCE_KIND_LABELS } from "../model/statuses"
import { DeliveryOrderLines } from "./delivery-order-lines"
import { DeliveryTransitionBar } from "./delivery-transition-bar"

const NO_COURIER = "__none__"

/**
 * /office/delivery-orders/:id and /new (W2-DLV-05, office-details/11): «Гость и адрес», «Состав заказа»,
 * the status moves in the header. The call center opens the same card with the «Телефон» source and
 * `channel: "call-center"` on every read and move — the server checks office.call-center.* then.
 */
export function DeliveryOrderEditor({ externalId, channel, backPath }: { externalId: string | null; channel: DeliveryChannel; backPath: string }) {
  const order = useDeliveryOrder(externalId, channel)
  const navigate = useNavigate()
  const back = () => navigate(backPath)
  if (externalId && order === undefined) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <OfficeStatePage state={{ kind: "loading" }} />
      </div>
    )
  }
  if (externalId && order === null) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState title="Заказ не найден" description="Заказа нет или он относится к ресторану вне вашей области." action={<Button variant="secondary" onClick={back}>К списку</Button>} />
      </div>
    )
  }
  return <OrderForm key={order ? `${order.externalId}:${order.version}` : "new"} order={order ?? null} channel={channel} backPath={backPath} onBack={back} />
}

function OrderForm({ order, channel, backPath, onBack }: { order: DeliveryOrder | null; channel: DeliveryChannel; backPath: string; onBack: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const canEdit = useCan(channel === "call-center" ? "office.call-center.edit" : "office.delivery-orders.edit")
  const canSeeGuests = useCan("office.guests.view")
  const { saveOrder, assignCourier } = useDeliveryMutations()

  const [baseline, setBaseline] = useState<DeliveryDraft>(() => (order ? draftFromOrder(order) : emptyDraft({ now: Date.now() })))
  const [draft, setDraft] = useState<DeliveryDraft>(baseline)
  const [errors, setErrors] = useState<DeliveryErrors>({ rows: {} })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const set = (patch: Partial<DeliveryDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setLines = (update: (lines: DeliveryDraft["lines"]) => DeliveryDraft["lines"]) => setDraft((current) => ({ ...current, lines: update(current.lines) }))

  // Restaurants in scope first; then the chosen restaurant's sources, couriers and payment types.
  const scope = useDeliveryReferences(undefined, true, channel)
  const restaurantExternalId = draft.restaurantExternalId || (order ? order.restaurantExternalId : (scope?.restaurants[0]?.externalId ?? ""))
  const references = useDeliveryReferences(restaurantExternalId || undefined, Boolean(restaurantExternalId), channel)
  const sourceExternalId = draft.sourceExternalId || (order ? "" : (defaultSourceFor(channel, references?.sources ?? []) ?? ""))
  const effective: DeliveryDraft = { ...draft, restaurantExternalId, sourceExternalId }

  // A masked phone (no office.guests.pii) goes back as is: saveOrder keeps the stored number.
  const masked = order !== null && isMaskedPhone(order.phone)
  const editableStatus = order === null || EDITABLE_STATUSES.includes(order.status)
  const readOnly = !canEdit || !editableStatus
  const dirty = created === null && !readOnly && draftSignature(draft) !== draftSignature(baseline)
  const blocker = useUnsavedChanges(dirty)

  useEffect(() => {
    if (created) navigate(`${backPath}/${encodeURIComponent(created)}`, { replace: true })
  }, [created, backPath, navigate])

  const restaurantOptions = restaurantSelectOptions(scope?.restaurants ?? [])
  if (order && !restaurantOptions.some((option) => option.value === order.restaurantExternalId)) restaurantOptions.push({ value: order.restaurantExternalId, label: order.restaurantExternalId })
  const sources = references?.sources ?? []
  const sourceOptions = sources.map((row) => ({ value: row.externalId, label: `${row.name} · ${SOURCE_KIND_LABELS[row.kind]}` }))
  if (order?.source && !sourceOptions.some((option) => option.value === order.source!.externalId)) sourceOptions.push({ value: order.source.externalId, label: order.source.name })
  // Only a free courier can be newly assigned (the server refuses a busy one); the current one stays listed.
  const courierOptions = [{ value: NO_COURIER, label: "Не назначен" }, ...courierChoices(references?.couriers ?? [], order?.courier ?? null)]
  const restaurantName = restaurantOptions.find((option) => option.value === restaurantExternalId)?.label ?? "—"
  const sourceName = order?.source?.name ?? sourceOptions.find((option) => option.value === sourceExternalId)?.label ?? "—"

  async function handleSave() {
    if (readOnly || busy) return
    const found = validateDraft(effective, { phoneOnFile: order !== null })
    setErrors(found)
    if (hasErrors(found)) return
    setBusy(true)
    setError(null)
    try {
      const result = await saveOrder(saveArgs(effective, { externalId: order?.externalId, expectedVersion: order?.version, channel, currentCourierExternalId: order?.courierExternalId ?? null }))
      toast(`Заказ ${result.number} сохранён · ${formatTenge(result.total)}`, "success")
      setBaseline(effective)
      if (!order) setCreated(result.externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сохранить заказ"))
    } finally {
      setBusy(false)
    }
  }

  /** On the kitchen (saveOrder refuses these statuses) the courier is assigned at once with assignCourier. */
  async function handleAssign(courierExternalId: string) {
    if (!order || courierExternalId === NO_COURIER || courierExternalId === order.courierExternalId || busy) return
    setBusy(true)
    setError(null)
    try {
      await assignCourier({ deliveryExternalId: order.externalId, courierExternalId, expectedVersion: order.version, channel })
      toast("Курьер назначен", "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось назначить курьера"))
    } finally {
      setBusy(false)
    }
  }

  const status = order?.status ?? "unprocessed"
  const totals = order ? { subtotal: order.subtotal, deliveryFee: order.deliveryFee, commissionAmount: order.commissionAmount, total: order.total } : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5 xl:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-title font-semibold">{order ? `Доставка ${order.number}` : "Новый заказ доставки"}</h2>
              <StatusPill domain="delivery" status={status} />
            </div>
            <p className="text-body-sm text-muted-foreground">Единый заказ офиса, кассы и кухни</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!readOnly ? <SaveStatus state={busy ? "saving" : dirty ? "dirty" : "clean"} /> : null}
            <Button variant="secondary" onClick={onBack}>
              <ArrowLeft aria-hidden />К списку
            </Button>
            {!readOnly ? (
              <Button variant={order && !dirty ? "secondary" : "primary"} onClick={() => void handleSave()} disabled={busy || (order !== null && !dirty)}>
                {busy ? "Сохранение…" : "Сохранить"}
              </Button>
            ) : null}
            {order ? <DeliveryTransitionBar order={order} channel={channel} disabled={dirty || busy} disabledReason="Сначала сохраните изменения" /> : null}
          </div>
        </header>

        {masked && !readOnly ? (
          <Banner tone="info" title="Телефон гостя скрыт">
            Заказ можно менять и сохранять — останется прежний номер гостя. Чтобы заменить номер, нажмите «Ввести новый номер».
          </Banner>
        ) : null}
        {order && !editableStatus && order.status !== "cancelled" ? (
          <Banner tone="info" title="Заказ уже на кухне — состав и адрес не меняются">
            {order.cookingStartAt ? `Старт готовки ${formatAlmatyTime(order.cookingStartAt)}. ` : ""}
            {order.paymentStatus === "paid" ? "Заказ оплачен." : "Оплата — при доставке или закрытии, по настройке источника."}
          </Banner>
        ) : null}
        {order?.status === "cancelled" ? (
          <Banner tone="warning" title="Заказ отменён">
            {order.cancelReason ?? "Причина не указана."}
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="danger" title="Не удалось выполнить действие">
            {error}
          </Banner>
        ) : null}

        <section aria-label="Гость и адрес" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title-sm font-semibold">Гость и адрес</h3>
            <p className="text-caption text-muted-foreground">Контактные данные и обещанное время</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ReadOnly label="Номер" value={order?.number ?? <span className="text-muted-foreground">Присвоится при сохранении</span>} />
            <TextField label="Гость" value={draft.customerName} error={errors.customerName} readOnly={readOnly} onChange={(customerName) => set({ customerName })} />
            <PhoneField
              value={draft.phone}
              error={errors.phone}
              readOnly={readOnly}
              lookup={canSeeGuests && !readOnly && !isMaskedPhone(draft.phone)}
              onChange={(phone) => set({ phone })}
              onGuest={(guest) => set({ customerName: guest.name || draft.customerName, ...(guest.email && !/[•*]/.test(guest.email) && !draft.email ? { email: guest.email } : {}) })}
            />
            <TextField label="Email" value={draft.email} error={errors.email} readOnly={readOnly} type="email" onChange={(email) => set({ email })} />
            {readOnly || order ? (
              <ReadOnly label="Ресторан" value={restaurantName} />
            ) : (
              <Field label="Ресторан" error={errors.restaurant}>
                {(control) => (
                  <Select
                    {...control}
                    value={restaurantExternalId || undefined}
                    onValueChange={(value) => set({ restaurantExternalId: value, sourceExternalId: "", courierExternalId: "", lines: draft.lines.map((line) => ({ ...line, unitPrice: null, lineTotal: null })) })}
                    options={restaurantOptions}
                    placeholder={scope === undefined ? "Загрузка…" : "Выберите ресторан"}
                  />
                )}
              </Field>
            )}
            {readOnly ? (
              <ReadOnly label="Источник" value={sourceName} />
            ) : (
              <Field label="Источник" error={errors.source}>
                {(control) => <Select {...control} value={sourceExternalId || undefined} onValueChange={(value) => set({ sourceExternalId: value })} options={sourceOptions} placeholder={references === undefined ? "Загрузка…" : "Выберите источник"} />}
              </Field>
            )}
            <TextField label="Адрес" value={draft.address} error={errors.address} readOnly={readOnly} onChange={(address) => set({ address })} />
            {readOnly ? (
              <ReadOnly label="Обещанное время" value={order ? formatAlmatyDateTime(order.expectedAt) : "—"} />
            ) : (
              <Field label="Обещанное время" error={errors.expectedAt} hint="Время Алматы">
                {(control) => <Input {...control} type="datetime-local" value={draft.expectedAt} onChange={(event) => set({ expectedAt: event.target.value })} />}
              </Field>
            )}
            <TextField label="Широта" value={draft.latitude} error={errors.latitude} readOnly={readOnly} inputMode="decimal" placeholder="43.238949" onChange={(latitude) => set({ latitude })} />
            <TextField label="Долгота" value={draft.longitude} error={errors.longitude} readOnly={readOnly} inputMode="decimal" placeholder="76.889709" onChange={(longitude) => set({ longitude })} hint={!readOnly ? "По координатам выбирается зона и стоимость доставки" : undefined} />
            {!readOnly ? (
              <Field label="Курьер">
                {(control) => <Select {...control} value={draft.courierExternalId || NO_COURIER} onValueChange={(value) => set({ courierExternalId: value === NO_COURIER ? "" : value })} options={courierOptions} />}
              </Field>
            ) : order && canEdit && COURIER_ASSIGNABLE_STATUSES.includes(order.status) ? (
              <Field label="Курьер" hint="Назначается сразу, без сохранения карточки">
                {(control) => <Select {...control} value={order.courierExternalId ?? NO_COURIER} onValueChange={(value) => void handleAssign(value)} options={courierOptions} disabled={busy} />}
              </Field>
            ) : (
              <ReadOnly label="Курьер" value={order?.courier ? `${order.courier.name} · ${describeStatus("courier", order.courier.status).label}` : "Не назначен"} />
            )}
            {readOnly ? (
              <ReadOnly label="Комментарий" value={draft.comment || "—"} className="md:col-span-2" />
            ) : (
              <Field label="Комментарий" className="md:col-span-2">
                {(control) => <Textarea {...control} rows={2} value={draft.comment} onChange={(event) => set({ comment: event.target.value })} />}
              </Field>
            )}
          </div>
          {order ? <Timing order={order} /> : null}
        </section>

        <DeliveryOrderLines
          restaurantExternalId={restaurantExternalId || undefined}
          channel={channel}
          lines={draft.lines}
          readOnly={readOnly}
          errors={errors.rows}
          linesError={errors.lines}
          totals={totals}
          stale={dirty}
          onAdd={(dish) => setLines((lines) => addProduct(lines, dish))}
          onReconfigure={(key, dish) => setLines((lines) => lines.map((line) => (line.key === key ? reconfigureLine(line, dish) : line)))}
          onChange={(key, patch) => setLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))}
          onRemove={(key) => setLines((lines) => lines.filter((line) => line.key !== key))}
        />
      </div>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}

/** Server forecast: when the kitchen starts, when the courier picks up, the zone and its fee. */
function Timing({ order }: { order: DeliveryOrder }) {
  const facts: [string, string][] = [
    ["Зона", order.zone ? `${order.zone.name} · ${formatTenge(order.zone.deliveryFee)}` : "Вне зон — доставка 0 ₸"],
    ["Старт готовки", order.cookingStartAt ? formatAlmatyDateTime(order.cookingStartAt) : "—"],
    ["К выдаче курьеру", order.predictedCookingCompleteAt ? formatAlmatyDateTime(order.predictedCookingCompleteAt) : "—"],
    ["Оплата", order.paymentStatus === "paid" ? "Оплачен" : order.paymentStatus === "refunded" ? "Возвращён" : "Не оплачен"],
  ]
  return (
    <dl className="grid gap-3 border-t border-border pt-4 text-body-sm sm:grid-cols-2 xl:grid-cols-4">
      {facts.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReadOnly({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm font-medium text-muted-foreground">{label}</span>
        <span className="min-h-11 content-center text-body-sm break-words text-foreground">{value}</span>
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  error,
  hint,
  readOnly,
  type = "text",
  inputMode,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  error?: string
  hint?: string
  readOnly: boolean
  type?: string
  inputMode?: "decimal" | "tel"
  placeholder?: string
  onChange: (value: string) => void
}) {
  if (readOnly) return <ReadOnly label={label} value={value || "—"} />
  return (
    <Field label={label} error={error} hint={hint}>
      {(control) => <Input {...control} type={type} inputMode={inputMode} placeholder={placeholder} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />}
    </Field>
  )
}

/**
 * «Телефон» with a guest lookup (office.guests.view); a masked guest phone never replaces the typed one.
 * A masked saved phone stays as is (the server keeps the number) until «Ввести новый номер».
 */
function PhoneField({
  value,
  error,
  readOnly,
  lookup,
  onChange,
  onGuest,
}: {
  value: string
  error?: string
  readOnly: boolean
  lookup: boolean
  onChange: (value: string) => void
  onGuest: (guest: { name: string; email?: string }) => void
}) {
  const guests = useGuestLookup(value, lookup)
  const matches = useMemo(() => (guests ?? []).filter((guest) => guest.name), [guests])
  if (readOnly) return <ReadOnly label="Телефон" value={value || "—"} />
  const masked = isMaskedPhone(value)
  return (
    <div className="flex flex-col gap-1.5">
      <Field label="Телефон" error={error} hint={masked ? "Номер скрыт — при сохранении останется прежний" : lookup ? "Гость найдётся по номеру" : undefined}>
        {(control) => <Input {...control} type="tel" inputMode="tel" autoComplete="off" placeholder="+7 700 000 00 00" value={value} readOnly={masked} onChange={(event) => onChange(event.target.value)} />}
      </Field>
      {masked ? (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => onChange("")}>
          Ввести новый номер
        </Button>
      ) : null}
      {matches.length ? (
        <ul aria-label="Найденные гости" className="flex flex-col gap-1">
          {matches.slice(0, 3).map((guest) => (
            <li key={guest._id}>
              <Button type="button" size="sm" variant="ghost" className="h-auto min-h-9 w-full justify-start py-1.5 text-left whitespace-normal" onClick={() => onGuest({ name: guest.name ?? "", email: guest.email })}>
                Гость: {guest.name} · {formatPhoneNumber(guest.phone ?? "")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
