import type { OrderReceiptData } from "@/pos/features/checkout/model/order-receipt"
import { PAYMENT_METHOD_LABEL } from "@/pos/features/checkout/model/order-receipt"
import { describeStatus } from "@/shared/lib/status-dictionary"
import type { PaymentMethod } from "@/shared/types/pos"

// A history row (orders.list) as a print form: a check for paid orders, a pre-check for open ones.

type Line = { productName: string; quantity: number; unitPrice: number; lineTotal?: number; sizeLabel?: string; voidedAt?: number; kitchenModifiers?: Array<{ label: string }> }

type Payment = { type: "sale" | "refund"; method: PaymentMethod; amount: number; tendered?: number; change?: number; paymentTypeName?: string }

export type PrintableOrder = {
  number: number
  status: string
  createdAt: number
  paidAt?: number
  tableLabel?: string
  hallLabel?: string
  orderTypeName?: string
  subtotal: number
  discountAmount?: number
  discountPercent: number
  discountTypeName?: string
  serviceChargePercent: number
  serviceChargeAmount: number
  total: number
  comment?: string
  createdByName: string
  lines: Line[]
  payments: Payment[]
}

const PAID = new Set(["paid", "partially_refunded", "refunded"])

export function receiptFromOrder(order: PrintableOrder, place: { restaurantName: string; terminalName: string }): OrderReceiptData {
  const discountAmount = order.discountAmount ?? Math.round(order.subtotal * (order.discountPercent / 100))
  return {
    kind: PAID.has(order.status) ? "receipt" : "precheck",
    orderNumber: order.number,
    tableLabel: order.tableLabel,
    hallLabel: order.hallLabel,
    orderTypeName: order.orderTypeName,
    restaurantName: place.restaurantName,
    terminalName: place.terminalName,
    operatorName: order.createdByName,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    statusLabel: describeStatus("order", order.status).label,
    lines: order.lines
      .filter((line) => !line.voidedAt)
      .map((line) => ({
        name: line.productName,
        quantity: line.quantity,
        amount: line.lineTotal ?? line.unitPrice * line.quantity,
        details: [line.sizeLabel, ...(line.kitchenModifiers ?? []).map((modifier) => modifier.label)].filter(Boolean).join(" · ") || undefined,
      })),
    subtotal: order.subtotal,
    discountAmount,
    discountLabel: order.discountTypeName || (order.discountPercent ? `Скидка ${order.discountPercent} %` : undefined),
    serviceChargePercent: order.serviceChargePercent,
    serviceChargeAmount: order.serviceChargeAmount,
    total: order.total,
    comment: order.comment,
    payments: order.payments.map((payment) => ({
      name: payment.paymentTypeName || PAYMENT_METHOD_LABEL[payment.method],
      amount: payment.amount,
      tendered: payment.tendered,
      change: payment.change,
      refund: payment.type === "refund",
    })),
  }
}
