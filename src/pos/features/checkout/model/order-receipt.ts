import type { PaymentMethod } from "@/shared/types/pos"

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Наличные", card: "Карта", qr: "QR" }

export const QUICK_CASH_STEPS = [500, 1000, 2000, 5000] as const

export function roundUpTo(value: number, step: number) {
  return Math.ceil(value / step) * step
}
