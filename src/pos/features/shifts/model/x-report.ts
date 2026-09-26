import { escapeHtml, printDateTime, printMoney, printPage } from "@/pos/features/print/print-document"
import type { EmployeeRole, PaymentMethod } from "@/shared/types/pos"

// X- and Z-report print forms (W1-POS-19, POS-DESIGN §6.6): 80 mm, non-fiscal (D6). Both print the
// snapshot of shifts/queries.ts buildXReportSnapshot; Z is a normal form, never JSON.

type MethodTotals = { sales: number; refunds: number; net: number; saleCount: number; refundCount: number }

export type ShiftReportSnapshot = {
  catalogGrossSales: number
  discounts: number
  serviceCharge: number
  sales: number
  refunds: number
  netSales: number
  averageCheck: number
  expectedCash: number
  payments: Record<PaymentMethod, MethodTotals>
  cashMovements: { cashIn: number; cashOut: number; cashInCount: number; cashOutCount: number }
  orderCounts: { paid: number; partiallyRefunded: number; refunded: number; cancelled: number; draft: number; held: number; discounted: number }
  openOrders: { count: number; total: number }
  heldOrders: { count: number; total: number }
  cancelledAmount: number
  saleOrderCount: number
  refundOrderCount: number
}

/** createXReport's answer (shifts/mutations.ts). */
export type XReportData = ShiftReportSnapshot & {
  reportNumber: string
  sequence: number
  shiftNumber: number
  terminalName: string
  restaurantName: string
  restaurantAddress?: string
  businessDate: string
  openedAt: number
  generatedAt: number
  openedByName: string
  generatedByName: string
  generatedByRole: EmployeeRole
  openingCash: number
}

export const ROLE_LABEL: Record<EmployeeRole, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Наличные", card: "Банковские карты", qr: "QR" }

export function duration(start: number, end: number) {
  const minutes = Math.max(0, Math.floor((end - start) / 60_000))
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`
}

const row = (label: string, value: string) => `<div class="row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`
const sub = (label: string, value: string) => `<div class="sub"><span>${escapeHtml(label)}</span><span>${value}</span></div>`

/** Sales, payment methods, cash in the drawer and orders — the body shared by X and Z. */
export function snapshotSections(snapshot: ShiftReportSnapshot, openingCash: number) {
  const methods = (["cash", "card", "qr"] as const)
    .map((method) => {
      const item = snapshot.payments[method]
      return `<section class="item">${row(METHOD_LABEL[method], `<b>${printMoney(item.net)}</b>`)}${sub(`Оплаты · ${item.saleCount}`, printMoney(item.sales))}${sub(`Возвраты · ${item.refundCount}`, printMoney(-item.refunds))}</section>`
    })
    .join("")
  const unfinished = snapshot.openOrders.count + snapshot.heldOrders.count
  return `<hr class="divider">
<p class="section">Продажи</p>
${row("Сумма по меню", printMoney(snapshot.catalogGrossSales))}
${row(`Скидки · ${snapshot.orderCounts.discounted}`, printMoney(-snapshot.discounts))}
${row("Сервисный сбор", printMoney(snapshot.serviceCharge))}
${row(`Оплаты · ${snapshot.saleOrderCount}`, printMoney(snapshot.sales))}
${row(`Возвраты · ${snapshot.refundOrderCount}`, printMoney(-snapshot.refunds))}
<div class="row total"><span>ЧИСТАЯ ВЫРУЧКА</span><span>${printMoney(snapshot.netSales)}</span></div>
${row("Средний чек", printMoney(snapshot.averageCheck))}
<hr class="divider">
<p class="section">По способам оплаты</p>
${methods}
<hr class="divider">
<p class="section">Наличные в кассе</p>
${row("Остаток при открытии", printMoney(openingCash))}
${row("Наличные продажи", printMoney(snapshot.payments.cash.sales))}
${row("Наличные возвраты", printMoney(-snapshot.payments.cash.refunds))}
${row(`Внесения · ${snapshot.cashMovements.cashInCount}`, printMoney(snapshot.cashMovements.cashIn))}
${row(`Изъятия · ${snapshot.cashMovements.cashOutCount}`, printMoney(-snapshot.cashMovements.cashOut))}
<div class="row total"><span>ОЖИДАЕТСЯ</span><span>${printMoney(snapshot.expectedCash)}</span></div>
<hr class="divider">
<p class="section">Заказы</p>
${row("Оплачены", String(snapshot.orderCounts.paid))}
${row("Частичный возврат", String(snapshot.orderCounts.partiallyRefunded))}
${row("Полный возврат", String(snapshot.orderCounts.refunded))}
${row("Отменены", `${snapshot.orderCounts.cancelled} · ${printMoney(snapshot.cancelledAmount)}`)}
${row("Открыты", `${snapshot.openOrders.count} · ${printMoney(snapshot.openOrders.total)}`)}
${row("Отложены", `${snapshot.heldOrders.count} · ${printMoney(snapshot.heldOrders.total)}`)}
${unfinished ? `<p class="box">Незавершённых заказов: ${unfinished}</p>` : ""}`
}

export function buildXReportHtml(report: XReportData) {
  return printPage(
    `${report.reportNumber} · X-отчёт`,
    `<header>
  <h1 class="brand">SANDYQ</h1>
  <p class="kind">X-ОТЧЁТ</p>
  <p class="center muted">Отчёт без гашения</p>
  <p class="box">НЕФИСКАЛЬНЫЙ ДОКУМЕНТ</p>
  <p class="center">${escapeHtml(report.restaurantName)}<br><span class="muted">${[report.restaurantAddress, report.terminalName].filter(Boolean).map(escapeHtml).join(" · ")}</span></p>
  <p class="center strong">${escapeHtml(report.reportNumber)}</p>
</header>
<hr class="divider">
${row("Смена", `№${report.shiftNumber}`)}
${row("Опер. дата", escapeHtml(report.businessDate))}
${row("Открыта", printDateTime(report.openedAt))}
${row("Сформирован", printDateTime(report.generatedAt))}
${row("Длительность", duration(report.openedAt, report.generatedAt))}
${row("Открыл смену", escapeHtml(report.openedByName))}
${row("Оператор", `${escapeHtml(report.generatedByName)} · ${ROLE_LABEL[report.generatedByRole] ?? ""}`)}
${snapshotSections(report, report.openingCash)}
<hr class="divider">
<p>Оператор ____________________</p>
<p class="footer strong">СМЕНА НЕ ЗАКРЫТА<br><span class="muted">Итоги не обнулены · X-отчёт №${report.sequence}</span></p>`,
  )
}
