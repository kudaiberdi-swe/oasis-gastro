import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useMemo } from "react"

import { buildOrderReceiptHtml, itemsWord, type OrderReceiptData } from "@/pos/features/checkout/model/order-receipt"
import { printDateTime, printPage } from "@/pos/features/print/print-document"
import { buildXReportHtml, duration, METHOD_LABEL, ROLE_LABEL, type ShiftReportSnapshot, type XReportData } from "@/pos/features/shifts/model/x-report"
import { buildZReportHtml, type ZReportData } from "@/pos/features/shifts/model/z-report"
import { formatTenge } from "@/shared/lib/format"

import { api } from "@convex/_generated/api"
import { printLinesHtml, renderPrintTemplate, type PrintData, type PrintDocumentType } from "@convex/lib/printTemplate"

// Printing by the office's published templates (W3-ADM-10): the check, pre-check, X and Z. The data of a
// form becomes the template's placeholders (money already as «7 990 ₸»); without a published template,
// or with one that no longer validates, the built-in form prints as before — printing never fails on a template.

export type TerminalSettings = FunctionReturnType<typeof api.domains.pos.queries.terminalSettings>
type ActiveTemplate = NonNullable<TerminalSettings["printTemplates"]["receipt"]>
type Place = { organizationName?: string; restaurantAddress?: string }

const money = (value: number) => formatTenge(value)

export function orderTemplateData(receipt: OrderReceiptData, place: Place = {}): PrintData {
  const count = receipt.lines.reduce((sum, line) => sum + line.quantity, 0)
  const payments = receipt.payments ?? []
  return {
    organization: { name: place.organizationName ?? "" },
    restaurant: { name: receipt.restaurantName, address: place.restaurantAddress ?? "" },
    terminal: { name: receipt.terminalName },
    cashier: { name: receipt.operatorName },
    order: {
      number: receipt.orderNumber ?? "",
      table: receipt.tableLabel ?? "",
      hall: receipt.hallLabel ?? "",
      type: receipt.orderTypeName ?? "",
      itemsCount: `${count} ${itemsWord(count)}`,
      createdAt: printDateTime(receipt.createdAt),
      paidAt: receipt.paidAt ? printDateTime(receipt.paidAt) : "",
      status: receipt.statusLabel ?? "",
      comment: receipt.comment?.trim() ?? "",
    },
    lines: receipt.lines.map((line) => ({ name: line.name, quantity: line.quantity, amount: money(line.amount), details: line.details ?? "" })),
    totals: {
      subtotal: money(receipt.subtotal),
      hasDiscount: receipt.discountAmount > 0,
      discount: money(-receipt.discountAmount),
      discountLabel: receipt.discountLabel || "Скидка",
      hasServiceCharge: receipt.serviceChargeAmount > 0,
      serviceChargePercent: receipt.serviceChargePercent,
      serviceCharge: money(receipt.serviceChargeAmount),
      total: money(receipt.total),
      hasPayments: payments.length > 0,
    },
    payments: payments.map((payment) => {
      const hasChange = payment.tendered != null && payment.tendered > payment.amount
      return {
        name: payment.name,
        amount: `${payment.refund ? "− " : ""}${money(payment.amount)}`,
        refund: Boolean(payment.refund),
        hasChange,
        tendered: hasChange ? money(payment.tendered!) : "",
        change: hasChange ? money(payment.change ?? payment.tendered! - payment.amount) : "",
      }
    }),
  }
}

function shiftTemplateData(snapshot: ShiftReportSnapshot, openingCash: number) {
  return {
    sales: {
      menuTotal: money(snapshot.catalogGrossSales),
      discounts: money(-snapshot.discounts),
      discountedOrders: snapshot.orderCounts.discounted,
      serviceCharge: money(snapshot.serviceCharge),
      payments: money(snapshot.sales),
      paymentOrders: snapshot.saleOrderCount,
      refunds: money(-snapshot.refunds),
      refundOrders: snapshot.refundOrderCount,
      net: money(snapshot.netSales),
      averageCheck: money(snapshot.averageCheck),
    },
    methods: (["cash", "card", "qr"] as const).map((method) => {
      const item = snapshot.payments[method]
      return { name: METHOD_LABEL[method], net: money(item.net), sales: money(item.sales), saleCount: item.saleCount, refunds: money(-item.refunds), refundCount: item.refundCount }
    }),
    cash: {
      opening: money(openingCash),
      sales: money(snapshot.payments.cash.sales),
      refunds: money(-snapshot.payments.cash.refunds),
      in: money(snapshot.cashMovements.cashIn),
      inCount: snapshot.cashMovements.cashInCount,
      out: money(-snapshot.cashMovements.cashOut),
      outCount: snapshot.cashMovements.cashOutCount,
      expected: money(snapshot.expectedCash),
    },
    orders: {
      paid: snapshot.orderCounts.paid,
      partiallyRefunded: snapshot.orderCounts.partiallyRefunded,
      refunded: snapshot.orderCounts.refunded,
      cancelled: snapshot.orderCounts.cancelled,
      cancelledAmount: money(snapshot.cancelledAmount),
      open: snapshot.openOrders.count,
      openTotal: money(snapshot.openOrders.total),
      held: snapshot.heldOrders.count,
      heldTotal: money(snapshot.heldOrders.total),
      unfinished: snapshot.openOrders.count + snapshot.heldOrders.count,
      hasUnfinished: snapshot.openOrders.count + snapshot.heldOrders.count > 0,
    },
  }
}

export function xReportTemplateData(report: XReportData, place: Place = {}): PrintData {
  return {
    organization: { name: place.organizationName ?? "" },
    restaurant: { name: report.restaurantName, address: report.restaurantAddress ?? place.restaurantAddress ?? "" },
    terminal: { name: report.terminalName },
    report: { number: report.reportNumber, sequence: report.sequence, generatedAt: printDateTime(report.generatedAt), operator: `${report.generatedByName} · ${ROLE_LABEL[report.generatedByRole] ?? ""}` },
    shift: { number: report.shiftNumber, businessDate: report.businessDate, openedAt: printDateTime(report.openedAt), duration: duration(report.openedAt, report.generatedAt), openedBy: report.openedByName },
    ...shiftTemplateData(report, report.openingCash),
  }
}

export function zReportTemplateData(report: ZReportData, place: { restaurantName: string; terminalName: string } & Place): PrintData {
  const shift = shiftTemplateData(report.snapshot, report.openingCash)
  const variance = report.variance === 0 ? money(0) : `${report.variance > 0 ? "+" : ""}${money(report.variance)}`
  return {
    organization: { name: place.organizationName ?? "" },
    restaurant: { name: place.restaurantName, address: place.restaurantAddress ?? "" },
    terminal: { name: place.terminalName },
    report: { number: report.number },
    shift: { number: report.shiftNumber, businessDate: report.businessDate, openedAt: printDateTime(report.openedAt), closedAt: printDateTime(report.closedAt), duration: duration(report.openedAt, report.closedAt), openedBy: "", closedBy: report.closedByName },
    ...shift,
    cash: { ...shift.cash, counted: money(report.countedCash), variance },
  }
}

/** The print form of a published template, or null when there is none or it does not validate. */
export function templateHtml(template: ActiveTemplate | null | undefined, type: PrintDocumentType, title: string, data: PrintData) {
  if (!template) return null
  const { lines, errors } = renderPrintTemplate(template.template, type, data)
  if (errors.length) return null
  return printPage(title, printLinesHtml(lines), { widthMm: template.widthMm, copies: template.copies })
}

/**
 * The terminal's print forms: each builds the HTML by the published template of its type and falls back
 * to the built-in form (W1-POS-15/19) while the office has none.
 */
export function usePosPrinter(sessionToken: string) {
  const settings = useQuery(api.domains.pos.queries.terminalSettings, { sessionToken })
  return useMemo(() => {
    const templates = settings?.printTemplates
    const place = { organizationName: settings?.organizationName, restaurantAddress: settings?.restaurantAddress }
    return {
      order: (receipt: OrderReceiptData) => {
        const title = receipt.kind === "precheck" ? `Предчек${receipt.orderNumber ? ` №${receipt.orderNumber}` : ""}` : `Чек №${receipt.orderNumber ?? ""}`
        return templateHtml(templates?.[receipt.kind], receipt.kind, title, orderTemplateData(receipt, place)) ?? buildOrderReceiptHtml(receipt)
      },
      xReport: (report: XReportData) => templateHtml(templates?.["x-report"], "x-report", `${report.reportNumber} · X-отчёт`, xReportTemplateData(report, place)) ?? buildXReportHtml(report),
      zReport: (report: ZReportData, where: { restaurantName: string; terminalName: string }) =>
        templateHtml(templates?.["z-report"], "z-report", `${report.number} · Z-отчёт`, zReportTemplateData(report, { ...where, ...place })) ?? buildZReportHtml(report, where),
    }
  }, [settings])
}
