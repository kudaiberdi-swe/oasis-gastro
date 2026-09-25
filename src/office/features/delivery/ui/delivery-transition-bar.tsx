import { useState } from "react"

import { useCan } from "@/office/components/can"
import { Banner, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Money, Select, useToast } from "@/shared/components/ui"
import { describeStatus } from "@/shared/lib/status-dictionary"
import { errorMessage } from "@/shared/lib/error-message"

import { useDeliveryMutations, useDeliveryReferences, type DeliveryOrder } from "../data/use-delivery"
import { isClosedShiftError, needsPayment, transitionActions, type DeliveryStatus } from "../model/statuses"

/**
 * Next-status buttons of the order card (W2-DLV-03). «Отменить» asks for a reason (danger), a move that
 * pays the order opens «Оплата при доставке», «Отправить» without a courier asks for one.
 */
export function DeliveryTransitionBar({ order, disabled, disabledReason }: { order: DeliveryOrder; disabled?: boolean; disabledReason?: string }) {
  const canEdit = useCan("office.delivery-orders.edit")
  const canCancel = useCan("office.delivery-orders.cancel")
  const actions = transitionActions(order.status, { canEdit, canCancel })
  const flow = useTransitionFlow(order)
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

/** Runs one transition with whatever it needs first; exposes the dialogs to render next to the buttons. */
export function useTransitionFlow(order: DeliveryOrder) {
  const { transitionOrder } = useDeliveryMutations()
  const toast = useToast()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const needsReferences = pending?.step === "payment" || pending?.step === "courier"
  const references = useDeliveryReferences(order.restaurantExternalId, needsReferences)

  async function run(to: DeliveryStatus, extra: { reason?: string; courierExternalId?: string; payment?: { paymentTypeExternalId?: string; amount?: number } } = {}) {
    setBusy(true)
    setError(null)
    setInlineError(null)
    try {
      await transitionOrder({ externalId: order.externalId, to, expectedVersion: order.version, ...extra })
      toast(`Статус заказа ${order.number}: ${describeStatus("delivery", to).label}`, "success")
      setPending(null)
    } catch (caught) {
      const message = errorMessage(caught, "Не удалось сменить статус")
      if (pending) setError(message)
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
    if (needsPayment(to, order.source?.settlementMode, order.paymentStatus)) return setPending({ to, step: "payment" })
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
  busy,
  error,
  onClose,
  onConfirm,
}: {
  order: DeliveryOrder
  to: DeliveryStatus
  paymentTypes: { externalId: string; name: string }[] | undefined
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (paymentTypeExternalId: string) => void
}) {
  const fallback = order.source?.defaultPaymentTypeExternalId ?? undefined
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
  order: DeliveryOrder
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
