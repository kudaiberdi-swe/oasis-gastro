import { Trash2 } from "lucide-react"
import { Fragment } from "react"

import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { ItemPicker } from "@/office/features/stock/ui/item-picker"
import { Input, Select } from "@/shared/components/ui"
import { formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import { newPriceListLine, type PriceListLineDraft } from "../model/price-list-draft"

export interface PriceListLinesTableProps {
  lines: readonly PriceListLineDraft[]
  readOnly: boolean
  errors: Record<string, string>
  linesError?: string
  /** Units for «Ед.»; undefined without office.units.view (the stock unit is used). */
  units: { externalId: string; shortName: string }[] | undefined
  onAdd: (line: PriceListLineDraft) => void
  onChange: (key: string, patch: Partial<PriceListLineDraft>) => void
  onRemove: (key: string) => void
}

const STOCK_UNIT = "__stock__"

/** «Товары поставщика»: Товар · Артикул поставщика · Название у поставщика · Ед. · Коэф. упаковки · Цена ₸ · Допуск % · удалить. */
export function PriceListLinesTable({ lines, readOnly, errors, linesError, units, onAdd, onChange, onRemove }: PriceListLinesTableProps) {
  const head = "h-10 px-3 font-semibold"
  const columns = readOnly ? 7 : 8
  const unitOptions = [{ value: STOCK_UNIT, label: "Складская" }, ...(units ?? []).map((unit) => ({ value: unit.externalId, label: unit.shortName }))]
  return (
    <section aria-label="Товары поставщика" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">Товары поставщика</h3>
          <p className="text-caption text-muted-foreground">Цена — за упаковку поставщика с НДС; коэффициент — складских единиц в упаковке</p>
        </div>
        {!readOnly ? <ItemPicker label="+ Добавить" className="w-full sm:w-72" onPick={(item) => onAdd(newPriceListLine(item))} /> : null}
      </div>
      {linesError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {linesError}
        </p>
      ) : null}
      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[880px] border-collapse text-body-sm">
          <caption className="sr-only">Строки прайс-листа</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className={cn(head, "text-left")}>
                Товар
              </th>
              <th scope="col" className={cn(head, "w-36 text-left")}>
                Артикул поставщика
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Название у поставщика
              </th>
              <th scope="col" className={cn(head, "w-32 text-left")}>
                Ед.
              </th>
              <th scope="col" className={cn(head, "w-28 text-right")}>
                Коэф. упаковки
              </th>
              <th scope="col" className={cn(head, "w-32 text-right")}>
                Цена, ₸
              </th>
              <th scope="col" className={cn(head, "w-24 text-right")}>
                Допуск, %
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
              const unitLabel = unitOptions.find((option) => option.value === line.unitExternalId)?.label ?? (line.itemUnit || "—")
              const change = (patch: Partial<PriceListLineDraft>) => onChange(line.key, { ...patch, unitPrice: null })
              return (
                <Fragment key={line.key}>
                  <tr className={cn("h-[var(--table-row-h)] align-middle", error ? "" : "border-b border-border")}>
                    <td className="px-3 py-2">
                      <span className="block font-semibold">{line.itemName}</span>
                      {line.unitPrice !== null ? <span className="block text-caption text-muted-foreground">{formatTenge(line.unitPrice)} за {line.itemUnit || "ед."}</span> : null}
                    </td>
                    <td className="px-3 py-2">{readOnly ? line.supplierSku || "—" : <Input aria-label={`Артикул поставщика — ${line.itemName}`} className="h-10" autoComplete="off" value={line.supplierSku} onChange={(event) => change({ supplierSku: event.target.value })} />}</td>
                    <td className="px-3 py-2">{readOnly ? line.supplierName || "—" : <Input aria-label={`Название у поставщика — ${line.itemName}`} className="h-10" autoComplete="off" value={line.supplierName} onChange={(event) => change({ supplierName: event.target.value })} />}</td>
                    <td className="px-3 py-2">
                      {readOnly || !units ? (
                        unitLabel
                      ) : (
                        <Select aria-label={`Единица — ${line.itemName}`} className="h-10" value={line.unitExternalId || STOCK_UNIT} onValueChange={(value) => change({ unitExternalId: value === STOCK_UNIT ? "" : value })} options={unitOptions} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {readOnly ? formatQuantity(parseDecimal(line.packageCoefficient) ?? 0) : <NumberCell label={`Коэффициент упаковки — ${line.itemName}`} value={line.packageCoefficient} invalid={Boolean(error)} onChange={(packageCoefficient) => change({ packageCoefficient })} />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {readOnly ? formatTenge(parseDecimal(line.price) ?? 0) : <NumberCell label={`Цена — ${line.itemName}`} value={line.price} invalid={Boolean(error)} onChange={(price) => change({ price })} />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {readOnly ? line.deviationPercent || "—" : <NumberCell label={`Допуск — ${line.itemName}`} value={line.deviationPercent} placeholder="как у листа" onChange={(deviationPercent) => change({ deviationPercent })} />}
                    </td>
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
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {lines.length === 0 ? <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{readOnly ? "В прайс-листе нет товаров." : "Товаров пока нет — найдите позицию склада и добавьте её."}</p> : null}
      </div>
    </section>
  )
}

function NumberCell({ label, value, invalid, placeholder, onChange }: { label: string; value: string; invalid?: boolean; placeholder?: string; onChange: (value: string) => void }) {
  return <Input aria-label={label} aria-invalid={invalid ? true : undefined} inputMode="decimal" autoComplete="off" placeholder={placeholder} className="h-10 text-right tabular-nums" value={value} onChange={(event) => onChange(event.target.value)} />
}
