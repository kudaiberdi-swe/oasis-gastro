import { escapeHtml, printDateTime, printMoney, printPage } from "@/pos/features/print/print-document"
import { duration, snapshotSections, type ShiftReportSnapshot } from "./x-report"

/** A saved Z-report (zReports row, shifts/queries.ts getZReport) and where it was printed. */
export type ZReportData = {
  number: string
  businessDate: string
  shiftNumber: number
  openedAt: number
  closedAt: number
  closedByName: string
  openingCash: number
  countedCash: number
  variance: number
  snapshot: ShiftReportSnapshot
}

export function buildZReportHtml(report: ZReportData, place: { restaurantName: string; terminalName: string }) {
  const variance = report.variance === 0 ? printMoney(0) : `${report.variance > 0 ? "+" : ""}${printMoney(report.variance)}`
  return printPage(
    `${report.number} · Z-отчёт`,
    `<header>
  <h1 class="brand">SANDYQ</h1>
  <p class="kind">Z-ОТЧЁТ</p>
  <p class="center muted">Отчёт с закрытием смены</p>
  <p class="box">НЕФИСКАЛЬНЫЙ ДОКУМЕНТ</p>
  <p class="center">${escapeHtml(place.restaurantName)}<br><span class="muted">${escapeHtml(place.terminalName)}</span></p>
  <p class="center strong">${escapeHtml(report.number)}</p>
</header>
<hr class="divider">
<div class="row"><span>Смена</span><span>№${report.shiftNumber}</span></div>
<div class="row"><span>Опер. дата</span><span>${escapeHtml(report.businessDate)}</span></div>
<div class="row"><span>Открыта</span><span>${printDateTime(report.openedAt)}</span></div>
<div class="row"><span>Закрыта</span><span>${printDateTime(report.closedAt)}</span></div>
<div class="row"><span>Длительность</span><span>${duration(report.openedAt, report.closedAt)}</span></div>
<div class="row"><span>Закрыл смену</span><span>${escapeHtml(report.closedByName)}</span></div>
${snapshotSections(report.snapshot, report.openingCash)}
<hr class="divider">
<p class="section">Сверка наличных</p>
<div class="row"><span>Ожидалось</span><span>${printMoney(report.snapshot.expectedCash)}</span></div>
<div class="row"><span>Пересчитано</span><span>${printMoney(report.countedCash)}</span></div>
<div class="row total"><span>РАСХОЖДЕНИЕ</span><span>${variance}</span></div>
<hr class="divider">
<p>Кассир ____________________</p>
<p>Менеджер ____________________</p>
<p class="footer strong">СМЕНА ЗАКРЫТА</p>`,
  )
}
