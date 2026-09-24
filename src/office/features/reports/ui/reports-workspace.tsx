import { useMemo, useState } from "react"

import {
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  KpiCard,
  Money,
  SegmentedControl,
  Select,
  SkeletonRows,
  type Column,
} from "@/shared/components/ui"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useReportsRestaurants, useSalesSummary, useShiftReports, type ReportsFilter, type ShiftReport } from "../data/use-office-reports"

const PAYMENT_LABEL: Record<string, string> = { cash: "Наличные", card: "Карта", qr: "QR" }

// Radix Select cannot hold "" as a value, so «Все филиалы» uses a sentinel that maps back to no filter.
const ALL_RESTAURANTS = "all"

type SalesSummary = NonNullable<ReturnType<typeof useSalesSummary>["summary"]>
type DateRow = SalesSummary["byDate"][number]
type ProductRow = SalesSummary["topProducts"][number]

const EMPTY = <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">Нет данных</p>

const dateColumns: Column<DateRow>[] = [
  { key: "date", header: "Дата", cell: (row) => <span className="tabular-nums">{row.date}</span> },
  { key: "orders", header: "Чеков", numeric: true, cell: (row) => formatQuantity(row.orders) },
  { key: "revenue", header: "Выручка", numeric: true, cell: (row) => <span className="font-semibold">{formatTenge(row.revenue)}</span> },
]

const productColumns: Column<ProductRow>[] = [
  { key: "name", header: "Блюдо", cell: (row) => <span className="font-semibold text-foreground">{row.name}</span> },
  { key: "quantity", header: "Кол-во", numeric: true, cell: (row) => formatQuantity(row.quantity) },
  { key: "revenue", header: "Выручка", numeric: true, cell: (row) => <span className="font-semibold">{formatTenge(row.revenue)}</span> },
]

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

  const restaurantOptions = useMemo(
    () => [{ value: ALL_RESTAURANTS, label: "Все филиалы" }, ...restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))],
    [restaurants],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3 xl:px-8">
        <SegmentedControl
          aria-label="Вид отчёта"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "sales", label: "Продажи" },
            { value: "shifts", label: "Кассовые отчёты" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Филиал"
            value={restaurantExternalId || ALL_RESTAURANTS}
            onValueChange={(value) => setRestaurantExternalId(value === ALL_RESTAURANTS ? "" : value)}
            options={restaurantOptions}
            className="w-56"
          />
          {tab === "sales" ? (
            <>
              <Input type="date" aria-label="Период с" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" />
              <span aria-hidden className="text-body-sm text-muted-foreground">
                —
              </span>
              <Input type="date" aria-label="Период по" value={to} onChange={(event) => setTo(event.target.value)} className="w-40" />
            </>
          ) : null}
        </div>
      </div>

      {tab === "sales" ? <SalesTab filter={filter} /> : <ShiftReportsTab restaurantExternalId={filter.restaurantExternalId} />}
    </div>
  )
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("mb-2 text-body-sm font-semibold text-foreground", className)}>{children}</h3>
}

function SalesTab({ filter }: { filter: ReportsFilter }) {
  const { summary, loading } = useSalesSummary(filter)
  if (loading || !summary) return <SkeletonRows className="px-6 py-4 xl:px-8" />

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 xl:px-8">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Выручка" value={formatTenge(summary.revenue)} />
        <KpiCard label="Чеков" value={formatQuantity(summary.orderCount)} />
        <KpiCard label="Средний чек" value={formatTenge(summary.averageCheck)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <div>
          <SectionTitle>По дням</SectionTitle>
          <DataTable caption="Продажи по дням" columns={dateColumns} rows={summary.byDate} getRowId={(row) => row.date} empty={EMPTY} />

          <SectionTitle className="mt-5">По способу оплаты</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {summary.byPaymentMethod.map((row) => (
              <div key={row.method} className="flex items-baseline gap-2 rounded-card border border-border bg-card px-3 py-2 text-body-sm">
                <span className="font-semibold text-foreground">{PAYMENT_LABEL[row.method] ?? row.method}</span>
                <Money value={row.amount} size="sm" />
              </div>
            ))}
            {!summary.byPaymentMethod.length && <p className="text-body-sm text-muted-foreground">Нет данных</p>}
          </div>
        </div>

        <div>
          <SectionTitle>Топ блюд</SectionTitle>
          <DataTable caption="Топ блюд" columns={productColumns} rows={summary.topProducts} getRowId={(row) => row.name} empty={EMPTY} />
        </div>
      </div>
    </div>
  )
}

function ShiftReportsTab({ restaurantExternalId }: { restaurantExternalId?: string }) {
  const { reports, loading } = useShiftReports({ restaurantExternalId })
  const [selected, setSelected] = useState<ShiftReport | null>(null)

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-4 xl:px-8">
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
