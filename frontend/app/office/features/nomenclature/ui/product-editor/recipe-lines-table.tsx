import { Trash2 } from "lucide-react"
import type { ReactNode } from "react"

import { Button, Combobox, Input } from "@/shared/components/ui"
import { formatAmount, formatQuantity, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import type { RecipeSummary } from "@convex/lib/recipeMath"
import { optionValue, type IngredientOption } from "../../data/use-recipe"
import { LINE_KIND_LABELS, linePatchForOption, type RecipeDraftLine, type RecipeErrors, type RecipeLineField } from "../../model/use-recipe-draft"

export interface RecipeLinesTableProps {
  lines: RecipeDraftLine[]
  summary: RecipeSummary
  batchYield: number
  errors: RecipeErrors["byLine"]
  readOnly: boolean
  options: IngredientOption[]
  knownCosts: Map<string, number>
  onSearchChange: (search: string) => void
  onChange: (key: string, patch: Partial<RecipeDraftLine>) => void
  onRemove: (key: string) => void
}

const HEADERS: { label: string; numeric?: boolean; className?: string }[] = [
  { label: "№", className: "w-10" },
  { label: "Наименование продукта", className: "min-w-64" },
  { label: "Тип", className: "w-24" },
  { label: "Ед.", className: "w-14" },
  { label: "Количество", numeric: true, className: "w-28" },
  { label: "Вес ед., кг", numeric: true, className: "w-28" },
  { label: "Брутто, кг", numeric: true, className: "w-24" },
  { label: "Хол. потери, %", numeric: true, className: "w-28" },
  { label: "Нетто, кг", numeric: true, className: "w-24" },
  { label: "Гор. потери, %", numeric: true, className: "w-28" },
  { label: "Выход, кг", numeric: true, className: "w-24" },
  { label: "Себестоимость, ₸", numeric: true, className: "w-32" },
]

const kg = (value: number) => formatQuantity(value)

/**
 * Recipe lines: № · product · type · unit · quantity · unit weight · gross · cold losses · net · hot losses ·
 * output · cost · delete. All 13 columns stay; the table scrolls sideways inside the card.
 */
export function RecipeLinesTable({ lines, summary, batchYield, errors, readOnly, options, knownCosts, onSearchChange, onChange, onRemove }: RecipeLinesTableProps) {
  return (
    <div className="overflow-x-auto" role="region" aria-label="Строки технологической карты" tabIndex={0}>
      <table className="w-full min-w-[1320px] border-collapse text-body-sm">
        <caption className="sr-only">Ингредиенты технологической карты</caption>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {HEADERS.map((header) => (
              <th key={header.label} scope="col" className={cn("px-2 py-2.5 text-caption font-semibold text-muted-foreground", header.numeric ? "text-right" : "text-left", header.className)}>
                {header.label}
              </th>
            ))}
            <th scope="col" className="w-12 px-2 py-2.5">
              <span className="sr-only">Удалить</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={HEADERS.length + 1} className="px-4 py-8 text-center text-body-sm text-muted-foreground">
                Ингредиентов пока нет. {readOnly ? "" : "Добавьте первый ингредиент — брутто, нетто и выход посчитаются сразу."}
              </td>
            </tr>
          ) : (
            lines.map((line, index) => (
              <LineRow
                key={line.key}
                line={line}
                index={index}
                calculated={summary.lines[index]}
                errors={errors[line.key] ?? {}}
                readOnly={readOnly}
                options={options}
                knownCosts={knownCosts}
                onSearchChange={onSearchChange}
                onChange={(patch) => onChange(line.key, patch)}
                onRemove={() => onRemove(line.key)}
              />
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/50 font-semibold">
            <td colSpan={6} className="px-3 py-3">
              Итого на {formatQuantity(batchYield > 0 ? batchYield : 1)} порц.
            </td>
            <Computed value={kg(summary.grossKg)} />
            <td />
            <Computed value={kg(summary.netKg)} />
            <td />
            <Computed value={kg(summary.outputKg)} />
            <td className="px-2 py-3 text-right text-accent tabular-nums">{formatTenge(summary.costPerBatch)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function LineRow({
  line,
  index,
  calculated,
  errors,
  readOnly,
  options,
  knownCosts,
  onSearchChange,
  onChange,
  onRemove,
}: {
  line: RecipeDraftLine
  index: number
  calculated: RecipeSummary["lines"][number] | undefined
  errors: Partial<Record<RecipeLineField, string>>
  readOnly: boolean
  options: IngredientOption[]
  knownCosts: Map<string, number>
  onSearchChange: (search: string) => void
  onChange: (patch: Partial<RecipeDraftLine>) => void
  onRemove: () => void
}) {
  const number = index + 1
  const value = line.refId ? optionValue(line.kind, line.refId) : undefined
  const rowOptions = value && !options.some((option) => option.value === value) ? [{ value, label: line.name, hint: LINE_KIND_LABELS[line.kind] }, ...options] : options
  const name = line.name || `Строка ${number}`

  return (
    <tr className="border-b border-border align-top hover:bg-muted/30">
      <td className="px-2 py-3 text-muted-foreground tabular-nums">{number}</td>
      <td className="px-2 py-2">
        {readOnly ? (
          <span className="block py-1 font-semibold">{line.name}</span>
        ) : (
          <CellError message={errors.ref}>
            <Combobox
              aria-label={`Ингредиент, строка ${number}`}
              aria-invalid={errors.ref ? true : undefined}
              className="[&_[role=combobox]]:h-10"
              value={value}
              options={rowOptions}
              placeholder="Выберите ингредиент"
              searchPlaceholder="Складская позиция или заготовка"
              emptyText="Ничего не найдено"
              onSearchChange={onSearchChange}
              onValueChange={(picked) => {
                const option = options.find((item) => item.value === picked)
                if (option) onChange(linePatchForOption(option, line, knownCosts))
              }}
            />
          </CellError>
        )}
      </td>
      <td className="px-2 py-3 text-muted-foreground">{LINE_KIND_LABELS[line.kind]}</td>
      <td className="px-2 py-3 font-semibold">{line.unit}</td>
      <td className="px-2 py-2">
        <NumberCell label={`Количество — ${name}`} value={line.quantity} error={errors.quantity} readOnly={readOnly} onChange={(quantity) => onChange({ quantity })} />
      </td>
      <td className="px-2 py-2">
        {line.unit === "кг" ? (
          <span className="block py-2.5 pr-3 text-right text-muted-foreground tabular-nums">1</span>
        ) : (
          <NumberCell label={`Вес единицы, кг — ${name}`} value={line.unitWeightKg} error={errors.unitWeightKg} readOnly={readOnly} onChange={(unitWeightKg) => onChange({ unitWeightKg })} />
        )}
      </td>
      <Computed value={calculated ? kg(calculated.grossKg) : "—"} emphasized />
      <td className="px-2 py-2">
        <NumberCell label={`Холодные потери, % — ${name}`} value={line.coldLossPercent} error={errors.coldLossPercent} readOnly={readOnly} suffix="%" onChange={(coldLossPercent) => onChange({ coldLossPercent })} />
      </td>
      <Computed value={calculated ? kg(calculated.netKg) : "—"} />
      <td className="px-2 py-2">
        <NumberCell label={`Горячие потери, % — ${name}`} value={line.hotLossPercent} error={errors.hotLossPercent} readOnly={readOnly} suffix="%" onChange={(hotLossPercent) => onChange({ hotLossPercent })} />
      </td>
      <Computed value={calculated ? kg(calculated.outputKg) : "—"} emphasized />
      <td className="px-2 py-3 text-right tabular-nums">
        {line.unitCost === null ? (
          <span className="text-muted-foreground" title="Появится после сохранения черновика">
            —
          </span>
        ) : (
          <>
            <span className="block font-semibold">{formatAmount(calculated?.cost ?? 0)}</span>
            <span className="block text-caption text-muted-foreground">
              {formatTenge(line.unitCost)}/{line.unit}
            </span>
          </>
        )}
      </td>
      <td className="px-2 py-2">
        {readOnly ? null : (
          <Button variant="ghost" size="icon-sm" aria-label={`Удалить ${line.name ? `«${line.name}»` : `строку ${number}`}`} onClick={onRemove} className="text-muted-foreground hover:text-destructive">
            <Trash2 aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  )
}

function CellError({ message, children }: { message?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      {message ? (
        <p className="text-caption text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}

function NumberCell({ label, value, error, readOnly, suffix, onChange }: { label: string; value: string; error?: string; readOnly: boolean; suffix?: string; onChange: (value: string) => void }) {
  if (readOnly) {
    return (
      <span className="block py-2.5 pr-3 text-right tabular-nums">
        {value || "—"}
        {suffix && value ? ` ${suffix}` : ""}
      </span>
    )
  }
  return (
    <CellError message={error}>
      <span className="relative block">
        <Input
          aria-label={label}
          aria-invalid={error ? true : undefined}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn("h-10 text-right tabular-nums", suffix && "pr-7")}
        />
        {suffix ? <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-caption text-muted-foreground">{suffix}</span> : null}
      </span>
    </CellError>
  )
}

function Computed({ value, emphasized }: { value: string; emphasized?: boolean }) {
  return <td className={cn("px-2 py-3 text-right tabular-nums", emphasized ? "bg-muted/40 font-semibold" : "font-medium")}>{value}</td>
}
