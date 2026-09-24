import { Undo2 } from "lucide-react"
import { useState } from "react"

import type { KitchenTicket } from "@/kitchen/features/board/data/use-kitchen-board"
import { ticketOrigin } from "@/kitchen/features/board/model/ticket"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import type { KitchenStatus } from "@/shared/types/pos"

export interface CompletedJournalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Served tickets, newest first. */
  tickets: KitchenTicket[]
  onSetStatus: (ticket: KitchenTicket, status: KitchenStatus) => Promise<unknown>
}

/** «Выданные»: the last 20 served tickets; a ticket served by mistake goes back to «Готово». */
export function CompletedJournal({ open, onOpenChange, tickets, onSetStatus }: CompletedJournalProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function bumpBack(ticket: KitchenTicket) {
    setPendingId(ticket._id)
    setError(null)
    try {
      await onSetStatus(ticket, "ready")
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось вернуть заказ"))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Выданные заказы</DialogTitle>
          <DialogDescription>До 20 последних выданных заказов. Выданный по ошибке заказ можно вернуть на доску.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        {tickets.length === 0 ? (
          <EmptyState title="Пока ничего не выдано" description="Выданные заказы появятся здесь." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {tickets.map((ticket) => (
              <li key={ticket._id} className="flex items-center gap-4 py-3">
                <span className="w-32 shrink-0 font-display text-title font-semibold tabular-nums">№{ticket.orderNumber}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium">{ticket.lines.map((line) => `${formatQuantity(line.quantity)} × ${line.productName}`).join(", ")}</span>
                  <span className="text-body-sm text-muted-foreground">
                    {ticketOrigin(ticket)}
                    {ticket.completedAt ? ` · выдан в ${formatAlmatyTime(ticket.completedAt)}` : ""}
                  </span>
                </div>
                <Button variant="ghost" size="md" disabled={pendingId !== null} onClick={() => void bumpBack(ticket)}>
                  <Undo2 />
                  Вернуть
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
