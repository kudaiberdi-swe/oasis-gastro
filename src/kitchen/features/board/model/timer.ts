// Kitchen ticket timers (POS-DESIGN §6.3): muted → warning → destructive (+ a strip on the left).
// Thresholds live here so the kitchen lead can tune them in one place.

const MINUTE = 60_000

export type TimerTone = "muted" | "warning" | "danger"

export type TimerThresholds = {
  /** From this elapsed time the timer turns warning. */
  warningAfterMs: number
  /** From this elapsed time the timer turns destructive and the ticket gets a strip. */
  dangerAfterMs: number
}

export type KitchenTimerConfig = {
  /** «В очереди» and «Готовится»: since the ticket reached the kitchen — the guest's wait. */
  cooking: TimerThresholds
  /** «Готово»: since the dish reached the pass — food going cold. */
  pickup: TimerThresholds
}

export const KITCHEN_TIMER: KitchenTimerConfig = {
  cooking: { warningAfterMs: 10 * MINUTE, dangerAfterMs: 15 * MINUTE },
  pickup: { warningAfterMs: 3 * MINUTE, dangerAfterMs: 5 * MINUTE },
}

export type TimedTicket = {
  status: string
  createdAt: number
  readyAt?: number
}

export function timerTone(elapsedMs: number, thresholds: TimerThresholds): TimerTone {
  if (elapsedMs >= thresholds.dangerAfterMs) return "danger"
  if (elapsedMs >= thresholds.warningAfterMs) return "warning"
  return "muted"
}

/** 0 → "0:00", 754 000 → "12:34", 3 723 000 → "1:02:03". Negative (clock skew) reads as zero. */
export function formatElapsed(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mmss = `${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds).padStart(2, "0")}`
  return hours ? `${hours}:${mmss}` : mmss
}

export function ticketTimer(ticket: TimedTicket, now: number, config: KitchenTimerConfig = KITCHEN_TIMER) {
  const pickup = ticket.status === "ready"
  const startedAt = pickup ? (ticket.readyAt ?? ticket.createdAt) : ticket.createdAt
  const elapsedMs = Math.max(0, now - startedAt)
  return { startedAt, elapsedMs, tone: timerTone(elapsedMs, pickup ? config.pickup : config.cooking), label: formatElapsed(elapsedMs) }
}
