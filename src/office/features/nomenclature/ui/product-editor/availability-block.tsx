import { useState } from "react"
import { useMutation } from "convex/react"

import { Button, DataTable, Input, Switch, useToast, type Column } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

import { api } from "../../../../../../convex/_generated/api"
import type { BranchPrice } from "../../data/use-nomenclature"

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** «до 25.09.2026» — the dish is back on sale at the next Almaty midnight after that day. */
export function untilFromDate(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  return Date.parse(`${date}T00:00:00Z`) - ALMATY_OFFSET_MS + DAY_MS
}

interface RowState {
  available: boolean
  reason: string
  until: string
  /** What the server last accepted, to show «Обновить» only on a real change. */
  saved: { reason: string; until: string }
}

function dateInput(until: number | null | undefined) {
  if (!until) return ""
  return new Date(until + 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** The row as the server has it (the card carries each branch's stop-list state). */
function initialRow(restaurant?: BranchPrice): RowState {
  const availability = restaurant?.availability
  const reason = availability?.reason ?? ""
  const until = dateInput(availability?.until)
  return { available: availability?.available ?? true, reason, until, saved: { reason, until } }
}

/**
 * «Наличие по филиалам» (W1-CAT-14): one row per restaurant in scope — «В продаже» switch, reason, «до».
 * Rows start from the stop-list state the product card returns.
 */
export function AvailabilityBlock({ productExternalId, restaurants, canEdit }: { productExternalId: string; restaurants: readonly BranchPrice[]; canEdit: boolean }) {
  const setAvailability = useMutation(api.domains.catalog.pos.setAvailability)
  const toast = useToast()
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(restaurants.map((restaurant) => [restaurant.restaurantExternalId, restaurant]))
  const rowOf = (restaurantExternalId: string) => rows[restaurantExternalId] ?? initialRow(byId.get(restaurantExternalId))
  const patch = (restaurantExternalId: string, value: Partial<RowState>) =>
    setRows((current) => ({ ...current, [restaurantExternalId]: { ...(current[restaurantExternalId] ?? initialRow(byId.get(restaurantExternalId))), ...value } }))

  async function commit(restaurant: BranchPrice, available: boolean) {
    const row = rowOf(restaurant.restaurantExternalId)
    const reason = row.reason.trim()
    const until = available ? undefined : untilFromDate(row.until)
    setBusy(restaurant.restaurantExternalId)
    setError(null)
    try {
      await setAvailability({
        productExternalId,
        restaurantExternalId: restaurant.restaurantExternalId,
        available,
        ...(reason && !available ? { reason } : {}),
        ...(until !== undefined ? { until } : {}),
      })
      patch(restaurant.restaurantExternalId, available ? { available, reason: "", until: "", saved: { reason: "", until: "" } } : { available, saved: { reason: row.reason, until: row.until } })
      toast(available ? `«${restaurant.name}»: снова в продаже` : `«${restaurant.name}»: в стоп-листе`, "success")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось изменить наличие"))
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<BranchPrice>[] = [
    { key: "branch", header: "Филиал", cell: (restaurant) => <span className="font-semibold">{restaurant.name}</span> },
    {
      key: "available",
      header: "В продаже",
      className: "w-28",
      cell: (restaurant) => {
        const row = rowOf(restaurant.restaurantExternalId)
        return (
          <Switch
            checked={row.available}
            onCheckedChange={(checked) => void commit(restaurant, checked)}
            disabled={!canEdit || busy === restaurant.restaurantExternalId}
            aria-label={`В продаже — ${restaurant.name}`}
          />
        )
      },
    },
    {
      key: "reason",
      header: "Причина",
      cell: (restaurant) => {
        const row = rowOf(restaurant.restaurantExternalId)
        return (
          <Input
            aria-label={`Причина — ${restaurant.name}`}
            placeholder="Закончилось, нет в меню филиала…"
            value={row.reason}
            onChange={(event) => patch(restaurant.restaurantExternalId, { reason: event.target.value })}
            disabled={!canEdit}
            autoComplete="off"
          />
        )
      },
    },
    {
      key: "until",
      header: "До",
      className: "w-44",
      cell: (restaurant) => {
        const row = rowOf(restaurant.restaurantExternalId)
        return (
          <Input
            type="date"
            aria-label={`До — ${restaurant.name}`}
            value={row.until}
            onChange={(event) => patch(restaurant.restaurantExternalId, { until: event.target.value })}
            disabled={!canEdit}
          />
        )
      },
    },
    {
      key: "update",
      header: "",
      className: "w-32",
      cell: (restaurant) => {
        const row = rowOf(restaurant.restaurantExternalId)
        const changed = !row.available && (row.reason !== row.saved.reason || row.until !== row.saved.until)
        return canEdit && changed ? (
          <Button size="sm" variant="secondary" onClick={() => void commit(restaurant, false)} disabled={busy === restaurant.restaurantExternalId}>
            Обновить
          </Button>
        ) : null
      },
    },
  ]

  return (
    <section aria-label="Наличие по филиалам" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">Наличие по филиалам</h3>
        <p className="text-caption text-muted-foreground">
          Выключите «В продаже», чтобы поставить блюдо в стоп-лист филиала. Причину и дату «до» заполните до переключения; пустая дата — до ручного включения.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DataTable
        caption="Наличие по филиалам"
        columns={columns}
        rows={[...restaurants]}
        getRowId={(restaurant) => restaurant.restaurantExternalId}
        empty={<p className="px-4 py-6 text-center text-body-sm text-muted-foreground">Нет филиалов в вашем доступе</p>}
      />
    </section>
  )
}
