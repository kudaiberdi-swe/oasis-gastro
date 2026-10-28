import { FileText } from "lucide-react"
import { useId, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { OfficeStatePage } from "@/office/components/state-page"
import { useFinanceRestaurantFilter } from "@/office/features/finance/data/use-finance-records"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { DataTable, EmptyState, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { useBreakpoint } from "@/shared/hooks/use-breakpoint"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"

import { RETAIL_OFFICE_PAGE_SIZE, useIikoOrders, useOfficeOrders, type IikoOrderRow, type OrderRow, type OrderStatusTab, type SalesSource } from "../data/use-retail-office"
import { ORDER_TABS, SOURCE_OPTIONS, tableText } from "../model/retail-office"
import { OrderDetailPanel } from "./order-detail-panel"

const SECTION = "/office/orders"

/** «Заказы и чеки» (/office/orders/:id?, W1-RTL-05): POS orders by status with the receipt card. */
export function OrdersWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Orders />
    </PlatformErrorBoundary>
  )
}

const columns: Column<OrderRow>[] = [
  {
    key: "number",
    header: "Заказ",
    sortValue: (row) => row.number,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold whitespace-nowrap tabular-nums">№{row.number}</span>
        <span className="text-caption text-muted-foreground">{row.source}</span>
      </div>
    ),
  },
  {
    key: "date",
    header: "Дата / смена",
    sortValue: (row) => row.createdAt,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap">{formatAlmatyDateTime(row.createdAt)}</span>
        {row.shiftNumber !== null ? <span className="text-caption text-muted-foreground">смена №{row.shiftNumber}</span> : null}
      </div>
    ),
  },
  {
    key: "restaurant",
    header: "Ресторан / кассир",
    cell: (row) => {
      const second = [row.terminalName, row.cashierName, row.tableLabel ? tableText(row.tableLabel) : null].filter(Boolean).join(" · ")
      return (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.restaurantName || "—"}</span>
          {second ? <span className="truncate text-caption text-muted-foreground">{second}</span> : null}
        </div>
      )
    },
  },
  { key: "status", header: "Статус", cell: (row) => <StatusPill domain="order" status={row.status} /> },
  { key: "total", header: "Сумма", numeric: true, sortValue: (row) => row.total, cell: (row) => <span className="font-medium">{formatTenge(row.total)}</span> },
]

// iiko orders (W2-RTL-01, D7): read-only, without a receipt card and without guest data.
const iikoColumns: Column<IikoOrderRow>[] = [
  {
    key: "number",
    header: "Заказ",
    sortValue: (row) => row.number,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold whitespace-nowrap tabular-nums">№{row.number}</span>
        <span className="text-caption text-muted-foreground">iiko</span>
      </div>
    ),
  },
  {
    key: "date",
    header: "Дата / смена",
    sortValue: (row) => row.openedAt,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap">{formatAlmatyDateTime(row.openedAt)}</span>
        {row.shiftNumber !== null ? <span className="text-caption text-muted-foreground">смена №{row.shiftNumber}</span> : null}
      </div>
    ),
  },
  {
    key: "restaurant",
    header: "Ресторан / тип",
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{row.restaurantName || "—"}</span>
        <span className="truncate text-caption text-muted-foreground">{[row.orderTypeName, row.guestCount ? `гостей ${row.guestCount}` : null].filter(Boolean).join(" · ") || "—"}</span>
      </div>
    ),
  },
  { key: "gross", header: "По меню", numeric: true, sortValue: (row) => row.grossAmount, cell: (row) => formatTenge(row.grossAmount) },
  { key: "total", header: "Сумма", numeric: true, sortValue: (row) => row.total, cell: (row) => <span className="font-medium">{formatTenge(row.total)}</span> },
]

function IikoOrders({ restaurantExternalId, enabled }: { restaurantExternalId: string | undefined; enabled: boolean }) {
  const list = useIikoOrders(restaurantExternalId, enabled)
  if (!enabled || list.status === "LoadingFirstPage") return <OfficeStatePage state={{ kind: "loading" }} />
  return (
    <DataTable
      caption="Заказы iiko"
      columns={iikoColumns}
      rows={list.results}
      getRowId={(row) => row._id}
      empty={<EmptyState title="Заказов iiko нет" description="Заказы появятся после импорта продаж из iiko для филиалов, сопоставленных в «Обмен данными»." />}
      loadMore={loadMoreFromPaginated(list, RETAIL_OFFICE_PAGE_SIZE)}
    />
  )
}

function Orders() {
  const { id } = useParams()
  const navigate = useNavigate()
  const desktop = useBreakpoint() === "desktop"
  const restaurants = useFinanceRestaurantFilter()
  const panelId = useId()
  const [tab, setTab] = useState<OrderStatusTab>("all")
  const [searchText, setSearchText] = useState("")
  const [source, setSource] = useState<SalesSource>("own")
  const search = useDebounced(searchText)
  const list = useOfficeOrders({ status: tab, search, restaurantExternalId: restaurants.restaurantExternalId }, !restaurants.loading && source === "own")
  const selectedId = id ?? null
  const unfiltered = tab === "all" && !search.trim()

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        {source === "own" ? <FilterTabs aria-label="Статус заказов" value={tab} onValueChange={(value) => setTab(value as OrderStatusTab)} items={ORDER_TABS} panelId={panelId} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label="Источник" className="w-full sm:w-40" value={source} onValueChange={(value) => setSource(value as SalesSource)} options={SOURCE_OPTIONS} />
          {source === "iiko" ? null : (
            <Input
              type="search"
              aria-label="Поиск заказов"
              placeholder="Номер, позиция или комментарий"
              className="w-full sm:w-[480px]"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          )}
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        </div>
        {source === "iiko" ? (
          <IikoOrders restaurantExternalId={restaurants.restaurantExternalId} enabled={!restaurants.loading} />
        ) : (
          <div id={panelId} role="tabpanel" aria-label={ORDER_TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
            {restaurants.loading || list.status === "LoadingFirstPage" ? (
              <OfficeStatePage state={{ kind: "loading" }} />
            ) : (
              <DataTable
                caption="Заказы и чеки"
                columns={columns}
                rows={list.results}
                getRowId={(row) => row._id}
                selectedId={selectedId}
                onRowClick={(row) => navigate(`${SECTION}/${encodeURIComponent(row._id)}`)}
                empty={
                  <EmptyState
                    title={unfiltered ? "Заказов пока нет" : "Ничего не найдено"}
                    description={unfiltered ? "Заказы появятся здесь сразу после создания на кассе." : "Измените статус, поиск или ресторан."}
                  />
                }
                loadMore={loadMoreFromPaginated(list, RETAIL_OFFICE_PAGE_SIZE)}
              />
            )}
          </div>
        )}
      </div>
      {selectedId ? (
        <OrderDetailPanel key={selectedId} orderId={selectedId} onClose={() => navigate(SECTION)} />
      ) : desktop && source === "own" ? (
        <aside aria-label="Чек заказа" className="flex w-[440px] shrink-0 flex-col items-center justify-center gap-3 border-l border-border bg-card p-6 text-center">
          <FileText aria-hidden className="size-8 text-gold" />
          <p className="text-body-sm text-muted-foreground">Выберите заказ для просмотра чека</p>
        </aside>
      ) : null}
    </div>
  )
}
