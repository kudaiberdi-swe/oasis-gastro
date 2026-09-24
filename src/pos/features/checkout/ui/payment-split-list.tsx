import { Plus, Trash2 } from "lucide-react"

import { addPart, allocated, partTendered, setPartAmount, type PaymentOption, type PaymentPart } from "../model/payment-parts"
import { Button, Field, MoneyInput, Select } from "@/shared/components/ui"
import { formatTenge } from "@/shared/lib/utils"

/** Mixed payment on N parts (W1-POS-17): each part has its own type and amount; the remainder is shown live. */
export function PaymentSplitList({ parts, options, total, onChange }: { parts: PaymentPart[]; options: PaymentOption[]; total: number; onChange: (parts: PaymentPart[]) => void }) {
  const combinable = options.filter((option) => option.combinable)
  const single = options.filter((option) => !option.combinable)
  const rest = total - allocated(parts)

  function patch(id: string, change: Partial<PaymentPart>) {
    onChange(parts.map((part) => (part.id === id ? { ...part, ...change } : part)))
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {parts.map((part, index) => {
          const option = options.find((candidate) => candidate.key === part.optionKey)
          return (
            <li key={part.id} aria-label={`Часть ${index + 1}`} className="flex flex-col gap-3 rounded-card border border-border p-3">
              <div className="flex items-end gap-2">
                <Field label={`Часть ${index + 1}`} className="flex-1">
                  {(control) => (
                    <Select
                      {...control}
                      value={part.optionKey}
                      onValueChange={(optionKey) => patch(part.id, { optionKey, tendered: null })}
                      options={combinable.map((candidate) => ({ value: candidate.key, label: candidate.name }))}
                      className="h-[var(--control-h-pos)]"
                    />
                  )}
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Убрать часть ${index + 1}`} onClick={() => onChange(parts.filter((candidate) => candidate.id !== part.id))} disabled={parts.length <= 1}>
                  <Trash2 />
                </Button>
              </div>
              <Field label={option?.allowsChange ? `${option.name} в составе оплаты` : "Сумма"}>
                {(control) => (
                  <MoneyInput {...control} value={part.amount} onValueChange={(amount) => onChange(setPartAmount(parts, part.id, amount, total))} className="h-[var(--control-h-pos)] text-body font-semibold" />
                )}
              </Field>
              {option?.allowsChange && (
                <Field label="Получено от гостя" hint={partTendered(part) > (part.amount ?? 0) ? `Сдача ${formatTenge(partTendered(part) - (part.amount ?? 0))}` : undefined}>
                  {(control) => (
                    <MoneyInput {...control} value={part.tendered ?? part.amount} onValueChange={(tendered) => patch(part.id, { tendered })} className="h-[var(--control-h-pos)] text-body font-semibold" />
                  )}
                </Field>
              )}
            </li>
          )
        })}
      </ol>
      <div className="flex items-center justify-between gap-2">
        <p className={rest === 0 ? "text-body-sm text-success" : "text-body-sm font-semibold text-warning-foreground"} aria-live="polite">
          {rest === 0 ? "Сумма распределена" : rest > 0 ? `Осталось ${formatTenge(rest)}` : `Больше заказа на ${formatTenge(-rest)}`}
        </p>
        <Button variant="secondary" onClick={() => onChange(addPart(parts, options, total))} disabled={combinable.length === 0}>
          <Plus />
          Добавить часть
        </Button>
      </div>
      {single.length > 0 && <p className="text-body-sm text-muted-foreground">Только отдельно: {single.map((option) => option.name).join(", ")}</p>}
    </div>
  )
}
