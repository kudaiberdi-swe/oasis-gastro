import { useState } from "react"

import { useCan } from "@/office/components/can"
import { Banner, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Money, Select, useToast } from "@/shared/components/ui"
import { describeStatus } from "@/shared/lib/status-dictionary"
import { errorMessage } from "@/shared/lib/error-message"

import { useDeliveryMutations, useDeliveryReferences, type DeliveryChannel, type DeliveryOrder, type DeliveryRow } from "../data/use-delivery"
import { isClosedShiftError, needsPayment, transitionActions, type DeliveryStatus, type SettlementMode } from "../model/statuses"

/** What a move needs to know about the order: the card's order or a register row (overview). */
export type TransitionSubject = {
  externalId: string
  number: string
  version: number
  status: DeliveryStatus
  restaurantExternalId: string
  courierExternalId: string | null
  total: number
  paymentStatus: "unpaid" | "paid" | "refunded"
  sourceExternalId: string
  settlementMode: SettlementMode | undefined
  /** The source's default payment type; for a row it is looked up in the references. */
  defaultPaymentTypeExternalId?: string | null
}

export function subjectOfOrder(order: DeliveryOrder): TransitionSubject {
  return {
    externalId: order.externalId,
    number: order.number,
    version: order.version,
    status: order.status,
    restaurantExternalId: order.restaurantExternalId,
    courierExternalId: order.courierExternalId ?? null,
    total: order.total,
    paymentStatus: order.paymentStatus,
    sourceExternalId: order.sourceExternalId,
    settlementMode: order.source?.settlementMode,
    defaultPaymentTypeExternalId: order.source?.defaultPaymentTypeExternalId ?? null,
  }
}

export function subjectOfRow(row: DeliveryRow): TransitionSubject {
  return {
    externalId: row.externalId,
    number: row.number,
    version: row.version,
    status: row.status,
    restaurantExternalId: row.restaurantExternalId,
    courierExternalId: row.courierExternalId,
    total: row.total,
    paymentStatus: row.paymentStatus,
    sourceExternalId: row.sourceExternalId,
    settlementMode: row.settlementMode,
  }
}

/** office.delivery-orders.* or, in the call center, office.call-center.* — as the server checks them. */
export function useTransitionRights(channel: DeliveryChannel) {
  const section = channel === "call-center" ? "office.call-center" : "office.delivery-orders"
  return { canEdit: useCan(`${section}.edit`), canCancel: useCan(`${section}.cancel`) }
}

/**
 * Next-status buttons of the order card (W2-DLV-03). «Отменить» asks for a reason (danger), a move that
 * pays the order opens «Оплата при доставке», «Отправить» without a courier asks for one.
 */
export function DeliveryTransitionBar({ order, channel, disabled, disabledReason }: { order: DeliveryOrder; channel: DeliveryChannel; disabled?: boolean; disabledReason?: string }) {
  const rights = useTransitionRights(channel)
  const actions = transitionActions(order.status, rights)
  const flow = useTransitionFlow(subjectOfOrder(order), channel)
  if (actions.length === 0) return null
  return (
    <>
      {actions.map((action) => (
        <Button
          key={action.to}
          variant={action.kind === "primary" && !disabled ? "primary" : action.kind === "danger" ? "danger" : "secondary"}
          disabled={disabled || flow.busy}
          title={disabled ? disabledReason : undefined}
          onClick={() => flow.start(action.to)}
        >
          {action.label}
        </Button>
      ))}
      {flow.dialogs}
    </>
  )
}

type Pending = { to: DeliveryStatus; step: "cancel" | "payment" | "courier" } | null

/**
 * Runs one transition with whatever it needs first; exposes the dialogs to render next to the buttons.
 * `errors: "toast"` (a register row) reports a refused move in a toast instead of an inline banner.
 */
export function useTransitionFlow(order: TransitionSubject, channel: DeliveryChannel, options: { errors?: "banner" | "toast" } = {}) {
  const { transitionOrder } = useDeliveryMutations()
  const toast = useToast()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const needsReferences = pending?.step === "payment" || pending?.step === "courier"
  const references = useDeliveryReferences(order.restaurantExternalId, needsReferences, channel)
  const defaultPaymentType = order.defaultPaymentTypeExternalId ?? references?.sources.find((source) => source.externalId === order.sourceExternalId)?.defaultPaymentTypeExternalId ?? undefined

  async function run(to: DeliveryStatus, extra: { reason?: string; courierExternalId?: string; payment?: { paymentTypeExternalId?: string; amount?: number } } = {}) {
    setBusy(true)
    setError(null)
    setInlineError(null)
    try {
      await transitionOrder({ externalId: order.externalId, to, expectedVersion: order.version, channel, ...extra })
      toast(`Статус заказа ${order.number}: ${describeStatus("delivery", to).label}`, "success")
      setPending(null)
    } catch (caught) {
      const message = errorMessage(caught, "Не удалось сменить статус")
      if (pending) setError(message)
      else if (options.errors === "toast") toast(message, "error")
      else setInlineError(message)
    } finally {
      setBusy(false)
    }
  }

  function start(to: DeliveryStatus) {
    setError(null)
    setInlineError(null)
    if (to === "cancelled") return setPending({ to, step: "cancel" })
    if (to === "on-way" && !order.courierExternalId) return setPending({ to, step: "courier" })
    if (needsPayment(to, order.settlementMode, order.paymentStatus)) return setPending({ to, step: "payment" })
    void run(to)
  }

  const close = () => {
    if (busy) return
    setPending(null)
    setError(null)
  }

  const dialogs = (
    <>
      {inlineError ? <TransitionError message={inlineError} onDismiss={() => setInlineError(null)} /> : null}
      <ConfirmDialog
        open={pending?.step === "cancel"}
        onOpenChange={(open) => (!open ? close() : undefined)}
        title={`Отменить заказ ${order.number}?`}
        description="Заказ кассы и тикет кухни тоже отменятся. Оплаченный заказ отменяется только возвратом на кассе."
        reasonLabel="Причина отмены"
        confirmLabel="Отменить заказ"
        cancelLabel="Не отменять"
        submitting={busy}
        error={error}
        onConfirm={(reason) => {
          if (reason.length < 3) return setError("Опишите причину — хотя бы три символа")
          return run("cancelled", { reason })
        }}
      />
      {pending?.step === "payment" ? (
        <PaymentDialog
          order={order}
          to={pending.to}
          paymentTypes={references?.paymentTypes}
          defaultPaymentTypeExternalId={defaultPaymentType}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={(paymentTypeExternalId) => void run(pending.to, { payment: { paymentTypeExternalId, amount: order.total } })}
        />
      ) : null}
      {pending?.step === "courier" ? (
        <CourierDialog
          order={order}
          couriers={references?.couriers}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={(courierExternalId) => void run("on-way", { courierExternalId })}
        />
      ) : null}
    </>
  )

  return { start, busy, dialogs }
}

function TransitionError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const shift = isClosedShiftError(message)
  return (
    <div className="basis-full">
      <Banner tone={shift ? "warning" : "danger"} title={shift ? "Смена доставки закрыта" : "Переход недоступен"} action={<Button size="sm" variant="ghost" onClick={onDismiss}>Скрыть</Button>}>
        {message}
      </Banner>
    </div>
  )
}

/** «Оплата при доставке»: the payment type (default from the source) and the order total from the server. */
export function PaymentDialog({
  order,
  to,
  paymentTypes,
  defaultPaymentTypeExternalId,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  order: Pick<TransitionSubject, "number" | "total">
  to: DeliveryStatus
  paymentTypes: { externalId: string; name: string }[] | undefined
  defaultPaymentTypeExternalId: string | undefined
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (paymentTypeExternalId: string) => void
}) {
  const fallback = defaultPaymentTypeExternalId
  const [choice, setChoice] = useState<string | undefined>(undefined)
  const options = (paymentTypes ?? []).map((row) => ({ value: row.externalId, label: row.name }))
  if (fallback && paymentTypes && !options.some((option) => option.value === fallback)) options.unshift({ value: fallback, label: "Тип оплаты источника" })
  const value = choice ?? fallback
  const shift = error ? isClosedShiftError(error) : false
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Оплата при доставке</DialogTitle>
          <DialogDescription>
            Заказ {order.number} {to === "closed" ? "закрывается" : "доставлен"} — оплата проводится на кассе «Доставка» ресторана, с проводками, списанием по техкарте и начислением бонусов.
          </DialogDescription>
        </DialogHeader>
        <Field label="Тип оплаты" hint={fallback ? "По умолчанию — тип оплаты источника заказа" : undefined}>
          {(control) => <Select {...control} value={value} onValueChange={setChoice} options={options} disabled={paymentTypes === undefined || busy} placeholder={paymentTypes === undefined ? "Загрузка…" : "Выберите тип оплаты"} />}
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-muted px-4 py-3">
          <span className="text-body-sm text-muted-foreground">Сумма к оплате</span>
          <Money value={order.total} size="lg" />
        </div>
        {error ? (
          <Banner tone={shift ? "warning" : "danger"} title={shift ? "Смена доставки закрыта" : "Оплата не проведена"}>
            {error}
            {shift ? " Откройте смену на кассе «Доставка» в POS и повторите." : null}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => value && onConfirm(value)} disabled={!value || busy}>
            {busy ? "Проведение…" : to === "closed" ? "Оплатить и закрыть" : "Оплатить и отметить доставленным"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const FREE_COURIER = ["available", "assigned", "returning"]

/** «Отправить» without a courier: pick a free courier of the order's restaurant. */
function CourierDialog({
  order,
  couriers,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  order: Pick<TransitionSubject, "number">
  couriers: { externalId: string; name: string; status: string }[] | undefined
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (courierExternalId: string) => void
}) {
  const [courier, setCourier] = useState<string | undefined>(undefined)
  const free = (couriers ?? []).filter((row) => FREE_COURIER.includes(row.status))
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Назначьте курьера</DialogTitle>
          <DialogDescription>Заказ {order.number} уходит в путь только с курьером ресторана.</DialogDescription>
        </DialogHeader>
        <Field label="Курьер" hint={couriers && free.length === 0 ? "Свободных курьеров нет — откройте смену курьеру в разделе «Курьеры»" : undefined}>
          {(control) => (
            <Select
              {...control}
              value={courier}
              onValueChange={setCourier}
              disabled={couriers === undefined || busy}
              placeholder={couriers === undefined ? "Загрузка…" : "Выберите курьера"}
              options={free.map((row) => ({ value: row.externalId, label: `${row.name} · ${describeStatus("courier", row.status).label}` }))}
            />
          )}
        </Field>
        {error ? (
          <Banner tone="danger" title="Не удалось отправить">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => courier && onConfirm(courier)} disabled={!courier || busy}>
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
