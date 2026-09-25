import { Heart, Search, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { Button, ConfirmDialog, EmptyState, Input, Select, SkeletonRows, useToast } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useReportCoverage, useReportsRestaurants, useReportViewActions, useReportViews, type ReportView } from "../data/use-reports"
import { ALL_FAMILIES, FAMILY_LABELS, findCatalogReport, REPORT_FAMILIES } from "../model/catalog"
import { formatPeriod } from "../model/format"
import { filtersFromConfig, filtersSearch, hasFilterParams, readFilters, writeFilters, type ReportFilters } from "../model/url-state"
import { CoverageBadge } from "./coverage-badge"
import { ReportViewer } from "./report-viewer"

// «Избранные отчёты» (W1-RPT-05, OFFICE-DESIGN §3.8): the same catalog + viewer template, the list holds
// only the user's favorite views (view name + report). /office/report-favorites/:viewId opens a view and
// restores its filters into the query string; changing them afterwards does not rewrite the view.

const BASE = "/office/report-favorites"

export function ReportFavoritesWorkspace() {
  const { id: viewId } = useParams()
  const [params, setParams] = useSearchParams()
  const views = useReportViews({ favoritesOnly: true }, true)
  const coverage = useReportCoverage()
  const restaurants = useReportsRestaurants()
  const filters = useMemo(() => readFilters(params), [params])
  const active = viewId ? views?.find((view) => view.externalId === viewId) : undefined
  const setFilters = (next: ReportFilters) => setParams((current) => writeFilters(current, next), { replace: true })

  // A bare deep link to a view (no filters in the URL) gets the view's own filters once.
  const restored = useRef<string | null>(null)
  useEffect(() => {
    if (!active || restored.current === active.externalId) return
    restored.current = active.externalId
    if (!hasFilterParams(params)) setParams((current) => writeFilters(current, filtersFromConfig(active.config)), { replace: true })
  }, [active, params, setParams])

  const listSearch = filtersSearch(filters)
  const empty = views !== undefined && views.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3 xl:px-8">
        <p className="text-body-sm text-muted-foreground">Отчёты с сохранёнными фильтрами. Видны только вам.</p>
        <CoverageBadge coverage={coverage} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside aria-label="Избранные представления" className={cn("min-h-0 w-full flex-col border-r border-border lg:flex lg:w-[330px] lg:shrink-0", viewId ? "hidden" : "flex")}>
          <FavoritesList views={views} activeId={viewId} />
        </aside>
        <section aria-label="Отчёт" className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto bg-background lg:block", viewId ? "block" : "hidden")}>
          {empty ? (
            <EmptyState
              size="lg"
              title="Нет избранных отчётов"
              description="Добавьте отчёт в избранное из полного каталога."
              action={
                <Button asChild variant="secondary">
                  <Link to="/office/reports">Открыть каталог</Link>
                </Button>
              }
            />
          ) : !viewId ? (
            <EmptyState size="lg" title="Выберите представление" description="Отчёт откроется с сохранёнными периодом, ресторанами и фильтром строк." />
          ) : views === undefined ? (
            <SkeletonRows rows={6} className="px-6 py-5 xl:px-8" />
          ) : !active ? (
            <EmptyState
              size="lg"
              title="Представление не найдено"
              description="Возможно, его убрали из избранного."
              action={
                <Button asChild variant="secondary">
                  <Link to={BASE}>К избранному</Link>
                </Button>
              }
            />
          ) : (
            <ReportViewer
              key={active.externalId}
              reportId={active.reportId}
              viewName={active.name}
              coverage={coverage}
              filters={filters}
              onFiltersChange={setFilters}
              restaurants={restaurants}
              backPath={BASE}
              backLabel="Избранные отчёты"
              backSearch={listSearch}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function FavoritesList({ views, activeId }: { views: ReportView[] | undefined; activeId: string | undefined }) {
  const [search, setSearch] = useState("")
  const [family, setFamily] = useState<string>(ALL_FAMILIES)
  const [removing, setRemoving] = useState<ReportView | null>(null)
  const familyOptions = useMemo(() => [{ value: ALL_FAMILIES, label: "Все отчёты" }, ...REPORT_FAMILIES.map((id) => ({ value: id, label: FAMILY_LABELS[id] }))], [])
  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru")
    return (views ?? []).filter((view) => {
      const report = findCatalogReport(view.reportId)
      if (family !== ALL_FAMILIES && report?.family !== family) return false
      return !needle || [view.name, view.reportTitle, report?.description ?? ""].some((text) => text.toLocaleLowerCase("ru").includes(needle))
    })
  }, [views, search, family])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-4">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Поиск в избранном" placeholder="Название или показатель" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Категория отчётов" value={family} onValueChange={setFamily} options={familyOptions} />
      </div>
      {views === undefined ? (
        <SkeletonRows rows={4} className="p-3" />
      ) : shown.length ? (
        <ul aria-label="Избранные отчёты" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {shown.map((view) => (
            <li key={view.externalId}>
              <FavoriteCard view={view} active={view.externalId === activeId} onRemove={() => setRemoving(view)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">Отчёты не найдены</p>
      )}
      <RemoveViewDialog view={removing} activeId={activeId} onClose={() => setRemoving(null)} />
    </div>
  )
}

function FavoriteCard({ view, active, onRemove }: { view: ReportView; active: boolean; onRemove: () => void }) {
  const canEdit = useCan("office.report-favorites.edit")
  const filters = filtersFromConfig(view.config)
  return (
    <div className={cn("flex items-start gap-2 rounded-card border border-border bg-card transition-colors duration-150 hover:bg-muted", active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]")}>
      <Link
        to={{ pathname: `${BASE}/${view.externalId}`, search: filtersSearch(filters) }}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-w-0 flex-1 gap-3 rounded-card p-3", focusRingClass)}
      >
        <Heart aria-hidden className="mt-0.5 size-[18px] shrink-0 fill-current text-primary" />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body-sm font-semibold text-foreground">{view.name}</span>
          <span className="truncate text-caption text-muted-foreground">
            {view.reportTitle} · {formatPeriod(filters.dateFrom, filters.dateTo)}
            {filters.restaurantExternalIds.length ? ` · ресторанов: ${filters.restaurantExternalIds.length}` : ""}
          </span>
        </span>
      </Link>
      {canEdit ? (
        <Button variant="ghost" size="icon-sm" className="m-1.5" aria-label={`Убрать «${view.name}» из избранного`} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

function RemoveViewDialog({ view, activeId, onClose }: { view: ReportView | null; activeId: string | undefined; onClose: () => void }) {
  const { remove } = useReportViewActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <ConfirmDialog
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
      title="Убрать из избранного?"
      description={view ? `Представление «${view.name}» будет удалено. Сам отчёт останется в каталоге.` : undefined}
      confirmLabel="Убрать"
      submitting={submitting}
      error={error}
      onConfirm={async () => {
        if (!view) return
        setSubmitting(true)
        try {
          await remove({ externalId: view.externalId })
          toast("Представление убрано из избранного", "success")
          if (view.externalId === activeId) navigate(BASE)
          onClose()
        } catch (caught) {
          setError(errorMessage(caught, "Не удалось убрать из избранного"))
        } finally {
          setSubmitting(false)
        }
      }}
    />
  )
}
