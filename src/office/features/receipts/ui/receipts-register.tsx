import { Plus } from "lucide-react"
import { useId, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useRestaurantFilter } from "@/office/features/stock-documents/data/use-stock-documents"
import { STATUS_TABS } from "@/office/features/stock-documents/model/document-types"
import { useDebounced, useSupplierOptions, useWarehouseOptions, type WarehouseOption } from "@/office/features/stock/data/use-stock-master"
import { Banner, Button, Combobox, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatAmount } from "@/shared/lib/format"

import { RECEIPTS_PAGE_SIZE, useAllSuppliers, useReceiptMutations, useReceipts, useWarehouseDocs, type ReceiptRow, type ReceiptStatus } from "../data/use-receipts"

const TABS = STATUS_TABS.map((tab) => (tab.value === "all" ? { ...tab, label: "Все документы" } : tab))

/** «Приходные накладные» register (/office/receipts, W1-STK-11). */
export function ReceiptsRegister() {
  const navigate = useNavigate()
  const canEdit = useCan("office.receipts.edit")
  const restaurants = useRestaurantFilter()
  const suppliers = useAllSuppliers(useCan("office.suppliers.view"))
  const warehouses = useWarehouseDocs(useCan("office.warehouses.view"))
  const panelId = useId()
  const [tab, setTab] = useState<"all" | ReceiptStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const [creating, setCreating] = useState(false)
  const list = useReceipts({ status: tab === "all" ? undefined : tab, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })

  const supplierName = (row: ReceiptRow) => suppliers?.find((supplier) => supplier._id === row.supplierId)?.name ?? "—"
  const warehouseName = (row: ReceiptRow) => warehouses?.find((warehouse) => warehouse._id === row.warehouseId)?.name ?? "—"
  const open = (externalId: string) => navigate(`/office/receipts/${encodeURIComponent(externalId)}`)

  const columns: Column<ReceiptRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "date", header: "Дата", cell: (row) => <span className="whitespace-nowrap">{formatAlmatyDateTime(row.date)}</span> },
    { key: "supplier", header: "Поставщик", cell: supplierName },
    { key: "warehouse", header: "Склад", cell: warehouseName },
    { key: "invoice", header: "Счёт-фактура", cell: (row) => row.invoiceNumber || "—" },
    { key: "amount", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.totalGross) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const unfiltered = tab === "all" && !search.trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Поступления поставщиков и фактическая стоимость складских партий.</p>
        {canEdit ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Новая накладная
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label="Статус накладных" value={tab} onValueChange={(value) => setTab(value as typeof tab)} items={TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={TABS.find((candidate) => candidate.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="search" aria-label="Поиск" placeholder="Номер, счёт-фактура или поставщик" className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Накладных пока нет",
              description: "Создайте приходную накладную, чтобы оприходовать поставку на склад.",
              action: canEdit ? (
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  Новая накладная
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption="Приходные накладные"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => open(row.externalId)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, RECEIPTS_PAGE_SIZE)}
          />
        )}
      </div>
      {creating ? <NewReceiptDialog restaurantExternalId={restaurants.restaurantExternalId} onClose={() => setCreating(false)} onCreated={open} /> : null}
    </div>
  )
}

function NewReceiptDialog({ restaurantExternalId, onClose, onCreated }: { restaurantExternalId?: string; onClose: () => void; onCreated: (externalId: string) => void }) {
  const suppliers = useSupplierOptions(useCan("office.suppliers.view"))
  const warehouses = useWarehouseOptions(useCan("office.stock.view"))
  const { createReceiptDraft } = useReceiptMutations()
  const [supplier, setSupplier] = useState<string | undefined>()
  const [warehouse, setWarehouse] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available: WarehouseOption[] = (warehouses ?? []).filter((option) => !restaurantExternalId || option.restaurantExternalId === restaurantExternalId)

  async function submit() {
    if (!supplier || !warehouse || busy) return
    setBusy(true)
    setError(null)
    try {
      const { externalId } = await createReceiptDraft({ supplierExternalId: supplier, warehouseExternalId: warehouse })
      onCreated(externalId)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать накладную"))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая накладная</DialogTitle>
          <DialogDescription>Номер присвоит сервер; товары добавляются в редакторе.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Banner tone="danger" title="Не удалось создать">
            {error}
          </Banner>
        ) : null}
        <Field label="Поставщик">
          {(control) => (
            <Combobox
              {...control}
              value={supplier}
              onValueChange={setSupplier}
              options={(suppliers ?? []).map((option) => ({ value: option.externalId, label: option.name, hint: `БИН ${option.bin}` }))}
              placeholder="Выберите поставщика"
              searchPlaceholder="Название или БИН"
            />
          )}
        </Field>
        <Field label="Оприходовать на склад">
          {(control) => <Select {...control} value={warehouse} onValueChange={setWarehouse} options={available.map((option) => ({ value: option.externalId, label: option.name }))} placeholder="Выберите склад" />}
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!supplier || !warehouse || busy}>
            {busy ? "Создание…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
