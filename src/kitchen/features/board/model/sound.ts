import { useCallback, useEffect, useRef, useState } from "react"

// New-ticket chime (POS-DESIGN §6.3): two short tones from Web Audio, no asset to load.
// Browsers start audio only after a gesture, so the context is primed on the first tap.

const SOUND_KEY = "sandyq-kitchen-sound"

type AudioContextCtor = new () => AudioContext

let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (context) return context
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined
  if (!Ctor) return null
  try {
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

/** Call from a user gesture (a tap on the board or the sound switch) so later chimes can play. */
export function primeChime() {
  const ctx = audioContext()
  if (ctx?.state === "suspended") void ctx.resume().catch(() => {})
}

export function playChime() {
  const ctx = audioContext()
  if (!ctx) return
  try {
    const start = ctx.currentTime
    for (const [offset, frequency] of [[0, 880], [0.18, 1320]] as const) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3)
      oscillator.connect(gain).connect(ctx.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.32)
    }
  } catch {
    /* audio unavailable: the board still updates */
  }
}

function readSoundSetting() {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off"
  } catch {
    return true
  }
}

/** The sound switch, remembered on this device (on by default). */
export function useSoundSetting() {
  const [enabled, setEnabled] = useState(readSoundSetting)
  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SOUND_KEY, next ? "on" : "off")
      } catch {
        /* blocked storage: the choice lasts for this visit */
      }
      if (next) primeChime()
      return next
    })
  }, [])
  return { enabled, toggle }
}

/**
 * Chimes when an active ticket id appears that was not on the board before. The first result and
 * every station switch (`resetKey`) only take stock, so opening the board is silent.
 */
export function useNewTicketChime(
  activeIds: string[] | undefined,
  knownIds: string[] | undefined,
  { enabled, resetKey, play = playChime }: { enabled: boolean; resetKey: string; play?: () => void },
) {
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null)
  const signature = activeIds?.join(",")

  useEffect(() => {
    if (!activeIds || !knownIds) return
    const previous = seen.current
    if (!previous || previous.key !== resetKey) {
      seen.current = { key: resetKey, ids: new Set([...activeIds, ...knownIds]) }
      return
    }
    const fresh = activeIds.filter((id) => !previous.ids.has(id))
    for (const id of [...activeIds, ...knownIds]) previous.ids.add(id)
    if (fresh.length && enabled) play()
    // `signature` stands for activeIds; knownIds only grow the seen set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, resetKey])
}
