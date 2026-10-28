import { DataTable, formatMoneyDigits, MoneyInput, type Column } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/format"

import type { BranchPrice } from "../../data/use-nomenclature"

type PriceSource = BranchPrice["resolvedPriceNow"]["source"]

// The price in force right now and where it comes from (W1-CAT-02 resolvePrice). The iiko overlay
// price is the card's base price edited in OASIS Gastro, so it reads as «базовая».
const SOURCE_LABELS: Record<PriceSource, string> = { "price-order": "приказ", branch: "филиал", base: "базовая", overlay: "базовая" }

export interface BranchPricesBlockProps {
  rows: readonly BranchPrice[]
  values: Record<string, number | null>
  onChange: (restaurantExternalId: string, price: number | null) => void
  basePrice: number | null
  /** Hidden-not-disabled rule: without the right the own price is shown as text. */
  editable: boolean
  /** Why the prices can't be edited right now (shown under the table). */
  notice?: string
}

/** «Цена по филиалам»: филиал · своя цена · действует сейчас с источником. */
export function BranchPricesBlock({ rows, values, onChange, basePrice, editable, notice }: BranchPricesBlockProps) {
  const columns: Column<BranchPrice>[] = [
    { key: "branch", header: "Филиал", cell: (row) => <span className="font-semibold">{row.name}</span> },
    {
      key: "own",
      header: "Своя цена",
      className: "w-56",
      cell: (row) => {
        const value = values[row.restaurantExternalId] ?? null
        if (!editable) return <span className="tabular-nums">{value === null ? "—" : formatTenge(value)}</span>
        return (
          <MoneyInput
            aria-label={`Своя цена — ${row.name}`}
            placeholder={basePrice === null ? undefined : formatMoneyDigits(String(basePrice))}
            value={value}
            onValueChange={(price) => onChange(row.restaurantExternalId, price)}
          />
        )
      },
    },
    {
      key: "now",
      header: "Действует сейчас",
      numeric: true,
      cell: (row) => (
        <span className="inline-flex items-baseline gap-2">
          <span>{formatTenge(row.resolvedPriceNow.price)}</span>
          <span className="text-caption text-muted-foreground">{SOURCE_LABELS[row.resolvedPriceNow.source]}</span>
        </span>
      ),
    },
  ]

  return (
    <section aria-label="Цена по филиалам" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">Цена по филиалам</h3>
        <p className="text-caption text-muted-foreground">Пусто — действует базовая цена. Приказ о ценах перекрывает цену филиала на время своего действия.</p>
      </div>
      <DataTable
        caption="Цена по филиалам"
        columns={columns}
        rows={[...rows]}
        getRowId={(row) => row.restaurantExternalId}
        empty={<p className="px-4 py-6 text-center text-body-sm text-muted-foreground">Нет филиалов в вашем доступе</p>}
      />
      {notice ? <p className="text-caption text-muted-foreground">{notice}</p> : null}
    </section>
  )
}
