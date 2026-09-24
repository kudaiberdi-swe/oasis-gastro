import type { PosPaymentType } from "@/pos/features/retail/data/use-retail-settings"
import { formatTenge } from "@/shared/lib/format"
import type { PaymentMethod } from "@/shared/types/pos"
import { PAYMENT_METHOD_LABEL } from "./order-receipt"

// Payment of an order (W1-POS-17): the tender options come from the published payment types; before
// they are seeded the terminal falls back to the legacy cash / card / QR methods. Rules mirror
// settleOrder (convex/lib/checkoutCore.ts): parts add up to the total, change only on a type that
// allows it, a non-combinable type pays alone.

export type PaymentOption = {
  /** paymentTypeExternalId, or `method:<kind>` in legacy mode. */
  key: string
  paymentTypeExternalId?: string
  method: PaymentMethod
  name: string
  hint: string
  combinable: boolean
  allowsChange: boolean
}

/** One part of a (possibly mixed) payment. `id` is stable so removing a middle part never shifts the others (S-22). */
export type PaymentPart = { id: string; optionKey: string; amount: number | null; tendered?: number | null }

export type CheckoutPayment = { paymentTypeExternalId?: string; method?: PaymentMethod; amount: number; tendered?: number }

const KIND_HINT: Record<PaymentMethod, string> = { cash: "Касса", card: "Банковский терминал", qr: "QR-оплата" }

export function paymentOptions(types: PosPaymentType[]): PaymentOption[] {
  if (types.length === 0) {
    return (Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((method) => ({
      key: `method:${method}`,
      method,
      name: PAYMENT_METHOD_LABEL[method],
      hint: KIND_HINT[method],
      combinable: true,
      allowsChange: method === "cash",
    }))
  }
  return types.map((type) => ({
    key: type.externalId,
    paymentTypeExternalId: type.externalId,
    method: type.data.processorKind,
    name: type.name,
    hint: type.receiptName && type.receiptName !== type.name ? type.receiptName : KIND_HINT[type.data.processorKind],
    combinable: type.data.combinable,
    allowsChange: type.data.allowsChange,
  }))
}

export const newPartId = () => crypto.randomUUID()

export const partTendered = (part: PaymentPart) => part.tendered ?? part.amount ?? 0

export function allocated(parts: PaymentPart[]) {
  return parts.reduce((sum, part) => sum + (part.amount ?? 0), 0)
}

/** Change handed back: only on parts whose type allows it. */
export function changeDue(parts: PaymentPart[], options: PaymentOption[]) {
  return parts.reduce((sum, part) => {
    const option = options.find((candidate) => candidate.key === part.optionKey)
    return option?.allowsChange ? sum + Math.max(0, partTendered(part) - (part.amount ?? 0)) : sum
  }, 0)
}

/** Why the payment cannot be confirmed yet, or null. */
export function paymentProblem(parts: PaymentPart[], options: PaymentOption[], total: number): string | null {
  if (parts.length === 0) return "Добавьте оплату"
  for (const part of parts) {
    const option = options.find((candidate) => candidate.key === part.optionKey)
    if (!option) return "Выберите способ оплаты"
    if (!part.amount || part.amount <= 0 || !Number.isInteger(part.amount)) return "Укажите сумму каждой части"
    if (option.allowsChange && partTendered(part) < part.amount) return "Полученной суммы недостаточно"
    if (parts.length > 1 && !option.combinable) return `«${option.name}» нельзя сочетать с другими типами оплаты`
  }
  const rest = total - allocated(parts)
  if (rest > 0) return `Осталось распределить ${formatTenge(rest)}`
  if (rest < 0) return `Сумма частей больше заказа на ${formatTenge(-rest)}`
  return null
}

/** The checkout `payments` argument: by payment type, or by legacy method; tendered only where change is allowed. */
export function toCheckoutPayments(parts: PaymentPart[], options: PaymentOption[]): CheckoutPayment[] {
  return parts.map((part) => {
    const option = options.find((candidate) => candidate.key === part.optionKey)!
    const amount = part.amount ?? 0
    return {
      ...(option.paymentTypeExternalId ? { paymentTypeExternalId: option.paymentTypeExternalId } : { method: option.method }),
      amount,
      ...(option.allowsChange ? { tendered: partTendered(part) } : {}),
    }
  })
}

/**
 * Sets one part's amount. With exactly two parts the other one takes the remainder, so «5 000 наличными,
 * остальное картой» is one input; with more parts the cashier distributes them.
 */
export function setPartAmount(parts: PaymentPart[], id: string, amount: number | null, total: number): PaymentPart[] {
  const next = parts.map((part) => (part.id === id ? { ...part, amount, tendered: null } : part))
  if (next.length !== 2) return next
  const rest = Math.max(0, total - (amount ?? 0))
  return next.map((part) => (part.id === id ? part : { ...part, amount: rest || null, tendered: null }))
}

/** A new part for what is still unpaid, on the first combinable option not used yet. */
export function addPart(parts: PaymentPart[], options: PaymentOption[], total: number): PaymentPart[] {
  const combinable = options.filter((option) => option.combinable)
  const used = new Set(parts.map((part) => part.optionKey))
  const option = combinable.find((candidate) => !used.has(candidate.key)) ?? combinable[0]
  if (!option) return parts
  const rest = Math.max(0, total - allocated(parts))
  return [...parts, { id: newPartId(), optionKey: option.key, amount: rest || null }]
}

/** Starting split: change-allowing option first (cash), the whole total on a second option. */
export function initialSplit(options: PaymentOption[], total: number): PaymentPart[] {
  const combinable = options.filter((option) => option.combinable)
  const first = combinable.find((option) => option.allowsChange) ?? combinable[0]
  const second = combinable.find((option) => option !== first)
  if (!first) return []
  return second
    ? [
        { id: newPartId(), optionKey: first.key, amount: null },
        { id: newPartId(), optionKey: second.key, amount: total },
      ]
    : [{ id: newPartId(), optionKey: first.key, amount: total }]
}

/** A refund goes back the way it was paid: the original payment's type, or its method for pre-M-2 payments. */
export function refundTarget(payment: { paymentTypeExternalId?: string; method: PaymentMethod }): { paymentTypeExternalId: string } | { method: PaymentMethod } {
  return payment.paymentTypeExternalId ? { paymentTypeExternalId: payment.paymentTypeExternalId } : { method: payment.method }
}
