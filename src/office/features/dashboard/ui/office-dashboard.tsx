import { ChevronRight } from "lucide-react"
import { useMemo } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { useCan, useCapabilities } from "@/office/components/can"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { officeNavigation } from "@/office/model/navigation"
import { Banner, Button, DataTable, EmptyState, KpiCard, SegmentedControl, Skeleton, TonePill, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { formatDelta, formatPeriod } from "../../reports/model/format"
import { filtersSearch } from "../../reports/model/url-state"
import { ReportChart } from "../../reports/ui/report-chart"
import { useDashboard, type DashboardData, type DashboardRestaurant } from "../data/use-dashboard"
import { DASHBOARD_PERIODS, isDashboardPeriod, periodRange, plural, quickAccessTiles, type DashboardPeriod } from "../model/dashboard"

// «Стартовая страница» (W1-ADM-05, OFFICE-DESIGN §3.7, parity office/01-dashboard.jpg): 4 KPI in a row,
// revenue by day for 30 days, «Рестораны сети» (a row opens «Выручка по дням» filtered by that restaurant —
// bahandi drops the filter) and «Быстрый доступ». The period lives in ?period= so F5 keeps it; today is the default.

const DRILL_REPORT = "sales-01"
const DOCUMENTS: [string, string, string] = ["документ", "документа", "документов"]
const DRAFTS: [string, string, string] = ["черновик", "черновика", "черновиков"]

export function DashboardWorkspace() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const canOpenReports = useCan("office.reports.view")
  const raw = params.get("period")
  const period: DashboardPeriod = isDashboardPeriod(raw) ? raw : "today"
  // Recomputed when the preset changes; the business day rolls over on the next change or reload.
  const range = useMemo(() => periodRange(period), [period])
  const { data, error, loading, retry } = useDashboard(range)

  const changePeriod = (next: DashboardPeriod) => {
    const search = new URLSearchParams(params)
    if (next === "today") search.delete("period")
    else search.set("period", next)
    setParams(search, { replace: true })
  }

  const openRestaurant = (row: DashboardRestaurant) => {
    navigate({
      pathname: `/office/reports/${DRILL_REPORT}`,
      search: filtersSearch({ dateFrom: range.from, dateTo: range.to, restaurantExternalIds: [row.restaurantExternalId], search: "" }),
    })
  }

  const periodLabel = DASHBOARD_PERIODS.find((preset) => preset.value === period)?.label ?? ""

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-title-sm text-accent italic">{periodLabel.toLocaleLowerCase("ru")}</p>
          <h2 className="font-display text-title font-semibold text-foreground">Сеть Sandyq</h2>
          <p className="text-body-sm text-muted-foreground">{formatPeriod(range.from, range.to)}</p>
        </div>
        <SegmentedControl
          aria-label="Период"
          value={period}
          onValueChange={changePeriod}
          options={DASHBOARD_PERIODS.map((preset) => ({ value: preset.value, label: preset.label }))}
        />
      </div>

      {error ? (
        <Banner
          tone="danger"
          title="Не удалось загрузить стартовую страницу"
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Banner>
      ) : loading || !data ? (
        <div role="status" aria-label="Загрузка стартовой страницы" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <DashboardContent data={data} onOpenRestaurant={canOpenReports ? openRestaurant : undefined} />
      )}

      <QuickAccess />
    </div>
  )
}

function hasSales(data: DashboardData) {
  return data.orders > 0 || data.previousOrders > 0 || data.revenue !== 0 || data.series.some((point) => point.value !== 0)
}

function DashboardContent({ data, onOpenRestaurant }: { data: DashboardData; onOpenRestaurant?: (row: DashboardRestaurant) => void }) {
  const delta = formatDelta(data.revenue, data.previousRevenue)
  const columns = useMemo<Column<DashboardRestaurant>[]>(
    () => [
      { key: "name", header: "Ресторан", cell: (row) => <span className="font-semibold text-foreground">{row.name}</span>, sortValue: (row) => row.name },
      { key: "documents", header: "Документы", numeric: true, cell: (row) => `${formatAmount(row.documents)} ${plural(row.documents, DOCUMENTS)}`, sortValue: (row) => row.documents },
      { key: "orders", header: "Заказов", numeric: true, cell: (row) => formatAmount(row.orders), sortValue: (row) => row.orders },
      { key: "turnover", header: "Оборот", numeric: true, cell: (row) => <span className="font-semibold">{formatTenge(row.turnover)}</span>, sortValue: (row) => row.turnover },
      {
        key: "status",
        header: "Статус",
        cell: (row) => (row.status === "working" ? <TonePill tone="success">Работает</TonePill> : <TonePill>Нет смен</TonePill>),
        sortValue: (row) => row.status,
      },
    ],
    [],
  )

  return (
    <>
      {hasSales(data) ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Выручка" value={formatTenge(data.revenue)} hint={delta?.text ?? "Проведённые продажи"} hintTone={delta?.tone ?? "neutral"} />
            <KpiCard label="Оплачено заказов" value={formatAmount(data.orders)} hint={`Средний чек ${formatTenge(data.averageCheck)}`} />
            <KpiCard label="Проведено документов" value={formatAmount(data.postedDocuments)} hint={`${formatAmount(data.draftDocuments)} ${plural(data.draftDocuments, DRAFTS)}`} />
            <KpiCard
              label="Ошибки обмена"
              value={formatAmount(data.exchangeErrors)}
              hint={data.exchangeErrors ? "Проверьте очередь интеграций" : "Обмен работает штатно"}
              hintTone={data.exchangeErrors ? "danger" : "success"}
            />
          </div>
          <ReportChart title="Выручка за 30 дней" points={data.series} format={formatTenge} />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {data.exchangeErrors ? (
            <Banner tone="danger" title={`Ошибки обмена: ${formatAmount(data.exchangeErrors)}`}>
              Проверьте очередь интеграций.
            </Banner>
          ) : null}
          <div className="rounded-card border border-border bg-card">
            <EmptyState title="Продаж пока нет" description="Выручка, заказы и график появятся после первой продажи на кассе." />
          </div>
        </div>
      )}

      <section aria-labelledby="dashboard-restaurants" className="flex flex-col gap-2">
        <div className="flex flex-col">
          <h3 id="dashboard-restaurants" className="text-body font-semibold text-foreground">
            Рестораны сети
          </h3>
          <p className="text-body-sm text-muted-foreground">Сводка документов и оборота</p>
        </div>
        <DataTable
          caption="Рестораны сети"
          columns={columns}
          rows={data.restaurants}
          getRowId={(row) => row.restaurantExternalId}
          onRowClick={onOpenRestaurant}
          empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Нет ресторанов в вашей области доступа</p>}
        />
      </section>
    </>
  )
}

function QuickAccess() {
  const capabilities = useCapabilities()
  const tiles = useMemo(() => quickAccessTiles(filterNavigationByCapabilities(officeNavigation, capabilities)), [capabilities])
  if (tiles.length === 0) return null

  return (
    <section aria-labelledby="dashboard-quick-access" className="flex flex-col gap-2">
      <h3 id="dashboard-quick-access" className="text-body font-semibold text-foreground">
        Быстрый доступ
      </h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ item, group }) => {
          const Icon = group.icon
          return (
            <li key={item.id}>
              <Link
                to={`/office/${item.id}`}
                className={cn("group flex h-full items-start gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:border-accent/40 hover:bg-muted", focusRingClass)}
              >
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-caption text-muted-foreground">{group.label}</span>
                  <span className="text-body-sm font-semibold text-foreground">{item.label}</span>
                  <span className="line-clamp-2 text-caption text-muted-foreground">{item.description}</span>
                </span>
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
