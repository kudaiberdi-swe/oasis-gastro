import { Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useDebounced } from "@/office/features/stock/data/use-stock-master"
import { Combobox, Field, Input } from "@/shared/components/ui"
import { restaurantSelectOptions } from "@/shared/lib/restaurant-options"

import type { ReportRestaurant } from "../data/use-reports"
import type { ReportFilters } from "../model/url-state"

// One filter row with wrapping (W1-RPT-03): «С», «По», «Рестораны» (chips), optional search.
// Empty restaurants = every restaurant in the user's scope (the server resolves it).

export function ReportFiltersBar({
  filters,
  onChange,
  restaurants,
  withSearch = false,
}: {
  filters: ReportFilters
  onChange: (next: ReportFilters) => void
  restaurants: ReportRestaurant[] | undefined
  withSearch?: boolean
}) {
  const options = useMemo(() => restaurantSelectOptions(restaurants ?? []), [restaurants])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <Field label="С" className="w-40">
          {(control) => <Input {...control} type="date" value={filters.dateFrom} max={filters.dateTo} onChange={(event) => onChange({ ...filters, dateFrom: event.target.value })} />}
        </Field>
        <Field label="По" className="w-40">
          {(control) => <Input {...control} type="date" value={filters.dateTo} min={filters.dateFrom} onChange={(event) => onChange({ ...filters, dateTo: event.target.value })} />}
        </Field>
        <Field label="Рестораны" className="min-w-56 flex-1 sm:max-w-md">
          {(control) => (
            <Combobox
              {...control}
              multiple
              options={options}
              value={filters.restaurantExternalIds}
              onValueChange={(restaurantExternalIds) => onChange({ ...filters, restaurantExternalIds })}
              placeholder={restaurants === undefined ? "Загрузка…" : "Все рестораны"}
              searchPlaceholder="Название ресторана"
              disabled={restaurants === undefined}
            />
          )}
        </Field>
      </div>
      {withSearch ? <SearchInput value={filters.search} onChange={(search) => onChange({ ...filters, search })} /> : null}
    </div>
  )
}

/** Typed text is debounced before it reaches the URL and the server (`config.search`). */
function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value)
  const debounced = useDebounced(text, 300)
  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // Only the debounced text drives the change; `value` follows it through the URL.
  }, [debounced])
  return (
    <div className="relative max-w-xl">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" aria-label="Фильтр строк отчёта" placeholder="Фильтр по названию строки" value={text} onChange={(event) => setText(event.target.value)} className="pl-9" />
    </div>
  )
}
