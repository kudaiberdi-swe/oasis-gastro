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
import type { KitchenStatus } from "@/shared/types/pos"

const STATION_KEY = "sandyq-kitchen-station"
const ON_DARK = "text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground"

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
  /** Shown next to the title: «Sandyq Алматы · Повар Айгерим». */
  restaurantName?: string
  employeeName?: string
  /** «Выйти» — ends the kitchen PIN session. Not shown when the board is embedded in the POS. */
  onLock?: () => void
}

/** Full-screen kitchen board (POS-DESIGN §6.3, §11.5): «В очереди / Готовится / Готово», live from Convex. */
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
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <div className="flex flex-col">
            <span className="font-display text-title-sm text-nav-accent italic">kitchen</span>
            <h1 className="font-display text-[32px] leading-9 font-semibold">Заказы кухни</h1>
          </div>
          <span className="mb-0.5 inline-flex h-8 items-center rounded-control border border-nav-muted/50 px-3 text-body-sm font-semibold tabular-nums">
            {board ? activeCountLabel(board.active.length) : "…"}
          </span>
          {caption ? <span className="mb-1.5 text-body-sm text-nav-muted">{caption}</span> : null}
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
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4" {...(board ? {} : { role: "status", "aria-label": "Загрузка" })}>
        {BOARD_COLUMNS.map((column) => {
          const columnTickets = board?.active.filter((ticket) => ticket.status === column.status) ?? []
          const fading = leaving.filter((ticket) => ticket.status === column.status)
          const cards = [...columnTickets.map((ticket) => ({ ticket, leaving: false })), ...fading.map((ticket) => ({ ticket, leaving: true }))].sort(
            (a, b) => a.ticket.createdAt - b.ticket.createdAt,
          )
          const headingId = `kitchen-column-${column.status}`
          return (
            <section key={column.status} aria-labelledby={headingId} className="flex min-h-0 flex-col rounded-panel bg-nav-raised">
              <h2 id={headingId} className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2 font-display text-[24px] leading-8 font-semibold">
                {column.title}
                <span className="font-sans text-title-sm text-nav-muted tabular-nums">{board ? columnTickets.length : ""}</span>
              </h2>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
                {!board ? (
                  <>
                    <Skeleton className="h-52 bg-nav" />
                    <Skeleton className="h-40 bg-nav" />
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
