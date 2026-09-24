import { useMemo, useState } from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog"
import { cn, formatTenge } from "@/shared/lib/utils"

import { useReportsRestaurants, useSalesSummary, useShiftReports, type ReportsFilter, type ShiftReport } from "../data/use-office-reports"

const inputClass = "h-11 rounded-[var(--radius-control)] border border-border bg-background px-3 text-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus:border-primary/50"

const PAYMENT_LABEL: Record<string, string> = { cash: "Наличные", card: "Карта", qr: "QR" }

export function ReportsWorkspace() {
  const [tab, setTab] = useState<"sales" | "shifts">("sales")
  const restaurants = useReportsRestaurants()
  const [restaurantExternalId, setRestaurantExternalId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const filter: ReportsFilter = useMemo(
    () => ({ restaurantExternalId: restaurantExternalId || undefined, from: from || undefined, to: to || undefined }),
    [restaurantExternalId, from, to],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex gap-1 rounded-[var(--radius-control)] bg-muted p-1">
          <button type="button" onClick={() => setTab("sales")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "sales" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Продажи
          </button>
          <button type="button" onClick={() => setTab("shifts")} className={cn("rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-bold", tab === "shifts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            Кассовые отчёты
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={restaurantExternalId} onChange={(event) => setRestaurantExternalId(event.target.value)} className={cn(inputClass, "h-9 w-48")}>
            <option value="">Все филиалы</option>
            {restaurants.map((restaurant) => <option key={restaurant.externalId} value={restaurant.externalId}>{restaurant.name}</option>)}
          </select>
          {tab === "sales" ? (
            <>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={cn(inputClass, "h-9 w-40")} />
              <span className="text-sm text-muted-foreground">—</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={cn(inputClass, "h-9 w-40")} />
            </>
          ) : null}
        </div>
      </div>

      {tab === "sales" ? <SalesTab filter={filter} /> : <ShiftReportsTab restaurantExternalId={filter.restaurantExternalId} />}
    </div>
  )
}

function SalesTab({ filter }: { filter: ReportsFilter }) {
  const { summary, loading } = useSalesSummary(filter)
  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-3 gap-3 p-5">
        <SummaryCard label="Выручка" value={formatTenge(summary!.revenue)} />
        <SummaryCard label="Чеков" value={String(summary!.orderCount)} />
        <SummaryCard label="Средний чек" value={formatTenge(summary!.averageCheck)} />
      </div>

      <div className="grid grid-cols-2 gap-5 px-5 pb-5">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">По дням</p>
          <table className="w-full text-sm">
            <thead className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-1 text-left">Дата</th><th className="py-1 text-right">Чеков</th><th className="py-1 text-right">Выручка</th></tr>
            </thead>
            <tbody>
              {summary!.byDate.map((row) => (
                <tr key={row.date} className="border-t border-border/60">
                  <td className="py-1.5">{row.date}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.orders}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{formatTenge(row.revenue)}</td>
                </tr>
              ))}
              {!summary!.byDate.length && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Нет данных</td></tr>}
            </tbody>
          </table>

          <p className="mb-2 mt-5 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">По способу оплаты</p>
          <div className="flex flex-wrap gap-2">
            {summary!.byPaymentMethod.map((row) => (
              <div key={row.method} className="rounded-[var(--radius-card)] border border-border bg-card px-3 py-2 text-sm">
                <span className="font-semibold text-foreground">{PAYMENT_LABEL[row.method] ?? row.method}</span>{" "}
                <span className="tabular-nums text-accent">{formatTenge(row.amount)}</span>
              </div>
            ))}
            {!summary!.byPaymentMethod.length && <p className="text-sm text-muted-foreground">Нет данных</p>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Топ блюд</p>
          <table className="w-full text-sm">
            <thead className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-1 text-left">Блюдо</th><th className="py-1 text-right">Кол-во</th><th className="py-1 text-right">Выручка</th></tr>
            </thead>
            <tbody>
              {summary!.topProducts.map((row) => (
                <tr key={row.name} className="border-t border-border/60">
                  <td className="py-1.5 font-semibold text-foreground">{row.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{formatTenge(row.revenue)}</td>
                </tr>
              ))}
              {!summary!.topProducts.length && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ShiftReportsTab({ restaurantExternalId }: { restaurantExternalId?: string }) {
  const { reports, loading } = useShiftReports({ restaurantExternalId })
  const [selected, setSelected] = useState<ShiftReport | null>(null)
  if (loading) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Загрузка…</div>

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left">№</th>
            <th className="px-3 py-2 text-left">Дата</th>
            <th className="px-3 py-2 text-left">Филиал / касса</th>
            <th className="px-3 py-2 text-left">Кассир</th>
            <th className="px-3 py-2 text-right">Продажи</th>
            <th className="px-3 py-2 text-right">Возвраты</th>
            <th className="px-3 py-2 text-right">Чистыми</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report._id} className="border-t border-border/60 hover:bg-muted/40">
              <td className="px-5 py-2 font-semibold text-foreground">{report.reportNumber}</td>
              <td className="px-3 py-2 text-muted-foreground">{report.businessDate}</td>
              <td className="px-3 py-2">{report.restaurantName} · {report.terminalName}</td>
              <td className="px-3 py-2 text-muted-foreground">{report.generatedByName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTenge(report.sales)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-destructive">{report.refunds ? `-${formatTenge(report.refunds)}` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatTenge(report.netSales)}</td>
              <td className="px-3 py-2 text-right">
                <button type="button" onClick={() => setSelected(report)} className="rounded-[var(--radius-control)] px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-primary/10">Открыть</button>
              </td>
            </tr>
          ))}
          {!reports.length && <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">Отчётов пока нет</td></tr>}
        </tbody>
      </table>

      {selected ? <ShiftReportDialog report={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}

function ShiftReportDialog({ report, onClose }: { report: ShiftReport; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Отчёт {report.reportNumber}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {report.restaurantName} · {report.terminalName} · смена №{report.shiftNumber} · {report.businessDate}
        </p>
        <p className="text-sm text-muted-foreground">Открыл: {report.openedByName} · Сформировал: {report.generatedByName}</p>

        <div className="grid grid-cols-2 gap-3">
          <Row label="Валовые продажи" value={formatTenge(report.catalogGrossSales)} />
          <Row label="Скидки" value={`-${formatTenge(report.discounts)}`} />
          <Row label="Сервисный сбор" value={formatTenge(report.serviceCharge)} />
          <Row label="Продажи" value={formatTenge(report.sales)} />
          <Row label="Возвраты" value={`-${formatTenge(report.refunds)}`} />
          <Row label="Чистыми" value={formatTenge(report.netSales)} bold />
          <Row label="Средний чек" value={formatTenge(report.averageCheck)} />
          <Row label="Ожидаемая наличность" value={formatTenge(report.expectedCash)} />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">По способу оплаты</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {(["cash", "card", "qr"] as const).map((method) => (
              <div key={method} className="rounded-[var(--radius-card)] border border-border p-2">
                <p className="text-xs font-semibold text-muted-foreground">{PAYMENT_LABEL[method]}</p>
                <p className="font-semibold tabular-nums">{formatTenge(report.payments[method].net)}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Движение наличных</p>
          <p className="text-sm text-muted-foreground">
            Внесения: {formatTenge(report.cashMovements.cashIn)} ({report.cashMovements.cashInCount}) · Изъятия: {formatTenge(report.cashMovements.cashOut)} ({report.cashMovements.cashOutCount})
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl font-semibold tabular-nums text-accent">{value}</p>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", bold ? "font-semibold text-foreground" : "text-foreground")}>{value}</span>
    </div>
  )
}
