import { Minus, Plus } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { Money } from "@/shared/components/ui/money"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"
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
    <div className="flex h-full w-[360px] shrink-0 flex-col rounded-panel border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="font-display text-title-sm font-semibold">{tableLabel || "Новый заказ"}</p>
        {saving && <p className="text-caption text-muted-foreground">Сохранение…</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">Добавьте блюда из меню</p>
        ) : (
          <ul className="flex flex-col gap-3 py-2">
            {lines.map((line) => (
              <li key={line.clientLineId} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-body font-semibold">{line.name}</p>
                  <p className="text-caption text-muted-foreground tabular-nums">{formatTenge(line.unitPrice)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="icon-sm" aria-label={`Убрать одну порцию: ${line.name}`} onClick={() => onDecrement(line.clientLineId)}>
                    <Minus />
                  </Button>
                  <span className="w-6 text-center text-body-sm font-semibold tabular-nums">{line.quantity}</span>
                  <Button variant="secondary" size="icon-sm" aria-label={`Добавить порцию: ${line.name}`} onClick={() => onIncrement(line.clientLineId)}>
                    <Plus />
                  </Button>
                </div>
                <Money value={line.unitPrice * line.quantity} size="sm" className="w-20 shrink-0 text-right" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border px-4 py-3 text-body-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Сумма</span>
          <span className="tabular-nums">{formatTenge(subtotal)}</span>
        </div>
        {discountPercent > 0 && (
          <button type="button" onClick={onDiscount} className={cn("flex w-full justify-between rounded-control text-success", focusRingClass)}>
            <span>Скидка {discountPercent}%</span>
            <span className="tabular-nums">−{formatTenge(discountAmount)}</span>
          </button>
        )}
        {discountPercent === 0 && (
          <Button variant="link" className="h-auto px-0 text-body-sm" onClick={onDiscount}>
            Добавить скидку
          </Button>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>Қызмет ақысы · сервисный сбор 15%</span>
          <span className="tabular-nums">{formatTenge(serviceChargeAmount)}</span>
        </div>
        <div className="flex items-baseline justify-between pt-1.5">
          <span className="text-body-sm font-semibold">Итого</span>
          <Money value={total} size="lg" />
        </div>
        {error && <p className="text-caption font-semibold text-destructive">{error}</p>}
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
