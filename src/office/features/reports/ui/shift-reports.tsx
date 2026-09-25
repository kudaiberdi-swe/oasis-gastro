import { useMemo, useState } from "react"

import { DataTable, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Select, type Column } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { useShiftReports, type ReportRestaurant, type ShiftReport } from "../data/use-reports"

// «Кассовые отчёты»: the X/Z-report history from the кассы. Stays in «Отчёты» until it moves to
// «Кассовые смены» (W1-RPT-03 «Файлы»).

const PAYMENT_LABEL: Record<string, string> = { cash: "Наличные", card: "Карта", qr: "QR" }
// Radix Select cannot hold "" as a value, so «Все филиалы» uses a sentinel that maps back to no filter.
const ALL_RESTAURANTS = "all"

const shiftColumns: Column<ShiftReport>[] = [
  { key: "number", header: "№", cell: (report) => <span className="font-semibold text-foreground tabular-nums">{report.reportNumber}</span> },
  { key: "date", header: "Дата", cell: (report) => <span className="text-muted-foreground tabular-nums">{report.businessDate}</span> },
  { key: "place", header: "Филиал / касса", cell: (report) => `${report.restaurantName} · ${report.terminalName}` },
  { key: "cashier", header: "Кассир", cell: (report) => <span className="text-muted-foreground">{report.generatedByName}</span> },
  { key: "sales", header: "Продажи", numeric: true, cell: (report) => formatTenge(report.sales) },
  {
    key: "refunds",
    header: "Возвраты",
    numeric: true,
    cell: (report) => (report.refunds ? <span className="text-destructive">{formatTenge(-report.refunds)}</span> : <span className="text-muted-foreground">—</span>),
  },
  { key: "net", header: "Чистыми", numeric: true, cell: (report) => <span className="font-semibold">{formatTenge(report.netSales)}</span> },
]

export function ShiftReportsTab({ restaurants }: { restaurants: ReportRestaurant[] | undefined }) {
  const [restaurantExternalId, setRestaurantExternalId] = useState("")
  const { reports, loading } = useShiftReports({ restaurantExternalId: restaurantExternalId || undefined })
  const [selected, setSelected] = useState<ShiftReport | null>(null)
  const options = useMemo(
    () => [{ value: ALL_RESTAURANTS, label: "Все филиалы" }, ...restaurantSelectOptions(restaurants ?? [])],
    [restaurants],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-4 xl:px-8">
      <Select
        aria-label="Филиал"
        value={restaurantExternalId || ALL_RESTAURANTS}
        onValueChange={(value) => setRestaurantExternalId(value === ALL_RESTAURANTS ? "" : value)}
        options={options}
        className="w-full sm:w-64"
      />
      <DataTable
        caption="Кассовые отчёты"
        columns={shiftColumns}
        rows={loading ? undefined : reports}
        getRowId={(report) => report._id}
        onRowClick={setSelected}
        selectedId={selected?._id ?? null}
        empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Отчётов пока нет</p>}
      />

      {selected ? <ShiftReportDialog report={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-body-sm font-semibold text-foreground">{children}</h3>
}

function ShiftReportDialog({ report, onClose }: { report: ShiftReport; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Отчёт {report.reportNumber}</DialogTitle>
          <DialogDescription>
            {report.restaurantName} · {report.terminalName} · смена №{report.shiftNumber} · {report.businessDate}
          </DialogDescription>
        </DialogHeader>
        <p className="text-body-sm text-muted-foreground">
          Открыл: {report.openedByName} · Сформировал: {report.generatedByName}
        </p>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Row label="Валовые продажи" value={formatTenge(report.catalogGrossSales)} />
          <Row label="Скидки" value={formatTenge(-report.discounts)} />
          <Row label="Сервисный сбор" value={formatTenge(report.serviceCharge)} />
          <Row label="Продажи" value={formatTenge(report.sales)} />
          <Row label="Возвраты" value={formatTenge(-report.refunds)} />
          <Row label="Чистыми" value={formatTenge(report.netSales)} bold />
          <Row label="Средний чек" value={formatTenge(report.averageCheck)} />
          <Row label="Ожидаемая наличность" value={formatTenge(report.expectedCash)} />
        </div>

        <section>
          <SectionTitle>По способу оплаты</SectionTitle>
          <div className="grid grid-cols-3 gap-2 text-body-sm">
            {(["cash", "card", "qr"] as const).map((method) => (
              <div key={method} className="rounded-card border border-border p-2">
                <p className="text-caption font-medium text-muted-foreground">{PAYMENT_LABEL[method]}</p>
                <p className="font-semibold tabular-nums">{formatTenge(report.payments[method].net)}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Движение наличных</SectionTitle>
          <p className="text-body-sm text-muted-foreground">
            Внесения: {formatTenge(report.cashMovements.cashIn)} ({report.cashMovements.cashInCount}) · Изъятия: {formatTenge(report.cashMovements.cashOut)} ({report.cashMovements.cashOutCount})
          </p>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-body-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("whitespace-nowrap tabular-nums text-foreground", bold && "font-semibold")}>{value}</span>
    </div>
  )
}
