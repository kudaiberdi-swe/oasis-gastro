import * as React from "react"
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react"

import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { Banner } from "./banner"
import { Button } from "./button"
import { SkeletonRows } from "./skeleton"

export interface Column<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Numbers and money: right-aligned, tabular figures. */
  numeric?: boolean
  /** Makes the header a sort button; the value to compare by. */
  sortValue?: (row: T) => string | number | null | undefined
  className?: string
}

export type SortState = { key: string; direction: "asc" | "desc" } | null

export interface LoadMoreState {
  loaded: number
  total?: number
  canLoadMore: boolean
  loadingMore?: boolean
  onLoadMore: () => void
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  getRowId: (row: T) => string
  /** A row opens its card: hover, "›" on the right, Enter/Space activate it. */
  onRowClick?: (row: T) => void
  selectedId?: string | null
  /** Initial client-side sort; server-sorted registers pass `sort` + `onSortChange` instead. */
  defaultSort?: SortState
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  loading?: boolean
  error?: React.ReactNode
  empty?: React.ReactNode
  loadMore?: LoadMoreState
  caption?: string
  className?: string
}

function compare(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ru")
}

/**
 * The one register table (closes L-23): 12px sentence-case header, 48px rows (40 compact), numbers on the
 * right, 2px gold strip on the selected row, horizontal scroll inside the card, "Загружено N из M" footer.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  selectedId,
  defaultSort = null,
  sort: controlledSort,
  onSortChange,
  loading = false,
  error,
  empty,
  loadMore,
  caption,
  className,
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = React.useState<SortState>(defaultSort)
  const serverSorted = controlledSort !== undefined
  const sort = serverSorted ? controlledSort : localSort

  const setSort = (key: string) => {
    const next: SortState = sort?.key === key ? (sort.direction === "asc" ? { key, direction: "desc" } : null) : { key, direction: "asc" }
    if (serverSorted) onSortChange?.(next)
    else setLocalSort(next)
  }

  const sortedRows = React.useMemo(() => {
    if (!rows || serverSorted || !sort) return rows
    const column = columns.find((item) => item.key === sort.key)
    if (!column?.sortValue) return rows
    const sorted = [...rows].sort((a, b) => compare(column.sortValue!(a), column.sortValue!(b)))
    return sort.direction === "desc" ? sorted.reverse() : sorted
  }, [rows, columns, sort, serverSorted])

  const showSkeleton = loading || rows === undefined
  // <1024 the office is view-only and rows become cards: first column as the title, the rest as label: value.
  const cards = useBreakpoint() === "mobile"

  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card", className)}>
      {error ? (
        <div className="p-3">
          <Banner tone="danger" title="Не удалось загрузить">
            {error}
          </Banner>
        </div>
      ) : null}
      {cards && !showSkeleton ? (
        <ul className="flex flex-col divide-y divide-border">
          {sortedRows!.map((row) => {
            const id = getRowId(row)
            const [first, ...rest] = columns
            const content = (
              <>
                <div className="text-body-sm font-semibold text-foreground">{first.cell(row)}</div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
                  {rest.map((column) => (
                    <React.Fragment key={column.key}>
                      <dt className="text-muted-foreground">{column.header}</dt>
                      <dd className={cn("text-foreground", column.numeric && "tabular-nums")}>{column.cell(row)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </>
            )
            return (
              <li key={id} className={cn(selectedId === id && "bg-muted shadow-[inset_2px_0_0_var(--gold)]")}>
                {onRowClick ? (
                  <button type="button" onClick={() => onRowClick(row)} className={cn("block w-full px-4 py-3 text-left hover:bg-muted", focusRingClass)}>
                    {content}
                  </button>
                ) : (
                  <div className="px-4 py-3">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="min-w-0 overflow-x-auto">
        {cards && !showSkeleton ? null : (
          <table className="w-full border-collapse text-body-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="border-b border-border">
                {columns.map((column) => {
                  const active = sort?.key === column.key
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : column.sortValue ? "none" : undefined}
                      className={cn("h-10 px-4 text-caption font-semibold whitespace-nowrap text-muted-foreground", column.numeric ? "text-right" : "text-left", column.className)}
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => setSort(column.key)}
                          className={cn("inline-flex items-center gap-1 rounded-control hover:text-foreground", active && "text-foreground", focusRingClass)}
                        >
                          {column.header}
                          {active ? sort.direction === "asc" ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" /> : null}
                        </button>
                      ) : (
                        column.header
                    )}
                  </th>
                )
              })}
              {onRowClick ? <th aria-hidden className="w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {!showSkeleton &&
              sortedRows!.map((row) => {
                const id = getRowId(row)
                const selected = selectedId === id
                return (
                  <tr
                    key={id}
                    aria-selected={onRowClick ? selected : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.target !== event.currentTarget) return
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              onRowClick(row)
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "h-[var(--table-row-h)] border-b border-border last:border-b-0",
                      onRowClick && cn("cursor-pointer hover:bg-muted", focusRingClass, "focus-visible:-outline-offset-2"),
                      selected && "bg-muted shadow-[inset_2px_0_0_var(--gold)]",
                    )}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={cn("px-4 py-2 text-foreground", column.numeric && "text-right tabular-nums whitespace-nowrap", column.className)}>
                        {column.cell(row)}
                      </td>
                    ))}
                    {onRowClick ? (
                      <td className="w-10 pr-3 text-right text-muted-foreground">
                        <ChevronRight aria-hidden className="ml-auto size-4" />
                      </td>
                    ) : null}
                  </tr>
                )
              })}
          </tbody>
        </table>
        )}
        {showSkeleton ? <SkeletonRows className="p-3" /> : null}
        {!showSkeleton && sortedRows!.length === 0 && !error ? empty ?? <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Записей нет</p> : null}
      </div>
      {loadMore && !showSkeleton && loadMore.loaded > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-caption text-muted-foreground">
          <span>
            Загружено {loadMore.loaded}
            {loadMore.total !== undefined ? ` из ${loadMore.total}` : ""}
          </span>
          {loadMore.canLoadMore ? (
            <Button variant="ghost" size="sm" onClick={loadMore.onLoadMore} disabled={loadMore.loadingMore}>
              {loadMore.loadingMore ? "Загрузка…" : "Показать ещё"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Adapter for Convex `usePaginatedQuery` results. */
export function loadMoreFromPaginated(query: { results: unknown[]; status: string; loadMore: (count: number) => void }, pageSize = 50, total?: number): LoadMoreState {
  return {
    loaded: query.results.length,
    total,
    canLoadMore: query.status === "CanLoadMore",
    loadingMore: query.status === "LoadingMore",
    onLoadMore: () => query.loadMore(pageSize),
  }
}
