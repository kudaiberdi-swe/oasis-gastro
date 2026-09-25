import { CalendarDays, ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { useSearchParams } from "react-router"

import { useCan } from "@/office/components/can"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary, usePlatformScope } from "@/office/features/platform/data/use-platform"
import { Banner, Button, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, SegmentedControl, Select, StatusPill, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { useScheduleMutations, useScheduleWeek, type ScheduleRow, type ScheduleShift, type ScheduleWeek } from "../data/use-workforce-w2"
import { addDays, currentWeekStart, dayLabel, formatShiftHours, mondayOf, shiftBlockLayout, weekRangeLabel } from "../model/w2"
import { ScheduleShiftDialog } from "./schedule-shift-dialog"
import { ColorSwatch } from "./shift-types-workspace"
import { ScheduleWeekGrid } from "./schedule-week"

// «Расписание» (W2-HR-04): /office/schedule?restaurant=…&week=YYYY-MM-DD — a week calendar instead of the
// bahandi table (OFFICE-DESIGN §5, POS-DESIGN §6.4), with a table view as the alternative.
// Blocks are not dragged: time changes go through the shift dialog (the server checks overlaps).

type View = "calendar" | "table"

type DialogState = { entry: ScheduleShift | null; defaults?: { employeeId?: string; date?: string } } | null

export function ScheduleWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Schedule />
    </PlatformErrorBoundary>
  )
}

function Schedule() {
  const scope = usePlatformScope()
  const [params, setParams] = useSearchParams()
  const canEdit = useCan("office.schedule.edit")
  const canPublish = useCan("office.schedule.approve")
  const { publishWeek } = useScheduleMutations()
  const toast = useToast()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [copying, setCopying] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requested = params.get("restaurant")
  const restaurantExternalId = scope.restaurants.some((restaurant) => restaurant.externalId === requested) ? requested! : scope.restaurants[0]?.externalId
  const weekParam = params.get("week")
  const weekStart = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? mondayOf(weekParam) : currentWeekStart()
  const view: View = params.get("view") === "table" ? "table" : "calendar"
  const week = useScheduleWeek(restaurantExternalId, weekStart)

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  const drafts = week ? week.rows.reduce((sum, row) => sum + row.days.reduce((daySum, day) => daySum + day.shifts.filter((shift) => shift.status === "draft").length, 0), 0) : 0

  async function publish() {
    if (!restaurantExternalId || publishing) return
    setPublishing(true)
    setError(null)
    try {
      const { published } = await publishWeek({ restaurantExternalId, weekStart })
      toast(`Опубликовано смен: ${published}`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось опубликовать неделю"))
    } finally {
      setPublishing(false)
    }
  }

  if (scope.loading) return <OfficeStatePage state={{ kind: "loading" }} />
  if (!restaurantExternalId) {
    return (
      <div className="px-6 py-5 xl:px-8">
        <EmptyState title="Нет доступных ресторанов" description="Расписание ведётся по ресторану — попросите администратора выдать доступ." />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center gap-3">
        {scope.restaurants.length > 1 ? (
          <Select aria-label="Ресторан" className="w-full sm:w-64" value={restaurantExternalId} onValueChange={(restaurant) => update({ restaurant })} options={scope.restaurants.map((restaurant) => ({ value: restaurant.externalId, label: restaurant.name }))} />
        ) : (
          <span className="text-body-sm font-semibold text-foreground">{scope.restaurants[0]?.name}</span>
        )}
        <div className="flex items-center gap-1" role="group" aria-label="Неделя">
          <Button variant="ghost" size="icon" aria-label="Предыдущая неделя" onClick={() => update({ week: addDays(weekStart, -7) })}>
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-44 text-center text-body-sm font-semibold tabular-nums" aria-live="polite">
            {weekRangeLabel(weekStart)}
          </span>
          <Button variant="ghost" size="icon" aria-label="Следующая неделя" onClick={() => update({ week: addDays(weekStart, 7) })}>
            <ChevronRight aria-hidden />
          </Button>
          {weekStart !== currentWeekStart() ? (
            <Button variant="ghost" size="sm" onClick={() => update({ week: null })}>
              <CalendarDays aria-hidden />
              Текущая неделя
            </Button>
          ) : null}
        </div>
        <SegmentedControl
          aria-label="Вид расписания"
          value={view}
          onValueChange={(next) => update({ view: next === "table" ? "table" : null })}
          options={[
            { value: "calendar", label: "Календарь" },
            { value: "table", label: "Таблица" },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setDialog({ entry: null, defaults: { date: weekStart } })}>
                <Plus aria-hidden />
                Новая смена
              </Button>
              <Button variant="secondary" onClick={() => setCopying(true)} disabled={!week}>
                <Copy aria-hidden />
                Скопировать неделю
              </Button>
            </>
          ) : null}
          {canPublish ? (
            <Button onClick={() => void publish()} disabled={publishing || drafts === 0}>
              {publishing ? "Публикация…" : "Опубликовать неделю"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Banner tone="danger" title="Не удалось выполнить действие">
          {error}
        </Banner>
      ) : null}

      {week === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : week.rows.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <OfficeStatePage state={{ kind: "empty", title: "В ресторане нет активных сотрудников", description: "Расписание строится по сотрудникам ресторана — добавьте их в разделе «Сотрудники»." }} />
        </div>
      ) : (
        <>
          <UpcomingShifts week={week} onOpen={(shift) => setDialog({ entry: shift })} />
          <p className="text-caption text-muted-foreground">{drafts ? `Черновиков на неделе: ${drafts} — сотрудники увидят их после публикации.` : allShifts(week).length ? "Все смены недели опубликованы." : "На этой неделе смен пока нет — нажмите на ячейку, чтобы добавить."}</p>
          {view === "calendar" ? (
            <ScheduleWeekGrid week={week} onCreate={canEdit ? (employeeId, date) => setDialog({ entry: null, defaults: { employeeId, date } }) : undefined} onOpen={(shift) => setDialog({ entry: shift })} />
          ) : (
            <ScheduleTable week={week} onOpen={(shift) => setDialog({ entry: shift })} />
          )}
        </>
      )}

      {dialog && week ? <ScheduleShiftDialog restaurantExternalId={restaurantExternalId} rows={week.rows} entry={dialog.entry} defaults={dialog.defaults} canEdit={canEdit} onClose={() => setDialog(null)} /> : null}
      {copying ? <CopyWeekDialog restaurantExternalId={restaurantExternalId} weekStart={weekStart} onClose={() => setCopying(false)} onCopied={(target) => update({ week: target })} /> : null}
    </div>
  )
}

function allShifts(week: ScheduleWeek) {
  return week.rows.flatMap((row) => row.days.flatMap((day) => day.shifts.map((shift) => ({ shift, row }))))
}

/** «Ближайшие смены» above the calendar, like the bahandi cards: the next shifts of the shown week. */
function UpcomingShifts({ week, onOpen }: { week: ScheduleWeek; onOpen: (shift: ScheduleShift) => void }) {
  const [now] = useState(() => Date.now())
  const next = allShifts(week)
    .filter(({ shift }) => shift.end > now)
    .sort((a, b) => a.shift.start - b.shift.start)
    .slice(0, 6)
  if (!next.length) return null
  return (
    <section aria-label="Ближайшие смены" className="flex flex-col gap-2">
      <h3 className="text-body-sm font-semibold text-foreground">Ближайшие смены</h3>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {next.map(({ shift, row }) => {
          const layout = shiftBlockLayout(shift)
          const { weekday, day } = dayLabel(shift.businessDate)
          return (
            <li key={shift.externalId} className="shrink-0">
              <button type="button" onClick={() => onOpen(shift)} className="flex w-56 flex-col gap-1 rounded-card border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted">
                <span className="flex items-center gap-2 truncate text-body-sm font-semibold">
                  <ColorSwatch token={shift.colorToken} />
                  <span className="truncate">{row.employeeName}</span>
                </span>
                <span className="truncate text-caption text-muted-foreground">{[row.positionName, shift.shiftTypeName].filter(Boolean).join(" · ") || "Смена"}</span>
                <span className="text-caption text-foreground tabular-nums">
                  {weekday} {day} · {layout.timeLabel}
                  {layout.nextDay ? " +1" : ""} · {formatShiftHours(shift.plannedHours)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type TableRow = { shift: ScheduleShift; row: ScheduleRow }

/** Table view (OFFICE-DESIGN §5): Дата · Сотрудник · Смена · Часы (ч, not ₸) · Статус. */
export const SCHEDULE_TABLE_COLUMNS: Column<TableRow>[] = [
  {
    key: "date",
    header: "Дата",
    cell: ({ shift }) => {
      const { weekday, day } = dayLabel(shift.businessDate)
      return <span className="whitespace-nowrap tabular-nums">{`${weekday} ${day}`}</span>
    },
  },
  {
    key: "employee",
    header: "Сотрудник",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{row.employeeName}</span>
        {row.positionName ? <span className="truncate text-caption text-muted-foreground">{row.positionName}</span> : null}
      </div>
    ),
  },
  {
    key: "shift",
    header: "Смена",
    cell: ({ shift }) => {
      const layout = shiftBlockLayout(shift)
      return (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <ColorSwatch token={shift.colorToken} />
          {[shift.shiftTypeName, `${layout.timeLabel}${layout.nextDay ? " +1" : ""}`].filter(Boolean).join(" · ")}
        </span>
      )
    },
  },
  { key: "hours", header: "Часы", numeric: true, cell: ({ shift }) => formatShiftHours(shift.plannedHours) },
  { key: "status", header: "Статус", cell: ({ shift }) => <StatusPill domain="document" status={shift.status} /> },
]

function ScheduleTable({ week, onOpen }: { week: ScheduleWeek; onOpen: (shift: ScheduleShift) => void }) {
  const rows = useMemo(() => allShifts(week).sort((a, b) => a.shift.start - b.shift.start), [week])
  return (
    <DataTable
      caption="Смены недели"
      columns={SCHEDULE_TABLE_COLUMNS}
      rows={rows}
      getRowId={({ shift }) => shift.externalId}
      onRowClick={({ shift }) => onOpen(shift)}
      empty={<p className="px-4 py-10 text-center text-body-sm text-muted-foreground">На этой неделе смен пока нет</p>}
    />
  )
}

function CopyWeekDialog({ restaurantExternalId, weekStart, onClose, onCopied }: { restaurantExternalId: string; weekStart: string; onClose: () => void; onCopied: (target: string) => void }) {
  const { copyWeek } = useScheduleMutations()
  const toast = useToast()
  const [target, setTarget] = useState(addDays(weekStart, 7))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(target)
  const targetWeek = valid ? mondayOf(target) : null
  const same = targetWeek === weekStart

  async function submit() {
    if (!targetWeek || same || busy) return
    setBusy(true)
    setError(null)
    try {
      const { copied, skipped } = await copyWeek({ restaurantExternalId, fromWeekStart: weekStart, toWeekStart: targetWeek })
      toast(skipped ? `Скопировано смен: ${copied}, пропущено из-за пересечений: ${skipped}` : `Скопировано смен: ${copied}`, skipped ? "info" : "success")
      onCopied(targetWeek)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось скопировать неделю"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Скопировать неделю</DialogTitle>
          <DialogDescription>Смены недели {weekRangeLabel(weekStart)} скопируются черновиками; пересекающиеся с уже запланированными пропустятся.</DialogDescription>
        </DialogHeader>
        <Field label="На неделю" hint={targetWeek ? (same ? "Выберите другую неделю" : `Неделя ${weekRangeLabel(targetWeek)}`) : "Укажите любой день недели"} error={same ? "Это та же неделя" : undefined}>
          {(control) => <Input {...control} type="date" value={target} onChange={(event) => setTarget(event.target.value)} />}
        </Field>
        {error ? (
          <Banner tone="danger" title="Не удалось скопировать">
            {error}
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!targetWeek || same || busy}>
            {busy ? "Копирование…" : "Скопировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
