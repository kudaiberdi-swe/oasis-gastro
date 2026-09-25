import { SlidersHorizontal, Trash2 } from "lucide-react"
import { Fragment, useCallback, useState } from "react"

import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { Combobox, Input, Money } from "@/shared/components/ui"
import { formatAmount, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { useDeliveryProducts, type DeliveryChannel } from "../data/use-delivery"
import { productPickerEmptyText, type DeliveryLineDraft, type DishChoice } from "../model/order-draft"
import { DeliveryProductConfigurator, type ConfigurationTarget } from "./delivery-product-dialog"

export type DeliveryTotals = { subtotal: number; deliveryFee: number; commissionAmount?: number; total: number }

export interface DeliveryOrderLinesProps {
  restaurantExternalId: string | undefined
  channel: DeliveryChannel
  lines: readonly DeliveryLineDraft[]
  readOnly: boolean
  errors: Record<string, string>
  linesError?: string
  /** The saved order's figures from the server; null for a new order. */
  totals: DeliveryTotals | null
  /** The form differs from the saved order: the totals are those of the last save. */
  stale: boolean
  /** A dish from «+ Добавить», with its size and modifiers when it has any. */
  onAdd: (dish: DishChoice) => void
  /** «Размер и добавки» of a line changed in the dialog. */
  onReconfigure: (key: string, dish: DishChoice) => void
  onChange: (key: string, patch: Partial<DeliveryLineDraft>) => void
  onRemove: (key: string) => void
}

/** «Состав заказа / Цены берутся из действующего каталога» (office-details/11). */
export function DeliveryOrderLines({ restaurantExternalId, channel, lines, readOnly, errors, linesError, totals, stale, onAdd, onReconfigure, onChange, onRemove }: DeliveryOrderLinesProps) {
  const head = "h-10 px-3 font-semibold"
  const columns = readOnly ? 6 : 7
  const [editing, setEditing] = useState<ConfigurationTarget | null>(null)
  const closeEditing = useCallback(() => setEditing(null), [])
  const applyEditing = useCallback((dish: DishChoice, key?: string) => key && onReconfigure(key, dish), [onReconfigure])
  return (
    <section aria-label="Состав заказа" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">Состав заказа</h3>
          <p className="text-caption text-muted-foreground">Цены берутся из действующего каталога</p>
        </div>
        {!readOnly ? <ProductPicker restaurantExternalId={restaurantExternalId} channel={channel} onPick={onAdd} /> : null}
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
                <th scope="col" className="w-24 px-3">
                  <span className="sr-only">Действия</span>
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
                        <span className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={`Размер и добавки — ${line.productName}`}
                            title="Размер и добавки"
                            onClick={() =>
                              setEditing({
                                productExternalId: line.productExternalId,
                                name: line.productName,
                                line: { key: line.key, quantity: Math.max(1, Math.round(parseDecimal(line.quantity) ?? 1)), sizeExternalId: line.sizeExternalId, modifierSelections: line.modifierSelections },
                              })
                            }
                            className={cn("grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground", focusRingClass)}
                          >
                            <SlidersHorizontal className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Удалить «${line.productName}»`}
                            onClick={() => onRemove(line.key)}
                            className={cn("grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-destructive", focusRingClass)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </span>
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
      {editing ? <DeliveryProductConfigurator key={editing.line?.key} restaurantExternalId={restaurantExternalId} channel={channel} target={editing} onClose={closeEditing} onDone={applyEditing} /> : null}
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

/**
 * «+ Добавить»: dishes of the restaurant with its price in force; a stop-listed dish is refused, a dish
 * with sizes or modifier groups opens «Размер и добавки» (productConfiguration).
 */
function ProductPicker({ restaurantExternalId, channel, onPick }: { restaurantExternalId: string | undefined; channel: DeliveryChannel; onPick: (dish: DishChoice) => void }) {
  const [search, setSearch] = useState("")
  const [refused, setRefused] = useState<string | null>(null)
  const [target, setTarget] = useState<ConfigurationTarget | null>(null)
  const products = useDeliveryProducts(restaurantExternalId, search, channel)
  const close = useCallback(() => setTarget(null), [])
  const options = (products ?? []).map((product) => ({
    value: product.productExternalId,
    label: product.name,
    hint: product.available ? `${product.hasSizes ? "от " : ""}${formatTenge(product.price)}` : `${formatTenge(product.price)} · в стоп-листе`,
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
          setTarget({ productExternalId: product.productExternalId, name: product.name })
        }}
        onSearchChange={setSearch}
        options={options}
        placeholder={restaurantExternalId ? "+ Добавить" : "Сначала выберите ресторан"}
        searchPlaceholder="Название блюда"
        emptyText={productPickerEmptyText(search, products === undefined)}
      />
      {target ? <DeliveryProductConfigurator key={target.productExternalId} restaurantExternalId={restaurantExternalId} channel={channel} target={target} onClose={close} onDone={onPick} /> : null}
      {refused ? (
        <p role="alert" className="text-caption text-destructive">
          {refused}
        </p>
      ) : null}
    </div>
  )
}
