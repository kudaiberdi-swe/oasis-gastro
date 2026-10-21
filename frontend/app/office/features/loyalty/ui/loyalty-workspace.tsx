import { UserRound } from "lucide-react"
import { useState } from "react"

import { useCan } from "@/office/components/can"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { useMasterSelection } from "@/office/features/stock/ui/master-panel"
import { Avatar, loadMoreFromPaginated, Select, StatusPill, type Column } from "@/shared/components/ui"
import { formatAlmatyDate } from "@/shared/lib/almaty-time"
import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { GUESTS_PAGE_SIZE, useCategories, useGuests, type Guest, type GuestCategory, type GuestStatus } from "../data/use-office-loyalty"
import { categoryColorClass, formatPhone, guestStatusOf, STATUS_TABS } from "../model/loyalty-model"
import { GuestEditor } from "./guest-editor"
import { LoyaltyRegister } from "./loyalty-register"
import { LoyaltySummary } from "./loyalty-summary"

const SECTION = "guests"
const ALL_RESTAURANTS = "__all__"

/** «Гости» (/office/guests/:id?, W1-LOY-04): register with KPI, masked personal data, guest card. */
export function LoyaltyWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Guests />
    </PlatformErrorBoundary>
  )
}

export function CategoryMarks({ ids, categories }: { ids: string[] | undefined; categories: GuestCategory[] | undefined }) {
  if (!ids?.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const category = categories?.find((candidate) => candidate.externalId === id)
        return (
          <span key={id} className="inline-flex h-6 items-center gap-1.5 rounded-round bg-muted px-2.5 text-caption font-medium whitespace-nowrap text-foreground">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-round", categoryColorClass(category?.color))} />
            {category?.name ?? id}
          </span>
        )
      })}
    </span>
  )
}

function Guests() {
  const canEdit = useCan("office.guests.edit")
  const selection = useMasterSelection(SECTION)
  const scope = usePlatformScope()
  const { categories } = useCategories()
  const [tab, setTab] = useState<string>("all")
  const [searchText, setSearchText] = useState("")
  const [restaurant, setRestaurant] = useState(ALL_RESTAURANTS)
  const search = useDebounced(searchText).trim()
  const list = useGuests({
    status: tab === "all" ? undefined : (tab as GuestStatus),
    search: search || undefined,
    restaurantExternalId: restaurant === ALL_RESTAURANTS ? undefined : restaurant,
  })
  const formOpen = (selection.isNew && canEdit) || selection.selectedId !== null

  const columns: Column<Guest>[] = [
    {
      key: "name",
      header: "Имя",
      cell: (guest) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={guest.name} fallback={UserRound} />
          <span className="truncate font-semibold">{guest.name || "Без имени"}</span>
        </span>
      ),
    },
    {
      key: "phone",
      header: "Телефон",
      cell: (guest) => <span className="whitespace-nowrap tabular-nums">{formatPhone(guest.phone)}</span>,
    },
    {
      key: "categories",
      header: "Категория",
      cell: (guest) => <CategoryMarks ids={guest.categoryExternalIds} categories={categories} />,
    },
    {
      key: "visits",
      header: "Визитов",
      numeric: true,
      cell: (guest) => formatQuantity(guest.visits ?? 0),
    },
    {
      key: "points",
      header: "Баланс бонусов",
      numeric: true,
      cell: (guest) => <span className="font-semibold">{formatQuantity(guest.points)}</span>,
    },
    {
      key: "lastVisit",
      header: "Последний визит",
      cell: (guest) => (guest.lastVisitAt ? formatAlmatyDate(guest.lastVisitAt) : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "status",
      header: "Статус",
      cell: (guest) => <StatusPill domain="document" status={guestStatusOf(guest)} />,
    },
  ]

  const toolbar =
    scope.restaurants.length > 1 ? (
      <Select
        aria-label="Ресторан"
        className="w-full sm:w-64"
        value={restaurant}
        onValueChange={setRestaurant}
        options={[
          { value: ALL_RESTAURANTS, label: "Все рестораны" },
          ...scope.restaurants.map((row) => ({
            value: row.externalId,
            label: row.name,
          })),
        ]}
      />
    ) : null

  return (
    <div className="flex min-h-0 flex-1">
      <LoyaltyRegister
        caption="Гости"
        top={<LoyaltySummary />}
        tabs={STATUS_TABS}
        tab={tab}
        onTabChange={setTab}
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Поиск: имя, телефон или номер карты"
        toolbar={toolbar}
        createLabel={canEdit ? "Новый гость" : undefined}
        onCreate={selection.openNew}
        formOpen={formOpen}
        columns={columns}
        rows={list.status === "LoadingFirstPage" ? undefined : list.results}
        getRowId={(guest) => guest._id}
        selectedId={selection.selectedId}
        onSelect={(guest) => selection.select(guest._id)}
        loadMore={loadMoreFromPaginated(list, GUESTS_PAGE_SIZE)}
        unfiltered={tab === "all" && !search && restaurant === ALL_RESTAURANTS}
        emptyTitle="Гостей пока нет"
        emptyDescription="Гости появляются из кассы при привязке к заказу или создаются здесь с согласиями."
      />
      {selection.isNew && canEdit ? <GuestEditor key="new" guestId={null} canEdit={canEdit} categories={categories} onClose={selection.close} onSaved={selection.select} /> : null}
      {selection.selectedId !== null ? (
        <GuestEditor key={selection.selectedId} guestId={selection.selectedId} canEdit={canEdit} categories={categories} onClose={selection.close} onSaved={selection.select} />
      ) : null}
    </div>
  )
}
