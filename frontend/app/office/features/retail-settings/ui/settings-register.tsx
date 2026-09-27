import { Plus } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, StatusPill, TonePill, type Column } from "@/shared/components/ui"
import { formatPercent, formatTenge } from "@/shared/lib/format"

import {
  DIRECTION_LABELS,
  DISCOUNT_MODE_LABELS,
  formatPeriod,
  formatRestaurants,
  KIND_META,
  PROCESSOR_LABELS,
  RETAIL_SETTINGS_PAGE_SIZE,
  SERVICE_MODE_LABELS,
  STATUS_TABS,
  useRetailSettings,
  type RetailSettingKind,
  type RetailSettingRow,
  type StatusView,
} from "../data/use-retail-settings"

const SEARCH_DEBOUNCE_MS = 250

export interface SettingsRegisterProps {
  kind: RetailSettingKind
  selectedId: string | null
  onSelect: (externalId: string) => void
  /** Absent without the edit right: «+ Новая настройка» is hidden. */
  onCreate?: () => void
  /** The form's «Опубликовать» is the screen's primary while the panel is open. */
  formOpen: boolean
  accountLabel: (value: string | undefined) => string | undefined
  restaurantName: (externalId: string) => string
}

/** Columns the kind adds between «Код» and «Рестораны» (OFFICE-DESIGN §5: meaning, not «Сумма / значение»). */
export function kindColumns(kind: RetailSettingKind, accountLabel: (value: string | undefined) => string | undefined): Column<RetailSettingRow>[] {
  switch (kind) {
    case "payment-type":
      return [
        { key: "processor", header: "Процессинг", cell: (row) => (row.data.kind === "payment-type" ? PROCESSOR_LABELS[row.data.processorKind] : "—") },
        { key: "account", header: "Денежный счёт", cell: (row) => (row.data.kind === "payment-type" ? (accountLabel(row.data.account) ?? "—") : "—") },
      ]
    case "order-type":
      return [
        {
          key: "mode",
          header: "Режим",
          cell: (row) =>
            row.data.kind === "order-type" ? (
              <span className="flex flex-wrap items-center gap-2">
                {SERVICE_MODE_LABELS[row.data.serviceMode]}
                {row.data.isDefault ? <TonePill tone="info">По умолчанию</TonePill> : null}
              </span>
            ) : (
              "—"
            ),
        },
        { key: "charge", header: "Сервисный сбор", numeric: true, cell: (row) => (row.data.kind === "order-type" ? formatPercent(row.data.serviceChargePercent) : "—") },
      ]
    case "discount-type":
      return [
        { key: "mode", header: "Вид", cell: (row) => (row.data.kind === "discount-type" ? DISCOUNT_MODE_LABELS[row.data.mode] : "—") },
        {
          key: "value",
          header: "Размер",
          numeric: true,
          cell: (row) => (row.data.kind === "discount-type" ? (row.data.mode === "fixed" ? formatTenge(row.data.value) : formatPercent(row.data.value)) : "—"),
        },
        { key: "apply", header: "Применение", cell: (row) => (row.data.kind === "discount-type" ? (row.data.automatic ? "Автоматически" : "Вручную") : "—") },
      ]
    case "deletion-reason":
      return [
        { key: "writeOff", header: "Списание со склада", cell: (row) => (row.data.kind === "deletion-reason" ? (row.data.writeOff ? "Да" : "Нет") : "—") },
        { key: "account", header: "Счёт расходов", cell: (row) => (row.data.kind === "deletion-reason" ? (accountLabel(row.data.expenseAccount) ?? "—") : "—") },
      ]
    case "cash-operation-type":
      return [
        {
          key: "direction",
          header: "Направление",
          cell: (row) =>
            row.data.kind === "cash-operation-type" ? <TonePill tone={row.data.direction === "cash-in" ? "success" : "warning"}>{DIRECTION_LABELS[row.data.direction]}</TonePill> : "—",
        },
        { key: "limit", header: "Макс. сумма", numeric: true, cell: (row) => (row.data.kind === "cash-operation-type" ? formatTenge(row.data.maximumAmount) : "—") },
      ]
  }
}

/** Register of one retail reference (OFFICE-DESIGN §3.2): status tabs, search, table; a row opens its form. */
export function SettingsRegister({ kind, selectedId, onSelect, onCreate, formOpen, accountLabel, restaurantName }: SettingsRegisterProps) {
  const meta = KIND_META[kind]
  const panelId = useId()
  const [view, setView] = useState<StatusView>("all")
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const list = useRetailSettings(kind, { view, search })

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const columns: Column<RetailSettingRow>[] = [
    {
      key: "name",
      header: "Название",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{row.name}</span>
          {row.receiptName && row.receiptName !== row.name ? <span className="truncate text-caption text-muted-foreground">В чеке: {row.receiptName}</span> : null}
        </div>
      ),
    },
    { key: "code", header: "Код", cell: (row) => <span className="whitespace-nowrap">{row.code}</span> },
    ...kindColumns(kind, accountLabel),
    { key: "restaurants", header: "Рестораны", cell: (row) => formatRestaurants(row.restaurantExternalIds, restaurantName) },
    { key: "period", header: "Период действия", cell: (row) => <span className="whitespace-nowrap">{formatPeriod(row.effectiveFrom, row.effectiveTo)}</span> },
    { key: "version", header: "Версия", numeric: true, cell: (row) => `v${row.version}` },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const unfiltered = view === "all" && !search.trim()
  const create = onCreate ? (
    <Button variant={formOpen ? "secondary" : "primary"} onClick={onCreate}>
      <Plus aria-hidden />
      Новая настройка
    </Button>
  ) : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="search" aria-label="Поиск" placeholder={meta.searchPlaceholder} className="w-full sm:w-[420px]" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        {create}
      </div>
      <FilterTabs aria-label="Статус версий" value={view} onValueChange={(value) => setView(value as StatusView)} items={STATUS_TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={STATUS_TABS.find((tab) => tab.value === view)?.label} className="flex flex-col gap-4">
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <div className="rounded-card border border-border bg-card">
            <OfficeStatePage
              state={{
                kind: "empty",
                title: meta.emptyTitle,
                description: meta.emptyDescription,
                action: onCreate ? (
                  <Button variant="secondary" onClick={onCreate}>
                    Новая настройка
                  </Button>
                ) : undefined,
              }}
            />
          </div>
        ) : (
          <DataTable
            caption={meta.title}
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            selectedId={selectedId}
            onRowClick={(row) => onSelect(row.externalId)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, RETAIL_SETTINGS_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}
