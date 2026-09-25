import { useMemo } from "react"
import { useNavigate } from "react-router"

import { Banner, Button, DataTable, KpiCard, Skeleton, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatPercent, formatTenge } from "@/shared/lib/format"

import { useDashboardSummary, type DashboardSummary, type ReportCoverage, type ReportRestaurant } from "../data/use-reports"
import { formatDelta, formatPeriod } from "../model/format"
import { filtersSearch, periodError, type ReportFilters } from "../model/url-state"
import { ReportChart } from "./report-chart"
import { ReportFiltersBar } from "./report-filters"

// «Сводка продаж» (was «Продажи» on salesSummary, W1-RPT-02): dashboardSummary from the dailySalesFacts
// pre-aggregate — net revenue minus refunds, orders, average check, a series by day and the restaurants
// table. A restaurant row opens «Выручка по дням» filtered by that restaurant (OFFICE-DESIGN §3.7).

type RestaurantRow = DashboardSummary["restaurants"][number]

const DRILL_REPORT = "sales-01"

export function SalesOverview({
  filters,
  onFiltersChange,
  restaurants,
  coverage,
}: {
  filters: ReportFilters
  onFiltersChange: (next: ReportFilters) => void
  restaurants: ReportRestaurant[] | undefined
  coverage: ReportCoverage | undefined
}) {
  const navigate = useNavigate()
  const invalid = periodError(filters)
  const args = useMemo(
    () => (invalid ? null : { restaurantExternalIds: filters.restaurantExternalIds, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
    [invalid, filters.restaurantExternalIds, filters.dateFrom, filters.dateTo],
  )
  const { data: summary, error, loading, retry } = useDashboardSummary(args)
  const canDrill = coverage?.implementedIds.includes(DRILL_REPORT) ?? false

  const columns = useMemo<Column<RestaurantRow>[]>(() => {
    const total = summary?.revenue ?? 0
    return [
      { key: "name", header: "Ресторан", cell: (row) => <span className="font-semibold text-foreground">{row.name}</span>, sortValue: (row) => row.name },
      { key: "orders", header: "Заказов", numeric: true, cell: (row) => formatAmount(row.orders), sortValue: (row) => row.orders },
      { key: "net", header: "Выручка", numeric: true, cell: (row) => <span className="font-semibold">{formatTenge(row.net)}</span>, sortValue: (row) => row.net },
      { key: "share", header: "Доля", numeric: true, cell: (row) => (total > 0 ? formatPercent((row.net / total) * 100) : "—"), sortValue: (row) => row.net },
    ]
  }, [summary?.revenue])

  const openRestaurant = (row: RestaurantRow) => {
    navigate({ pathname: `/office/reports/${DRILL_REPORT}`, search: filtersSearch({ ...filters, restaurantExternalIds: [row.externalId], search: "" }) })
  }

  const delta = summary ? formatDelta(summary.revenue, summary.previousRevenue) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <ReportFiltersBar filters={filters} onChange={onFiltersChange} restaurants={restaurants} />
      {invalid ? (
        <Banner tone="warning" title="Проверьте период">
          {invalid}
        </Banner>
      ) : error ? (
        <Banner
          tone="danger"
          title="Не удалось загрузить сводку"
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Banner>
      ) : loading || !summary ? (
        <div role="status" aria-label="Загрузка сводки" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Выручка" value={formatTenge(summary.revenue)} hint={delta?.text ?? `Прошлый период: ${formatTenge(summary.previousRevenue)}`} hintTone={delta?.tone ?? "neutral"} />
            <KpiCard label="Оплачено заказов" value={formatAmount(summary.orders)} hint={formatPeriod(filters.dateFrom, filters.dateTo)} />
            <KpiCard label="Средний чек" value={formatTenge(summary.averageCheck)} hint="Продажи до возвратов ÷ заказы" />
            <KpiCard label="Возвраты" value={formatTenge(summary.refunds ? -summary.refunds : 0)} hint={`Продажи до возвратов: ${formatTenge(summary.grossRevenue)}`} hintTone={summary.refunds ? "danger" : "neutral"} />
          </div>
          <ReportChart title="Выручка по дням" points={summary.series} format={formatTenge} />
          <section className="flex flex-col gap-2">
            <h3 className="text-body-sm font-semibold text-foreground">Рестораны сети</h3>
            <DataTable
              caption="Рестораны сети"
              columns={columns}
              rows={summary.restaurants}
              getRowId={(row) => row.externalId}
              onRowClick={canDrill ? openRestaurant : undefined}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">За выбранный период продаж нет</p>}
            />
          </section>
        </>
      )}
    </div>
  )
}
