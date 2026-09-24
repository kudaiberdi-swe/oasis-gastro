import { refundTarget } from "@/pos/features/checkout/model/payment-parts"
import { PAYMENT_METHOD_LABEL } from "@/pos/features/checkout/model/order-receipt"
import { formatTenge } from "@/shared/lib/format"
import type { PaymentMethod } from "@/shared/types/pos"

// Refund of a paid check (W1-POS-18). Mirrors orders/mutations.ts refund: the money goes back the
// way it was paid (payment type, or method for payments before M-2), never more than is left on
// that way; a refund by lines is the lines' share of what the guest paid.

export type HistoryPayment = { type: "sale" | "refund"; method: PaymentMethod; amount: number; paymentTypeExternalId?: string; paymentTypeName?: string }

export type HistoryLine = { _id: string; productName: string; quantity: number; unitPrice: number; lineTotal?: number; voidedAt?: number }

/** One way the check was paid and how much of it can still be returned. */
export type RefundWay = {
  key: string
  label: string
  target: { paymentTypeExternalId: string } | { method: PaymentMethod }
  paid: number
  available: number
}

const wayKey = (payment: Pick<HistoryPayment, "paymentTypeExternalId" | "method">) => (payment.paymentTypeExternalId ? `type:${payment.paymentTypeExternalId}` : `method:${payment.method}`)

export function refundWays(payments: HistoryPayment[]): RefundWay[] {
  const ways = new Map<string, RefundWay>()
  for (const payment of payments) {
    if (payment.type !== "sale") continue
    const key = wayKey(payment)
    const way = ways.get(key) ?? { key, label: payment.paymentTypeName || PAYMENT_METHOD_LABEL[payment.method], target: refundTarget(payment), paid: 0, available: 0 }
    way.paid += payment.amount
    ways.set(key, way)
  }
  for (const payment of payments) {
    if (payment.type !== "refund") continue
    // A refund by method (no type) counts against every sale of that method, as the server does.
    const way = payment.paymentTypeExternalId ? ways.get(wayKey(payment)) : [...ways.values()].find((candidate) => "method" in candidate.target && candidate.target.method === payment.method)
    if (way) way.available -= payment.amount
  }
  for (const way of ways.values()) way.available += way.paid
  return [...ways.values()].map((way) => ({ ...way, available: Math.max(0, way.available) }))
}

export function paidTotal(payments: HistoryPayment[]) {
  return payments.filter((payment) => payment.type === "sale").reduce((sum, payment) => sum + payment.amount, 0)
}

export function refundableTotal(payments: HistoryPayment[]) {
  return payments.reduce((sum, payment) => sum + (payment.type === "sale" ? payment.amount : -payment.amount), 0)
}

const lineAmount = (line: HistoryLine) => line.lineTotal ?? line.unitPrice * line.quantity

/**
 * The amount of a refund by lines: the lines' part of the subtotal applied to the order total, so
 * the discount and the service charge are returned in proportion. Same rounding as the server.
 */
export function linesRefundAmount(order: { subtotal: number; total: number; lines: HistoryLine[] }, quantities: Record<string, number>) {
  let linesAmount = 0
  for (const line of order.lines) {
    const quantity = quantities[line._id] ?? 0
    if (!quantity || line.voidedAt || line.quantity <= 0) continue
    linesAmount += (lineAmount(line) / line.quantity) * Math.min(quantity, line.quantity)
  }
  return order.subtotal > 0 ? Math.round((linesAmount * order.total) / order.subtotal) : 0
}

/** Why the refund cannot be sent yet, or null. */
export function refundProblem(input: { way: RefundWay | undefined; amount: number | null; reason: string }) {
  if (!input.way) return "Выберите способ возврата"
  if (!input.amount || input.amount <= 0 || !Number.isInteger(input.amount)) return "Укажите сумму возврата"
  if (input.amount > input.way.available) return `По способу «${input.way.label}» можно вернуть не больше ${formatTenge(input.way.available)}`
  if (input.reason.trim().length < 3) return "Укажите причину возврата"
  return null
}
