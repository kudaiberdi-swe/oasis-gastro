import { Plus } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, type Column } from "@/shared/components/ui"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"
import { formatAmount, formatQuantity } from "@/shared/lib/format"

import { BALANCE_TABS, STOCK_PAGE_SIZE, useBalances, useWarehouseOptions, type BalanceFilter, type BalanceRow } from "../data/use-stock-master"
import { BalanceFlags } from "./balance-flags"
import { InventoryItemPanel } from "./inventory-item-panel"

const ALL = "__all__"

/** «Остатки на складах» (/office/stock, W1-STK-07): balances at a date with minimum control. */
export function BalancesPage() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <BalancesRegister />
    </PlatformErrorBoundary>
  )
}

/** "2026-09-20" → the end of that Almaty day; today or empty → undefined (the current balance). */
export function balanceAt(date: string, now = Date.now()): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= almatyBusinessDate(now)) return undefined
  return Date.parse(`${date}T23:59:59.999+05:00`)
}

export const rowId = (row: BalanceRow) => `${row.warehouse.externalId}:${row.item.externalId}`

export const BALANCE_COLUMNS: Column<BalanceRow>[] = [
  {
    key: "item",
    header: "Номенклатура",
    sortValue: (row) => row.item.name,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{row.item.name}</span>
        <span className="truncate text-caption text-muted-foreground">{row.item.externalId}</span>
      </div>
    ),
  },
  { key: "warehouse", header: "Склад", sortValue: (row) => row.warehouse.name, cell: (row) => row.warehouse.name },
  {
    key: "quantity",
    header: "Количество",
    numeric: true,
    sortValue: (row) => row.quantity,
    cell: (row) => (
      <div className="flex flex-col items-end gap-1">
        <span className={row.negative ? "text-destructive" : undefined}>{formatQuantity(row.quantity, row.item.unit)}</span>
        <BalanceFlags row={row} />
      </div>
    ),
  },
  { key: "average", header: "Ср. цена, ₸", numeric: true, sortValue: (row) => row.averageUnitCost, cell: (row) => formatAmount(row.averageUnitCost) },
  { key: "amount", header: "Стоимость, ₸", numeric: true, sortValue: (row) => row.amount, cell: (row) => formatAmount(row.amount) },
]

type Panel = { kind: "row"; id: string } | { kind: "new" } | null

function BalancesRegister() {
  const canCreate = useCan("office.nomenclature.edit")
  const panelId = useId()
  const [filter, setFilter] = useState<BalanceFilter>("all")
  const [warehouse, setWarehouse] = useState(ALL)
  const [date, setDate] = useState("")
  const [search, setSearch] = useState("")
  const [panel, setPanel] = useState<Panel>(null)
  const warehouses = useWarehouseOptions()
  const today = almatyBusinessDate(Date.now())
  const list = useBalances({ warehouseExternalId: warehouse === ALL ? undefined : warehouse, at: balanceAt(date), filter })

  const needle = search.trim().toLocaleLowerCase("ru")
  // listBalances has no search argument: the loaded pages are filtered here.
  const rows = useMemo(() => (needle ? list.results.filter((row) => `${row.item.name} ${row.item.externalId}`.toLocaleLowerCase("ru").includes(needle)) : list.results), [list.results, needle])
  const selected = panel?.kind === "row" ? list.results.find((row) => rowId(row) === panel.id) ?? null : null

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-muted-foreground">Количество и средневзвешенная стоимость на выбранный момент.</p>
          {canCreate ? (
            <Button onClick={() => setPanel({ kind: "new" })}>
              <Plus aria-hidden />
              Новая позиция
            </Button>
          ) : null}
        </div>
        <FilterTabs aria-label="Фильтр остатков" value={filter} onValueChange={(value) => setFilter(value as BalanceFilter)} items={BALANCE_TABS} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={BALANCE_TABS.find((tab) => tab.value === filter)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input type="search" aria-label="Поиск" placeholder="Товар или ингредиент" className="w-full sm:w-[360px]" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select
              aria-label="Склад"
              className="w-full sm:w-64"
              value={warehouse}
              onValueChange={setWarehouse}
              options={[{ value: ALL, label: "Все склады" }, ...(warehouses ?? []).map((option) => ({ value: option.externalId, label: option.name }))]}
            />
            <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
              на дату
              <Input type="date" aria-label="На дату" className="w-44" max={today} value={date || today} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
          {list.status === "LoadingFirstPage" ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : (
            <DataTable
              caption="Остатки на складах"
              columns={BALANCE_COLUMNS}
              rows={rows}
              getRowId={rowId}
              selectedId={selected ? rowId(selected) : null}
              onRowClick={(row) => setPanel({ kind: "row", id: rowId(row) })}
              empty={
                <OfficeStatePage
                  state={{
                    kind: "empty",
                    title: filter === "all" && !needle ? "Остатков пока нет" : "Ничего не найдено",
                    description: filter === "all" && !needle ? "Остатки появятся после первого прихода на склад." : "Измените фильтры или загрузите ещё записи.",
                  }}
                />
              }
              loadMore={loadMoreFromPaginated(list, STOCK_PAGE_SIZE)}
            />
          )}
        </div>
      </div>
      {panel?.kind === "new" ? <InventoryItemPanel key="new" balance={null} onClose={() => setPanel(null)} /> : null}
      {selected ? <InventoryItemPanel key={rowId(selected)} balance={selected} onClose={() => setPanel(null)} /> : null}
    </div>
  )
}
