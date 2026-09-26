import { useRef, useState } from "react"
import { Minus, Plus, X } from "lucide-react"

import { linesRefundAmount, refundableTotal, refundProblem, refundWays, type HistoryLine, type HistoryPayment, type RefundWay } from "@/pos/features/history/model/refund"
import { Button, Field, Money, MoneyInput, RadioGroup, Textarea } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatTenge } from "@/shared/lib/format"

export type RefundOrder = { _id: string; number: number; subtotal: number; total: number; lines: HistoryLine[]; payments: HistoryPayment[] }

export type RefundInput = {
  orderId: string
  idempotencyKey: string
  amount: number
  target: RefundWay["target"]
  lines?: Array<{ orderLineId: string; quantity: number }>
  reason: string
  managerApprovalToken: string
}

/**
 * «Возврат по заказу» (W1-POS-18) — a panel on the right of the history list, so it is visible
 * without scrolling (L-4). Amount and way come from the original payment; a refund by lines is
 * their share of the paid total. A manager PIN confirms every refund.
 */
export function RefundPanel({
  order,
  onClose,
  onRefund,
  onManagerRequired,
}: {
  order: RefundOrder
  onClose: () => void
  onRefund: (input: RefundInput) => Promise<unknown>
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const ways = refundWays(order.payments)
  const [wayKey, setWayKey] = useState<string | undefined>(() => ways.find((way) => way.available > 0)?.key)
  const way = ways.find((candidate) => candidate.key === wayKey)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [amount, setAmount] = useState<number | null>(way?.available ?? null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // One key per refund attempt: a retry after a lost answer never refunds twice.
  const idempotencyKey = useRef(crypto.randomUUID())

  const lines = order.lines.filter((line) => !line.voidedAt)
  const byLines = Object.values(quantities).some((quantity) => quantity > 0)
  const refundAmount = byLines ? linesRefundAmount(order, quantities) : amount
  const problem = refundProblem({ way, amount: refundAmount, reason })

  function changeQuantity(line: HistoryLine, delta: number) {
    setError(null)
    setQuantities((current) => ({ ...current, [line._id]: Math.min(line.quantity, Math.max(0, (current[line._id] ?? 0) + delta)) }))
  }

  async function submit() {
    if (problem || !way || !refundAmount || submitting) {
      setError(problem)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = await onManagerRequired(`Возврат ${formatTenge(refundAmount)} по заказу №${order.number} требует подтверждения менеджера`)
      if (!token) return
      await onRefund({
        orderId: order._id,
        idempotencyKey: idempotencyKey.current,
        amount: refundAmount,
        target: way.target,
        ...(byLines ? { lines: Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([orderLineId, quantity]) => ({ orderLineId, quantity })) } : {}),
        reason: reason.trim(),
        managerApprovalToken: token,
      })
      idempotencyKey.current = crypto.randomUUID()
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось провести возврат"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside aria-label={`Возврат по заказу №${order.number}`} className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <p className="font-display text-title-sm font-semibold">Возврат по заказу №{order.number}</p>
          <p className="text-body-sm text-muted-foreground">
            Доступно <Money value={refundableTotal(order.payments)} size="sm" />
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Закрыть возврат" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="grid gap-1.5">
          <p id="refund-way-label" className="text-body-sm font-medium text-muted-foreground">
            Способ возврата
          </p>
          <RadioGroup
            aria-labelledby="refund-way-label"
            value={wayKey}
            onValueChange={(value) => {
              setWayKey(value)
              setError(null)
              if (!byLines) setAmount(ways.find((candidate) => candidate.key === value)?.available ?? null)
            }}
            options={ways.map((candidate) => ({ value: candidate.key, label: candidate.label, description: `доступно ${formatTenge(candidate.available)}`, disabled: candidate.available <= 0 }))}
          />
        </div>

        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium text-muted-foreground">Позиции к возврату (необязательно)</p>
          <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
            {lines.map((line) => (
              <li key={line._id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-body-sm">
                  <span className="block">
                    <span className="font-semibold">{line.productName}</span>
                    <span className="text-muted-foreground"> · из {line.quantity}</span>
                  </span>
                  {line.productNameKk?.trim() && line.productNameKk.trim() !== line.productName.trim() ? (
                    <span lang="kk" className="block text-muted-foreground">
                      {line.productNameKk}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <Button variant="secondary" size="icon" className="size-12" aria-label={`Меньше: ${line.productName}`} onClick={() => changeQuantity(line, -1)} disabled={!quantities[line._id]}>
                    <Minus />
                  </Button>
                  <span className="w-7 text-center text-body font-semibold tabular-nums" aria-label={`К возврату: ${line.productName}`}>
                    {quantities[line._id] ?? 0}
                  </span>
                  <Button variant="secondary" size="icon" className="size-12" aria-label={`Больше: ${line.productName}`} onClick={() => changeQuantity(line, 1)} disabled={(quantities[line._id] ?? 0) >= line.quantity}>
                    <Plus />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {byLines ? (
          <div className="flex items-baseline justify-between rounded-control bg-muted px-3 py-2">
            <span className="text-body-sm text-muted-foreground">Сумма по позициям · со скидкой и сбором</span>
            <Money value={refundAmount ?? 0} />
          </div>
        ) : (
          <Field label="Сумма возврата">
            {(control) => <MoneyInput {...control} value={amount} onValueChange={(value) => { setAmount(value); setError(null) }} className="h-[var(--control-h-pos)] text-body font-semibold" />}
          </Field>
        )}

        <Field label="Причина возврата">
          {(control) => <Textarea {...control} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} placeholder="Например, блюдо не понравилось гостю" />}
        </Field>
        {error ? (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        ) : problem && reason.trim().length >= 3 ? (
          <p className="text-body-sm text-muted-foreground">{problem}</p>
        ) : null}
      </div>
      <div className="flex gap-2 border-t border-border px-5 py-4">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose} disabled={submitting}>
          Закрыть
        </Button>
        <Button variant="danger" size="lg" className="flex-[1.4]" onClick={submit} disabled={Boolean(problem) || submitting}>
          {submitting ? "Возврат…" : `Вернуть ${formatTenge(refundAmount ?? 0)}`}
        </Button>
      </div>
    </aside>
  )
}
