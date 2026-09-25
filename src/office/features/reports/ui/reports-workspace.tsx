import { useCallback, useMemo } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { EmptyState, SegmentedControl } from "@/shared/components/ui"
import { cn } from "@/shared/lib/utils"

import { useReportCoverage, useReportsRestaurants, type ReportCoverage } from "../data/use-reports"
import { FAMILY_LABELS, REPORT_FAMILIES } from "../model/catalog"
import { readFilters, readView, writeFilters, writeView, type ReportFilters, type ReportsView } from "../model/url-state"
import { CoverageBadge } from "./coverage-badge"
import { ReportCatalog } from "./report-catalog"
import { ReportViewer } from "./report-viewer"
import { SalesOverview } from "./sales-overview"
import { ShiftReportsTab } from "./shift-reports"

// «Все отчёты» (W1-RPT-03, OFFICE-DESIGN §3.8): /office/reports — catalog (330px) + viewer,
// /office/reports/:reportId — the viewer with its filters in the query string. «Сводка продаж»
// (dashboardSummary) and «Кассовые отчёты» are views of the same section (?view=summary|shifts).
// Every action here is secondary: the screen has no primary button.

const VIEW_OPTIONS: { value: ReportsView; label: string }[] = [
  { value: "catalog", label: "Все отчёты" },
  { value: "summary", label: "Сводка продаж" },
  { value: "shifts", label: "Кассовые отчёты" },
]

export function ReportsWorkspace() {
  const { id: reportId } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const view = readView(params, reportId)
  const filters = useMemo(() => readFilters(params), [params])
  const coverage = useReportCoverage()
  const restaurants = useReportsRestaurants()

  const setFilters = useCallback((next: ReportFilters) => setParams((current) => writeFilters(current, next), { replace: true }), [setParams])
  const setView = (next: ReportsView) => {
    const search = writeView(params, next).toString()
    navigate({ pathname: "/office/reports", search: search ? `?${search}` : "" })
  }
  const filterSearch = useMemo(() => {
    const search = writeView(params, "catalog").toString()
    return search ? `?${search}` : ""
  }, [params])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3 xl:px-8">
        <SegmentedControl aria-label="Вид раздела отчётов" value={view} onValueChange={setView} options={VIEW_OPTIONS} />
        <CoverageBadge coverage={coverage} />
      </div>

      {view === "summary" ? (
        <SalesOverview filters={filters} onFiltersChange={setFilters} restaurants={restaurants} coverage={coverage} />
      ) : view === "shifts" ? (
        <ShiftReportsTab restaurants={restaurants} />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside aria-label="Каталог" className={cn("min-h-0 w-full flex-col border-r border-border lg:flex lg:w-[330px] lg:shrink-0", reportId ? "hidden" : "flex")}>
            <ReportCatalog coverage={coverage} activeId={reportId} linkSearch={filterSearch} />
          </aside>
          <section aria-label="Отчёт" className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto bg-background lg:block", reportId ? "block" : "hidden")}>
            {reportId ? (
              <ReportViewer
                key={reportId}
                reportId={reportId}
                coverage={coverage}
                filters={filters}
                onFiltersChange={setFilters}
                restaurants={restaurants}
                backSearch={filterSearch}
              />
            ) : (
              <CatalogIntro coverage={coverage} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function CatalogIntro({ coverage }: { coverage: ReportCoverage | undefined }) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-8 xl:px-8">
      <EmptyState
        size="lg"
        title="Выберите отчёт"
        description={
          coverage
            ? `${coverage.total} отчётов в каталоге, из них готовы ${coverage.implemented}. Остальные помечены «В разработке» и откроются с пояснением, без нулей вместо данных.`
            : "Отчёт откроется справа вместе с фильтрами периода и ресторанов."
        }
      />
      {coverage ? (
        <dl className="grid w-full max-w-2xl grid-cols-1 gap-x-8 gap-y-2 text-body-sm sm:grid-cols-2">
          {REPORT_FAMILIES.map((family) => {
            const counts = coverage.byFamily[family] ?? { implemented: 0, total: 0 }
            return (
              <div key={family} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5">
                <dt className="text-foreground">{FAMILY_LABELS[family]}</dt>
                <dd className="text-muted-foreground tabular-nums">
                  {counts.implemented} из {counts.total}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : null}
    </div>
  )
}
