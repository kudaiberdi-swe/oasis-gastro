import { useEffect, useRef, useState } from "react"

/** The cancel fade (POS-DESIGN §4: ≤150 ms). */
export const VANISH_MS = 150

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
}

/**
 * A ticket cancelled at the POS simply drops out of the board query. This keeps its last copy for
 * `VANISH_MS` so it can fade out in place instead of blinking away; with reduced motion it is gone at once.
 * `presentIds` is every id still in the response (a served ticket moves to the journal, it does not vanish);
 * a new `resetKey` (station switch) starts over without animating.
 */
export function useVanishing<T extends { _id: string }>(active: T[] | undefined, presentIds: string[] | undefined, resetKey: string) {
  const previous = useRef<{ key: string; tickets: T[] } | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [leaving, setLeaving] = useState<T[]>([])

  useEffect(() => {
    if (!active || !presentIds) return
    const before = previous.current
    previous.current = { key: resetKey, tickets: active }
    if (!before || before.key !== resetKey) {
      setLeaving([])
      return
    }
    if (prefersReducedMotion()) return
    const present = new Set(presentIds)
    const gone = before.tickets.filter((ticket) => !present.has(ticket._id))
    if (!gone.length) return
    const goneIds = new Set(gone.map((ticket) => ticket._id))
    setLeaving((current) => [...current.filter((ticket) => !goneIds.has(ticket._id)), ...gone])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setLeaving((current) => current.filter((ticket) => !goneIds.has(ticket._id)))
    }, VANISH_MS)
    timers.current.add(timer)
  }, [active, presentIds, resetKey])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
    }
  }, [])

  return leaving
}
