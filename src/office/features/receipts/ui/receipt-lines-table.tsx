import { Trash2 } from "lucide-react"
import { Fragment } from "react"

import { VAT_OPTIONS } from "@/office/features/stock-documents/model/document-types"
import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { ItemPicker } from "@/office/features/stock/ui/item-picker"
import { Banner, Input, MoneyInput, Select } from "@/shared/components/ui"
import { formatAmount, formatPercent, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { PriceCheck } from "../data/use-receipts"
import { lineGross, newReceiptLine, receiptTotals, type ReceiptLineDraft } from "../model/receipt-draft"

export interface ReceiptLinesTableProps {
  lines: readonly ReceiptLineDraft[]
  readOnly: boolean
  errors: Record<string, string>
  /** Server price checks of the saved draft, by line number. */
  priceChecks: readonly PriceCheck[]
  onAdd: (line: ReceiptLineDraft) => void
  onChange: (key: string, patch: Partial<ReceiptLineDraft>) => void
  onRemove: (key: string) => void
}

/** «№ · Наименование товара · Ед. · Количество · Цена за ед. · НДС · Сумма · удалить» + итог. */
export function ReceiptLinesTable({ lines, readOnly, errors, priceChecks, onAdd, onChange, onRemove }: ReceiptLinesTableProps) {
  const totals = receiptTotals(lines)
  const checks = new Map(priceChecks.filter((check) => check.outcome !== "ok").map((check) => [check.lineNo, check]))
  const head = "h-10 px-3 font-semibold"
  const columns = readOnly ? 7 : 8
  return (
    <section aria-label="Приходная накладная" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">Приходная накладная</h3>
          <p className="text-caption text-muted-foreground">Оприходование товаров на склад по закупочным ценам</p>
        </div>
        {!readOnly ? <ItemPicker label="Добавить товар" className="w-full sm:w-80" onPick={(item) => onAdd(newReceiptLine(item))} /> : null}
      </div>
      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Строки накладной</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className={cn(head, "w-12 text-left")}>
                №
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Наименование товара
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Ед.
              </th>
              <th scope="col" className={cn(head, "w-32 text-right")}>
                Количество
              </th>
              <th scope="col" className={cn(head, "w-40 text-right")}>
                Цена за ед.
              </th>
              <th scope="col" className={cn(head, "w-32 text-left")}>
                НДС
              </th>
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
              const gross = lineGross(line)
              const error = errors[line.key]
              const check = line.lineNo !== null ? checks.get(line.lineNo) : undefined
              return (
                <Fragment key={line.key}>
                  <tr className={cn("h-[var(--table-row-h)] align-middle", check ? "" : "border-b border-border")}>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{index + 1}</td>
                    <td className="px-3 py-2 font-semibold">{line.itemName}</td>
                    <td className="px-3 py-2">{line.unit ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {readOnly ? (
                        formatQuantity(parseDecimal(line.quantity) ?? 0)
                      ) : (
                        <Input
                          aria-label={`Количество — ${line.itemName}`}
                          aria-invalid={error ? true : undefined}
                          inputMode="decimal"
                          className="h-10 text-right tabular-nums"
                          value={line.quantity}
                          onChange={(event) => onChange(line.key, { quantity: event.target.value })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {readOnly ? (
                        line.unitCostGross === null ? "—" : formatTenge(line.unitCostGross)
                      ) : (
                        <MoneyInput aria-label={`Цена с НДС — ${line.itemName}`} className="h-10" value={line.unitCostGross} onValueChange={(unitCostGross) => onChange(line.key, { unitCostGross })} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {readOnly ? (
                        (VAT_OPTIONS.find((option) => option.value === line.vatRate)?.label ?? `${line.vatRate} %`)
                      ) : (
                        <Select aria-label={`НДС — ${line.itemName}`} className="h-10" value={line.vatRate} onValueChange={(vatRate) => onChange(line.key, { vatRate })} options={VAT_OPTIONS} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{gross === null ? "—" : formatAmount(gross)}</td>
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
                  {error ? (
                    <tr className="border-b border-border">
                      <td colSpan={columns} className="px-3 pb-2">
                        <span role="alert" className="text-caption text-destructive">
                          {line.itemName}: {error}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {check ? (
                    <tr className="border-b border-border">
                      <td colSpan={columns} className="px-3 pb-3">
                        <Banner tone={check.outcome === "block" ? "danger" : "warning"} title={`Цена «${check.itemName}» отклоняется на ${formatPercent(check.deviationPercent, { explicitPlus: true })}`}>
                          Средняя на складе — {formatTenge(check.reference)}, в накладной — {formatTenge(check.unitCost)}.
                          {check.outcome === "block" ? " Политика поставщика не даст провести накладную." : " Проведение возможно, отклонение попадёт в предупреждения."}
                        </Banner>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {lines.length === 0 ? <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{readOnly ? "В накладной нет строк." : "Строк пока нет — найдите товар и добавьте его."}</p> : null}
      </div>
      <p className="text-right text-body-sm text-muted-foreground">
        Товарных позиций: {lines.length} · В том числе НДС <span className="font-semibold text-foreground tabular-nums">{formatTenge(totals.vat)}</span> · Итого по документу{" "}
        <span className="sq-price text-title-sm font-semibold text-foreground">{formatTenge(totals.gross)}</span>
      </p>
    </section>
  )
}
