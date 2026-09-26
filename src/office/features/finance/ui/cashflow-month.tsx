import { ChevronLeft, ChevronRight } from "lucide-react"

import { Banner, Button, KpiCard, Skeleton } from "@/shared/components/ui"
import { formatAmount, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { CashflowForecast } from "../data/use-planning"
import { formatBusinessDate } from "../model/modules"
import { formatMonth, monthGrid, shiftMonth, WEEKDAYS } from "../model/planning"

export interface CashflowMonthProps {
  month: string
  onMonthChange: (month: string) => void
  forecast: CashflowForecast | undefined
}

/**
 * Above the payment calendar register (W3-FIN-12, OFFICE-DESIGN §5): KPI «Поступления / Платежи / Минимальный
 * остаток» (L-11) and the month with the planned sums of each day and the money left at its end; a day with a
 * cash gap is destructive. Days are Almaty business dates; the forecast starts today.
 */
export function CashflowMonth({ month, onMonthChange, forecast }: CashflowMonthProps) {
  const weeks = monthGrid(month)
  const byDate = new Map((forecast?.days ?? []).map((day) => [day.date, day]))
  const gap = forecast ? forecast.gapDays > 0 : false
  const past = forecast ? forecast.days.every((day) => day.balance === null) : false

  return (
    <section aria-label="Платёжный календарь месяца" className="flex flex-col gap-4">
      {forecast === undefined ? (
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard label="Поступления" value={formatTenge(forecast.incoming)} hint={`Остаток денег сегодня: ${formatTenge(forecast.currentBalance)}`} />
          <KpiCard label="Платежи" value={formatTenge(forecast.outgoing)} hint={forecast.overdue.items ? `Просрочено и перенесено на сегодня: ${formatTenge(forecast.overdue.outgoing + forecast.overdue.incoming)}` : "Просроченных нет"} hintTone={forecast.overdue.items ? "danger" : "neutral"} />
          <KpiCard
            label="Минимальный остаток"
            value={forecast.minimumBalance === null ? "—" : formatTenge(forecast.minimumBalance)}
            hint={forecast.minimumBalance === null ? "Прогноз строится с сегодняшнего дня" : gap ? `Кассовый разрыв: дней ${forecast.gapDays}` : "Разрывов нет"}
            hintTone={gap ? "danger" : "neutral"}
          />
        </div>
      )}
      {forecast?.truncated ? (
        <Banner tone="warning" title="Посчитано не полностью">
          Слишком много записей — прогноз посчитан по первым из них.
        </Banner>
      ) : null}
      <div className="rounded-card border border-border bg-card p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" aria-label="Предыдущий месяц" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft aria-hidden />
          </Button>
          <h2 className="font-display text-title-sm font-semibold text-foreground">{formatMonth(month)}</h2>
          <Button variant="ghost" size="sm" aria-label="Следующий месяц" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        {past ? <p className="mb-3 text-caption text-muted-foreground">Месяц прошёл: прогноз строится с сегодняшнего дня, открытые суммы перенесены на сегодня.</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-caption">
            <caption className="sr-only">Поступления, платежи и остаток по дням: {formatMonth(month)}</caption>
            <thead>
              <tr>
                {WEEKDAYS.map((day) => (
                  <th key={day} scope="col" className="pb-1 text-center font-medium text-muted-foreground">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, index) => (
                <tr key={index}>
                  {week.map((date, column) => {
                    if (!date) return <td key={column} />
                    const day = byDate.get(date)
                    const today = forecast?.today === date
                    return (
                      <td
                        key={date}
                        aria-label={`${formatBusinessDate(date)}${day?.gap ? ", кассовый разрыв" : ""}`}
                        className={cn(
                          "h-20 rounded-control border p-1.5 align-top",
                          day?.gap ? "border-destructive/40 bg-destructive/10" : today ? "border-accent bg-accent/10" : "border-border",
                          day?.balance === null && "text-muted-foreground",
                        )}
                      >
                        <div className="flex h-full flex-col gap-0.5">
                          <span className={cn("font-semibold", today && "text-accent")}>{Number(date.slice(8))}</span>
                          {day?.incoming ? <span className="tabular-nums text-success">+{formatAmount(day.incoming)}</span> : null}
                          {day?.outgoing ? <span className="tabular-nums text-foreground">−{formatAmount(day.outgoing)}</span> : null}
                          {day && day.balance !== null && (day.items || today) ? (
                            <span className={cn("mt-auto tabular-nums", day.gap ? "font-semibold text-destructive" : "text-muted-foreground")}>= {formatAmount(day.balance)}</span>
                          ) : null}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {forecast?.undated.items ? <p className="mt-2 text-caption text-muted-foreground">Обязательств без срока оплаты: {forecast.undated.items} на {formatTenge(forecast.undated.amount)} — в прогноз не вошли.</p> : null}
      </div>
    </section>
  )
}
