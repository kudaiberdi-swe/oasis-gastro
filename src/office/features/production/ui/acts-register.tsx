import { Plus } from "lucide-react"
import { useId, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useAllSuppliers } from "@/office/features/receipts/data/use-receipts"
import { useRestaurantFilter } from "@/office/features/stock-documents/data/use-stock-documents"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatQuantity } from "@/shared/lib/format"
import { recordCount } from "@/shared/lib/plural"

import { PRODUCTION_PAGE_SIZE, useProductionDocuments, useProductionMutations, useWarehouseDocs, type ProductionDocumentRow } from "../data/use-production"
import { documentTitle, LIFECYCLE_TABS, type ProductionStatus, type ProductionTypeConfig } from "../model/production"

/**
 * Register of one production / logistics document type: Register §3.1 for «Акты приготовления», Domain §3.5
 * (lifecycle tabs, «Поиск: …» + «N записей», columns of OFFICE-DESIGN §5) for the rest.
 */
export function ActsRegister({ config, toolbar }: { config: ProductionTypeConfig; toolbar?: ReactNode }) {
  const navigate = useNavigate()
  const canEdit = useCan(`office.${config.section}.edit`)
  const canCreateReceipt = useCan("office.receipts.edit")
  const canOpenReceipt = useCan("office.receipts.view")
  const restaurants = useRestaurantFilter()
  const warehouses = useWarehouseDocs(useCan("office.warehouses.view"))
  const canViewSuppliers = useCan("office.suppliers.view")
  const suppliers = useAllSuppliers(config.supplier && canViewSuppliers)
  const { createReceiptFromPurchaseOrder } = useProductionMutations()
  const panelId = useId()
  const tabs = LIFECYCLE_TABS[config.lifecycle]
  const [tab, setTab] = useState<"all" | ProductionStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const [error, setError] = useState<string | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const list = useProductionDocuments({ type: config.type, status: tab === "all" ? undefined : tab, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })

  const warehouseName = (id: string | undefined) => (id ? (warehouses?.find((warehouse) => warehouse._id === id)?.name ?? "—") : "—")
  const route = (row: ProductionDocumentRow) => (config.destinationLabel && config.sourceLabel ? `${warehouseName(row.sourceWarehouseId)} → ${warehouseName(row.destinationWarehouseId)}` : warehouseName(row.sourceWarehouseId ?? row.destinationWarehouseId))
  const open = (externalId: string) => navigate(`/office/${config.section}/${encodeURIComponent(externalId)}`)
  const startCreate = () => navigate({ pathname: `/office/${config.section}/new`, search: restaurants.restaurantExternalId ? `?restaurant=${encodeURIComponent(restaurants.restaurantExternalId)}` : "" })
  // Acts get their cost on posting; a purchase order carries the expected sum from saving.
  const amount = (row: ProductionDocumentRow) => (config.lifecycle === "purchase" || row.status === "posted" || row.status === "reversed" ? formatAmount(row.totalAmount) : "—")

  async function createReceipt(row: ProductionDocumentRow) {
    setBusyRow(row.externalId)
    setError(null)
    try {
      const receiptExternalId = await createReceiptFromPurchaseOrder({ externalId: row.externalId })
      navigate(`/office/receipts/${encodeURIComponent(receiptExternalId)}`)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать приходную накладную"))
      setBusyRow(null)
    }
  }

  const number: Column<ProductionDocumentRow> = { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> }
  const date: Column<ProductionDocumentRow> = { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatAlmatyDate(row.date)}</span> }
  const status: Column<ProductionDocumentRow> = { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> }
  const positions: Column<ProductionDocumentRow> = { key: "positions", header: "Позиций", numeric: true, cell: (row) => row.lines.length }
  const columns: Column<ProductionDocumentRow>[] =
    config.type === "production"
      ? [
          number,
          date,
          { key: "source", header: "Со склада", cell: (row) => warehouseName(row.sourceWarehouseId) },
          { key: "destination", header: "На склад", cell: (row) => warehouseName(row.destinationWarehouseId) },
          { key: "quantity", header: "Количество", numeric: true, cell: (row) => formatQuantity(row.lines.reduce((sum, line) => sum + line.quantity, 0)) },
          { key: "amount", header: "Стоимость, ₸", numeric: true, cell: amount },
          status,
        ]
      : config.type === "purchase-order"
        ? [
            number,
            date,
            { key: "supplier", header: "Поставщик", cell: (row) => suppliers?.find((supplier) => supplier._id === row.supplierId)?.name ?? "—" },
            { key: "warehouse", header: "Склад", cell: (row) => warehouseName(row.destinationWarehouseId) },
            { key: "expected", header: "Ожидаемая дата", cell: (row) => (row.expectedDate ? <span className="whitespace-nowrap">{formatAlmatyDate(row.expectedDate)}</span> : "—") },
            { key: "amount", header: "Сумма, ₸", numeric: true, cell: amount },
            status,
            {
              key: "receipt",
              header: <span className="sr-only">Приход</span>,
              cell: (row) =>
                row.receiptExternalId && canOpenReceipt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      navigate(`/office/receipts/${encodeURIComponent(row.receiptExternalId!)}`)
                    }}
                  >
                    Открыть приход
                  </Button>
                ) : row.status === "approved" && !row.receiptExternalId && canCreateReceipt ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyRow !== null}
                    onClick={(event) => {
                      event.stopPropagation()
                      void createReceipt(row)
                    }}
                  >
                    {busyRow === row.externalId ? "Создание…" : "Создать приход"}
                  </Button>
                ) : null,
            },
          ]
        : config.type === "internal-order"
          ? [number, date, { key: "route", header: "Откуда → Куда", cell: route }, positions, { key: "amount", header: "Сумма, ₸", numeric: true, cell: amount }, status]
          : [
              number,
              date,
              { key: "title", header: "Название", cell: (row) => <span className="line-clamp-1">{documentTitle(row)}</span> },
              { key: "route", header: config.destinationLabel ? "Со склада → На склад" : "Со склада", cell: route },
              positions,
              { key: "amount", header: "Стоимость, ₸", numeric: true, cell: amount },
              status,
            ]

  const unfiltered = tab === "all" && !search.trim()
  const register = config.type === "production"
  const newButton = canEdit ? (
    <Button onClick={startCreate} disabled={restaurants.restaurants.length === 0}>
      <Plus aria-hidden />
      {config.newLabel}
    </Button>
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {toolbar || newButton ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {toolbar ?? <span />}
          {newButton}
        </div>
      ) : null}
      {error ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}
      {register ? null : <FilterTabs aria-label="Статус документов" value={tab} onValueChange={(value) => setTab(value as typeof tab)} items={tabs} panelId={panelId} />}
      <div id={panelId} role={register ? undefined : "tabpanel"} aria-label={register ? undefined : tabs.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder={config.searchPlaceholder} className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {register ? (
            <Select aria-label="Статус" className="w-full sm:w-48" value={tab} onValueChange={(value) => setTab(value as typeof tab)} options={tabs.map((item) => ({ value: item.value, label: item.value === "all" ? "Все статусы" : item.label }))} />
          ) : null}
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          {!register && list.status !== "LoadingFirstPage" ? <span className="text-body-sm text-muted-foreground">{recordCount(list.results.length)}</span> : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <>
            <OfficeStatePage
              state={{
                kind: "empty",
                action: canEdit ? (
                  <Button variant="secondary" onClick={startCreate}>
                    {config.newLabel}
                  </Button>
                ) : undefined,
              }}
            />
            {register ? <RegisterFooter loaded={0} exhausted /> : null}
          </>
        ) : (
          <>
            <DataTable
              caption={config.title}
              columns={columns}
              rows={list.results}
              getRowId={(row) => row.externalId}
              onRowClick={(row) => open(row.externalId)}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
              loadMore={register ? undefined : loadMoreFromPaginated(list, PRODUCTION_PAGE_SIZE)}
            />
            {register ? <RegisterFooter loaded={list.results.length} exhausted={list.status === "Exhausted"} onLoadMore={list.status === "CanLoadMore" ? () => list.loadMore(PRODUCTION_PAGE_SIZE) : undefined} /> : null}
          </>
        )}
      </div>
    </div>
  )
}

/** «Загружено записей: N» · «Все записи загружены» (office/26-production-acts-empty.jpg). */
function RegisterFooter({ loaded, exhausted, onLoadMore }: { loaded: number; exhausted: boolean; onLoadMore?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
      <span>Загружено записей: {loaded}</span>
      {exhausted ? (
        <span>Все записи загружены</span>
      ) : onLoadMore ? (
        <Button variant="ghost" size="sm" onClick={onLoadMore}>
          Показать ещё
        </Button>
      ) : null}
    </div>
  )
}
