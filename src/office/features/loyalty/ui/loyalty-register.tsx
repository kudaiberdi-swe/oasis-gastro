import { Plus, Search } from "lucide-react"
import { useId, type ReactNode } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { Button, DataTable, FilterTabs, Input, type Column, type LoadMoreState } from "@/shared/components/ui"
import { recordCount } from "@/shared/lib/plural"

export interface LoyaltyRegisterProps<Row> {
  caption: string
  tabs: readonly { value: string; label: string }[]
  tab: string
  onTabChange: (value: string) => void
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  /** «Новый гость»; absent without the edit right. */
  createLabel?: string
  onCreate?: () => void
  /** While the card is open its «Сохранить» is the one primary of the screen. */
  formOpen: boolean
  columns: Column<Row>[]
  /** undefined while the first page loads. */
  rows: Row[] | undefined
  getRowId: (row: Row) => string
  selectedId: string | null
  onSelect: (row: Row) => void
  loadMore?: LoadMoreState
  /** No tab and no search: an empty list means the section is empty, not the filter. */
  unfiltered: boolean
  emptyTitle: string
  emptyDescription: string
  /** Module KPI above the tabs (only where the section has its own, L-11). */
  top?: ReactNode
  toolbar?: ReactNode
}

/** Register of a loyalty section (OFFICE-DESIGN §3.5): KPI, lifecycle tabs, search + count, config columns. */
export function LoyaltyRegister<Row>({
  caption,
  tabs,
  tab,
  onTabChange,
  search,
  onSearchChange,
  searchPlaceholder,
  createLabel,
  onCreate,
  formOpen,
  columns,
  rows,
  getRowId,
  selectedId,
  onSelect,
  loadMore,
  unfiltered,
  emptyTitle,
  emptyDescription,
  top,
  toolbar,
}: LoyaltyRegisterProps<Row>) {
  const panelId = useId()
  const active = tabs.find((candidate) => candidate.value === tab) ?? tabs[0]
  const create =
    createLabel && onCreate ? (
      <Button variant={formOpen ? "secondary" : "primary"} onClick={onCreate}>
        <Plus aria-hidden />
        {createLabel}
      </Button>
    ) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {top}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterTabs aria-label="Статус записей" value={active.value} onValueChange={onTabChange} items={tabs.map(({ value, label }) => ({ value, label }))} panelId={panelId} />
        {create}
      </div>
      <div id={panelId} role="tabpanel" aria-label={active.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder={searchPlaceholder} className="pl-9" value={search} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
          {toolbar}
          {rows ? <span className="ml-auto text-caption text-muted-foreground">{recordCount(rows.length)}</span> : null}
        </div>
        {rows === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : rows.length === 0 && unfiltered ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: emptyTitle,
                description: emptyDescription,
                action:
                  create && onCreate ? (
                    <Button variant="secondary" onClick={onCreate}>
                      {createLabel}
                    </Button>
                  ) : undefined,
              }}
            />
          </div>
        ) : (
          <DataTable
            caption={caption}
            columns={columns}
            rows={rows}
            getRowId={getRowId}
            selectedId={selectedId}
            onRowClick={onSelect}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMore}
          />
        )}
      </div>
    </div>
  )
}
