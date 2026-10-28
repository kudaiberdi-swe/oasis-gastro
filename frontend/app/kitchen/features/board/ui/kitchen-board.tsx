import { History, LogOut, Volume2, VolumeX } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { COMPLETED_JOURNAL_SIZE, useKitchenBoardQuery, useKitchenMutations, type KitchenTicket } from "@/kitchen/features/board/data/use-kitchen-board"
import { primeChime, useNewTicketChime, useSoundSetting } from "@/kitchen/features/board/model/sound"
import { activeCountLabel, BOARD_COLUMNS, type BoardStatus } from "@/kitchen/features/board/model/ticket"
import { useVanishing } from "@/kitchen/features/board/model/use-vanishing"
import { CompletedJournal } from "@/kitchen/features/board/ui/completed-journal"
import { StationFilter } from "@/kitchen/features/board/ui/station-filter"
import { TicketCard } from "@/kitchen/features/board/ui/ticket-card"
import { Button, Skeleton } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn } from "@/shared/lib/utils"
import type { KitchenStatus } from "@/shared/types/pos"

const STATION_KEY = "sandyq-kitchen-station"
const ON_DARK = "text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground focus-visible:outline-nav-accent"

// Column headers (redesign 2026-10): «Новые» blue, «Готовятся» dark grey, «Готово» green.
const COLUMN_HEADER: Record<BoardStatus, string> = {
  queued: "bg-info text-info-foreground",
  preparing: "bg-nav-raised text-nav-foreground",
  ready: "bg-success text-success-foreground",
}

type BoardTicket = KitchenTicket & { status: BoardStatus }

function isBoardTicket(ticket: KitchenTicket): ticket is BoardTicket {
  return ticket.status === "queued" || ticket.status === "preparing" || ticket.status === "ready"
}

function readStation(): string | undefined {
  try {
    return window.localStorage.getItem(STATION_KEY) || undefined
  } catch {
    return undefined
  }
}

function rememberStation(prepArea: string | undefined) {
  try {
    if (prepArea) window.localStorage.setItem(STATION_KEY, prepArea)
    else window.localStorage.removeItem(STATION_KEY)
  } catch {
    /* blocked storage: the station lasts for this visit */
  }
}

/** One clock for every ticket timer on the board. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export interface KitchenBoardProps {
  sessionToken: string
  /** Shown next to the title: «Ресторан Алматы · Повар Айгерим». */
  restaurantName?: string
  employeeName?: string
  /** «Выйти» — ends the kitchen PIN session. Not shown when the board is embedded in the POS. */
  onLock?: () => void
}

/** Full-screen kitchen board (POS-DESIGN §6.3, §11.5): «Новые / Готовятся / Готово» on the dark board, a clock top-right, live from Convex. */
export function KitchenBoard({ sessionToken, restaurantName, employeeName, onLock }: KitchenBoardProps) {
  const [prepArea, setPrepArea] = useState<string | undefined>(readStation)
  const [journalOpen, setJournalOpen] = useState(false)
  const tickets = useKitchenBoardQuery(sessionToken, { prepArea, includeCompletedLast: COMPLETED_JOURNAL_SIZE })
  const { setStatus } = useKitchenMutations()
  const sound = useSoundSetting()
  const now = useNow()
  const resetKey = prepArea ?? "all"

  const board = useMemo(() => {
    if (!tickets) return undefined
    const active = tickets.filter(isBoardTicket)
    const completed = tickets.filter((ticket) => ticket.status === "completed").sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
    return {
      active,
      completed,
      activeIds: active.map((ticket) => ticket._id as string),
      completedIds: completed.map((ticket) => ticket._id as string),
      presentIds: tickets.map((ticket) => ticket._id as string),
    }
  }, [tickets])

  const leaving = useVanishing(board?.active, board?.presentIds, resetKey)
  useNewTicketChime(board?.activeIds, board?.completedIds, { enabled: sound.enabled, resetKey })

  function move(ticket: KitchenTicket, status: KitchenStatus) {
    return setStatus({ sessionToken, ticketId: ticket._id, status })
  }

  function chooseStation(next: string | undefined) {
    rememberStation(next)
    setPrepArea(next)
  }

  const caption = [restaurantName, employeeName].filter(Boolean).join(" · ")

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-nav p-4 text-nav-foreground" onPointerDown={primeChime}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-display font-semibold">Заказы кухни</h1>
          <span className="inline-flex h-8 items-center rounded-round bg-nav-raised px-3 text-body-sm font-semibold tabular-nums">
            {board ? activeCountLabel(board.active.length) : "…"}
          </span>
          {caption ? <span className="text-body-sm text-nav-muted">{caption}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StationFilter value={prepArea} onChange={chooseStation} />
          <Button
            variant="ghost"
            size="icon"
            className={ON_DARK}
            aria-pressed={sound.enabled}
            aria-label={sound.enabled ? "Звук новых заказов включён" : "Звук новых заказов выключен"}
            title={sound.enabled ? "Выключить звук" : "Включить звук"}
            onClick={sound.toggle}
          >
            {sound.enabled ? <Volume2 /> : <VolumeX />}
          </Button>
          <Button variant="ghost" className={ON_DARK} onClick={() => setJournalOpen(true)}>
            <History />
            Выданные
            {board ? <span className="text-nav-muted tabular-nums">{board.completed.length}</span> : null}
          </Button>
          {onLock ? (
            <Button variant="ghost" className={ON_DARK} onClick={onLock}>
              <LogOut />
              Выйти
            </Button>
          ) : null}
          <time dateTime={new Date(now).toISOString()} className="ml-2 text-display font-semibold tabular-nums">
            {formatAlmatyTime(now)}
          </time>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4" {...(board ? {} : { role: "status", "aria-label": "Загрузка", "aria-busy": true })}>
        {BOARD_COLUMNS.map((column) => {
          const columnTickets = board?.active.filter((ticket) => ticket.status === column.status) ?? []
          const fading = leaving.filter((ticket) => ticket.status === column.status)
          const cards = [...columnTickets.map((ticket) => ({ ticket, leaving: false })), ...fading.map((ticket) => ({ ticket, leaving: true }))].sort(
            (a, b) => a.ticket.createdAt - b.ticket.createdAt,
          )
          const headingId = `kitchen-column-${column.status}`
          return (
            <section key={column.status} aria-labelledby={headingId} className="flex min-h-0 flex-col gap-3 rounded-panel bg-nav-raised/40 p-2">
              <h2 id={headingId} className={cn("flex h-12 shrink-0 items-center gap-2 rounded-card px-4 text-title font-semibold", COLUMN_HEADER[column.status])}>
                {column.title}
                {board ? <span className="tabular-nums">({columnTickets.length})</span> : null}
              </h2>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {!board ? (
                  <>
                    <Skeleton className="h-52 rounded-card bg-nav-raised" />
                    <Skeleton className="h-40 rounded-card bg-nav-raised" />
                  </>
                ) : cards.length === 0 ? (
                  <p className="px-1 py-8 text-center text-body text-nav-muted">Нет заказов</p>
                ) : (
                  cards.map(({ ticket, leaving: isLeaving }) => (
                    <TicketCard key={ticket._id} ticket={ticket} now={now} leaving={isLeaving} onSetStatus={(status) => move(ticket, status)} />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      <CompletedJournal open={journalOpen} onOpenChange={setJournalOpen} tickets={board?.completed ?? []} onSetStatus={move} />
    </div>
  )
}
