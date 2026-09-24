import { Trash2 } from "lucide-react"

import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { ItemPicker } from "@/office/features/stock/ui/item-picker"
import { Input, Select } from "@/shared/components/ui"
import { formatAmount, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { documentTotals, inventoryDelta, lineAmount, newLine, type DocumentLineDraft, type LineErrors } from "../model/document-lines"
import { VAT_OPTIONS, type DocumentTypeConfig } from "../model/document-types"

export interface DocumentLinesTableProps {
  config: DocumentTypeConfig
  lines: readonly DocumentLineDraft[]
  readOnly: boolean
  /** Posted amount from the server; drafts show the sum of known costs. */
  postedAmount: number | null
  errors: LineErrors
  onAdd: (line: DocumentLineDraft) => void
  onChange: (key: string, patch: Partial<DocumentLineDraft>) => void
  onRemove: (key: string) => void
}

/** «Товары»: № · Позиция · Ед. · Количество (или По учёту / Факт) · Цена / себестоимость · НДС % · Сумма. */
export function DocumentLinesTable({ config, lines, readOnly, postedAmount, errors, onAdd, onChange, onRemove }: DocumentLinesTableProps) {
  const totals = documentTotals(lines, config)
  const head = "h-10 px-3 font-semibold"
  return (
    <section aria-label="Товары" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">Товары</h3>
          <p className="text-caption text-muted-foreground">
            {config.inventory ? "«По учёту» сервер считает при проведении на дату документа." : "Себестоимость — средняя склада, её записывает проведение."}
          </p>
        </div>
        {!readOnly ? <ItemPicker className="w-full sm:w-80" onPick={(item) => onAdd(newLine(item))} /> : null}
      </div>
      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Строки документа</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className={cn(head, "w-12 text-left")}>
                №
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Позиция
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Ед.
              </th>
              {config.inventory ? (
                <>
                  <th scope="col" className={cn(head, "text-right")}>
                    По учёту
                  </th>
                  <th scope="col" className={cn(head, "w-36 text-right")}>
                    Факт
                  </th>
                  <th scope="col" className={cn(head, "text-right")}>
                    Расхождение
                  </th>
                </>
              ) : (
                <th scope="col" className={cn(head, "w-36 text-right")}>
                  Количество
                </th>
              )}
              <th scope="col" className={cn(head, "text-right")}>
                Цена / себестоимость
              </th>
              {config.vat ? (
                <th scope="col" className={cn(head, "w-32 text-left")}>
                  НДС %
                </th>
              ) : null}
              <th scope="col" className={cn(head, "text-right")}>
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
            {lines.map((line, index) => {
              const error = errors[line.key]
              const amount = lineAmount(line, config)
              const delta = config.inventory ? inventoryDelta(line) : null
              const field = config.inventory ? "actualQuantity" : "quantity"
              return (
                <tr key={line.key} className="h-[var(--table-row-h)] border-b border-border align-middle last:border-b-0">
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{index + 1}</td>
                  <td className="px-3 py-2 font-semibold">{line.itemName}</td>
                  <td className="px-3 py-2">{line.unit ?? "—"}</td>
                  {config.inventory ? (
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{line.expectedQuantity === null ? "—" : formatQuantity(line.expectedQuantity)}</td>
                  ) : null}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {readOnly ? (
                      formatQuantity(parseDecimal(line[field]) ?? 0)
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Input
                          aria-label={`${config.inventory ? "Факт" : "Количество"} — ${line.itemName}`}
                          aria-invalid={error ? true : undefined}
                          inputMode="decimal"
                          className="h-10 text-right tabular-nums"
                          value={line[field]}
                          onChange={(event) => onChange(line.key, { [field]: event.target.value } as Partial<DocumentLineDraft>)}
                        />
                        {error ? (
                          <span role="alert" className="text-caption text-destructive">
                            {error}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </td>
                  {config.inventory ? (
                    <td className={cn("px-3 py-2 text-right tabular-nums whitespace-nowrap", delta !== null && delta < 0 && "text-destructive", delta !== null && delta > 0 && "text-success")}>
                      {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatQuantity(delta)}`}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{line.unitCost > 0 ? formatTenge(line.unitCost) : "—"}</td>
                  {config.vat ? (
                    <td className="px-3 py-2">
                      {readOnly ? (
                        VAT_OPTIONS.find((option) => option.value === line.vatRate)?.label ?? `${line.vatRate} %`
                      ) : (
                        <Select aria-label={`НДС — ${line.itemName}`} className="h-10" value={line.vatRate} onValueChange={(vatRate) => onChange(line.key, { vatRate })} options={VAT_OPTIONS} />
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{amount === null ? "—" : formatAmount(amount)}</td>
                  {!readOnly ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Удалить «${line.itemName}»`}
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
        {lines.length === 0 ? <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{readOnly ? "В документе нет строк." : "Строк пока нет — найдите позицию и добавьте её."}</p> : null}
      </div>
      <p className="text-right text-body-sm text-muted-foreground">
        Позиций: {lines.length} · Количество <span className="font-semibold text-foreground tabular-nums">{formatQuantity(totals.quantity)}</span> · Итого по документу{" "}
        <span className="sq-price text-title-sm font-semibold text-foreground">{postedAmount !== null ? formatTenge(postedAmount) : totals.amount > 0 ? formatTenge(totals.amount) : "—"}</span>
      </p>
    </section>
  )
}
