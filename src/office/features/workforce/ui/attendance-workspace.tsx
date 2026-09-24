import { Plus, Search } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { columnsFromConfig } from "@/office/engine/register-page"
import type { ColumnDef } from "@/office/engine/module-config"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Button, DataTable, FilterTabs, Input, loadMoreFromPaginated, Select, type Column } from "@/shared/components/ui"

import { useAttendanceList, WORKFORCE_PAGE_SIZE, type AttendanceRow, type AttendanceStatus } from "../data/use-office-workforce"
import { useRestaurantFilter } from "../data/use-restaurant-filter"
import { ATTENDANCE_TABS, ATTENDANCE_TYPE_LABEL, formatBusinessDate, formatClock, formatDeviation } from "../model/modules"
import { AttendanceEditor } from "./attendance-editor"

// «Журнал явки» (W1-HR-05): /office/attendance — the log (§3.5); /office/attendance/:id — a record, «new» creates one.

export function AttendanceWorkspace() {
  const { id } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={`${id ?? "list"}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      {id ? <AttendanceEditor externalId={id === "new" ? null : id} /> : <AttendanceRegister />}
    </PlatformErrorBoundary>
  )
}

/** Columns per OFFICE-DESIGN §5: hours are «8 ч», never «8 ₸» (L-10). */
export function attendanceColumns(restaurantName: (externalId: string) => string | undefined): ColumnDef<AttendanceRow>[] {
  return [
    { key: "number", label: "Номер", kind: "ref", display: (row) => <span className="font-semibold whitespace-nowrap">{row.number}</span> },
    { key: "businessDate", label: "Дата", kind: "text", value: (row) => formatBusinessDate(row.businessDate) },
    {
      key: "employee",
      label: "Сотрудник",
      kind: "ref",
      display: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-foreground">{row.employeeName}</span>
          <span className="truncate text-caption text-muted-foreground">
            {[restaurantName(row.restaurantExternalId), row.attendanceType === "worked" ? null : ATTENDANCE_TYPE_LABEL[row.attendanceType]].filter(Boolean).join(" · ")}
          </span>
        </div>
      ),
    },
    { key: "clockIn", label: "Приход", kind: "text", value: (row) => formatClock(row.clockIn) },
    { key: "clockOut", label: "Уход", kind: "text", value: (row) => formatClock(row.clockOut, row.clockIn) },
    { key: "hours", label: "Часы", kind: "hours" },
    { key: "deviation", label: "Отклонение", kind: "text", value: (row) => formatDeviation(row.deviationMinutes) },
    { key: "status", label: "Статус", kind: "status" },
  ]
}

function AttendanceRegister() {
  const navigate = useNavigate()
  const canEdit = useCan("office.attendance.edit")
  const restaurants = useRestaurantFilter()
  const panelId = useId()
  const [tab, setTab] = useState<"all" | AttendanceStatus>("all")
  const [searchText, setSearchText] = useState("")
  const search = useDebounced(searchText)
  const list = useAttendanceList({ status: tab === "all" ? undefined : tab, search, restaurantExternalId: restaurants.restaurantExternalId, enabled: !restaurants.loading })
  const restaurantName = restaurants.restaurantName
  const columns = useMemo<Column<AttendanceRow>[]>(
    () => columnsFromConfig(attendanceColumns((externalId) => restaurantName(externalId))).map((column) => (column.key === "clockIn" || column.key === "clockOut" || column.key === "deviation" ? { ...column, numeric: true } : column)),
    [restaurantName],
  )
  const loading = list.status === "LoadingFirstPage"
  const unfiltered = tab === "all" && !search.trim() && !restaurants.restaurantExternalId
  const create = () => navigate("/office/attendance/new")

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Приход и уход с кассы, автоявка по смене и корректировки офиса с согласованием.</p>
        {canEdit ? (
          <Button onClick={create}>
            <Plus aria-hidden />
            Новая запись
          </Button>
        ) : null}
      </div>
      <FilterTabs aria-label="Статус записей явки" value={tab} onValueChange={(value) => setTab(value as typeof tab)} panelId={panelId} items={ATTENDANCE_TABS} />
      <div id={panelId} role="tabpanel" aria-label={ATTENDANCE_TABS.find((item) => item.value === tab)?.label} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative w-full sm:w-[420px]">
            <span className="sr-only">Поиск: журнал явки</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Поиск: номер, сотрудник или код" className="pl-9" />
          </label>
          {restaurants.visible ? <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurants.value} onValueChange={restaurants.setValue} options={restaurants.options} /> : null}
          <span className="ml-auto text-caption text-muted-foreground">{loading ? "" : `${list.results.length} записей`}</span>
        </div>
        {loading ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : list.results.length === 0 && unfiltered && list.status === "Exhausted" ? (
          <OfficeStatePage
            state={{
              kind: "empty",
              title: "Записей явки пока нет",
              description: "Они появятся, когда сотрудники отметят приход на кассе или откроют смену.",
              action: canEdit ? (
                <Button variant="secondary" onClick={create}>
                  Новая запись
                </Button>
              ) : undefined,
            }}
          />
        ) : (
          <DataTable
            caption="Журнал явки"
            columns={columns}
            rows={list.results}
            getRowId={(row) => row.externalId}
            onRowClick={(row) => navigate(`/office/attendance/${encodeURIComponent(row.externalId)}`)}
            empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">Ничего не найдено по выбранным фильтрам</p>}
            loadMore={loadMoreFromPaginated(list, WORKFORCE_PAGE_SIZE)}
          />
        )}
      </div>
    </div>
  )
}
