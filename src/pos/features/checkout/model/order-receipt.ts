import { lineDetails, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { escapeHtml, printDateTime, printMoney, printPage } from "@/pos/features/print/print-document"
import type { PaymentMethod } from "@/shared/types/pos"

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Наличные", card: "Карта", qr: "QR" }

export const QUICK_CASH_STEPS = [500, 1000, 2000, 5000] as const

export function roundUpTo(value: number, step: number) {
  return Math.ceil(value / step) * step
}

// Printed check and pre-check (W1-POS-15, POS-DESIGN §6.6): 80 mm, black and white, no fiscal data
// (D6 — every print form is non-fiscal). The pre-check is what the guest checks before paying.

export type ReceiptLine = { name: string; quantity: number; amount: number; details?: string }

export type ReceiptPayment = { name: string; amount: number; tendered?: number; change?: number; refund?: boolean }

export type OrderReceiptData = {
  kind: "precheck" | "receipt"
  orderNumber?: number
  tableLabel?: string
  hallLabel?: string
  orderTypeName?: string
  restaurantName: string
  terminalName: string
  operatorName: string
  createdAt: number
  paidAt?: number
  statusLabel?: string
  lines: ReceiptLine[]
  subtotal: number
  discountAmount: number
  discountLabel?: string
  serviceChargePercent: number
  serviceChargeAmount: number
  total: number
  comment?: string
  payments?: ReceiptPayment[]
}

function itemsWord(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 14) return "позиций"
  if (mod10 === 1) return "позиция"
  if (mod10 >= 2 && mod10 <= 4) return "позиции"
  return "позиций"
}

export function buildOrderReceiptHtml(receipt: OrderReceiptData) {
  const precheck = receipt.kind === "precheck"
  const count = receipt.lines.reduce((sum, line) => sum + line.quantity, 0)
  const place = [receipt.tableLabel, receipt.hallLabel].filter(Boolean).join(" · ")
  const lines = receipt.lines
    .map(
      (line) => `<section class="item">
  <div class="row"><span><b>${line.quantity} ×</b> ${escapeHtml(line.name)}</span><span class="strong">${printMoney(line.amount)}</span></div>
  ${line.details ? `<div class="sub"><span>${escapeHtml(line.details)}</span><span></span></div>` : ""}
</section>`,
    )
    .join("")
  const payments = (receipt.payments ?? [])
    .map(
      (payment) => `<div class="row"><span>${payment.refund ? "Возврат · " : ""}${escapeHtml(payment.name)}</span><span>${payment.refund ? "− " : ""}${printMoney(payment.amount)}</span></div>
${payment.tendered != null && payment.tendered > payment.amount ? `<div class="sub"><span>Получено</span><span>${printMoney(payment.tendered)}</span></div><div class="sub"><span>Сдача</span><span>${printMoney(payment.change ?? payment.tendered - payment.amount)}</span></div>` : ""}`,
    )
    .join("")
  const title = precheck ? `Предчек${receipt.orderNumber ? ` №${receipt.orderNumber}` : ""}` : `Чек №${receipt.orderNumber ?? ""}`

  return printPage(
    title,
    `<header>
  <h1 class="brand">SANDYQ</h1>
  <p class="kind">${precheck ? "ПРЕДЧЕК" : "ЧЕК ЗАКАЗА"}</p>
  <p class="center">${escapeHtml(receipt.restaurantName)}<br><span class="muted">${escapeHtml(receipt.terminalName)}</span></p>
  ${receipt.orderNumber !== undefined ? `<p class="number">Заказ №${receipt.orderNumber}</p>` : ""}
  <p class="center muted">${[place, receipt.orderTypeName, `${count} ${itemsWord(count)}`].filter(Boolean).map(escapeHtml).join(" · ")}</p>
</header>
<hr class="divider">
<div class="row"><span>${precheck ? "Время" : "Создан"}</span><span>${printDateTime(receipt.createdAt)}</span></div>
${receipt.paidAt ? `<div class="row"><span>Оплачен</span><span>${printDateTime(receipt.paidAt)}</span></div>` : ""}
${receipt.statusLabel ? `<div class="row"><span>Статус</span><span>${escapeHtml(receipt.statusLabel)}</span></div>` : ""}
<div class="row"><span>Кассир</span><span>${escapeHtml(receipt.operatorName)}</span></div>
<hr class="divider">
${lines}
${receipt.comment?.trim() ? `<div class="note"><b>Комментарий:</b> ${escapeHtml(receipt.comment.trim())}</div>` : ""}
<hr class="divider">
<div class="row"><span>Сумма заказа</span><span>${printMoney(receipt.subtotal)}</span></div>
${receipt.discountAmount ? `<div class="row"><span>${escapeHtml(receipt.discountLabel || "Скидка")}</span><span>${printMoney(-receipt.discountAmount)}</span></div>` : ""}
${receipt.serviceChargeAmount ? `<div class="row"><span>Қызмет ақысы ${receipt.serviceChargePercent} % / Обслуживание ${receipt.serviceChargePercent} %</span><span>${printMoney(receipt.serviceChargeAmount)}</span></div>` : ""}
<div class="row total"><span>${precheck ? "К ОПЛАТЕ" : "ИТОГО"}</span><span>${printMoney(receipt.total)}</span></div>
${payments ? `<hr class="divider"><p class="section">Оплата</p>${payments}` : ""}
<p class="box">${precheck ? "НЕ ЯВЛЯЕТСЯ ЧЕКОМ" : "НЕФИСКАЛЬНЫЙ ДОКУМЕНТ"}</p>
<p class="footer">${precheck ? "Проверьте заказ перед оплатой" : "Рахмет! Спасибо за визит"}</p>
<p class="slogan">DALA AŊYZYN JAŊĞYRTU</p>`,
  )
}

type DraftForPrint = {
  orderNumber?: number
  tableLabel: string
  lines: OrderDraftLine[]
  subtotal: number
  discountPercent: number
  discountAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  total: number
  comment: string
}

/** The pre-check of the check on screen: active lines and the totals the cashier sees. */
export function precheckFromDraft(
  draft: DraftForPrint,
  place: { restaurantName: string; terminalName: string; operatorName: string; orderTypeName?: string },
  now = Date.now(),
): OrderReceiptData {
  return {
    kind: "precheck",
    orderNumber: draft.orderNumber,
    tableLabel: draft.tableLabel || undefined,
    orderTypeName: place.orderTypeName,
    restaurantName: place.restaurantName,
    terminalName: place.terminalName,
    operatorName: place.operatorName,
    createdAt: now,
    lines: draft.lines.filter((line) => !line.voidedAt).map((line) => ({ name: line.name, quantity: line.quantity, amount: lineTotal(line), details: lineDetails(line) || undefined })),
    subtotal: draft.subtotal,
    discountAmount: draft.discountAmount,
    discountLabel: draft.discountPercent ? `Скидка ${draft.discountPercent} %` : undefined,
    serviceChargePercent: draft.serviceChargePercent,
    serviceChargeAmount: draft.serviceChargeAmount,
    total: draft.total,
    comment: draft.comment,
  }
}
