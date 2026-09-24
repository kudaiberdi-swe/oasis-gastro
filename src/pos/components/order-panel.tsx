import { Minus, Plus } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { formatTenge } from "@/shared/lib/utils"
import type { DraftLine } from "@/shared/types/pos"

export function OrderPanel({
  tableLabel,
  lines,
  subtotal,
  discountPercent,
  discountAmount,
  serviceChargeAmount,
  total,
  saving,
  error,
  onIncrement,
  onDecrement,
  onHold,
  onCheckout,
  onDiscount,
  disabled,
}: {
  tableLabel: string
  lines: DraftLine[]
  subtotal: number
  discountPercent: number
  discountAmount: number
  serviceChargeAmount: number
  total: number
  saving: boolean
  error: string | null
  onIncrement: (clientLineId: string) => void
  onDecrement: (clientLineId: string) => void
  onHold: () => void
  onCheckout: () => void
  onDiscount: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col rounded-[var(--radius-panel)] border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="font-display text-lg font-semibold">{tableLabel || "Новый заказ"}</p>
        {saving && <p className="text-xs text-muted-foreground">Сохранение…</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Добавьте блюда из меню</p>
        ) : (
          <ul className="flex flex-col gap-3 py-2">
            {lines.map((line) => (
              <li key={line.clientLineId} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-[15px] font-semibold">{line.name}</p>
                  <p className="text-xs text-muted-foreground">{formatTenge(line.unitPrice)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onDecrement(line.clientLineId)} className="grid size-7 place-items-center rounded-[var(--radius-control)] bg-muted text-muted-foreground">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{line.quantity}</span>
                  <button type="button" onClick={() => onIncrement(line.clientLineId)} className="grid size-7 place-items-center rounded-[var(--radius-control)] bg-muted text-muted-foreground">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <p className="font-display w-20 shrink-0 text-right text-[15px] font-semibold tabular-nums text-accent">{formatTenge(line.unitPrice * line.quantity)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border px-4 py-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Сумма</span>
          <span className="tabular-nums">{formatTenge(subtotal)}</span>
        </div>
        {discountPercent > 0 && (
          <button type="button" onClick={onDiscount} className="flex w-full justify-between text-success">
            <span>Скидка {discountPercent}%</span>
            <span className="tabular-nums">−{formatTenge(discountAmount)}</span>
          </button>
        )}
        {discountPercent === 0 && (
          <button type="button" onClick={onDiscount} className="text-accent underline decoration-dotted underline-offset-2">
            Добавить скидку
          </button>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>Қызмет ақысы · сервисный сбор 15%</span>
          <span className="tabular-nums">{formatTenge(serviceChargeAmount)}</span>
        </div>
        <div className="flex items-baseline justify-between pt-1.5">
          <span className="text-sm font-semibold">Итого</span>
          <span className="font-display text-xl font-semibold tabular-nums text-accent">{formatTenge(total)}</span>
        </div>
        {error && <p className="text-xs font-semibold text-destructive">{error}</p>}
      </div>
      <div className="flex gap-2 p-4 pt-0">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onHold} disabled={disabled || lines.length === 0}>
          Отложить
        </Button>
        <Button size="lg" className="flex-1" onClick={onCheckout} disabled={disabled || lines.length === 0}>
          Оплата
        </Button>
      </div>
    </div>
  )
}
