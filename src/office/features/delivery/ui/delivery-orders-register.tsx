import { Plus, Search } from "lucide-react"
import { useId, useState } from "react"
import { useNavigate } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useRestaurantFilter } from "@/office/features/workforce/data/use-restaurant-filter"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime, formatAlmatyTime } from "@/shared/lib/almaty-time"
import { formatAmount } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { DELIVERY_PAGE_SIZE, useDeliveryKpis, useDeliveryOverview, type DeliveryChannel, type DeliveryRow } from "../data/use-delivery"
import { DELIVERY_TABS, quickTransition, transitionLabel, type DeliveryTab } from "../model/statuses"
import { DeliveryKpis } from "./delivery-kpis"
import { subjectOfRow, useTransitionFlow, useTransitionRights } from "./delivery-transition-bar"

const MODE = {
  delivery: {
    heading: null,
    view: "office.delivery-orders.view",
    edit: "office.delivery-orders.edit",
  },
  "call-center": {
    heading: "Рабочее место оператора",
    view: "office.call-center.view",
    edit: "office.call-center.edit",
  },
} as const

/**
 * «Заказы доставки» (/office/delivery-orders, office/59) and the call center (/office/call-center,
 * office/62): the same register, `mode` switches the rights, texts and the operator's queue order.
 */
export function DeliveryOrdersRegister({ mode, basePath }: { mode: DeliveryChannel; basePath: string }) {
  const navigate = useNavigate()
  const config = MODE[mode]
  const canCreate = useCan(config.edit)
  const restaurants = useRestaurantFilter()
  const panelId = useId()
  const [tab, setTab] = useState<DeliveryTab>("active")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const enabled = !restaurants.loading
  const list = useDeliveryOverview({ tab, search, restaurantExternalId: restaurants.restaurantExternalId, channel: mode, enabled })
  const kpis = useDeliveryKpis({ restaurantExternalId: restaurants.restaurantExternalId, channel: mode, enabled })
  const open = (externalId: string) => navigate(`${basePath}/${encodeURIComponent(externalId)}`)
  const create = () => navigate(`${basePath}/new`)

  const columns: Column<DeliveryRow>[] = [
    {
      key: "number",
      header: "Заказ",
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold whitespace-nowrap">{row.number}</span>
          {restaurants.visible ? <span className="text-caption text-muted-foreground">{restaurants.restaurantName(row.restaurantExternalId)}</span> : null}
        </span>
      ),
    },
    {
      key: "expected",
      header: "Обещано",
      cell: (row) => (
        <span className={cn("whitespace-nowrap tabular-nums", row.late && "font-semibold text-warning")}>
          {formatAlmatyDateTime(row.expectedAt)}
          {row.late ? <span className="block text-caption">Опаздывает</span> : null}
        </span>
      ),
    },
    {
      key: "guest",
      header: "Гость / адрес",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">
            {row.customerName} · <span className="tabular-nums">{row.phone}</span>
          </span>
          <span className="truncate text-caption text-muted-foreground">{row.address}</span>
        </span>
      ),
    },
    {
      key: "fulfillment",
      header: "Исполнение",
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.courierName ?? "Курьер не назначен"}</span>
          {row.predictedCookingCompleteAt ? <span className="text-caption text-muted-foreground">К выдаче {formatAlmatyTime(row.predictedCookingCompleteAt)}</span> : null}
        </span>
      ),
    },
    { key: "total", header: "Сумма, ₸", numeric: true, cell: (row) => formatAmount(row.total) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="delivery" status={row.status} /> },
    { key: "action", header: <span className="sr-only">Действие</span>, cell: (row) => <QuickAction row={row} channel={mode} /> },
  ]

  const unfiltered = tab === "all" && !search.trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {config.heading ? <h2 className="font-display text-title font-semibold">{config.heading}</h2> : <span />}
        {canCreate ? (
          <Button onClick={create}>
            <Plus aria-hidden />
            Новый заказ
          </Button>
        ) : null}
      </div>
      <DeliveryKpis kpis={kpis} />
      <FilterTabs aria-label="Статус заказов" value={tab} onValueChange={(value) => setTab(value as DeliveryTab)} items={DELIVERY_TABS} panelId={panelId} />
      <div id={panelId} role="tabpanel" aria-label={DELIVERY_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск заказов</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Номер, гость, телефон или адрес" className="pl-9" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
          </label>
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
        </div>
        {list.status === "LoadingFirstPage" ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Заказов пока нет",
              description: "Создайте первый заказ доставки — номер присвоит сервер.",
              action: canCreate ? (
                <Button variant="secondary" onClick={create}>
                  Новый заказ
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption={mode === "call-center" ? "Очередь заказов" : "Заказы доставки"}
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => open(row.externalId)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Заказов с такими условиями нет</p>}
            loadMore={loadMoreFromPaginated(list, DELIVERY_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The row's main next step. «Отправить» without a courier asks for one, «Доставлен» / «Закрыть» ask for
 * the payment when the server settles the order then (the source's settlementMode); the cancel is in the card.
 */
function QuickAction({ row, channel }: { row: DeliveryRow; channel: DeliveryChannel }) {
  const { canEdit } = useTransitionRights(channel)
  const flow = useTransitionFlow(subjectOfRow(row), channel, { errors: "toast" })
  const to = quickTransition(row.status)
  if (!canEdit || !to) return null
  // Dialogs are portals, but their React events still bubble to the row: keep them off onRowClick.
  return (
    <span className="contents" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Button size="sm" variant="secondary" disabled={flow.busy} onClick={() => flow.start(to)}>
        {transitionLabel(row.status, to)}
      </Button>
      {flow.dialogs}
    </span>
  )
}
