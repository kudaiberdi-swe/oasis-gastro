import { useState, type ReactNode } from "react"
import { Bike, ChefHat, Ellipsis, MessageSquareText, Minus, Percent, Plus, ReceiptText, ShoppingBag, Trash2, UserRound, UtensilsCrossed } from "lucide-react"

import { isLocked, lineDetails, lineDetailsKk, lineTotal, type OrderDraftLine } from "@/pos/features/order-taking/model/draft-lines"
import { bilingualName, useT } from "@/pos/i18n"
import { Button } from "@/shared/components/ui/button"
import { Money } from "@/shared/components/ui/money"
import { SegmentedControl } from "@/shared/components/ui/segmented-control"
import { StatusPill, TonePill } from "@/shared/components/ui/status-pill"
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

/**
 * «Қызмет ақысы» only where it applies: not for takeaway and not at 0 %. An amount the server did
 * charge is always shown, so the lines above «К оплате» still add up.
 */
export function showServiceCharge(input: { mode: OrderType | undefined; percent: number; amount: number }) {
  if (input.amount !== 0) return true
  return input.mode !== "takeaway" && input.percent > 0
}

// Order lines: name · quantity stepper (48 + 32 + 48) · total; the bin sits under the total, apart from it.
const LINE_GRID = "grid grid-cols-[minmax(0,1fr)_128px_96px] gap-x-2"

export function OrderPanel({
  tableLabel,
  orderNumber,
  orderStatus = "draft",
  titleSlot,
  guestSlot,
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
  offlineReason,
}: {
  tableLabel: string
  orderNumber?: number
  /** orders.status of the check on screen; a new unsaved one is «draft» (открыт). */
  orderStatus?: string
  /** Replaces the plain title — the checks switcher «Стол 7 ▾ · Заказ №…» (W1-POS-10). */
  titleSlot?: ReactNode
  /** «Гостей: —» (guest-count-control.tsx) beside the check's comment; left out for takeaway and delivery. */
  guestSlot?: ReactNode
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
  /** «Ещё» in the action bar — the one entry to «Действия с заказом». */
  onMore?: () => void
  comment?: string
  suggestion?: UpsellSuggestion | null
  onAddSuggestion?: () => void
  disabled?: boolean
  /** No link to the server: «Оплатить» and «На кухню» are blocked and the reason is shown beside them. */
  offlineReason?: string | null
}) {
  const t = useT()
  const hasActive = lines.some((line) => !line.voidedAt)
  const payable = Math.max(0, total - loyaltyRedemption)
  const mode = orderTypeOptions.find((option) => option.value === orderTypeValue)?.mode
  const serviceChargeShown = showServiceCharge({ mode, percent: serviceChargePercent, amount: serviceChargeAmount })
  return (
    <section
      aria-label={t("order.aria")}
      className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-card min-[1440px]:w-[440px] min-[1920px]:w-[470px]"
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex min-h-12 min-w-0 items-center gap-2">
          {titleSlot ?? (
            <p className="truncate font-display text-title font-semibold">
              {tableLabel || t("common.newOrder")}
              {orderNumber !== undefined && <span className="text-body-sm font-normal text-muted-foreground"> · {t("common.orderNumber", { number: orderNumber })}</span>}
            </p>
          )}
          <StatusPill domain="order" status={orderStatus} className="shrink-0" />
          <span aria-live="polite" className="ml-auto shrink-0 text-body-sm text-muted-foreground">
            {saving ? t("common.saving") : null}
          </span>
        </div>
        {(guestSlot || comment?.trim()) && (
          <div className="flex min-w-0 items-center gap-3">
            {guestSlot}
            {comment?.trim() && (
              <p className="flex min-w-0 items-start gap-1.5 text-body-sm text-muted-foreground">
                <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="line-clamp-2">{comment}</span>
              </p>
            )}
          </div>
        )}
        <SegmentedControl
          aria-label={t("order.type")}
          size="pos"
          className="flex w-full"
          value={orderTypeValue}
          onValueChange={onOrderTypeChange}
          options={orderTypeOptions.map((option) => ({ value: option.value, label: option.label, icon: MODE_ICON[option.mode] }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <span aria-hidden className="grid size-16 place-items-center rounded-card bg-muted text-muted-foreground">
              <ReceiptText className="size-7" />
            </span>
            <p className="font-display text-title font-semibold">{t("order.empty")}</p>
            <p className="text-body-sm text-muted-foreground">{t("order.emptyHint")}</p>
          </div>
        ) : (
          <>
          <div aria-hidden className={cn(LINE_GRID, "border-b border-border pb-2 text-body-sm font-semibold text-muted-foreground")}>
            <span>{t("order.colName")}</span>
            <span className="text-center">{t("order.colQty")}</span>
            <span className="text-right">{t("order.colSum")}</span>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <OrderLineRow key={line.clientLineId} line={line} onIncrement={onIncrement} onDecrement={onDecrement} onRemove={onRemove} onVoid={onVoid} />
            ))}
          </ul>
          </>
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
                <span className="block text-body-sm text-muted-foreground">{t("order.addSuggestion")}</span>
                <span className="block truncate text-body font-semibold">{suggestion.name}</span>
              </span>
            </span>
            <span className="shrink-0 text-body font-semibold text-accent tabular-nums">+{formatTenge(suggestion.price)}</span>
          </button>
        </div>
      )}
      <div className="flex gap-1 border-t border-border bg-muted p-1">
        <Button variant="ghost" className="h-12 min-w-0 flex-1 px-2" onClick={onDiscount} disabled={disabled || !hasActive}>
          <Percent />
          {t("order.discount")}
        </Button>
        {onGuest && (
          <Button variant="ghost" className="h-12 min-w-0 flex-1 px-2" onClick={onGuest} disabled={disabled || !hasActive} title={guestLabel}>
            <UserRound />
            <span className="truncate">{guestLabel || t("common.guest")}</span>
          </Button>
        )}
        <Button variant="ghost" className="h-12 min-w-0 flex-1 px-2" onClick={onSendToKitchen} disabled={disabled || !canSendToKitchen || sendingToKitchen || Boolean(offlineReason)} title={offlineReason ?? undefined}>
          <ChefHat />
          {sendingToKitchen ? t("order.sending") : t("order.toKitchen")}
        </Button>
        {onMore && (
          <Button variant="ghost" className="h-12 min-w-0 flex-1 px-2" aria-haspopup="dialog" onClick={onMore} disabled={disabled}>
            <Ellipsis />
            {t("order.more")}
          </Button>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border px-4 py-3 text-body-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{t("order.subtotal")}</span>
          <span className="tabular-nums">{formatTenge(subtotal)}</span>
        </div>
        {discountAmount !== 0 && (
          <div className="flex justify-between text-success">
            <span>{discountPercent > 0 ? t("order.discountPercent", { percent: discountPercent }) : t("order.discount")}</span>
            <span className="tabular-nums">{formatTenge(-discountAmount)}</span>
          </div>
        )}
        {serviceChargeShown && (
          <div className="flex justify-between text-muted-foreground">
            {/* The Kazakh name of the line is printed on the receipt too; in Russian it is followed by the Russian one. */}
            <span>
              <span lang="kk">Қызмет ақысы</span>
              {t.locale === "kk" ? ` ${serviceChargePercent}%` : ` · ${t("order.serviceCharge", { percent: serviceChargePercent })}`}
            </span>
            <span className="tabular-nums">{formatTenge(serviceChargeAmount)}</span>
          </div>
        )}
        {loyaltyRedemption > 0 && (
          <div className="flex justify-between text-success">
            <span>{t("order.points")}</span>
            <span className="tabular-nums">{formatTenge(-loyaltyRedemption)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-gold/45 pt-2">
          <span className="flex flex-col">
            <span className="text-body font-semibold">{t("order.toPay")}</span>
            <span className="text-body-sm text-muted-foreground">{t("order.positions", { count: itemCount })}</span>
          </span>
          <Money value={payable} size="xl" />
        </div>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </div>
      {offlineReason && (
        <p id="order-offline-reason" className="px-4 pb-2 text-body-sm font-semibold text-destructive">
          {offlineReason}
        </p>
      )}
      <div className="flex gap-2 p-4 pt-0">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onHold} disabled={disabled || !hasActive || saving}>
          {t("order.hold")}
        </Button>
        <Button
          size="lg"
          className="flex-[1.6]"
          onClick={onCheckout}
          disabled={disabled || !hasActive || saving || Boolean(offlineReason)}
          title={offlineReason ?? undefined}
          aria-describedby={offlineReason ? "order-offline-reason" : undefined}
        >
          {t("order.pay", { amount: formatTenge(payable) })}
        </Button>
      </div>
    </section>
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
  const t = useT()
  const title = bilingualName(t.locale, line)
  const detailsRu = lineDetails(line)
  const detailsKk = lineDetailsKk(line)
  // Modifier details follow the name: the interface language first, the other one under it.
  const details = t.locale === "kk" && detailsKk ? [{ text: detailsKk, lang: "kk" }, { text: detailsRu, lang: "ru" }] : [{ text: detailsRu, lang: "ru" }, { text: detailsKk, lang: "kk" }]
  const voided = Boolean(line.voidedAt)
  const sent = Boolean(line.sentToKitchenAt) && !voided
  // A sent line is fixed: «−» and the bin open «Удалить позицию»; «+» adds a new portion as its own line.
  // «−» on the last portion of an unsent line asks inline «Убрать позицию?» instead of deleting silently.
  const [confirmRemove, setConfirmRemove] = useState(false)
  // «+» while asking answers the question: the line keeps its portions.
  if (confirmRemove && (line.quantity > 1 || sent || voided)) setConfirmRemove(false)
  const decrement = () => (sent ? onVoid(line.clientLineId) : line.quantity <= 1 ? setConfirmRemove(true) : onDecrement(line.clientLineId))
  const remove = () => (sent ? onVoid(line.clientLineId) : onRemove(line.clientLineId))

  return (
    <li className={cn(LINE_GRID, "items-start py-3", voided && "text-muted-foreground")} aria-label={voided ? t("line.voided", { name: title.primary.text }) : undefined}>
      <div className="min-w-0 pt-3">
        <p lang={title.primary.lang} className={cn("text-body font-semibold", voided && "line-through")}>
          {title.primary.text}
        </p>
        {title.secondary && (
          <p lang={title.secondary.lang} className={cn("text-body-sm text-muted-foreground", voided && "line-through")}>
            {title.secondary.text}
          </p>
        )}
        {details.map((detail) =>
          detail.text ? (
            <p key={detail.lang} lang={detail.lang} className={cn("text-body-sm text-muted-foreground", voided && "line-through")}>
              {detail.text}
            </p>
          ) : null,
        )}
        {sent && (
          <TonePill tone="info" className="mt-1 gap-1">
            <ChefHat aria-hidden className="size-3.5" />
            {t("line.onKitchen")}
          </TonePill>
        )}
        {voided && (
          <TonePill tone="neutral" className="mt-1">
            {t("line.removed")}
          </TonePill>
        )}
      </div>
      {voided ? (
        <span className="pt-3 text-center text-body font-semibold tabular-nums line-through">{line.quantity}</span>
      ) : (
        <div className="flex items-center">
          <Button variant="secondary" size="icon" className="size-12" aria-label={sent ? t("line.voidAria", { name: title.primary.text }) : t("line.decrementAria", { name: title.primary.text })} onClick={decrement}>
            <Minus />
          </Button>
          <span className="w-8 text-center text-body font-semibold tabular-nums">{line.quantity}</span>
          <Button variant="secondary" size="icon" className="size-12" aria-label={t("line.incrementAria", { name: title.primary.text })} onClick={() => onIncrement(line.clientLineId)}>
            <Plus />
          </Button>
        </div>
      )}
      <div className="flex min-w-0 flex-col items-end gap-2">
        <Money value={lineTotal(line)} size="sm" className={cn("pt-3 text-right", voided && "text-muted-foreground line-through")} />
        {!voided && (
          <Button variant="ghost" size="icon" aria-label={sent ? t("line.voidKitchenAria", { name: title.primary.text }) : t("line.removeAria", { name: title.primary.text })} onClick={remove} disabled={isLocked(line) && !sent} className="-mr-3 size-12 text-muted-foreground hover:text-destructive">
            <Trash2 />
          </Button>
        )}
      </div>
      {confirmRemove && (
        <div role="group" aria-label={t("line.confirmRemoveAria", { name: title.primary.text })} className="col-span-3 mt-2 flex items-center justify-between gap-2 rounded-control bg-muted px-3 py-2">
          <span className="text-body font-semibold">{t("line.confirmRemove")}</span>
          <span className="flex gap-2">
            <Button variant="secondary" className="h-[var(--control-h-pos)]" onClick={() => setConfirmRemove(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              className="h-[var(--control-h-pos)]"
              onClick={() => {
                setConfirmRemove(false)
                onRemove(line.clientLineId)
              }}
            >
              {t("line.remove")}
            </Button>
          </span>
        </div>
      )}
    </li>
  )
}
