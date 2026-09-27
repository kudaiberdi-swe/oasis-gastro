import { Search } from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"

import { DataTable, FilterTabs, Input, KpiCard, type Column } from "@/shared/components/ui"
import { recordCount } from "@/shared/lib/plural"
import { cn } from "@/shared/lib/utils"

import type { ModuleApi } from "./define-module-api"
import { PAGE_SIZE } from "./define-module-api"
import { formatValue, isNumericKind } from "./format-value"
import { statusTabs, type ColumnDef, type ModuleConfig } from "./module-config"

export function columnsFromConfig<Row>(defs: ColumnDef<Row>[], statusDomain?: ModuleConfig<Row>["statusDomain"]): Column<Row>[] {
  return defs.map((def) => {
    const read = def.value ?? ((row: Row) => (row as Record<string, unknown>)[def.key])
    return {
      key: def.key,
      header: def.label,
      numeric: isNumericKind(def.kind),
      cell: (row: Row) => (def.kind === "ref" && def.display ? def.display(row) : formatValue(def.kind, read(row), { unit: def.unit, statusDomain: def.statusDomain ?? statusDomain })),
      sortValue: def.sortable ? (row: Row) => read(row) as string | number : undefined,
    }
  })
}

export interface RegisterPageProps<Row> {
  config: ModuleConfig<Row>
  api: ModuleApi<Row>
  getRowId: (row: Row) => string
  onOpen?: (row: Row) => void
  selectedId?: string | null
  /** Filters shown next to the search: restaurant, period… */
  toolbar?: ReactNode
  empty?: ReactNode
}

/** Register (OFFICE-DESIGN §3.1/§3.5): lifecycle tabs, search, config columns, "Показать ещё". */
export function RegisterPage<Row>({ config, api, getRowId, onOpen, selectedId, toolbar, empty }: RegisterPageProps<Row>) {
  const tabs = statusTabs(config.lifecycle)
  const [tab, setTab] = useState(tabs[0].key)
  const [search, setSearch] = useState("")
  const activeTab = tabs.find((candidate) => candidate.key === tab) ?? tabs[0]
  // The server filters by one status; tabs that group several statuses filter the page client-side.
  const list = api.useList({ status: activeTab.statuses?.length === 1 ? activeTab.statuses[0] : undefined, search: search.trim() || undefined })
  const loading = list.status === "LoadingFirstPage"
  const rows = useMemo(
    () => (activeTab.statuses && config.statusOf ? list.results.filter((row) => activeTab.statuses!.includes(config.statusOf!(row))) : list.results),
    [list.results, activeTab, config],
  )
  const columns = useMemo(() => columnsFromConfig(config.columns, config.statusDomain), [config])
  const TopPanel = config.topPanel
  const panelId = useId()

  return (
    <div className="flex flex-col gap-4">
      {config.kpis?.length ? (
        <div className={cn("grid gap-4", config.kpis.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {config.kpis.map((kpi) => (
            <KpiCard key={kpi.key} label={kpi.label} value={formatValue(kpi.kind, kpi.compute(list.results), { unit: kpi.unit })} />
          ))}
        </div>
      ) : null}
      {TopPanel ? <TopPanel /> : null}
      <FilterTabs aria-label="Статус" value={tab} onValueChange={setTab} panelId={panelId} items={tabs.map((candidate) => ({ value: candidate.key, label: candidate.label }))} />
      <div id={panelId} role="tabpanel" aria-label={activeTab.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full max-w-[480px] min-w-[240px] flex-1 sm:flex-none sm:basis-[360px]">
            <span className="sr-only">Поиск</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="pl-9" />
          </label>
          {toolbar}
          <span className="ml-auto text-caption text-muted-foreground">{loading ? "" : recordCount(rows.length)}</span>
        </div>
        <DataTable
          caption={config.entityLabel}
          columns={columns}
          rows={loading ? undefined : rows}
          getRowId={getRowId}
          onRowClick={onOpen}
          selectedId={selectedId}
          empty={empty}
          loadMore={{
            loaded: list.results.length,
            canLoadMore: list.status === "CanLoadMore",
            loadingMore: list.status === "LoadingMore",
            onLoadMore: () => list.loadMore(PAGE_SIZE),
          }}
        />
      </div>
    </div>
  )
}
