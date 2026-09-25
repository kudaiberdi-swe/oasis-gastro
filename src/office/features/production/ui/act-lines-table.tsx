import { Trash2 } from "lucide-react"

import { parseDecimal } from "@/office/features/stock/data/use-stock-master"
import { ItemPicker } from "@/office/features/stock/ui/item-picker"
import { Combobox, Input, Select } from "@/shared/components/ui"
import { formatAmount, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn, focusRingClass } from "@/shared/lib/utils"

import type { PreparationRow } from "../data/use-production"
import { writeOffLabel, type ProductionTypeConfig } from "../model/production"
import { newActLine, type ActLineDraft, type LineErrors } from "../model/use-act-draft"

const DIRECTIONS = [
  { value: "input", label: "Вход" },
  { value: "output", label: "Выход" },
]

export interface ActLinesTableProps {
  config: ProductionTypeConfig
  lines: readonly ActLineDraft[]
  readOnly: boolean
  errors: LineErrors
  /** Server total: the posted cost of an act, the expected sum of a saved purchase order; null — not yet. */
  total: number | null
  preparations: readonly PreparationRow[] | undefined
  onAdd: (line: ActLineDraft) => void
  onChange: (key: string, patch: Partial<ActLineDraft>) => void
  onRemove: (key: string) => void
}

/** Lines of the document: preparations, stock items, «Вход / Выход» or the expected purchase price. */
export function ActLinesTable({ config, lines, readOnly, errors, total, preparations, onAdd, onChange, onRemove }: ActLinesTableProps) {
  const head = "h-10 px-3 font-semibold"
  const mode = config.lineMode
  const quantity = lines.reduce((sum, line) => sum + (parseDecimal(line.quantity) ?? 0), 0)
  const itemHeader = mode === "preparation" ? "Заготовка" : "Позиция"
  return (
    <section aria-label={config.linesTitle} className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-title-sm font-semibold">
            {config.linesTitle} <span className="text-body-sm font-normal text-muted-foreground tabular-nums">{lines.length}</span>
          </h3>
          <p className="text-caption text-muted-foreground">
            {mode === "purchase"
              ? "Ожидаемая цена — для контроля минимального заказа; фактическую цену укажет приходная накладная."
              : mode === "directional"
                ? "Вход списывается по средней складу-источнику; выход получает его себестоимость по доле (или по количеству)."
                : "Себестоимость — средняя склада, её записывает проведение."}
          </p>
        </div>
        {!readOnly ? (
          mode === "preparation" ? (
            <PreparationPicker preparations={preparations} onPick={(row) => onAdd(newActLine({ ref: row.productExternalId, name: row.name, unit: row.unit }, "output"))} />
          ) : mode === "directional" ? (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <ItemPicker className="w-full sm:w-64" label="Добавить вход" onPick={(item) => onAdd(newActLine({ ref: item.externalId, name: item.name, unit: item.unit }, "input"))} />
              <ItemPicker className="w-full sm:w-64" label="Добавить выход" onPick={(item) => onAdd(newActLine({ ref: item.externalId, name: item.name, unit: item.unit }, "output"))} />
            </div>
          ) : (
            <ItemPicker className="w-full sm:w-80" onPick={(item) => onAdd(newActLine({ ref: item.externalId, name: item.name, unit: item.unit }, mode === "purchase" ? "output" : "input"))} />
          )
        ) : null}
      </div>
      <div className="min-w-0 overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Строки документа</caption>
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th scope="col" className={cn(head, "w-12 text-left")}>
                №
              </th>
              {mode === "directional" ? (
                <th scope="col" className={cn(head, "w-32 text-left")}>
                  Вход / Выход
                </th>
              ) : null}
              <th scope="col" className={cn(head, "text-left")}>
                {itemHeader}
              </th>
              <th scope="col" className={cn(head, "text-left")}>
                Ед.
              </th>
              <th scope="col" className={cn(head, "w-36 text-right")}>
                Количество
              </th>
              {mode === "directional" ? (
                <th scope="col" className={cn(head, "w-36 text-right")}>
                  Доля себестоимости
                </th>
              ) : null}
              {mode === "purchase" ? (
                <th scope="col" className={cn(head, "w-40 text-right")}>
                  Ожидаемая цена, ₸
                </th>
              ) : (
                <th scope="col" className={cn(head, "text-right")}>
                  Стоимость, ₸
                </th>
              )}
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
              return (
                <tr key={line.key} className="h-[var(--table-row-h)] border-b border-border align-middle last:border-b-0">
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{index + 1}</td>
                  {mode === "directional" ? (
                    <td className="px-3 py-2">
                      {readOnly ? (
                        line.direction === "input" ? "Вход" : "Выход"
                      ) : (
                        <Select aria-label={`Вход / Выход — ${line.name}`} className="h-10" value={line.direction} onValueChange={(direction) => onChange(line.key, { direction: direction as ActLineDraft["direction"] })} options={DIRECTIONS} />
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{line.name}</span>
                      {error && !readOnly ? (
                        <span role="alert" className="text-caption text-destructive">
                          {error}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">{line.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {readOnly ? (
                      formatQuantity(parseDecimal(line.quantity) ?? 0)
                    ) : (
                      <Input
                        aria-label={`Количество — ${line.name}`}
                        aria-invalid={error ? true : undefined}
                        inputMode="decimal"
                        className="h-10 text-right tabular-nums"
                        value={line.quantity}
                        onChange={(event) => onChange(line.key, { quantity: event.target.value })}
                      />
                    )}
                  </td>
                  {mode === "directional" ? (
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {line.direction === "input" ? (
                        "—"
                      ) : readOnly ? (
                        line.costShare || "по количеству"
                      ) : (
                        <Input
                          aria-label={`Доля себестоимости — ${line.name}`}
                          inputMode="decimal"
                          placeholder="по количеству"
                          className="h-10 text-right tabular-nums"
                          value={line.costShare}
                          onChange={(event) => onChange(line.key, { costShare: event.target.value })}
                        />
                      )}
                    </td>
                  ) : null}
                  {mode === "purchase" ? (
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {readOnly ? (
                        line.expectedUnitCost ? formatTenge(parseDecimal(line.expectedUnitCost) ?? 0) : "—"
                      ) : (
                        <Input
                          aria-label={`Ожидаемая цена — ${line.name}`}
                          inputMode="decimal"
                          className="h-10 text-right tabular-nums"
                          value={line.expectedUnitCost}
                          onChange={(event) => onChange(line.key, { expectedUnitCost: event.target.value })}
                        />
                      )}
                    </td>
                  ) : (
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{line.amount === null ? "—" : formatAmount(line.amount)}</td>
                  )}
                  {!readOnly ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Удалить «${line.name}»`}
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
        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{readOnly ? "В документе нет строк." : mode === "preparation" ? "Строк пока нет — выберите заготовку." : "Строк пока нет — найдите позицию и добавьте её."}</p>
        ) : null}
      </div>
      <p className="text-right text-body-sm text-muted-foreground">
        Позиций: {lines.length} · Количество <span className="font-semibold text-foreground tabular-nums">{formatQuantity(Math.round(quantity * 1000) / 1000)}</span> ·{" "}
        {mode === "purchase" ? "Сумма по ожидаемым ценам" : "Итого по документу"}{" "}
        <span className="sq-price text-title-sm font-semibold text-foreground">{total !== null ? formatTenge(total) : "—"}</span>
        {total === null ? <span className="block text-caption">{mode === "purchase" ? "Пересчитывается при сохранении" : "Стоимость рассчитает проведение"}</span> : null}
      </p>
    </section>
  )
}

/** «Добавить заготовку»: products with itemType «preparation» (listPreparations). */
function PreparationPicker({ preparations, onPick }: { preparations: readonly PreparationRow[] | undefined; onPick: (row: PreparationRow) => void }) {
  const options = (preparations ?? []).map((row) => ({ value: row.productExternalId, label: row.name, hint: [row.unit, writeOffLabel(row.writeOffMethod)].filter(Boolean).join(" · ") }))
  return (
    <Combobox
      aria-label="Добавить заготовку"
      className="w-full sm:w-80"
      value={undefined}
      onValueChange={(productExternalId) => {
        const row = preparations?.find((candidate) => candidate.productExternalId === productExternalId)
        if (row) onPick(row)
      }}
      options={options}
      placeholder="Добавить заготовку"
      searchPlaceholder="Название заготовки"
      emptyText={preparations === undefined ? "Загрузка…" : "Заготовок нет — отметьте позицию на вкладке «Заготовки»"}
    />
  )
}
