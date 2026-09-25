import { Plus, TriangleAlert } from "lucide-react"

import { cn, focusRingClass } from "@/shared/lib/utils"

import type { ScheduleRow, ScheduleShift, ScheduleWeek } from "../data/use-workforce-w2"
import { dayLabel, formatShiftHours, normLabel, shiftBlockLayout, shiftColor } from "../model/w2"

// «Расписание» (W2-HR-04): the week calendar — rows are employees, columns are days, shift blocks in the
// color of their shift type, hours per employee on the right with a warning above the position norm.

export interface ScheduleWeekGridProps {
  week: ScheduleWeek
  /** Empty-cell click → «Новая смена» for that employee and day; absent without the edit right. */
  onCreate?: (employeeId: string, date: string) => void
  onOpen: (shift: ScheduleShift, row: ScheduleRow) => void
}

export function shiftAccessibleLabel(shift: ScheduleShift, employeeName: string) {
  const layout = shiftBlockLayout(shift)
  const { weekday, day } = dayLabel(shift.businessDate)
  return [
    `Смена: ${employeeName}`,
    `${weekday} ${day}`,
    `${layout.timeLabel}${layout.nextDay ? " (до следующего дня)" : ""}`,
    formatShiftHours(shift.plannedHours),
    shift.status === "draft" ? "черновик" : "опубликована",
  ].join(", ")
}

export function ScheduleWeekGrid({ week, onCreate, onOpen }: ScheduleWeekGridProps) {
  const dayTotals = week.days.map((_, index) => week.rows.reduce((sum, row) => sum + row.days[index].hours, 0))
  const weekTotal = dayTotals.reduce((sum, hours) => sum + hours, 0)

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card">
      <table aria-label="Расписание на неделю" className="w-full min-w-[1040px] table-fixed border-collapse text-body-sm">
        <colgroup>
          <col className="w-56" />
          {week.days.map((date) => (
            <col key={date} />
          ))}
          <col className="w-40" />
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-3 text-left text-caption font-semibold text-muted-foreground">
              Сотрудник
            </th>
            {week.days.map((date) => {
              const { weekday, day } = dayLabel(date)
              return (
                <th key={date} scope="col" className="border-l border-border px-2 py-3 text-left text-caption font-semibold text-muted-foreground">
                  <span className="text-foreground">{weekday}</span> <span className="tabular-nums">{day}</span>
                </th>
              )
            })}
            <th scope="col" className="border-l border-border px-3 py-3 text-right text-caption font-semibold text-muted-foreground">
              Часы за неделю
            </th>
          </tr>
        </thead>
        <tbody>
          {week.rows.map((row) => (
            <tr key={row.employeeId} className="border-b border-border last:border-b-0">
              <th scope="row" className="px-4 py-2 text-left align-top font-normal">
                <span className="block truncate font-semibold text-foreground">{row.employeeName}</span>
                <span className="block truncate text-caption text-muted-foreground">{row.positionName ?? `код ${row.employeeCode}`}</span>
              </th>
              {row.days.map((day) => (
                <DayCell key={day.date} row={row} date={day.date} shifts={day.shifts} onCreate={onCreate} onOpen={onOpen} />
              ))}
              <td className={cn("border-l border-border px-3 py-2 text-right align-top tabular-nums", row.overNorm ? "bg-warning/10 text-warning-foreground" : "text-foreground")}>
                <span className="inline-flex items-center justify-end gap-1 font-semibold">
                  {row.overNorm ? <TriangleAlert aria-hidden className="size-4" /> : null}
                  {normLabel(row.plannedHours, row.weeklyNorm)}
                </span>
                {row.overNorm ? <span className="block text-caption">Сверх нормы на {formatShiftHours(row.plannedHours - (row.weeklyNorm ?? 0))}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted">
            <th scope="row" className="px-4 py-2 text-left text-caption font-semibold text-muted-foreground">
              Итого за день
            </th>
            {dayTotals.map((hours, index) => (
              <td key={week.days[index]} className="border-l border-border px-2 py-2 text-caption font-semibold tabular-nums">
                {hours ? formatShiftHours(hours) : "—"}
              </td>
            ))}
            <td className="border-l border-border px-3 py-2 text-right text-caption font-semibold tabular-nums">{formatShiftHours(weekTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function DayCell({ row, date, shifts, onCreate, onOpen }: { row: ScheduleRow; date: string; shifts: ScheduleShift[]; onCreate?: ScheduleWeekGridProps["onCreate"]; onOpen: ScheduleWeekGridProps["onOpen"] }) {
  const { weekday, day } = dayLabel(date)
  return (
    <td className="group border-l border-border p-1 align-top">
      <div className="flex min-h-16 flex-col gap-1">
        {shifts.map((shift) => (
          <ShiftBlock key={shift.externalId} shift={shift} onClick={() => onOpen(shift, row)} label={shiftAccessibleLabel(shift, row.employeeName)} />
        ))}
        {onCreate ? (
          <button
            type="button"
            aria-label={`Новая смена: ${row.employeeName}, ${weekday} ${day}`}
            onClick={() => onCreate(row.employeeId, date)}
            className={cn(
              "grid place-items-center rounded-control text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100",
              shifts.length ? "h-7 opacity-0 group-hover:opacity-100" : "min-h-16 flex-1 opacity-60 group-hover:opacity-100",
              focusRingClass,
            )}
          >
            <Plus aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
    </td>
  )
}

function ShiftBlock({ shift, label, onClick }: { shift: ScheduleShift; label: string; onClick: () => void }) {
  const layout = shiftBlockLayout(shift)
  const color = shiftColor(shift.colorToken)
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn("flex w-full flex-col rounded-control border-l-4 px-2 py-1 text-left transition-colors hover:brightness-95", color.block, focusRingClass)}>
      <span className="truncate text-caption font-semibold text-foreground">{shift.shiftTypeName ?? "Смена"}</span>
      <span className="text-caption text-foreground tabular-nums">
        {layout.timeLabel}
        {layout.nextDay ? <span className="text-muted-foreground"> +{layout.nextDay}</span> : null}
      </span>
      <span className="flex items-center justify-between gap-1 text-caption text-muted-foreground">
        <span className="tabular-nums">{formatShiftHours(shift.plannedHours)}</span>
        {shift.status === "draft" ? <span>черновик</span> : null}
      </span>
    </button>
  )
}
