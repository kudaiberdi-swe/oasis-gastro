import type { ReactNode } from "react"
import { Bike, ChefHat, Ellipsis, MessageSquareText, Minus, Percent, Plus, ShoppingBag, Trash2, UserRound, UtensilsCrossed } from "lucide-react"

import { isLocked, lineDetails, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { Button } from "@/shared/components/ui/button"
import { Money } from "@/shared/components/ui/money"
import { SegmentedControl } from "@/shared/components/ui/segmented-control"
import { TonePill } from "@/shared/components/ui/status-pill"
import { cn, focusRingClass, formatTenge } from "@/shared/lib/utils"
import type { OrderType } from "@/shared/types/pos"

export type OrderTypeOption = { value: string; label: string; mode: OrderType }

/** «Добавить к заказу» (pos.queries.suggestion). */
export type UpsellSuggestion = { name: string; price: number }

const MODE_ICON: Record<OrderType, ReactNode> = {
  "dine-in": <UtensilsCrossed aria-hidden />,
  takeaway: <ShoppingBag aria-hidden />,
  delivery: <Bike aria-hidden />,
}

function positions(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  const word = mod10 === 1 && mod100 !== 11 ? "позиция" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "позиции" : "позиций"
  return `${count} ${word}`
}

export function OrderPanel({
  tableLabel,
  orderNumber,
  lines,
  itemCount,
  orderTypeOptions,
  orderTypeValue,
  onOrderTypeChange,
  subtotal,
  discountPercent,
  discountAmount,
  serviceChargePercent,
  serviceChargeAmount,
  total,
  saving,
  error,
  canSendToKitchen,
  sendingToKitchen,
  onIncrement,
  onDecrement,
  onRemove,
  onVoid,
  onSendToKitchen,
  onHold,
  onCheckout,
  onDiscount,
  guestLabel,
  loyaltyRedemption = 0,
  onGuest,
  onMore,
  comment,
  suggestion,
  onAddSuggestion,
  disabled,
}: {
  tableLabel: string
  orderNumber?: number
  lines: OrderDraftLine[]
  itemCount: number
  orderTypeOptions: OrderTypeOption[]
  orderTypeValue: string
  onOrderTypeChange: (value: string) => void
  subtotal: number
  discountPercent: number
  discountAmount: number
  serviceChargePercent: number
  serviceChargeAmount: number
  total: number
  saving: boolean
  error: string | null
  canSendToKitchen: boolean
  sendingToKitchen?: boolean
  onIncrement: (clientLineId: string) => void
  onDecrement: (clientLineId: string) => void
  onRemove: (clientLineId: string) => void
  /** «Удалить позицию» for a line the kitchen already has. */
  onVoid: (clientLineId: string) => void
  onSendToKitchen: () => void
  onHold: () => void
  onCheckout: () => void
  onDiscount: () => void
  /** The attached guest («Айгерим · 40 б.»); «Гость» when none. */
  guestLabel?: string
  /** Points planned on the check (W1-POS-16): shown as a line and taken off «К оплате». */
  loyaltyRedemption?: number
  onGuest?: () => void
  /** «Ещё» — the order actions dialog. */
  onMore?: () => void
  comment?: string
  suggestion?: UpsellSuggestion | null
  onAddSuggestion?: () => void
  disabled?: boolean
}) {
  const hasActive = lines.some((line) => !line.voidedAt)
  const payable = Math.max(0, total - loyaltyRedemption)
  return (
    <div className="flex h-full w-[420px] shrink-0 flex-col rounded-panel border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display text-title font-semibold">
            {tableLabel || "Новый заказ"}
            {orderNumber !== undefined && <span className="text-body-sm font-normal text-muted-foreground"> · Заказ №{orderNumber}</span>}
          </p>
          {saving && <p className="text-body-sm text-muted-foreground">Сохранение…</p>}
        </div>
        {comment?.trim() && (
          <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
            <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="line-clamp-2">{comment}</span>
          </p>
        )}
        <SegmentedControl
          aria-label="Тип заказа"
          size="pos"
          className="flex w-full"
          value={orderTypeValue}
          onValueChange={onOrderTypeChange}
          options={orderTypeOptions.map((option) => ({ value: option.value, label: option.label, icon: MODE_ICON[option.mode] }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">Добавьте блюда из меню</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <OrderLineRow key={line.clientLineId} line={line} onIncrement={onIncrement} onDecrement={onDecrement} onRemove={onRemove} onVoid={onVoid} />
            ))}
          </ul>
        )}
      </div>
      {suggestion && hasActive && onAddSuggestion && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={onAddSuggestion}
            disabled={disabled}
            className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-dashed border-gold bg-card px-3 py-2 text-left hover:bg-muted disabled:opacity-50", focusRingClass)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Plus aria-hidden className="size-4 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-body-sm text-muted-foreground">Добавить к заказу</span>
                <span className="block truncate text-body font-semibold">{suggestion.name}</span>
              </span>
            </span>
            <span className="shrink-0 text-body font-semibold text-accent tabular-nums">+{formatTenge(suggestion.price)}</span>
          </button>
        </div>
      )}
      <div className="flex gap-1 border-t border-border bg-muted px-2 py-1.5">
        <Button variant="ghost" className="h-11 min-w-0 flex-1 px-2" onClick={onDiscount} disabled={disabled || !hasActive}>
          <Percent />
          Скидка
        </Button>
        {onGuest && (
          <Button variant="ghost" className="h-11 min-w-0 flex-1 px-2" onClick={onGuest} disabled={disabled || !hasActive} title={guestLabel}>
            <UserRound />
            <span className="truncate">{guestLabel || "Гость"}</span>
          </Button>
        )}
        <Button variant="ghost" className="h-11 min-w-0 flex-1 px-2" onClick={onSendToKitchen} disabled={disabled || !canSendToKitchen || sendingToKitchen}>
          <ChefHat />
          {sendingToKitchen ? "Отправка…" : "На кухню"}
        </Button>
        {onMore && (
          <Button variant="ghost" className="h-11 min-w-0 flex-1 px-2" onClick={onMore} disabled={disabled}>
            <Ellipsis />
            Ещё
          </Button>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border px-4 py-3 text-body-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Сумма заказа</span>
          <span className="tabular-nums">{formatTenge(subtotal)}</span>
        </div>
        {discountAmount !== 0 && (
          <div className="flex justify-between text-success">
            <span>Скидка{discountPercent > 0 ? ` ${discountPercent}%` : ""}</span>
            <span className="tabular-nums">{formatTenge(-discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>Қызмет ақысы · сервисный сбор {serviceChargePercent}%</span>
          <span className="tabular-nums">{formatTenge(serviceChargeAmount)}</span>
        </div>
        {loyaltyRedemption > 0 && (
          <div className="flex justify-between text-success">
            <span>Баллами</span>
            <span className="tabular-nums">{formatTenge(-loyaltyRedemption)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-gold/45 pt-2">
          <span className="flex flex-col">
            <span className="text-body font-semibold">К оплате</span>
            <span className="text-body-sm text-muted-foreground">{positions(itemCount)}</span>
          </span>
          <Money value={payable} size="xl" />
        </div>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2 p-4 pt-0">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onHold} disabled={disabled || !hasActive || saving}>
          Отложить
        </Button>
        <Button size="lg" className="flex-[1.6]" onClick={onCheckout} disabled={disabled || !hasActive || saving}>
          Оплатить · {formatTenge(payable)}
        </Button>
      </div>
    </div>
  )
}

function OrderLineRow({
  line,
  onIncrement,
  onDecrement,
  onRemove,
  onVoid,
}: {
  line: OrderDraftLine
  onIncrement: (clientLineId: string) => void
  onDecrement: (clientLineId: string) => void
  onRemove: (clientLineId: string) => void
  onVoid: (clientLineId: string) => void
}) {
  const details = lineDetails(line)
  const voided = Boolean(line.voidedAt)
  const sent = Boolean(line.sentToKitchenAt) && !voided
  // A sent line is fixed: «−» and the bin open «Удалить позицию»; «+» adds a new portion as its own line.
  const decrement = () => (sent ? onVoid(line.clientLineId) : onDecrement(line.clientLineId))
  const remove = () => (sent ? onVoid(line.clientLineId) : onRemove(line.clientLineId))

  return (
    <li className={cn("flex flex-col gap-2 py-3", voided && "text-muted-foreground")} aria-label={voided ? `${line.name} — удалено` : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-body font-semibold", voided && "line-through")}>{line.name}</p>
          {details && <p className={cn("text-body-sm text-muted-foreground", voided && "line-through")}>{details}</p>}
          {sent && (
            <TonePill tone="info" className="mt-1 gap-1">
              <ChefHat aria-hidden className="size-3.5" />
              на кухне
            </TonePill>
          )}
          {voided && (
            <TonePill tone="neutral" className="mt-1">
              удалено
            </TonePill>
          )}
        </div>
        <Money value={lineTotal(line)} size="sm" className={cn("shrink-0 text-right", voided && "text-muted-foreground line-through")} />
      </div>
      {!voided && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" aria-label={sent ? `Удалить позицию: ${line.name}` : `Убрать одну порцию: ${line.name}`} onClick={decrement}>
              <Minus />
            </Button>
            <span className="w-8 text-center text-body font-semibold tabular-nums">{line.quantity}</span>
            <Button variant="secondary" size="icon" aria-label={`Добавить порцию: ${line.name}`} onClick={() => onIncrement(line.clientLineId)}>
              <Plus />
            </Button>
          </div>
          <Button variant="ghost" size="icon" aria-label={sent ? `Удалить позицию с кухни: ${line.name}` : `Удалить: ${line.name}`} onClick={remove} disabled={isLocked(line) && !sent}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  )
}
