import { ArrowLeft, Download } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"

import { Banner, Button, EmptyState, Skeleton, SkeletonRows, TonePill } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useReportResult, type ReportConfig, type ReportCoverage, type ReportRestaurant, type ReportResult } from "../data/use-reports"
import { findCatalogReport, isMechanicDisabled, isNotApplicableKz, type ReportDefinition } from "../model/catalog"
import { EXPORT_MIME, exportFileName, toCsv, toXlsx, type ExportMeta } from "../model/export"
import { formatGeneratedAt, formatReportValue } from "../model/format"
import { configFromFilters, periodError, type ReportFilters } from "../model/url-state"
import { ReportChart } from "./report-chart"
import { FavoriteButton } from "./save-view-dialog"
import { ReportFiltersBar } from "./report-filters"
import { ReportKpis, ReportTable } from "./report-table"
import { ScheduleButton } from "./schedule-dialog"

// Report viewer (W1-RPT-03): title and description, the toolbar on its own row under the title (L-16),
// filters, KPI, a chart for day series, the table with «Итого», the source footer. Toolbar: favorites,
// CSV/XLSX export and «Рассылка» (W2-RPT-06, only for implemented reports). A report that is not
// implemented yet opens with an honest empty state and never calls `execute`.

type ViewerProps = {
  reportId: string
  coverage: ReportCoverage | undefined
  filters: ReportFilters
  onFiltersChange: (next: ReportFilters) => void
  restaurants: ReportRestaurant[] | undefined
  backSearch: string
  /** Opened from «Избранные отчёты»: the saved view's name, shown above the title. */
  viewName?: string
  backPath?: string
  backLabel?: string
}

export function ReportViewer({ reportId, coverage, filters, onFiltersChange, restaurants, backSearch, viewName, backPath = "/office/reports", backLabel = "Все отчёты" }: ViewerProps) {
  const report = findCatalogReport(reportId)
  const back = (
    <Link to={{ pathname: backPath, search: backSearch }} className="inline-flex items-center gap-1 text-body-sm text-accent hover:underline lg:hidden">
      <ArrowLeft aria-hidden className="size-4" /> {backLabel}
    </Link>
  )

  if (!report) {
    return (
      <div className="flex flex-col gap-4 px-6 py-5 xl:px-8">
        {back}
        <EmptyState
          size="lg"
          title="Отчёт не найден"
          description={`В каталоге нет отчёта «${reportId}». Выберите отчёт из списка.`}
          action={
            <Button asChild variant="secondary">
              <Link to={{ pathname: "/office/reports", search: backSearch }}>К каталогу</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const implemented = coverage ? coverage.implementedIds.includes(report.id) : undefined
  // A report of a mechanic that does not apply (KZ) or is off (Г-11) shows its status, never an empty table.
  const unavailable = isNotApplicableKz(report) || isMechanicDisabled(report)
  return (
    <div className="flex flex-col gap-4 px-6 py-5 xl:px-8">
      {back}
      <ViewerHeader report={report} implemented={implemented} viewName={viewName} />
      {unavailable ? (
        <NotImplemented report={report} />
      ) : implemented === undefined ? (
        <div role="status" aria-label="Загрузка" className="flex flex-col gap-3">
          <Skeleton className="h-11 w-full max-w-xl" />
          <SkeletonRows rows={6} />
        </div>
      ) : implemented ? (
        <ReportBody report={report} filters={filters} onFiltersChange={onFiltersChange} restaurants={restaurants} />
      ) : (
        <NotImplemented report={report} />
      )}
    </div>
  )
}

function ViewerHeader({ report, implemented, viewName }: { report: ReportDefinition; implemented: boolean | undefined; viewName?: string }) {
  return (
    <header className="flex flex-col gap-2">
      {viewName && viewName !== report.title ? <p className="text-caption font-medium text-accent">Представление «{viewName}»</p> : null}
      <h2 className="font-display text-title font-semibold text-foreground">{report.title}</h2>
      <p className="text-body-sm text-muted-foreground">{report.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {implemented === undefined || isNotApplicableKz(report) || isMechanicDisabled(report) ? null : implemented ? <TonePill tone="success">Готов</TonePill> : <TonePill>В разработке</TonePill>}
        <TonePill>{report.familyLabel}</TonePill>
        {report.configurable ? <TonePill tone="info">OLAP</TonePill> : null}
        {isNotApplicableKz(report) ? <TonePill tone="warning">Не применяется в РК</TonePill> : null}
        {isMechanicDisabled(report) ? <TonePill tone="warning">Механика выключена</TonePill> : null}
      </div>
    </header>
  )
}

function NotImplemented({ report }: { report: ReportDefinition }) {
  if (isNotApplicableKz(report)) {
    return (
      <EmptyState
        size="lg"
        title="Не применяется в Казахстане"
        description="Отчёт относится к механике, которой нет в РК (например, ЕГАИС). Он оставлен в каталоге для полноты и не рассчитывается."
      />
    )
  }
  if (isMechanicDisabled(report)) {
    return (
      <EmptyState
        size="lg"
        title="Недоступно: механика выключена"
        description="Сертификаты, купоны, реферальная программа и корпоративные клиенты в Sandyq не используются (решение владельца). Отчёт оставлен в каталоге для полноты и не рассчитывается."
      />
    )
  }
  return (
    <EmptyState
      size="lg"
      title="Отчёт в разработке"
      description={`Расчёт появится в волне ${report.wave}. Пока отчёт не считается, поэтому мы не показываем нули вместо данных.`}
    />
  )
}

function ReportBody({ report, filters, onFiltersChange, restaurants }: { report: ReportDefinition; filters: ReportFilters; onFiltersChange: (next: ReportFilters) => void; restaurants: ReportRestaurant[] | undefined }) {
  const invalid = periodError(filters)
  const config = useMemo<ReportConfig | null>(() => (invalid ? null : configFromFilters(filters)), [invalid, filters])
  const { data: result, error, loading, retry } = useReportResult(report.id, config)
  const meta: ExportMeta = {
    title: report.title,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    restaurants: filters.restaurantExternalIds.map((id) => restaurants?.find((restaurant) => restaurant.externalId === id)?.name ?? id),
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Действия с отчётом">
        <FavoriteButton report={report} config={config} />
        <Button variant="secondary" size="sm" disabled={!result} onClick={() => result && download(result, meta, "csv")}>
          <Download aria-hidden />
          Экспорт CSV
        </Button>
        <Button variant="secondary" size="sm" disabled={!result} onClick={() => result && download(result, meta, "xlsx")}>
          <Download aria-hidden />
          Экспорт XLSX
        </Button>
        <ScheduleButton report={report} config={config} />
      </div>
      <ReportFiltersBar filters={filters} onChange={onFiltersChange} restaurants={restaurants} withSearch />
      {invalid ? (
        <Banner tone="warning" title="Проверьте период">
          {invalid}
        </Banner>
      ) : error ? (
        <Banner
          tone="danger"
          title="Не удалось сформировать отчёт"
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Banner>
      ) : loading || !result ? (
        <div role="status" aria-label="Загрузка отчёта" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <ReportResultView report={report} result={result} />
      )}
    </>
  )
}

function ReportResultView({ report, result }: { report: ReportDefinition; result: ReportResult }) {
  const chart = useMemo(() => daySeries(result), [result])
  if (result.unavailable) {
    // The data source is not connected yet (e.g. telephony): an honest state instead of zeros.
    return (
      <>
        <EmptyState size="lg" title={result.unavailable.title} description={result.unavailable.description} />
        <p className="text-caption text-muted-foreground">
          Источник: {result.sourceLabel} · проверено {formatGeneratedAt(result.generatedAt)}
        </p>
      </>
    )
  }
  return (
    <>
      {result.truncated ? (
        <Banner tone="warning" title="Период слишком большой">
          Показаны первые {result.rows.length} строк: расчёт остановился на лимите записей. Сузьте период или выберите меньше ресторанов.
        </Banner>
      ) : null}
      <ReportKpis kpis={result.kpis} />
      {chart ? <ReportChart title={`${chart.label} по дням`} points={chart.points} format={(value) => formatReportValue(value, "money")} /> : null}
      <ReportTable result={result} caption={report.title} />
      <p className="text-caption text-muted-foreground">
        Источник: {result.sourceLabel} · сформировано {formatGeneratedAt(result.generatedAt)}
      </p>
    </>
  )
}

/** A chart only for day series: the first column is a date and there is a money column (the revenue one first). */
function daySeries(result: ReportResult) {
  const [first] = result.columns
  if (!first || first.unit !== "date" || result.rows.length < 2) return null
  const measure = result.columns.find((column) => column.key === "netAmount") ?? result.columns.find((column) => column.unit === "money")
  if (!measure) return null
  const points = result.rows
    .map((row) => ({ date: String(row.cells[first.key]), value: Number(row.cells[measure.key] ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { label: measure.label, points }
}

/** CSV and XLSX from the same module the scheduled mailings use (convex/lib/reportExport.ts). */
function download(result: ReportResult, meta: ExportMeta, extension: "csv" | "xlsx") {
  const body: BlobPart = extension === "csv" ? toCsv(result, meta) : (toXlsx(result, meta).slice().buffer as ArrayBuffer)
  const blob = new Blob([body], { type: EXPORT_MIME[extension] })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = exportFileName(meta, extension)
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
