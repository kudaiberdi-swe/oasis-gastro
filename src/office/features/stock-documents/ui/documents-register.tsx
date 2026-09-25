import { Plus } from "lucide-react"
import { useId, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useDebounced, useWarehouseOptions } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount, formatQuantity } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { DOCUMENTS_PAGE_SIZE, useRestaurantFilter, useStockDocumentMutations, useStockDocuments, type StockDocumentRow } from "../data/use-stock-documents"
import { STATUS_TABS, type DocumentStatus, type DocumentTypeConfig } from "../model/document-types"

/** Register of one stock document type (OFFICE-DESIGN §3.1): status tabs, search, restaurant, «Показать ещё». */
export function DocumentsRegister({ config }: { config: DocumentTypeConfig }) {
  const navigate = useNavigate()
  const canEdit = useCan(`office.${config.section}.edit`)
  const restaurants = useRestaurantFilter()
  const warehouses = useWarehouseOptions(useCan("office.stock.view"))
  const { createDocument } = useStockDocumentMutations()
  const panelId = useId()
  const [tab, setTab] = useState<"all" | DocumentStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const [creating, setCreating] = useState(false)
  const [pickRestaurant, setPickRestaurant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useStockDocuments({ type: config.type, status: tab === "all" ? undefined : tab, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })

  const warehouseName = (externalId: string | undefined) => (externalId ? (warehouses?.find((option) => option.externalId === externalId)?.name ?? externalId) : "—")
  const open = (externalId: string) => navigate(`/office/${config.section}/${encodeURIComponent(externalId)}`)

  const columns: Column<StockDocumentRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatAlmatyDate(row.date)}</span> },
    {
      key: "warehouse",
      header: "Склад / контрагент",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{config.destination ? `${warehouseName(row.sourceWarehouseExternalId)} → ${warehouseName(row.destinationWarehouseExternalId)}` : warehouseName(row.sourceWarehouseExternalId)}</span>
          <span className="truncate text-caption text-muted-foreground">{row.counterpartyName || restaurants.restaurantName(row.restaurantExternalId) || "—"}</span>
        </div>
      ),
    },
    { key: "quantity", header: "Количество", numeric: true, cell: (row) => formatQuantity(row.totalQuantity) },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => (row.status === "draft" ? "—" : formatAmount(row.totalAmount)) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  async function create(restaurantExternalId: string) {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const { externalId } = await createDocument({ type: config.type, restaurantExternalId })
      open(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать документ"))
      setCreating(false)
    }
  }

  const startCreate = () => {
    if (restaurants.restaurantExternalId) void create(restaurants.restaurantExternalId)
    else if (restaurants.restaurants.length === 1) void create(restaurants.restaurants[0].externalId)
    else setPickRestaurant(true)
  }

  const unfiltered = tab === "all" && !search.trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">{config.description}</p>
        {canEdit ? (
          <Button onClick={startCreate} disabled={creating || restaurants.restaurants.length === 0}>
            <Plus aria-hidden />
            {creating ? "Создание…" : "Новый документ"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось создать">
          {error}
        </Banner>
      ) : null}
      <FilterTabs aria-label="Статус документов" value={tab} onValueChange={(value) => setTab(value as typeof tab)} items={STATUS_TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={STATUS_TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder="Номер, склад или контрагент" className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              action: canEdit ? (
                <Button variant="secondary" onClick={startCreate} disabled={creating}>
                  Новый документ
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption={config.title}
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => open(row.externalId)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, DOCUMENTS_PAGE_SIZE)}
          />
        )}
      </div>
      <RestaurantPickDialog open={pickRestaurant} onOpenChange={setPickRestaurant} restaurants={restaurants.restaurants} busy={creating} onPick={(externalId) => void create(externalId)} />
    </div>
  )
}

export function RestaurantPickDialog({
  open,
  onOpenChange,
  restaurants,
  busy,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurants: readonly { externalId: string; name: string }[]
  busy: boolean
  onPick: (externalId: string) => void
}) {
  const [value, setValue] = useState<string | undefined>()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый документ</DialogTitle>
          <DialogDescription>Документ относится к одному ресторану — выберите его.</DialogDescription>
        </DialogHeader>
        <Field label="Ресторан">{(control) => <Select {...control} value={value} onValueChange={setValue} options={restaurantSelectOptions(restaurants)} placeholder="Выберите ресторан" />}</Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={!value || busy} onClick={() => value && onPick(value)}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
