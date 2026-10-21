import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react"
import { useMemo } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { useCan, useCapabilities } from "@/office/components/can"
import { filterNavigationByCapabilities } from "@/office/model/nav-filter"
import { officeNavigation } from "@/office/model/navigation"
import { Banner, Button, DataTable, EmptyState, IconThumb, KpiCard, SegmentedControl, Skeleton, TonePill, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatPercent, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useOfficeFavorites } from "../../favorites/data/use-office-favorites"
import { favoriteTile, type FavoriteTile } from "../../favorites/model/favorites"
import { formatDelta, formatPeriod } from "../../reports/model/format"
import { filtersSearch } from "../../reports/model/url-state"
import { ReportChart } from "../../reports/ui/report-chart"
import { useDashboard, type DashboardData, type DashboardRestaurant } from "../data/use-dashboard"
import { DASHBOARD_PERIODS, isDashboardPeriod, periodRange, plural, quickAccessTiles, type DashboardPeriod } from "../model/dashboard"

// «Стартовая страница» (W1-ADM-05, OFFICE-DESIGN §3.7, parity office/01-dashboard.jpg): 4 KPI in a row with
// delta chips, revenue by day for 30 days as violet bars, «Рестораны сети» ranked by turnover with a share bar
// (a row opens «Выручка по дням» filtered by that restaurant — bahandi drops the filter) and «Быстрый доступ».
// The period lives in ?period= so F5 keeps it; today is the default. Cards sit on the lavender background
// (OfficePage layout "bare").

const DRILL_REPORT = "sales-01"
const QUICK_ACCESS_LIMIT = 8
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-8 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-title font-semibold text-foreground">Сеть Sandyq</h2>
          <p className="text-body-sm text-muted-foreground tabular-nums">{formatPeriod(range.from, range.to)}</p>
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
        <div role="status" aria-label="Загрузка стартовой страницы" aria-busy="true" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-32 rounded-card" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
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

/** The green «+12,5 %» / red «−4 %» chip beside a KPI number; `context` is read out where no caption says it. */
function DeltaBadge({ delta, context }: { delta: ReturnType<typeof formatDelta>; context?: string }) {
  if (!delta) return null
  const Icon = delta.tone === "danger" ? TrendingDown : TrendingUp
  return (
    <>
      <TonePill tone={delta.tone} className="gap-1 tabular-nums">
        {delta.tone === "neutral" ? null : <Icon aria-hidden className="size-3.5" />}
        {delta.percent}
      </TonePill>
      {context ? <span className="sr-only">{context}</span> : null}
    </>
  )
}

function DashboardContent({ data, onOpenRestaurant }: { data: DashboardData; onOpenRestaurant?: (row: DashboardRestaurant) => void }) {
  const delta = formatDelta(data.revenue, data.previousRevenue)
  const ordersDelta = formatDelta(data.orders, data.previousOrders)
  // The server sends the restaurants by turnover, so the rank is that order; the share is of their total.
  const ranking = useMemo(() => {
    const total = data.restaurants.reduce((sum, row) => sum + Math.max(0, row.turnover), 0)
    return new Map(data.restaurants.map((row, index) => [row.restaurantExternalId, { rank: index + 1, share: total > 0 ? Math.max(0, row.turnover) / total : null }]))
  }, [data.restaurants])
  const columns = useMemo<Column<DashboardRestaurant>[]>(
    () => [
      {
        key: "name",
        header: "Ресторан",
        cell: (row) => (
          <span className="flex items-center gap-3">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-round bg-accent-surface text-caption font-semibold text-accent tabular-nums">
              {ranking.get(row.restaurantExternalId)?.rank}
            </span>
            <span className="font-semibold text-foreground">{row.name}</span>
          </span>
        ),
        sortValue: (row) => row.name,
      },
      {
        key: "share",
        header: "Доля оборота",
        cell: (row) => <ShareBar share={ranking.get(row.restaurantExternalId)?.share ?? null} />,
        sortValue: (row) => ranking.get(row.restaurantExternalId)?.share ?? 0,
        className: "w-[28%] min-w-48",
      },
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
    [ranking],
  )

  return (
    <>
      {hasSales(data) ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Выручка" value={formatTenge(data.revenue)} badge={<DeltaBadge delta={delta} />} hint={delta ? "к прошлому периоду" : "Проведённые продажи"} />
            <KpiCard label="Оплачено заказов" value={formatAmount(data.orders)} badge={<DeltaBadge delta={ordersDelta} context="к прошлому периоду" />} hint={`Средний чек ${formatTenge(data.averageCheck)}`} />
            <KpiCard label="Проведено документов" value={formatAmount(data.postedDocuments)} hint={`${formatAmount(data.draftDocuments)} ${plural(data.draftDocuments, DRAFTS)}`} />
            <KpiCard
              label="Ошибки обмена"
              value={formatAmount(data.exchangeErrors)}
              hint={data.exchangeErrors ? "Проверьте очередь интеграций" : "Обмен работает штатно"}
              hintTone={data.exchangeErrors ? "danger" : "success"}
            />
          </div>
          <ReportChart title="Выручка за 30 дней" points={data.series} format={formatTenge} className="shadow-panel" />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {data.exchangeErrors ? (
            <Banner tone="danger" title={`Ошибки обмена: ${formatAmount(data.exchangeErrors)}`}>
              Проверьте очередь интеграций.
            </Banner>
          ) : null}
          <div className="rounded-card border border-border bg-card shadow-panel">
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
          className="shadow-panel"
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

/** «Быстрый доступ»: the user's «Избранное» in its order (W3-ADM-13); the first section per group while it is empty. */
function QuickAccess() {
  const capabilities = useCapabilities()
  const favorites = useOfficeFavorites()
  const tiles = useMemo<FavoriteTile[]>(() => {
    if (favorites === undefined) return []
    if (favorites.length) return favorites.slice(0, QUICK_ACCESS_LIMIT).map(favoriteTile)
    return quickAccessTiles(filterNavigationByCapabilities(officeNavigation, capabilities), QUICK_ACCESS_LIMIT).map(({ item, group }) => ({
      id: item.id,
      href: `/office/${item.id}`,
      caption: group.label,
      title: item.label,
      description: item.description,
      icon: group.icon,
    }))
  }, [favorites, capabilities])
  if (tiles.length === 0) return null

  return (
    <section aria-labelledby="dashboard-quick-access" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dashboard-quick-access" className="text-body font-semibold text-foreground">
          Быстрый доступ
        </h3>
        {favorites?.length ? (
          <Link to="/office/favorites" className={cn("text-body-sm text-accent underline-offset-4 hover:underline", focusRingClass)}>
            Всё избранное
          </Link>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <li key={tile.id}>
              <Link
                to={tile.href}
                className={cn("group flex h-full items-start gap-3 rounded-card border border-border bg-card p-4 shadow-panel transition-colors hover:border-accent/40", focusRingClass)}
              >
                <IconThumb icon={Icon} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-caption text-muted-foreground">{tile.caption}</span>
                  <span className="text-body-sm font-semibold text-foreground">{tile.title}</span>
                  {tile.description ? <span className="line-clamp-2 text-caption text-muted-foreground">{tile.description}</span> : null}
                </span>
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-accent" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A horizontal violet bar with the percent: the restaurant's share of the network turnover. */
function ShareBar({ share }: { share: number | null }) {
  if (share === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden className="h-2 min-w-0 flex-1 overflow-hidden rounded-round bg-muted">
        <span className="block h-full rounded-round bg-accent" style={{ width: `${Math.round(share * 1000) / 10}%` }} />
      </span>
      <span className="w-14 shrink-0 text-right font-medium tabular-nums">{formatPercent(share * 100)}</span>
    </span>
  )
}
