import type { ShiftCandidate } from "@/office/features/finance/data/use-finance-records"
import type { OrderReceiptData } from "@/pos/features/checkout/model/order-receipt"
import { describeStatus } from "@/shared/lib/status-dictionary"

import type { CashDirection, OrderDetail, OrderStatusTab, SalesSource, ShiftCard, ShiftStatusTab } from "../data/use-retail-office"

// Pure helpers of the retail office sections (W1-RTL-04/05/06): tabs, filters, card mappings.

export const ORDER_TABS: { value: OrderStatusTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "open", label: "Открытые" },
  { value: "held", label: "Отложенные" },
  { value: "paid", label: "Оплаченные" },
  { value: "refunded", label: "Возвраты" },
  { value: "cancelled", label: "Отменённые" },
]

export const SHIFT_TABS: { value: ShiftStatusTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "open", label: "Открытые" },
  { value: "closed", label: "Закрытые" },
]

export const SOURCE_OPTIONS: { value: SalesSource; label: string }[] = [
  { value: "sandyq", label: "OASIS Gastro" },
  { value: "iiko", label: "iiko" },
]

/** iiko shift statuses (sessionStatus) in Russian; anything unknown shows as it came. */
export function iikoShiftStatusLabel(status: string) {
  return ({ OPEN: "Открыта", CLOSED: "Закрыта", UNACCEPTED: "Закрыта, не принята", ACCEPTED: "Принята" } as Record<string, string>)[status] ?? status
}

export const DIRECTION_LABEL: Record<CashDirection, string> = { "cash-in": "Внесение", "cash-out": "Изъятие" }
export const DIRECTION_TONE = { "cash-in": "success", "cash-out": "warning" } as const

const ALMATY_OFFSET = "+05:00"
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Business-date inputs (YYYY-MM-DD, Almaty) → the createdAt range of the journal query. An empty or
 * reversed period is `null` (the page asks to fix it); both empty means «no period».
 */
export function periodRange(from: string, to: string): { from?: number; to?: number } | null {
  if (from && !DATE.test(from)) return null
  if (to && !DATE.test(to)) return null
  if (from && to && from > to) return null
  return {
    ...(from ? { from: Date.parse(`${from}T00:00:00.000${ALMATY_OFFSET}`) } : {}),
    ...(to ? { to: Date.parse(`${to}T23:59:59.999${ALMATY_OFFSET}`) } : {}),
  }
}

/** A shift card in the shape the finance acceptance dialog takes (one dialog, B-21). */
export function shiftCandidate(shift: ShiftCard): ShiftCandidate {
  return {
    shiftId: shift._id,
    restaurantName: shift.restaurantName,
    terminalName: shift.terminalName,
    shiftNumber: shift.number,
    businessDate: shift.businessDate,
    zReportNumber: shift.zReportNumber,
    closedAt: shift.closedAt,
    closedByName: shift.closedByName,
    expectedCash: shift.expectedCash ?? 0,
    countedCash: shift.countedCash ?? 0,
    variance: shift.variance ?? 0,
  }
}

/** «стол 5»; a label that already names the table («Стол 2» from the POS hall) stays as is, not «стол Стол 2». */
export function tableText(label: string) {
  const trimmed = label.trim()
  return /^стол(\s|$)/iu.test(trimmed) ? trimmed : `стол ${trimmed}`
}

/** Only a closed shift without an active acceptance can be accepted. */
export const canAcceptShift = (shift: ShiftCard) => shift.status === "closed" && !shift.acceptance

/** A closed shift without a saved Z-report (should not happen after W1-POS-08) has nothing to print. */
export const Z_REPORT_MISSING = "У смены нет сохранённого Z-отчёта — печатать нечего."

/** The receipt card as the POS print form (80 mm, non-fiscal). Voided lines are not printed. */
export function receiptFromDetail(detail: OrderDetail): OrderReceiptData {
  const { order, totals } = detail
  return {
    kind: "receipt",
    orderNumber: order.number,
    tableLabel: order.tableLabel ?? undefined,
    orderTypeName: order.orderTypeName ?? undefined,
    restaurantName: order.restaurantName,
    terminalName: order.terminalName ?? "Касса",
    operatorName: order.cashierName ?? "—",
    createdAt: order.createdAt,
    paidAt: order.paidAt ?? undefined,
    statusLabel: describeStatus("order", order.status).label,
    lines: detail.lines
      .filter((line) => !line.voided)
      .map((line) => ({
        name: line.sizeLabel ? `${line.productName} · ${line.sizeLabel}` : line.productName,
        quantity: line.quantity,
        amount: line.lineTotal,
        details: line.modifiers.length ? line.modifiers.join(", ") : undefined,
      })),
    subtotal: totals.subtotal,
    discountAmount: totals.discount,
    discountLabel: totals.discountName ?? undefined,
    serviceChargePercent: totals.serviceChargePercent,
    serviceChargeAmount: totals.serviceCharge,
    total: totals.total,
    comment: order.comment || undefined,
    payments: detail.payments.map((payment) => ({
      name: payment.name,
      amount: payment.amount,
      tendered: payment.tendered ?? undefined,
      change: payment.change ?? undefined,
      refund: payment.type === "refund",
    })),
  }
}
