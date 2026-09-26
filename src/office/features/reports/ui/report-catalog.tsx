import { FileChartColumn, Search } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { Link } from "react-router"

import { Checkbox, EmptyState, Input, Select, TonePill } from "@/shared/components/ui"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { ReportCoverage } from "../data/use-reports"
import { ALL_FAMILIES, FAMILY_LABELS, filterReports, isMechanicDisabled, isNotApplicableKz, REPORT_CATALOG, REPORT_FAMILIES, type ReportDefinition } from "../model/catalog"

// Catalog column (330px ≥1024): search «Название или показатель», family select («Все отчёты» + 10),
// report cards with Russian tags. Ready/in-development comes from coverage.implementedIds.

export function ReportCatalog({ coverage, activeId, linkSearch }: { coverage: ReportCoverage | undefined; activeId: string | undefined; linkSearch: string }) {
  const onlyReadyId = useId()
  const [search, setSearch] = useState("")
  const [family, setFamily] = useState<string>(ALL_FAMILIES)
  const [onlyReady, setOnlyReady] = useState(false)
  const implemented = useMemo(() => (coverage ? new Set(coverage.implementedIds) : undefined), [coverage])
  const reports = useMemo(() => filterReports(REPORT_CATALOG, { search, family, onlyReady, implemented }), [search, family, onlyReady, implemented])

  const familyOptions = useMemo(
    () => [
      { value: ALL_FAMILIES, label: "Все отчёты" },
      ...REPORT_FAMILIES.map((id) => {
        const counts = coverage?.byFamily[id]
        return { value: id, label: counts ? `${FAMILY_LABELS[id]} · ${counts.implemented} из ${counts.total}` : FAMILY_LABELS[id] }
      }),
    ],
    [coverage],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-4">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Поиск отчёта" placeholder="Название или показатель" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Категория отчётов" value={family} onValueChange={setFamily} options={familyOptions} />
        <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
          <label htmlFor={onlyReadyId} className="inline-flex items-center gap-2 text-body-sm text-foreground">
            <Checkbox id={onlyReadyId} checked={onlyReady} onCheckedChange={(value) => setOnlyReady(value === true)} disabled={!coverage} />
            Только готовые
          </label>
          <span aria-live="polite">
            Показано {reports.length} из {REPORT_CATALOG.length}
          </span>
        </div>
      </div>
      {reports.length ? (
        <ul aria-label="Каталог отчётов" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {reports.map((report) => (
            <li key={report.id}>
              <CatalogCard report={report} active={report.id === activeId} ready={implemented?.has(report.id)} search={linkSearch} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Ничего не найдено" description="Измените запрос или категорию." />
      )}
    </div>
  )
}

function CatalogCard({ report, active, ready, search }: { report: ReportDefinition; active: boolean; ready: boolean | undefined; search: string }) {
  return (
    <Link
      to={{ pathname: `/office/reports/${report.id}`, search }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex gap-3 rounded-card border border-border bg-card p-3 transition-colors duration-150 hover:bg-muted",
        active && "bg-muted shadow-[inset_2px_0_0_var(--gold)]",
        focusRingClass,
      )}
    >
      <FileChartColumn aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", ready ? "text-accent" : "text-muted-foreground")} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body-sm font-semibold text-foreground">{report.title}</span>
        <span className="line-clamp-2 text-caption text-muted-foreground">{report.description}</span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          {ready === undefined ? null : ready ? <TonePill tone="success">Готов</TonePill> : <TonePill>В разработке</TonePill>}
          <TonePill>{report.familyLabel}</TonePill>
          {report.configurable ? <TonePill tone="info">OLAP</TonePill> : null}
          {isNotApplicableKz(report) ? <TonePill tone="warning">Не применяется в РК</TonePill> : null}
          {isMechanicDisabled(report) ? <TonePill tone="warning">Механика выключена</TonePill> : null}
        </span>
      </div>
    </Link>
  )
}
