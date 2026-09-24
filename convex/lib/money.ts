import { SERVICE_CHARGE_PERCENT } from "./policy"

/** Tenge has no subunit in practice at Sandyq's prices — round to the integer tenge everywhere. */
export function roundKzt(amount: number): number {
  return Math.round(amount)
}

/** The one rounding rule for an order's percent discount — shared by the order itself and the X-report. */
export function calculateDiscountAmount(subtotal: number, discountPercent: number): number {
  return roundKzt(subtotal * (discountPercent / 100))
}

/** An order's discount: stored since W1-POS-03 (fixed and markup types), else derived from the percent. */
export function orderDiscountAmount(order: { subtotal: number; discountPercent: number; discountAmount?: number }): number {
  return order.discountAmount ?? calculateDiscountAmount(order.subtotal, order.discountPercent)
}

export function calculateServiceCharge(subtotal: number, discountAmount: number, percent = SERVICE_CHARGE_PERCENT): number {
  return roundKzt(Math.max(0, subtotal - discountAmount) * (percent / 100))
}

export function calculateOrderTotal(subtotal: number, discountAmount: number, serviceChargeAmount: number): number {
  return roundKzt(subtotal - discountAmount + serviceChargeAmount)
}

/**
 * expectedCash = opening float + cash sales − cash refunds + cash insertions − cash withdrawals.
 * Mirrors the reference implementation's shift-close reconciliation formula.
 */
export function calculateCashReconciliation(args: {
  openingCash: number
  cashSales: number
  cashRefunds: number
  cashIn: number
  cashOut: number
}): number {
  return roundKzt(args.openingCash + args.cashSales - args.cashRefunds + args.cashIn - args.cashOut)
}
