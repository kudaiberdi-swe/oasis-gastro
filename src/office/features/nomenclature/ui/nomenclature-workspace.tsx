import { Plus, SlidersHorizontal } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { flattenGroupTree, groupOptions, useProductGroups } from "@/office/features/product-groups/data/use-product-groups"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, TonePill, type Column } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

import {
  ALL_GROUPS,
  filtersFromParams,
  filtersToParams,
  ITEM_TYPE_LABELS,
  NOMENCLATURE_PAGE_SIZE,
  useNomenclature,
  type NomenclatureFilters,
  type NomenclatureLocationState,
  type NomenclatureRow,
  type NomenclatureSort,
  type NomenclatureStatus,
} from "../data/use-nomenclature"
import { NewProductDialog } from "./new-product-dialog"
import { ProductEditor, ProductThumb } from "./product-editor/product-editor"

/** /office/nomenclature — the register; /office/nomenclature/:externalId — the product card. */
export function NomenclatureWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <ProductEditor externalId={id} /> : <NomenclatureRegister />}
    </PlatformErrorBoundary>
  )
}

const TABS: { value: NomenclatureStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "hidden", label: "Скрытые" },
]

const SORT_OPTIONS: { value: NomenclatureSort; label: string }[] = [
  { value: "name", label: "По названию" },
  { value: "price", label: "По цене" },
  { value: "category", label: "По категории" },
]

const SEARCH_DEBOUNCE_MS = 250

/** «от 1 650 ₸» when the branches in scope charge different prices. */
export function formatPriceRange(range: { min: number; max: number }) {
  return range.min < range.max ? `от ${formatTenge(range.min)}` : formatTenge(range.min)
}

export const NOMENCLATURE_COLUMNS: Column<NomenclatureRow>[] = [
  {
    key: "name",
    header: "Наименование",
    cell: (row) => (
      <div className="flex min-w-0 items-center gap-3">
        <ProductThumb imageUrl={row.imageUrl} categoryLabel={row.category.label} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.name}</span>
          {row.nameKk || row.description ? <span className="truncate text-caption text-muted-foreground">{row.nameKk || row.description}</span> : null}
        </div>
      </div>
    ),
  },
  { key: "category", header: "Категория", cell: (row) => row.category.label },
  { key: "price", header: "Цена", numeric: true, cell: (row) => formatPriceRange(row.priceRange) },
  {
    key: "settings",
    header: "Настройки",
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <SlidersHorizontal aria-hidden className="size-4" />
        {row.settingsSummary}
      </span>
    ),
  },
  { key: "type", header: "Тип", cell: (row) => ITEM_TYPE_LABELS[row.itemType] },
  { key: "status", header: "Статус", cell: (row) => (row.enabled ? <TonePill tone="success">Активно</TonePill> : <TonePill>Скрыто</TonePill>) },
]

function NomenclatureRegister() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(params), [params])
  const navigate = useNavigate()
  const location = useLocation()
  const canEdit = useCan("office.nomenclature.edit")
  const groups = useProductGroups()
  const panelId = useId()
  const [creating, setCreating] = useState(false)
  const [searchText, setSearchText] = useState(filters.search)
  const list = useNomenclature(filters)
  const loading = list.status === "LoadingFirstPage"

  const update = (patch: Partial<NomenclatureFilters>) => setParams(filtersToParams({ ...filters, ...patch }), { replace: true })

  // Typing updates the URL (and the query) after a short pause.
  useEffect(() => {
    if (searchText === filters.search) return
    const timer = window.setTimeout(() => setParams(filtersToParams({ ...filters, search: searchText }), { replace: true }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText, filters, setParams])

  const groupSelectOptions = useMemo(() => [{ value: ALL_GROUPS, label: "Все группы" }, ...groupOptions(flattenGroupTree(groups ?? []))], [groups])
  const unfiltered = filters.status === "all" && !filters.search.trim() && filters.group === ALL_GROUPS

  const openCard = (row: NomenclatureRow) => {
    const state: NomenclatureLocationState = { productId: row._id }
    navigate({ pathname: `/office/nomenclature/${encodeURIComponent(row.externalId)}`, search: location.search }, { state })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Новое блюдо
          </Button>
        </div>
      ) : null}
      <FilterTabs aria-label="Статус номенклатуры" value={filters.status} onValueChange={(value) => update({ status: value as NomenclatureStatus })} items={TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={TABS.find((item) => item.value === filters.status)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            aria-label="Поиск"
            placeholder="Название, описание или артикул"
            className="w-full sm:w-[420px]"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Select aria-label="Группа" className="w-full sm:w-64" value={filters.group} onValueChange={(value) => update({ group: value })} options={groupSelectOptions} />
          <Select aria-label="Сортировка" className="w-full sm:w-48" value={filters.sort} onValueChange={(value) => update({ sort: value as NomenclatureSort })} options={SORT_OPTIONS} />
        </div>
        {loading ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Номенклатуры пока нет",
              description: "Добавьте первое блюдо или загрузите каталог из iiko.",
              action: canEdit ? (
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  Новое блюдо
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption="Номенклатура"
            columns={NOMENCLATURE_COLUMNS}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={openCard}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, NOMENCLATURE_PAGE_SIZE)}
          />
        )}
      </div>
      {creating ? <NewProductDialog groups={groups ?? []} defaultGroup={filters.group === ALL_GROUPS ? undefined : filters.group} onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
