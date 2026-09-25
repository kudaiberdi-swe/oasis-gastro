import { useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { KpiCard, loadMoreFromPaginated, Select, Skeleton, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { formatAmount, formatQuantity } from "@/shared/lib/format"

import { RESERVATIONS_PAGE_SIZE, useReservations, useReservationSummary, type ReservationRow } from "../data/use-reservations"
import { formatPhone } from "../model/loyalty-model"
import { formatTimeRange, RECORD_TYPE_LABELS, RESERVATION_TABS, type ReservationPrefill, type ReservationStatus, type ReservationTab } from "../model/reservations"
import { FloorPlanSection } from "./floor-plan"
import { LoyaltyRegister } from "./loyalty-register"
import { ReservationEditor } from "./reservation-editor"

const SECTION = "reservations"

/** «Банкеты и резервы» (/office/reservations/:id?, W2-LOY-07): the floor plan of a day above the approval register. */
export function ReservationsWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Reservations />
    </PlatformErrorBoundary>
  )
}

function Reservations() {
  const canEdit = useCan("office.reservations.edit")
  const selection = useMasterSelection(SECTION)
  const scope = usePlatformScope()
  const [restaurantChoice, setRestaurantChoice] = useState<string | null>(null)
  const restaurant = restaurantChoice ?? scope.restaurants[0]?.externalId
  const [tab, setTab] = useState<ReservationTab>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText).trim()
  const [editingPlan, setEditingPlan] = useState(false)
  const [prefill, setPrefill] = useState<ReservationPrefill | undefined>(undefined)
  const list = useReservations({
    ...(restaurant ? { restaurantExternalId: restaurant } : {}),
    ...(tab === "all" ? {} : { status: tab as ReservationStatus }),
    ...(search ? { search } : {}),
  })
  const panelOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const create = (next?: ReservationPrefill) => {
    setPrefill(next)
    selection.openNew()
  }

  const columns: Column<ReservationRow>[] = [
    {
      key: "number",
      header: "Номер",
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-semibold whitespace-nowrap">{row.number}</span>
          <span className="text-caption text-muted-foreground">{RECORD_TYPE_LABELS[row.recordType]}</span>
        </span>
      ),
    },
    {
      key: "start",
      header: "Дата и время",
      cell: (row) => (
        <span className="flex flex-col whitespace-nowrap tabular-nums">
          <span>{formatAlmatyDate(row.start)}</span>
          <span className="text-caption text-muted-foreground">{formatTimeRange(row.start, row.end)}</span>
        </span>
      ),
    },
    {
      key: "guest",
      header: "Гость",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.guestName}</span>
          <span className="text-caption whitespace-nowrap text-muted-foreground tabular-nums">{formatPhone(row.phone)}</span>
        </span>
      ),
    },
    { key: "guests", header: "Гостей", numeric: true, cell: (row) => formatQuantity(row.guestCount) },
    { key: "tables", header: "Стол", cell: (row) => (row.tableLabels.length ? row.tableLabels.join(", ") : <span className="text-muted-foreground">—</span>) },
    { key: "prepayment", header: "Предоплата ₸", numeric: true, cell: (row) => (row.prepayment ? <span className="font-medium">{formatAmount(row.prepayment)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "status", header: "Статус", cell: (row) => <StatusPill domain="document" status={row.status} /> },
  ]

  const toolbar =
    scope.restaurants.length > 1 ? (
      <Select
        aria-label="Ресторан"
        className="w-full sm:w-64"
        value={restaurant}
        onValueChange={(value) => {
          setRestaurantChoice(value)
          setEditingPlan(false)
        }}
        options={scope.restaurants.map((row) => ({ value: row.externalId, label: row.name }))}
      />
    ) : null

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption="Банкеты и резервы"
        top={
          <>
            <ReservationKpi restaurantExternalId={restaurant} />
            <FloorPlanSection
              key={restaurant ?? "none"}
              restaurantExternalId={restaurant}
              canEdit={canEdit}
              editing={editingPlan}
              onEditingChange={(editing) => {
                setEditingPlan(editing)
                if (editing && selection.open) selection.close()
              }}
              primaryAllowed={!panelOpen}
              onOpenReservation={selection.select}
              onCreate={canEdit ? create : undefined}
            />
          </>
        }
        tabs={RESERVATION_TABS}
        tab={tab}
        onTabChange={(value) => setTab(value as ReservationTab)}
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Поиск: номер, гость, телефон или повод"
        toolbar={toolbar}
        createLabel={canEdit ? "Новая запись" : undefined}
        onCreate={() => create()}
        formOpen={panelOpen || editingPlan}
        columns={columns}
        rows={list.status === "LoadingFirstPage" ? undefined : list.results}
        getRowId={(row) => row.externalId}
        selectedId={selection.selectedId}
        onSelect={(row) => selection.select(row.externalId)}
        loadMore={loadMoreFromPaginated(list, RESERVATIONS_PAGE_SIZE)}
        unfiltered={tab === "all" && !search}
        emptyTitle="Броней пока нет"
        emptyDescription="Создайте бронь стола или банкет — или выберите стол на схеме зала."
      />
      {panelOpen ? (
        <ReservationEditor
          key={selection.selectedId ?? `new:${JSON.stringify(prefill ?? {})}`}
          externalId={selection.selectedId}
          restaurantExternalId={restaurant}
          prefill={selection.isNew ? prefill : undefined}
          onClose={selection.close}
          onSaved={selection.select}
        />
      ) : null}
    </div>
  )
}

/** KPI of the section (OFFICE-DESIGN §5 reservations): upcoming bookings on approval or approved. */
function ReservationKpi({ restaurantExternalId }: { restaurantExternalId: string | undefined }) {
  const summary = useReservationSummary(restaurantExternalId)
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {summary === undefined ? <Skeleton className="h-24 w-full" /> : <KpiCard label="Предстоящих резервов" value={formatQuantity(summary.upcoming)} hint={summary.upcoming >= 400 ? "Показано не больше 200 на статус" : "На согласовании и согласованные"} />}
    </div>
  )
}
