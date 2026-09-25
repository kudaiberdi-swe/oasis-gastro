import { Search } from "lucide-react"
import { useDeferredValue, useId, useMemo, useState } from "react"

import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { findOfficeItem } from "@/office/model/navigation"
import { DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, TonePill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { auditSource, describeAuditAction, SYSTEM_ACTOR_KEY, type AuditSource } from "@/shared/lib/audit-actions"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { PLATFORM_PAGE_SIZE, PlatformErrorBoundary, useAuditLog, usePlatformScope, type AuditEventRow } from "../data/use-platform"

const ALL = "all"
const DAY_MS = 24 * 60 * 60 * 1000

type SourceTab = "all" | AuditSource

const TABS: { value: SourceTab; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "pos", label: "Касса" },
  { value: "office", label: "Офис" },
  { value: "system", label: "Система" },
]

const SECRET_KEY = /pin|password|token|secret/i
export const MASK = "•••"

/** Values of keys that look like credentials never reach the screen, at any depth. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, SECRET_KEY.test(key) ? MASK : maskSecrets(inner)]))
  }
  return value
}

/** The Russian label; a dynamic `${moduleId}.<action>` code also names its office section. */
export function auditActionLabel(action: string) {
  const described = describeAuditAction(action)
  const section = described.moduleId ? findOfficeItem(described.moduleId)?.label : undefined
  return section ? `${described.label} · ${section}` : described.label
}

/** YYYY-MM-DD in Almaty → the first millisecond of that day. */
const almatyDayStart = (date: string) => Date.parse(`${date}T00:00:00+05:00`)

/** «Журнал событий» (/office/audit-log, W1-ADM-04): POS and office events, newest first. */
export function AuditLogWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <AuditLogContent />
    </PlatformErrorBoundary>
  )
}

function AuditLogContent() {
  const scope = usePlatformScope()
  // A branch user reads their restaurants one at a time (the server asks «Выберите ресторан» otherwise).
  const needsRestaurant = !scope.loading && !scope.network && scope.restaurants.length > 1
  const [tab, setTab] = useState<SourceTab>("all")
  const [search, setSearch] = useState("")
  const [restaurantChoice, setRestaurant] = useState<string>(ALL)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelId = useId()
  const deferredSearch = useDeferredValue(search.trim())
  const restaurant = needsRestaurant && restaurantChoice === ALL ? scope.restaurants[0].externalId : restaurantChoice

  const fromMs = from ? almatyDayStart(from) : undefined
  const toMs = to ? almatyDayStart(to) + DAY_MS - 1 : undefined
  const list = useAuditLog({
    search: deferredSearch || undefined,
    restaurantExternalId: restaurant === ALL ? undefined : restaurant,
    actorKey: tab === "system" ? SYSTEM_ACTOR_KEY : undefined,
    from: Number.isFinite(fromMs) ? fromMs : undefined,
    to: Number.isFinite(toMs) ? toMs : undefined,
  })
  const loading = list.status === "LoadingFirstPage"
  // «Касса» / «Офис» filter the loaded page by source; «Система» is filtered on the server.
  const rows = useMemo(() => (tab === "pos" || tab === "office" ? list.results.filter((event) => auditSource(event) === tab) : list.results), [list.results, tab])
  const selected = selectedId ? list.results.find((event) => event._id === selectedId) : undefined

  const columns = useMemo<Column<AuditEventRow>[]>(
    () => [
      { key: "time", header: "Время", cell: (row) => <span className="tabular-nums whitespace-nowrap">{formatAlmatyDateTime(row.occurredAt)}</span> },
      { key: "actor", header: "Актор", cell: (row) => <span className="font-semibold">{row.actorKey}</span> },
      {
        key: "action",
        header: "Действие",
        cell: (row) => (
          <span title={row.action}>
            <TonePill tone="neutral">{auditActionLabel(row.action)}</TonePill>
          </span>
        ),
      },
      {
        key: "resource",
        header: "Ресурс",
        cell: (row) => (
          <span className="text-caption text-muted-foreground">
            {row.resourceType} · {row.resourceExternalId}
          </span>
        ),
      },
      { key: "area", header: "Область", cell: (row) => scope.restaurantName(row.restaurantExternalId) ?? "Вся организация" },
    ],
    [scope],
  )

  const restaurantOptions = [...(needsRestaurant ? [] : [{ value: ALL, label: "Все рестораны" }]), ...restaurantSelectOptions(scope.restaurants)]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
        <FilterTabs aria-label="Источник событий" value={tab} onValueChange={(value) => setTab(value as SourceTab)} items={TABS} panelId={panelId} />
        <div id={panelId} role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="relative w-full max-w-[480px] min-w-[240px] flex-1 sm:flex-none sm:basis-[360px]">
              <span className="sr-only">Поиск по журналу</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Актор, действие, ресурс, correlation ID" className="pl-9" />
            </label>
            <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurant} onValueChange={setRestaurant} options={restaurantOptions} />
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="Период с" className="w-40" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
              <span aria-hidden className="text-muted-foreground">
                —
              </span>
              <Input type="date" aria-label="Период по" className="w-40" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
            </div>
          </div>
          {loading ? (
            <OfficeStatePage state={{ kind: "loading" }} />
          ) : (
            <DataTable
              caption="Журнал событий"
              columns={columns}
              rows={rows}
              getRowId={(row) => row._id}
              onRowClick={(row) => setSelectedId(row._id)}
              selectedId={selected?._id ?? null}
              empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{list.status === "CanLoadMore" ? "На загруженной странице событий нет — покажите ещё" : "Событий нет"}</p>}
              loadMore={loadMoreFromPaginated(list, PLATFORM_PAGE_SIZE)}
            />
          )}
        </div>
      </div>
      <RightPanel open={selected !== undefined} onOpenChange={(open) => (open ? undefined : setSelectedId(null))} title={selected ? auditActionLabel(selected.action) : ""}>
        {selected ? <AuditEventDetails event={selected} area={scope.restaurantName(selected.restaurantExternalId) ?? "Вся организация"} /> : null}
      </RightPanel>
    </div>
  )
}

function AuditEventDetails({ event, area }: { event: AuditEventRow; area: string }) {
  const facts: [string, string | undefined][] = [
    ["Время", formatAlmatyDateTime(event.occurredAt)],
    ["Актор", event.actorKey],
    ["Код действия", event.action],
    ["Ресурс", `${event.resourceType} · ${event.resourceExternalId}`],
    ["Область", area],
    ["Право", event.capability],
    ["Correlation ID", event.correlationId],
  ]
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-sm text-foreground">{event.summary}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
      </dl>
      {event.details !== undefined ? (
        <section aria-label="Подробности" className="flex flex-col gap-2">
          <h3 className="text-body-sm font-semibold text-foreground">Подробности</h3>
          <pre className="overflow-x-auto rounded-card border border-border bg-muted p-3 text-caption whitespace-pre-wrap break-words text-foreground">
            {JSON.stringify(maskSecrets(event.details), null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  )
}
