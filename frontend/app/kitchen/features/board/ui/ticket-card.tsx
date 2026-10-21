import { Clock, Undo2 } from "lucide-react"
import { useState } from "react"

import type { KitchenTicket } from "@/kitchen/features/board/data/use-kitchen-board"
import { channelBadge, instructionKind, NEXT_STEP, PREVIOUS_STEP, ticketOrigin, type BoardStatus, type InstructionKind } from "@/kitchen/features/board/model/ticket"
import { ticketTimer, type TimerTone } from "@/kitchen/features/board/model/timer"
import { Button, StatusPill, TonePill } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"
import type { KitchenStatus } from "@/shared/types/pos"

// The elapsed-time chip in the footer: quiet, then amber, then red (thresholds in timer.ts).
const TIMER_CLASS: Record<TimerTone, string> = {
  muted: "bg-muted text-muted-foreground",
  warning: "bg-warning-surface text-warning-foreground",
  danger: "bg-destructive-surface text-destructive",
}

const INSTRUCTION_CLASS: Record<InstructionKind, string> = {
  remove: "border-destructive bg-card text-destructive",
  add: "border-accent/40 bg-accent/10 text-accent",
  note: "border-border bg-muted text-muted-foreground",
}

export interface TicketCardProps {
  ticket: KitchenTicket & { status: BoardStatus }
  now: number
  onSetStatus: (status: KitchenStatus) => Promise<unknown>
  /** A cancelled ticket fading out: no actions, hidden from assistive tech. */
  leaving?: boolean
}

export function TicketCard({ ticket, now, onSetStatus, leaving = false }: TicketCardProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = ticketTimer(ticket, now)
  const next = NEXT_STEP[ticket.status]
  const back = PREVIOUS_STEP[ticket.status]
  const badge = channelBadge(ticket.source)

  async function move(status: KitchenStatus) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onSetStatus(status)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось сменить статус"))
    } finally {
      setPending(false)
    }
  }

  return (
    <article
      aria-label={`Заказ №${ticket.orderNumber}`}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      data-timer={timer.tone}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-card bg-card text-card-foreground shadow-panel",
        // Overdue: a red frame round the whole ticket (and the red time chip below).
        timer.tone === "danger" && "ring-2 ring-destructive ring-inset",
        leaving && "pointer-events-none animate-out fade-out zoom-out-95 duration-150 fill-mode-forwards",
      )}
    >
      <header className="flex flex-col gap-2 px-4 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-title font-bold tabular-nums">№{ticket.orderNumber}</span>
            <span className="truncate text-body text-muted-foreground">{ticketOrigin(ticket)}</span>
          </span>
          <time dateTime={new Date(ticket.createdAt).toISOString()} className="shrink-0 text-body font-semibold text-muted-foreground tabular-nums">
            {formatAlmatyTime(ticket.createdAt)}
          </time>
        </div>
        {badge ? (
          <span className="flex flex-wrap items-center gap-2">
            <TonePill tone="info" className="h-7 text-body-sm">
              {badge}
              {ticket.deliveryNumber ? ` ${ticket.deliveryNumber}` : ""}
            </TonePill>
            {ticket.pickupAt ? <span className="text-body-sm font-semibold tabular-nums">К выдаче курьеру {formatAlmatyTime(ticket.pickupAt)}</span> : null}
          </span>
        ) : null}
      </header>

      <ul className="flex flex-col gap-3 px-4 py-3">
        {ticket.lines.map((line) => (
          <li key={line._id} className="flex items-start gap-3">
            {/* The quantity in a round violet mark: kitchen lines carry no dish photo in the board query. */}
            <span aria-hidden className="grid h-9 min-w-9 shrink-0 place-items-center rounded-round bg-accent-surface px-2 text-body font-bold text-accent tabular-nums">{formatQuantity(line.quantity)}</span>
            <span className="flex min-w-0 flex-col gap-1.5 pt-1">
              <span className="text-title-sm font-semibold 2xl:text-title">
                <span className="sr-only">{formatQuantity(line.quantity)} × </span>
                {line.productName}
              </span>
              {line.instructions.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {line.instructions.map((instruction, index) => (
                    <span
                      key={`${instruction}-${index}`}
                      className={cn("inline-flex min-h-7 items-center rounded-control border px-2 text-body font-semibold", INSTRUCTION_CLASS[instructionKind(instruction)])}
                    >
                      {instruction}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="px-4 pb-2 text-body-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 px-4 pb-3">
        <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-round px-3 text-body font-semibold tabular-nums", TIMER_CLASS[timer.tone])}>
          <Clock aria-hidden className="size-4" />
          <span aria-label={`Прошло ${timer.label}`}>{timer.label}</span>
        </span>
        <StatusPill domain="kitchen" status={ticket.status} className="h-8 px-3 text-body-sm" />
      </div>

      <footer className="flex gap-2 border-t border-border p-3">
        {back ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-14"
            aria-label={`Вернуть в «${back.label}»`}
            title={`Вернуть в «${back.label}»`}
            disabled={pending || leaving}
            onClick={() => void move(back.status)}
          >
            <Undo2 />
          </Button>
        ) : null}
        <Button
          variant={next.primary ? "primary" : "secondary"}
          size="lg"
          className="h-14 flex-1 text-title-sm"
          disabled={pending || leaving}
          onClick={() => void move(next.status)}
        >
          {next.label}
        </Button>
      </footer>
    </article>
  )
}
