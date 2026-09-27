import { Field, Input, Select, Skeleton } from "@/shared/components/ui"
import { formatQuantity } from "@/shared/lib/format"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import { formatBusinessDate, intervalLabel, peakInterval, weekdayName, type RecordModule } from "../config"
import { useKitchenForecast, type useForecastTarget } from "../data/use-production-logistics"

const CARDS = 8

/**
 * «Прогноз кухни» (W3-PRD-07, L-14) — the same panel above «План на кухню» and «Ведомость полуфабрикатов»:
 * the restaurant and date, then the eight dishes most in demand on that weekday with «Рекомендуется: N».
 */
export function ForecastPanel({ moduleId, target }: { moduleId: RecordModule; target: ReturnType<typeof useForecastTarget> }) {
  const forecast = useKitchenForecast(moduleId, target.restaurantExternalId, target.targetDate)
  const cards = forecast?.products.slice(0, CARDS) ?? []
  // The day's shape is the restaurant's (quarter-hour facts): one peak for every dish.
  const peak = forecast ? peakInterval(forecast.intervals) : null
  return (
    <section aria-label="Прогноз кухни" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-panel">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-title-sm font-semibold">Прогноз кухни</h3>
          <p className="text-body-sm text-muted-foreground">Средний спрос за шесть недель; расчёт по 15-минутным интервалам</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {target.restaurants.length > 1 ? (
            <Field label="Ресторан" className="w-full sm:w-64">
              {(control) => <Select {...control} value={target.restaurantExternalId || undefined} onValueChange={(restaurant) => target.set({ restaurant })} options={restaurantSelectOptions(target.restaurants)} placeholder="Выберите ресторан" />}
            </Field>
          ) : null}
          <Field label="Дата" className="w-full sm:w-44">
            {(control) => <Input {...control} type="date" value={target.targetDate} onChange={(event) => event.target.value && target.set({ date: event.target.value })} />}
          </Field>
        </div>
      </div>
      {!target.restaurantExternalId && !target.loading ? (
        <p className="text-body-sm text-muted-foreground">Нет ресторана в вашем доступе — прогноз строится по одному ресторану.</p>
      ) : forecast === undefined ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
          {Array.from({ length: CARDS }, (_, index) => (
            <Skeleton key={index} className="h-[72px] w-full" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Нет продаж в этот день недели ({weekdayName(forecast.weekday)}) за шесть недель до {formatBusinessDate(forecast.targetDate)} — рекомендовать нечего.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((row) => (
              <li key={row.productExternalId} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-background p-3">
                <span className="truncate text-body-sm font-semibold" title={row.name}>
                  {row.name}
                </span>
                <span className="text-caption text-muted-foreground">Рекомендуется: {row.recommendedQuantity}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted-foreground">
            На {formatBusinessDate(forecast.targetDate)} ({weekdayName(forecast.weekday)}) · дней с продажами: {forecast.daysWithSales} из {forecast.sourceDates.length} · блюд в прогнозе: {forecast.products.length} · в среднем {formatQuantity(forecast.intervals.reduce((sum, value) => sum + value, 0))} заказов за день{peak !== null ? ` · пик ${intervalLabel(peak)}` : ""}
          </p>
        </>
      )}
    </section>
  )
}
