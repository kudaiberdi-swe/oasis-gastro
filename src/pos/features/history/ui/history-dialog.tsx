import { useState } from "react"
import { Printer, Search } from "lucide-react"

import { useOrderHistory, type HistoryOrder, type HistoryStatus } from "@/pos/features/history/data/use-order-history"
import { refundableTotal } from "@/pos/features/history/model/refund"
import { RefundPanel, type RefundInput } from "@/pos/features/history/ui/refund-panel"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, Input, Money, Select, SkeletonRows, StatusPill } from "@/shared/components/ui"
import { formatAlmatyDateTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"

const STATUS_OPTIONS: Array<{ value: HistoryStatus | "all"; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Открытые" },
  { value: "held", label: "Отложенные" },
  { value: "paid", label: "Оплаченные" },
  { value: "partially_refunded", label: "Частичный возврат" },
  { value: "refunded", label: "Возвращённые" },
  { value: "cancelled", label: "Отменённые" },
]

const REFUNDABLE = new Set(["paid", "partially_refunded"])

// A side sheet over the right edge: the list, and the refund panel next to it (L-4).
const sheetClass =
  "top-0 right-0 left-auto flex h-full max-h-none w-[min(1120px,100vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0"

/**
 * «История заказов» (W1-POS-18): orders of this terminal, server-side search, status filter and
 * pagination. «Продолжить» opens an open or held check, «Возврат» opens the refund panel on the right.
 */
export function HistoryDialog({
  open,
  onOpenChange,
  sessionToken,
  onContinue,
  onRefund,
  onPrint,
  onManagerRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionToken: string
  onContinue: (order: HistoryOrder) => Promise<unknown>
  onRefund: (input: RefundInput) => Promise<unknown>
  onPrint: (order: HistoryOrder) => void
  onManagerRequired: (reason: string) => Promise<string | null>
}) {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<HistoryStatus | "all">("all")
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const history = useOrderHistory(open ? sessionToken : null, search, status === "all" ? undefined : status)
  const refundOrder = history.orders.find((order) => order._id === refundOrderId) ?? null

  async function continueOrder(order: HistoryOrder) {
    setBusyOrderId(order._id)
    setError(null)
    try {
      await onContinue(order)
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось открыть заказ"))
    } finally {
      setBusyOrderId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRefundOrderId(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className={sheetClass}>
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <DialogTitle>История заказов</DialogTitle>
            <DialogDescription>Заказы этой кассы: поиск, фильтр и загрузка страниц выполняются на сервере.</DialogDescription>
          </DialogHeader>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex gap-2 border-b border-border bg-muted/40 px-6 py-3">
              <label className="relative flex-1">
                <span className="sr-only">Поиск заказа</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, стол или позиция" className="h-[var(--control-h-pos)] pl-9 text-body" />
              </label>
              <Select
                aria-label="Статус заказа"
                value={status}
                onValueChange={(value) => setStatus(value as HistoryStatus | "all")}
                options={STATUS_OPTIONS}
                className="h-[var(--control-h-pos)] w-56 text-body"
              />
            </div>
            {error && (
              <p role="alert" className="mx-6 mt-3 text-body-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
              {history.status === "LoadingFirstPage" ? (
                <SkeletonRows rows={6} />
              ) : history.orders.length === 0 ? (
                <EmptyState title="Заказы не найдены" description={search ? "Проверьте номер или название блюда." : "На этой кассе ещё нет заказов."} />
              ) : (
                <ul className="flex flex-col gap-2" aria-label="Заказы">
                  {history.orders.map((order) => (
                    <HistoryRow
                      key={order._id}
                      order={order}
                      selected={order._id === refundOrderId}
                      busy={busyOrderId === order._id}
                      onContinue={() => void continueOrder(order)}
                      onRefund={() => setRefundOrderId(order._id)}
                      onPrint={() => onPrint(order)}
                    />
                  ))}
                </ul>
              )}
              {history.status === "CanLoadMore" || history.status === "LoadingMore" ? (
                <div className="flex justify-center py-3">
                  <Button variant="secondary" onClick={history.loadMore} disabled={history.status === "LoadingMore"}>
                    {history.status === "LoadingMore" ? "Загрузка…" : "Показать ещё"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          {refundOrder && (
            <RefundPanel key={refundOrder._id} order={refundOrder} onClose={() => setRefundOrderId(null)} onRefund={onRefund} onManagerRequired={onManagerRequired} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HistoryRow({
  order,
  selected,
  busy,
  onContinue,
  onRefund,
  onPrint,
}: {
  order: HistoryOrder
  selected: boolean
  busy: boolean
  onContinue: () => void
  onRefund: () => void
  onPrint: () => void
}) {
  const refundable = REFUNDABLE.has(order.status) && refundableTotal(order.payments) > 0
  const place = [order.tableLabel, order.hallLabel].filter(Boolean).join(" · ")
  return (
    <li
      aria-label={`Заказ №${order.number}`}
      className={selected ? "grid grid-cols-[130px_1fr_auto_auto] items-center gap-3 rounded-card border border-foreground bg-card p-3" : "grid grid-cols-[130px_1fr_auto_auto] items-center gap-3 rounded-card border border-border bg-card p-3"}
    >
      <div>
        <p className="text-body font-semibold">№{order.number}</p>
        <p className="text-body-sm text-muted-foreground">{formatAlmatyDateTime(order.createdAt)}</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill domain="order" status={order.status} />
          {place && <span className="truncate text-body-sm font-medium">{place}</span>}
        </div>
        <p className="mt-1 truncate text-body-sm text-muted-foreground">
          {order.itemCount} поз. · {order.comment || "Без комментария"}
        </p>
      </div>
      <Money value={order.total} className="text-right" />
      <div className="flex justify-end gap-1">
        {order.status === "held" || order.status === "draft" ? (
          <Button variant="secondary" onClick={onContinue} disabled={busy}>
            {busy ? "Открытие…" : "Продолжить"}
          </Button>
        ) : null}
        {refundable ? (
          <Button variant="secondary" onClick={onRefund} aria-pressed={selected}>
            Возврат
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" aria-label={`Печать заказа №${order.number}`} onClick={onPrint}>
          <Printer />
        </Button>
      </div>
    </li>
  )
}
