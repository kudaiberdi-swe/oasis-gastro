import { Clock, Undo2 } from "lucide-react"
import { useState } from "react"

import type { KitchenTicket } from "@/kitchen/features/board/data/use-kitchen-board"
import { instructionKind, NEXT_STEP, PREVIOUS_STEP, ticketOrigin, type BoardStatus, type InstructionKind } from "@/kitchen/features/board/model/ticket"
import { ticketTimer, type TimerTone } from "@/kitchen/features/board/model/timer"
import { Button, StatusPill } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"
import { formatQuantity } from "@/shared/lib/format"
import { cn } from "@/shared/lib/utils"
import type { KitchenStatus } from "@/shared/types/pos"

const TIMER_CLASS: Record<TimerTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-destructive",
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
        "relative flex shrink-0 flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground shadow-panel",
        timer.tone === "danger" && "pl-1.5 before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-destructive",
        leaving && "pointer-events-none animate-out fade-out zoom-out-95 duration-150 fill-mode-forwards",
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-body-sm font-semibold text-muted-foreground">Заказ</span>
          <span className="font-display text-[40px] leading-none font-semibold tabular-nums">№{ticket.orderNumber}</span>
          <span className="mt-1.5 truncate text-body text-muted-foreground">{ticketOrigin(ticket)}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill domain="kitchen" status={ticket.status} className="h-7 text-body-sm" />
          <span className={cn("inline-flex items-center gap-1.5 text-title-sm font-semibold tabular-nums", TIMER_CLASS[timer.tone])}>
            <Clock aria-hidden className="size-[18px]" />
            <span aria-label={`Прошло ${timer.label}`}>{timer.label}</span>
          </span>
        </div>
      </header>

      <ul className="flex flex-col gap-2.5 px-4 py-3">
        {ticket.lines.map((line) => (
          <li key={line._id} className="flex flex-col gap-1.5">
            <span className="text-[18px] leading-7 font-semibold 2xl:text-[20px]">
              <span className="tabular-nums">{formatQuantity(line.quantity)}</span> × {line.productName}
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
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="px-4 pb-2 text-body-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <footer className="mt-auto flex gap-2 border-t border-border p-3">
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
