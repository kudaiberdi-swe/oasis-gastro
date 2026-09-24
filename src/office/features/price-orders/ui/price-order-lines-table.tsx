import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button, Checkbox, Combobox, Input, MoneyInput, type ComboboxOption } from "@/shared/components/ui"
import { formatPercent, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { PriceOrderLine } from "../data/use-price-orders"
import { lineKey, markupPercent, type PriceLineDraft } from "../model/use-price-order-draft"

export interface PriceOrderLinesTableProps {
  lines: readonly PriceLineDraft[]
  /** The saved lines: «Было» (price before the order) and the portion cost come from the server. */
  saved: readonly PriceOrderLine[]
  readOnly: boolean
  errors: Record<string, string>
  productOptions: ComboboxOption[]
  onAddProduct: (productExternalId: string) => void
  onChange: (key: string, patch: Partial<PriceLineDraft>) => void
  onRemove: (key: string) => void
}

/** «Позиции прайс-листа»: Вкл · Наименование · Размер · Было · Новая цена · Наценка · удалить. */
export function PriceOrderLinesTable({ lines, saved, readOnly, errors, productOptions, onAddProduct, onChange, onRemove }: PriceOrderLinesTableProps) {
  const [filter, setFilter] = useState("")
  const [product, setProduct] = useState<string | undefined>()
  const savedByKey = useMemo(() => new Map(saved.map((line) => [lineKey(line.productExternalId, line.sizeOptionExternalId), line])), [saved])
  const needle = filter.trim().toLocaleLowerCase("ru")
  const visible = needle ? lines.filter((line) => `${line.productName} ${line.sizeLabel ?? ""}`.toLocaleLowerCase("ru").includes(needle)) : lines
  const included = lines.filter((line) => line.included).length

  return (
    <section aria-label="Позиции прайс-листа" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title-sm font-semibold">Позиции прайс-листа</h3>
        <p className="text-caption text-muted-foreground">
          {readOnly ? `Включено позиций: ${included} из ${lines.length}` : "Включите строки и назначьте новую цену. «Было» считается при сохранении на дату начала."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" aria-label="Поиск по позициям" placeholder="Название или размер" className="w-full sm:w-72" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {!readOnly ? (
          <>
            <Combobox aria-label="Блюдо для приказа" className="w-full sm:w-72" value={product} onValueChange={setProduct} options={productOptions} placeholder="Выберите блюдо…" searchPlaceholder="Название или артикул" />
            <Button
              variant="secondary"
              disabled={!product}
              onClick={() => {
                if (!product) return
                onAddProduct(product)
                setProduct(undefined)
              }}
            >
              <Plus aria-hidden />
              Добавить
            </Button>
          </>
        ) : null}
      </div>

      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Позиции приказа</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className="h-10 w-14 px-3 text-left font-semibold">
                Вкл.
              </th>
              <th scope="col" className="px-3 text-left font-semibold">
                Наименование
              </th>
              <th scope="col" className="px-3 text-left font-semibold">
                Размер
              </th>
              <th scope="col" className="px-3 text-right font-semibold">
                Было
              </th>
              <th scope="col" className="w-44 px-3 text-right font-semibold">
                Новая цена
              </th>
              <th scope="col" className="px-3 text-right font-semibold">
                Наценка
              </th>
              {!readOnly ? (
                <th scope="col" className="w-12 px-3">
                  <span className="sr-only">Удалить</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const server = savedByKey.get(line.key)
              const markup = markupPercent(line.newPrice, server?.costAtSave ?? 0)
              const title = line.sizeLabel ? `${line.productName}, ${line.sizeLabel}` : line.productName
              const error = errors[line.key]
              return (
                <tr key={line.key} className={cn("h-[var(--table-row-h)] border-b border-border align-middle last:border-b-0", !line.included && "text-muted-foreground")}>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span>{line.included ? "Да" : "Нет"}</span>
                    ) : (
                      <Checkbox checked={line.included} onCheckedChange={(value) => onChange(line.key, { included: value === true })} aria-label={`Включить «${title}»`} />
                    )}
                  </td>
                  <td className="px-3 py-2 font-semibold">{line.productName}</td>
                  <td className="px-3 py-2">{line.sizeLabel ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{server ? formatTenge(server.previousPrice) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {readOnly ? (
                      line.newPrice === null ? "—" : formatTenge(line.newPrice)
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <MoneyInput aria-label={`Новая цена — ${title}`} aria-invalid={error ? true : undefined} value={line.newPrice} onValueChange={(newPrice) => onChange(line.key, { newPrice })} />
                        {error ? (
                          <span role="alert" className="text-caption text-destructive">
                            {error}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{markup === null ? "—" : formatPercent(markup)}</td>
                  {!readOnly ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Удалить «${title}»`}
                        onClick={() => onRemove(line.key)}
                        className={cn("grid size-9 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-destructive", focusRingClass)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{lines.length === 0 ? "Позиций пока нет — выберите блюдо и нажмите «Добавить»." : "Ничего не найдено"}</p>
        ) : null}
      </div>
      <p className="text-caption text-muted-foreground">Наценка — от себестоимости порции по активной техкарте; без техкарты — «—».</p>
    </section>
  )
}
