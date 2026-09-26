import { useRef, useState } from "react"
import { Minus, Plus, X } from "lucide-react"

import { linesRefundAmount, refundableTotal, refundProblem, refundWays, type HistoryLine, type HistoryPayment, type RefundWay } from "@/pos/features/history/model/refund"
import { Button, Field, Money, MoneyInput, RadioGroup, Textarea } from "@/shared/components/ui"
import { bilingualName, posErrorMessage, useT } from "@/pos/i18n"
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
  const t = useT()
  const ways = refundWays(order.payments, t)
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
  const problem = refundProblem({ way, amount: refundAmount, reason }, t)

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
      const token = await onManagerRequired(t("refund.approval", { amount: formatTenge(refundAmount), number: order.number }))
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
      setError(posErrorMessage(t, caught, t("refund.failed")))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside aria-label={t("refund.title", { number: order.number })} className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <p className="font-display text-title-sm font-semibold">{t("refund.title", { number: order.number })}</p>
          <p className="text-body-sm text-muted-foreground">
            {t("refund.available")} <Money value={refundableTotal(order.payments)} size="sm" />
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("refund.close")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="grid gap-1.5">
          <p id="refund-way-label" className="text-body-sm font-medium text-muted-foreground">
            {t("refund.way")}
          </p>
          <RadioGroup
            aria-labelledby="refund-way-label"
            value={wayKey}
            onValueChange={(value) => {
              setWayKey(value)
              setError(null)
              if (!byLines) setAmount(ways.find((candidate) => candidate.key === value)?.available ?? null)
            }}
            options={ways.map((candidate) => ({ value: candidate.key, label: candidate.label, description: t("refund.wayAvailable", { amount: formatTenge(candidate.available) }), disabled: candidate.available <= 0 }))}
          />
        </div>

        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium text-muted-foreground">{t("refund.lines")}</p>
          <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
            {lines.map((line) => {
              const name = bilingualName(t.locale, { name: line.productName, nameKk: line.productNameKk })
              return (
              <li key={line._id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-body-sm">
                  <span className="block">
                    <span lang={name.primary.lang} className="font-semibold">
                      {name.primary.text}
                    </span>
                    <span className="text-muted-foreground"> · {t("refund.of", { count: line.quantity })}</span>
                  </span>
                  {name.secondary ? (
                    <span lang={name.secondary.lang} className="block text-muted-foreground">
                      {name.secondary.text}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <Button variant="secondary" size="icon" className="size-12" aria-label={t("common.less", { label: name.primary.text })} onClick={() => changeQuantity(line, -1)} disabled={!quantities[line._id]}>
                    <Minus />
                  </Button>
                  <span className="w-7 text-center text-body font-semibold tabular-nums" aria-label={t("refund.count", { name: name.primary.text })}>
                    {quantities[line._id] ?? 0}
                  </span>
                  <Button variant="secondary" size="icon" className="size-12" aria-label={t("common.more", { label: name.primary.text })} onClick={() => changeQuantity(line, 1)} disabled={(quantities[line._id] ?? 0) >= line.quantity}>
                    <Plus />
                  </Button>
                </span>
              </li>
              )
            })}
          </ul>
        </div>

        {byLines ? (
          <div className="flex items-baseline justify-between rounded-control bg-muted px-3 py-2">
            <span className="text-body-sm text-muted-foreground">{t("refund.byLines")}</span>
            <Money value={refundAmount ?? 0} />
          </div>
        ) : (
          <Field label={t("refund.amount")}>
            {(control) => <MoneyInput {...control} value={amount} onValueChange={(value) => { setAmount(value); setError(null) }} className="h-[var(--control-h-pos)] text-body font-semibold" />}
          </Field>
        )}

        <Field label={t("refund.reason")}>
          {(control) => <Textarea {...control} value={reason} onChange={(event) => { setReason(event.target.value); setError(null) }} placeholder={t("refund.placeholder")} />}
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
          {t("common.close")}
        </Button>
        <Button variant="danger" size="lg" className="flex-[1.4]" onClick={submit} disabled={Boolean(problem) || submitting}>
          {submitting ? t("refund.submitting") : t("refund.submit", { amount: formatTenge(refundAmount ?? 0) })}
        </Button>
      </div>
    </aside>
  )
}
