import { useState } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { useFinanceRestaurantFilter } from "@/office/features/finance/data/use-finance-records"
import { Banner, DataTable, EmptyState, Input, loadMoreFromPaginated, Select, TonePill, type Column } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { RETAIL_OFFICE_PAGE_SIZE, useCashOperations, type CashDirection, type CashOperationRow } from "../data/use-retail-office"
import { DIRECTION_LABEL, DIRECTION_TONE, periodRange } from "../model/retail-office"

const ALL = "all"
const DIRECTION_OPTIONS = [
  { value: ALL, label: "Все операции" },
  { value: "cash-in", label: "Внесения" },
  { value: "cash-out", label: "Изъятия" },
]

const columns: Column<CashOperationRow>[] = [
  {
    key: "date",
    header: "Дата / смена",
    sortValue: (row) => row.createdAt,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="whitespace-nowrap">{formatAlmatyDateTime(row.createdAt)}</span>
        <span className="truncate text-caption text-muted-foreground">
          смена №{row.shiftNumber}
          {row.restaurantName ? ` · ${row.restaurantName}` : ""}
        </span>
      </div>
    ),
  },
  { key: "direction", header: "Операция", cell: (row) => <TonePill tone={DIRECTION_TONE[row.direction]}>{DIRECTION_LABEL[row.direction]}</TonePill> },
  {
    key: "reason",
    header: "Основание",
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{row.operationTypeName ?? DIRECTION_LABEL[row.direction]}</span>
        {row.reason ? <span className="truncate text-caption text-muted-foreground">{row.reason}</span> : null}
      </div>
    ),
  },
  { key: "employee", header: "Сотрудник", cell: (row) => row.employeeName ?? "—" },
  {
    key: "amount",
    header: "Сумма",
    numeric: true,
    sortValue: (row) => row.amount,
    cell: (row) => <span className={cn("font-medium", row.amount < 0 && "text-destructive")}>{formatTenge(row.amount)}</span>,
  },
]

/**
 * «Журнал операций» (/office/cash-operations, W1-RTL-04): cash in / out of the shifts in the user's
 * scope, newest first. Without a direction the server returns one page of both kinds; picking
 * «Внесения» or «Изъятия» pages further.
 */
export function CashOperationsJournal() {
  const restaurants = useFinanceRestaurantFilter()
  const [direction, setDirection] = useState<string>(ALL)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const range = periodRange(from, to)
  const list = useCashOperations(
    { restaurantExternalId: restaurants.restaurantExternalId, direction: direction === ALL ? undefined : (direction as CashDirection), ...(range ?? {}) },
    !restaurants.loading && range !== null,
  )
  const filtered = direction !== ALL || from !== "" || to !== ""

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-body-sm font-medium">
          С
          <Input type="date" aria-label="Период с" className="w-44" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-body-sm font-medium">
          По
          <Input type="date" aria-label="Период по" className="w-44" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <Select aria-label="Вид операции" className="w-full sm:w-48" value={direction} onValueChange={setDirection} options={DIRECTION_OPTIONS} />
        {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-56" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
      </div>

      {range === null ? (
        <Banner tone="warning" title="Укажите период">
          Дата начала не может быть позже даты окончания.
        </Banner>
      ) : restaurants.loading || list.status === "LoadingFirstPage" ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : (
        <>
          <DataTable
            caption="Журнал внесений и изъятий"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row._id}
            empty={
              <EmptyState
                title={filtered ? "Ничего не найдено" : "Операций пока нет"}
                description={filtered ? "Измените период или вид операции." : "Внесения и изъятия появятся здесь сразу после проведения на кассе."}
              />
            }
            loadMore={loadMoreFromPaginated(list, RETAIL_OFFICE_PAGE_SIZE)}
          />
          {direction === ALL && list.results.length > 0 ? (
            <p className="text-caption text-muted-foreground">Показаны последние операции обоих видов. Чтобы листать дальше, выберите «Внесения» или «Изъятия».</p>
          ) : null}
        </>
      )}
    </div>
  )
}
