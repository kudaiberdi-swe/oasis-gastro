import { Plus } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, TonePill, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import {
  formatPeriod,
  formatRestaurants,
  PRICE_ORDERS_PAGE_SIZE,
  SORT_OPTIONS,
  STATUS_LABELS,
  usePriceOrderMutations,
  usePriceOrders,
  VIEW_TABS,
  type PriceOrderRow,
  type PriceOrderSort,
  type PriceOrderView,
} from "../data/use-price-orders"

const SEARCH_DEBOUNCE_MS = 250

/** «Приказы об изменении цен» register (/office/price-orders, W1-CAT-11). */
export function PriceOrdersRegister() {
  const navigate = useNavigate()
  const canEdit = useCan("office.price-orders.edit")
  const scope = usePlatformScope()
  const { createDraft } = usePriceOrderMutations()
  const panelId = useId()
  const [view, setView] = useState<PriceOrderView>("all")
  const [sort, setSort] = useState<PriceOrderSort>("start-desc")
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = usePriceOrders({ view, search, sort })

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const restaurantName = (externalId: string) => scope.restaurantName(externalId) ?? externalId
  const columns: Column<PriceOrderRow>[] = [
    { key: "number", header: "Номер", cell: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate">{row.name}</span>
          {row.posName ? <span className="truncate text-caption text-muted-foreground">На кассе: {row.posName}</span> : null}
        </div>
      ),
    },
    { key: "restaurants", header: "Филиалы", cell: (row) => formatRestaurants(row.restaurantExternalIds, restaurantName) },
    { key: "status", header: "Статус", cell: (row) => <TonePill tone={STATUS_LABELS[row.status].tone}>{STATUS_LABELS[row.status].label}</TonePill> },
    { key: "period", header: "Период", cell: (row) => <span className="whitespace-nowrap">{formatPeriod(row.effectiveFrom, row.effectiveTo)}</span> },
    { key: "lines", header: "Позиций", numeric: true, cell: (row) => row.lineCount },
  ]

  async function create() {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const { externalId } = await createDraft({})
      navigate(`/office/price-orders/${encodeURIComponent(externalId)}`)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось создать приказ"))
      setCreating(false)
    }
  }

  const unfiltered = view === "all" && !search.trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Базовые, размерные и временные цены для касс Sandyq.</p>
        {canEdit ? (
          <Button onClick={() => void create()} disabled={creating}>
            <Plus aria-hidden />
            {creating ? "Создание…" : "Новый приказ"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Banner tone="danger" title="Не удалось создать">
          {error}
        </Banner>
      ) : null}
      <FilterTabs aria-label="Статус приказов" value={view} onValueChange={(value) => setView(value as PriceOrderView)} items={VIEW_TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={VIEW_TABS.find((tab) => tab.value === view)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            aria-label="Поиск"
            placeholder="Номер, название или название на кассе"
            className="w-full sm:w-[420px]"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Select aria-label="Сортировка" className="w-full sm:w-72" value={sort} onValueChange={(value) => setSort(value as PriceOrderSort)} options={SORT_OPTIONS} disabled={Boolean(search.trim())} />
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Приказов пока нет",
              description: "Создайте приказ, чтобы изменить цены с нужной даты — для всей сети или отдельных филиалов.",
              action: canEdit ? (
                <Button variant="secondary" onClick={() => void create()} disabled={creating}>
                  Новый приказ
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption="Приказы об изменении цен"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => navigate(`/office/price-orders/${encodeURIComponent(row.externalId)}`)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, PRICE_ORDERS_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}
