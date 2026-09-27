import { usePaginatedQuery } from "convex/react"
import { useId, useState } from "react"
import { Link } from "react-router"

import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { DataTable, EmptyState, FilterTabs, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDate, formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn, focusRingClass } from "@/shared/lib/utils"
import { recordCount } from "@/shared/lib/plural"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"
import type { FunctionReturnType } from "convex/server"

import { api } from "@convex/_generated/api"
import { formatPhone } from "../../loyalty/model/loyalty-model"

// «Телефония» (/office/telephony, W3-DLV-09): the journal of calls received from the provider's signed
// webhook. The provider is shown in every row; phones come masked without office.guests.pii; a call
// matched to an open delivery order links to it.

const PAGE_SIZE = 50
const ALL = "__all__"

type CallRow = FunctionReturnType<typeof api.domains.telephony.queries.calls>["page"][number]
type Direction = "all" | "inbound" | "outbound"

const DIRECTION_TABS: { value: Direction; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "inbound", label: "Входящие" },
  { value: "outbound", label: "Исходящие" },
]

const DIRECTION_LABELS = { inbound: "Входящий", outbound: "Исходящий" } as const

/** Readable provider names; a provider without an entry shows its code. */
export const TELEPHONY_PROVIDER_LABELS: Record<string, string> = {
  generic: "Вебхук АТС",
  telephony: "Офис",
  "historical-import": "Исторический импорт",
}

export function TelephonyWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Telephony />
    </PlatformErrorBoundary>
  )
}

function Telephony() {
  const panelId = useId()
  const scope = usePlatformScope()
  const [direction, setDirection] = useState<Direction>("all")
  const [restaurant, setRestaurant] = useState<string>(ALL)
  const list = usePaginatedQuery(
    api.domains.telephony.queries.calls,
    { ...(direction === "all" ? {} : { direction }), ...(restaurant === ALL ? {} : { restaurantExternalId: restaurant }) },
    { initialNumItems: PAGE_SIZE },
  )
  const rows = list.status === "LoadingFirstPage" ? undefined : list.results
  const unfiltered = direction === "all" && restaurant === ALL

  const columns: Column<CallRow>[] = [
    {
      key: "time",
      header: "Время",
      cell: (row) => (
        <span className="flex flex-col whitespace-nowrap tabular-nums">
          <span>{formatAlmatyDate(row.startedAt)}</span>
          <span className="text-caption text-muted-foreground">{formatAlmatyTime(row.startedAt)}</span>
        </span>
      ),
    },
    { key: "direction", header: "Направление", cell: (row) => <span className="font-medium">{DIRECTION_LABELS[row.direction]}</span> },
    { key: "provider", header: "Провайдер", cell: (row) => TELEPHONY_PROVIDER_LABELS[row.provider] ?? row.provider },
    {
      key: "phone",
      header: "Телефон",
      cell: (row) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap tabular-nums">{formatPhone(row.phone)}</span>
          {row.deliveryExternalId ? (
            <Link to={`/office/delivery-orders/${encodeURIComponent(row.deliveryExternalId)}`} className={cn("text-caption text-accent underline-offset-2 hover:underline", focusRingClass)}>
              Доставка {row.deliveryNumber ?? ""}
            </Link>
          ) : (
            <span className="text-caption text-muted-foreground">Без заказа</span>
          )}
        </span>
      ),
    },
    { key: "restaurant", header: "Ресторан", cell: (row) => scope.restaurantName(row.restaurantExternalId) ?? <span className="text-muted-foreground">—</span> },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="call" status={row.status} /> },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <section aria-label="Журнал звонков" className="flex flex-col rounded-card border border-border bg-card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-body font-semibold text-foreground">Журнал звонков</h2>
            <p className="text-caption text-muted-foreground">Провайдер указан в каждой записи</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {scope.restaurants.length > 1 ? (
              <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurant} onValueChange={setRestaurant} options={[{ value: ALL, label: "Все рестораны" }, ...restaurantSelectOptions(scope.restaurants)]} />
            ) : null}
            {rows ? <span className="text-caption text-muted-foreground">{recordCount(rows.length)}</span> : null}
          </div>
        </div>
        <div className="px-5 pt-3">
          <FilterTabs aria-label="Направление звонков" value={direction} onValueChange={(value) => setDirection(value as Direction)} items={DIRECTION_TABS} panelId={panelId} />
        </div>
        <div id={panelId} role="tabpanel" aria-label={DIRECTION_TABS.find((tab) => tab.value === direction)?.label} className="p-4">
          {rows && rows.length === 0 && unfiltered ? (
            <EmptyState title="Журнал пуст" description="Звонки появятся после подключения провайдера телефонии." />
          ) : (
            <DataTable
              caption="Журнал звонков"
              columns={columns}
              rows={rows}
              loading={rows === undefined}
              getRowId={(row) => row.externalId}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Звонков по выбранным фильтрам нет</p>}
              loadMore={loadMoreFromPaginated(list, PAGE_SIZE)}
            />
          )}
        </div>
      </section>
    </div>
  )
}
