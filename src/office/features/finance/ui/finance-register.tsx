import { Plus } from "lucide-react"
import { useId, useState, type ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, type Column } from "@/shared/components/ui"
import { recordCount } from "@/shared/lib/plural"

import { FINANCE_PAGE_SIZE, useFinanceRecords, type FinanceModuleId, type FinanceRecord } from "../data/use-finance-records"
import type { StatusTab } from "../model/modules"

export interface FinanceRegisterProps {
  moduleId: FinanceModuleId
  caption: string
  tabs: StatusTab[]
  columns: Column<FinanceRecord>[]
  searchPlaceholder: string
  /** «+ Новая статья»; absent without the edit right. */
  createLabel?: string
  onCreate?: () => void
  /** The card's «Сохранить» is the screen's primary while it is open. */
  formOpen: boolean
  selectedId: string | null
  onSelect: (externalId: string) => void
  emptyTitle: string
  emptyDescription: string
  /** Filters next to the search. */
  toolbar?: ReactNode
  restaurantExternalId?: string
  /** The section's own KPI (L-11), above the search. */
  kpis?: ReactNode
  /** Narrows the loaded page on the client (filters the server list has no index for). */
  filterRows?: (row: FinanceRecord) => boolean
  /** A row click other than opening its card (e.g. to the source document); defaults to onSelect. */
  onRowOpen?: (row: FinanceRecord) => void
}

/** Register of one finance module (OFFICE-DESIGN §3.5): lifecycle tabs, server search, config columns, «Показать ещё». */
export function FinanceRegister({ moduleId, caption, tabs, columns, searchPlaceholder, createLabel, onCreate, formOpen, selectedId, onSelect, emptyTitle, emptyDescription, toolbar, restaurantExternalId, kpis, filterRows, onRowOpen }: FinanceRegisterProps) {
  const panelId = useId()
  const [tab, setTab] = useState(tabs[0].value)
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const active = tabs.find((candidate) => candidate.value === tab) ?? tabs[0]
  const list = useFinanceRecords(moduleId, { status: active.status, search, restaurantExternalId })
  const unfiltered = !active.status && !search.trim()
  const rows = filterRows ? list.results.filter(filterRows) : list.results

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {kpis}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder={searchPlaceholder} className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {toolbar}
        </div>
        {createLabel && onCreate ? (
          <Button variant={formOpen ? "secondary" : "primary"} onClick={onCreate}>
            <Plus aria-hidden />
            {createLabel}
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label="Статус записей" value={tab} onValueChange={setTab} items={tabs.map(({ value, label }) => ({ value, label }))} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={active.label} className="flex flex-col gap-4">
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: emptyTitle,
                description: emptyDescription,
                action:
                  createLabel && onCreate ? (
                    <Button variant="secondary" onClick={onCreate}>
                      {createLabel}
                    </Button>
                  ) : undefined,
              }}
            />
          </div>
        ) : (
          <>
            <p className="text-caption text-muted-foreground">{recordCount(rows.length)}</p>
            <DataTable
              caption={caption}
              columns={columns}
              rows={rows}
              getRowId={(row) => row.externalId}
              selectedId={selectedId}
              onRowClick={(row) => (onRowOpen ? onRowOpen(row) : onSelect(row.externalId))}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
              loadMore={loadMoreFromPaginated(list, FINANCE_PAGE_SIZE)}
            />
          </>
        )}
      </div>
    </div>
  )
}
