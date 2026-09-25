import { Trash2 } from "lucide-react"
import { Fragment, useState } from "react"

import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { Combobox, Input, Money } from "@/shared/components/ui"
import { formatAmount, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useDeliveryProducts, type DeliveryProduct } from "../data/use-delivery"
import type { DeliveryLineDraft } from "../model/order-draft"

export type DeliveryTotals = { subtotal: number; deliveryFee: number; commissionAmount?: number; total: number }

export interface DeliveryOrderLinesProps {
  restaurantExternalId: string | undefined
  lines: readonly DeliveryLineDraft[]
  readOnly: boolean
  errors: Record<string, string>
  linesError?: string
  /** The saved order's figures from the server; null for a new order. */
  totals: DeliveryTotals | null
  /** The form differs from the saved order: the totals are those of the last save. */
  stale: boolean
  onAdd: (product: DeliveryProduct) => void
  onChange: (key: string, patch: Partial<DeliveryLineDraft>) => void
  onRemove: (key: string) => void
}

/** «Состав заказа / Цены берутся из действующего каталога» (office-details/11). */
export function DeliveryOrderLines({ restaurantExternalId, lines, readOnly, errors, linesError, totals, stale, onAdd, onChange, onRemove }: DeliveryOrderLinesProps) {
  const head = "h-10 px-3 font-semibold"
  const columns = readOnly ? 6 : 7
  return (
    <section aria-label="Состав заказа" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">Состав заказа</h3>
          <p className="text-caption text-muted-foreground">Цены берутся из действующего каталога</p>
        </div>
        {!readOnly ? <ProductPicker restaurantExternalId={restaurantExternalId} onPick={onAdd} /> : null}
      </div>
      {linesError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {linesError}
        </p>
      ) : null}
      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Позиции заказа</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className={cn(head, "text-left")}>
                Товар
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Размер
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Модификаторы
              </th>
              <th scope="col" className={cn(head, "w-28 text-right")}>
                Кол-во
              </th>
              <th scope="col" className={cn(head, "w-32 text-right")}>
                Цена, ₸
              </th>
              <th scope="col" className={cn(head, "w-32 text-right")}>
                Сумма, ₸
              </th>
              {!readOnly ? (
                <th scope="col" className="w-12 px-3">
                  <span className="sr-only">Удалить</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const error = errors[line.key]
              return (
                <Fragment key={line.key}>
                  <tr className={cn("h-[var(--table-row-h)] align-middle", error ? "" : "border-b border-border")}>
                    <td className="px-3 py-2 font-semibold">{line.productName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{line.sizeLabel ?? (line.sizeExternalId ? "Выбран" : "По умолчанию")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{line.modifierLabels.length ? line.modifierLabels.join(", ") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {readOnly ? (
                        formatQuantity(parseDecimal(line.quantity) ?? 0)
                      ) : (
                        <Input
                          aria-label={`Количество — ${line.productName}`}
                          aria-invalid={error ? true : undefined}
                          inputMode="decimal"
                          className="h-10 text-right tabular-nums"
                          value={line.quantity}
                          onChange={(event) => onChange(line.key, { quantity: event.target.value, lineTotal: null })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{line.unitPrice === null ? "—" : formatAmount(line.unitPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={line.lineTotal === null ? "Сумму строки считает сервер при сохранении" : undefined}>
                      {line.lineTotal === null ? <span className="text-muted-foreground">после сохранения</span> : formatAmount(line.lineTotal)}
                    </td>
                    {!readOnly ? (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          aria-label={`Удалить «${line.productName}»`}
                          onClick={() => onRemove(line.key)}
                          className={cn("grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-destructive", focusRingClass)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {error ? (
                    <tr className="border-b border-border">
                      <td colSpan={columns} className="px-3 pb-2">
                        <span role="alert" className="text-caption text-destructive">
                          {line.productName}: {error}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {lines.length === 0 ? <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{readOnly ? "В заказе нет позиций." : "Позиций пока нет — найдите блюдо и добавьте его."}</p> : null}
      </div>
      <OrderTotals totals={totals} stale={stale} />
    </section>
  )
}

function OrderTotals({ totals, stale }: { totals: DeliveryTotals | null; stale: boolean }) {
  if (!totals) {
    return <p className="text-right text-body-sm text-muted-foreground">Итог, доставку по зоне и номер заказа рассчитает сервер при сохранении.</p>
  }
  return (
    <div className="flex flex-col items-end gap-1 text-body-sm">
      {stale ? <p className="text-caption text-warning">Итог — на момент последнего сохранения; сохраните заказ, чтобы пересчитать.</p> : null}
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-right">
        <dt className="text-muted-foreground">Подытог</dt>
        <dd className="tabular-nums">{formatTenge(totals.subtotal)}</dd>
        <dt className="text-muted-foreground">Доставка</dt>
        <dd className="tabular-nums">{formatTenge(totals.deliveryFee)}</dd>
        {totals.commissionAmount ? (
          <>
            <dt className="text-muted-foreground">Комиссия агрегатора</dt>
            <dd className="tabular-nums">{formatTenge(totals.commissionAmount)}</dd>
          </>
        ) : null}
        <dt className="self-center font-semibold text-foreground">К оплате</dt>
        <dd>
          <Money value={totals.total} size="lg" />
        </dd>
      </dl>
    </div>
  )
}

/** «+ Добавить»: dishes of the restaurant with its price in force; a stop-listed dish is refused. */
function ProductPicker({ restaurantExternalId, onPick }: { restaurantExternalId: string | undefined; onPick: (product: DeliveryProduct) => void }) {
  const [search, setSearch] = useState("")
  const [refused, setRefused] = useState<string | null>(null)
  const products = useDeliveryProducts(restaurantExternalId, search)
  const options = (products ?? []).map((product) => ({
    value: product.productExternalId,
    label: product.name,
    hint: product.available ? formatTenge(product.price) : `${formatTenge(product.price)} · в стоп-листе`,
  }))
  return (
    <div className="flex w-full flex-col gap-1 sm:w-80">
      <Combobox
        aria-label="Добавить"
        value={undefined}
        disabled={!restaurantExternalId}
        onValueChange={(externalId) => {
          const product = products?.find((candidate) => candidate.productExternalId === externalId)
          if (!product) return
          if (!product.available) return setRefused(`«${product.name}» в стоп-листе ресторана`)
          setRefused(null)
          onPick(product)
        }}
        onSearchChange={setSearch}
        options={options}
        placeholder={restaurantExternalId ? "+ Добавить" : "Сначала выберите ресторан"}
        searchPlaceholder="Название блюда"
        emptyText={products === undefined ? "Загрузка…" : "Ничего не найдено"}
      />
      {refused ? (
        <p role="alert" className="text-caption text-destructive">
          {refused}
        </p>
      ) : null}
    </div>
  )
}
