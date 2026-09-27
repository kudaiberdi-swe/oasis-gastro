import { Printer } from "lucide-react"
import { useState, type ReactNode } from "react"

import { RightPanel } from "@/office/components/right-panel"
import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { buildOrderReceiptHtml } from "@/pos/features/checkout/model/order-receipt"
import { printHtml } from "@/pos/features/print/print-document"
import { Button, EmptyState, Money, StatusPill, TonePill, useToast } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { describeAuditAction } from "@/shared/lib/audit-actions"
import { formatPercent, formatTenge } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"

import { useOrderDetail, type OrderDetail } from "../data/use-retail-office"
import { receiptFromDetail } from "../model/retail-office"

export interface OrderDetailPanelProps {
  orderId: string
  onClose: () => void
}

/**
 * The receipt card (W1-RTL-05, closes L-17): opens on a row click at any width — beside the register at
 * ≥1440, sliding over it below. The direct URL is /office/orders/:id.
 */
export function OrderDetailPanel({ orderId, onClose }: OrderDetailPanelProps) {
  const [attempt, setAttempt] = useState(0)
  return (
    // A malformed id in the URL fails the query's validator: the error stays inside the panel.
    <PlatformErrorBoundary key={`${orderId}-${attempt}`} onRetry={() => setAttempt((value) => value + 1)}>
      <OrderDetailContent orderId={orderId} onClose={onClose} />
    </PlatformErrorBoundary>
  )
}

function OrderDetailContent({ orderId, onClose }: OrderDetailPanelProps) {
  const detail = useOrderDetail(orderId)
  const toast = useToast()
  const onOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  if (!detail) {
    return (
      <RightPanel open onOpenChange={onOpenChange} title="Заказ">
        {detail === undefined ? (
          <OfficeStatePage state={{ kind: "loading" }} />
        ) : (
          <EmptyState title="Заказ не найден" description="Возможно, он относится к ресторану вне вашего доступа или ссылка устарела." />
        )}
      </RightPanel>
    )
  }

  const print = () => {
    if (!printHtml(buildOrderReceiptHtml(receiptFromDetail(detail)))) toast("Браузер не может напечатать чек", "error")
  }

  return (
    <RightPanel
      open
      onOpenChange={onOpenChange}
      title={`Заказ №${detail.order.number}`}
      footer={
        <Button variant="secondary" onClick={print}>
          <Printer aria-hidden />
          Печать чека
        </Button>
      }
    >
      <OrderReceipt detail={detail} />
    </RightPanel>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-body-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-body-sm", strong && "font-semibold")}>
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

export function OrderReceipt({ detail }: { detail: OrderDetail }) {
  const { order, lines, totals, payments, deletions, audit } = detail
  const meta = [order.orderTypeName, order.tableLabel ? `стол ${order.tableLabel}` : null, order.guestCount ? `гостей: ${order.guestCount}` : null].filter(Boolean).join(" · ")
  const configVersions = order.retailConfigVersion ? order.retailConfigVersion.split(/[,;]\s*/).filter(Boolean) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill domain="order" status={order.status} />
          {meta ? <span className="text-body-sm text-muted-foreground">{meta}</span> : null}
        </div>
        <dl className="flex flex-col gap-1">
          <Row label="Ресторан">{order.restaurantName}</Row>
          <Row label="Касса">{order.terminalName ?? "—"}</Row>
          <Row label="Кассир">{order.cashierName ?? "—"}</Row>
          <Row label="Создан">{formatAlmatyDateTime(order.createdAt)}</Row>
          {order.paidAt ? <Row label="Оплачен">{formatAlmatyDateTime(order.paidAt)}</Row> : null}
        </dl>
        {order.comment ? <p className="rounded-card bg-muted p-3 text-body-sm">{order.comment}</p> : null}
      </div>

      <Section title="Позиции">
        {lines.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">В заказе нет позиций</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <li key={line._id} className="flex flex-col gap-1 py-2">
                <div className="flex items-baseline justify-between gap-3 text-body-sm">
                  <span className={cn("min-w-0", line.voided && "text-muted-foreground line-through")}>
                    <span className="font-semibold tabular-nums">{line.quantity} ×</span> {line.productName}
                    {line.sizeLabel ? <span className="text-muted-foreground"> · {line.sizeLabel}</span> : null}
                  </span>
                  <span className={cn("whitespace-nowrap tabular-nums", line.voided && "text-muted-foreground line-through")}>{formatTenge(line.lineTotal)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-caption text-muted-foreground tabular-nums">{formatTenge(line.unitPrice)} за шт.</span>
                  {line.modifiers.map((modifier, index) => (
                    <TonePill key={`${modifier}-${index}`}>{modifier}</TonePill>
                  ))}
                  {line.voided ? <TonePill tone="danger">Удалена</TonePill> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Итоги">
        <dl className="flex flex-col gap-1">
          <Row label="Сумма заказа">{formatTenge(totals.subtotal)}</Row>
          {totals.discount ? <Row label={totals.discountName ?? "Скидка"}>{formatTenge(-totals.discount)}</Row> : null}
          {totals.serviceCharge ? <Row label={`Сервисный сбор ${formatPercent(totals.serviceChargePercent)}`}>{formatTenge(totals.serviceCharge)}</Row> : null}
          {totals.loyaltyRedeemed ? <Row label="Оплачено бонусами">{formatTenge(-totals.loyaltyRedeemed)}</Row> : null}
          <Row label="К оплате" strong>
            <Money value={totals.total} size="md" />
          </Row>
        </dl>
      </Section>

      <Section title="Платежи">
        {payments.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">Оплат нет</p>
        ) : (
          <dl className="flex flex-col gap-2">
            {payments.map((payment) => (
              <div key={payment._id} className="flex flex-col gap-0.5">
                <Row label={payment.type === "refund" ? `Возврат · ${payment.name}` : payment.name}>
                  <span className={cn(payment.type === "refund" && "text-destructive")}>{formatTenge(payment.type === "refund" ? -payment.amount : payment.amount)}</span>
                </Row>
                {payment.tendered !== null && payment.tendered > payment.amount ? (
                  <p className="text-caption text-muted-foreground">
                    Получено {formatTenge(payment.tendered)} · сдача {formatTenge(payment.change ?? payment.tendered - payment.amount)}
                  </p>
                ) : null}
                <p className="text-caption text-muted-foreground">{formatAlmatyDateTime(payment.createdAt)}</p>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {deletions.length ? (
        <Section title="Удаления и отмены">
          <ul className="flex flex-col gap-2">
            {deletions.map((event) => (
              <li key={event._id} className="flex flex-col gap-0.5 text-body-sm">
                <span className="font-semibold">
                  {event.reason}
                  {event.line ? <span className="font-normal text-muted-foreground"> · {event.line}</span> : null}
                </span>
                <span className="text-caption text-muted-foreground">
                  {formatAlmatyDateTime(event.createdAt)}
                  {event.writeOff ? " · со списанием со склада" : ""}
                  {event.comment ? ` · ${event.comment}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {configVersions.length ? (
        <Section title="Снимок кассовых настроек">
          <div className="flex flex-wrap gap-1.5">
            {configVersions.map((version) => (
              <TonePill key={version}>{version}</TonePill>
            ))}
          </div>
        </Section>
      ) : null}

      {audit.length ? (
        <Section title="История заказа">
          <ol className="flex flex-col gap-2">
            {audit.map((event) => (
              <li key={event._id} className="flex flex-col gap-0.5 text-body-sm">
                <span className="font-semibold" title={event.action}>
                  {describeAuditAction(event.action).label}
                </span>
                <span className="text-caption text-muted-foreground">
                  {formatAlmatyDateTime(event.occurredAt)}
                  {event.summary ? ` · ${event.summary}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </div>
  )
}
