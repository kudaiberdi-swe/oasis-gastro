import { useAction, useMutation } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "../../../../../convex/_generated/api"
import { IDLE_LOCK_MS_CLIENT } from "./policy"
import type { PosAccessSession } from "@/shared/types/pos"

const STORAGE_KEY = "sandyq-pos-session"

function resolveTerminalExternalId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("terminal")
  if (fromQuery) {
    window.localStorage.setItem("sandyq-pos-terminal", fromQuery)
    return fromQuery
  }
  const stored = window.localStorage.getItem("sandyq-pos-terminal")
  if (stored) return stored
  const fromEnv = import.meta.env.VITE_POS_TERMINAL_ID
  if (fromEnv) return fromEnv
  throw new Error("Не задан терминал: передайте ?terminal=<externalId> или VITE_POS_TERMINAL_ID")
}

function readStoredAccess(): PosAccessSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PosAccessSession
    if (parsed.expiresAt <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export function usePosSession() {
  const [access, setAccess] = useState<PosAccessSession | null>(() => readStoredAccess())
  const [locked, setLocked] = useState(false)
  const login = useAction(api.domains.auth.actions.login)
  const logoutMutation = useMutation(api.domains.auth.mutations.logout)
  const lockMutation = useMutation(api.domains.auth.mutations.lock)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const terminalExternalId = resolveTerminalExternalId()

  const persist = useCallback((value: PosAccessSession | null) => {
    setAccess(value)
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      else window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* sessionStorage unavailable — session still works for this tab's lifetime */
    }
  }, [])

  const signIn = useCallback(
    async (employeeCode: string, pin: string) => {
      const result = await login({ employeeCode, pin, terminalExternalId, purpose: "operator" })
      const session = { sessionToken: result.sessionToken, expiresAt: result.expiresAt, employee: result.employee, terminal: result.terminal, restaurant: result.restaurant } as PosAccessSession
      persist(session)
      setLocked(false)
      return session
    },
    [login, persist, terminalExternalId],
  )

  const signOut = useCallback(async () => {
    if (access) await logoutMutation({ sessionToken: access.sessionToken }).catch(() => {})
    persist(null)
    setLocked(false)
  }, [access, logoutMutation, persist])

  const lock = useCallback(async () => {
    if (access) await lockMutation({ sessionToken: access.sessionToken }).catch(() => {})
    persist(null)
    setLocked(true)
  }, [access, lockMutation, persist])

  const touch = useCallback(() => {
    if (!access) return
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => void lock(), IDLE_LOCK_MS_CLIENT)
  }, [access, lock])

  useEffect(() => {
    if (!access) return
    touch()
    const events = ["pointerdown", "keydown"] as const
    for (const event of events) window.addEventListener(event, touch)
    return () => {
      for (const event of events) window.removeEventListener(event, touch)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(access)])

  return { access, locked, terminalExternalId, signIn, signOut, lock }
}
