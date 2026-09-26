import { useAction, useMutation, useQuery } from "convex/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { api } from "../../../../../convex/_generated/api"
import { IDLE_LOCK_MS_CLIENT } from "./policy"
import { useT } from "@/pos/i18n"
import type { PosAccessSession } from "@/shared/types/pos"

const STORAGE_KEY = "sandyq-pos-session"
const TERMINAL_KEY = "sandyq-pos-terminal"

function rememberTerminal(externalId: string | null) {
  try {
    if (externalId) window.localStorage.setItem(TERMINAL_KEY, externalId)
    else window.localStorage.removeItem(TERMINAL_KEY)
  } catch {
    /* blocked storage: the choice lasts for this visit */
  }
}

/** `?terminal=` wins, then the remembered choice, then the build-time default. */
function resolveTerminalExternalId(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("terminal")
  if (fromQuery) {
    rememberTerminal(fromQuery)
    return fromQuery
  }
  try {
    const stored = window.localStorage.getItem(TERMINAL_KEY)
    if (stored) return stored
  } catch {
    /* blocked storage */
  }
  return import.meta.env.VITE_POS_TERMINAL_ID || null
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
  const t = useT()
  const [access, setAccess] = useState<PosAccessSession | null>(() => readStoredAccess())
  const [locked, setLocked] = useState(false)
  const login = useAction(api.domains.auth.actions.login)
  const logoutMutation = useMutation(api.domains.auth.mutations.logout)
  const lockMutation = useMutation(api.domains.auth.mutations.lock)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // «Автоблокировка кассы» of «Настройки системы» (W3-ADM-12, terminal → restaurant → organization); 5 min until it loads.
  const settings = useQuery(api.domains.pos.queries.terminalSettings, access ? { sessionToken: access.sessionToken } : "skip")
  const idleMs = useRef(IDLE_LOCK_MS_CLIENT)
  idleMs.current = settings?.idleLockMinutes ? settings.idleLockMinutes * 60_000 : IDLE_LOCK_MS_CLIENT

  const [terminalExternalId, setTerminalExternalId] = useState<string | null>(() => resolveTerminalExternalId())

  const chooseTerminal = useCallback((externalId: string | null) => {
    rememberTerminal(externalId)
    const url = new URL(window.location.href)
    if (url.searchParams.has("terminal")) {
      url.searchParams.delete("terminal")
      window.history.replaceState(null, "", url)
    }
    setTerminalExternalId(externalId)
  }, [])

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
      if (!terminalExternalId) throw new Error(t("session.noTerminal"))
      const result = await login({ employeeCode, pin, terminalExternalId, purpose: "operator" })
      const session = { sessionToken: result.sessionToken, expiresAt: result.expiresAt, employee: result.employee, terminal: result.terminal, restaurant: result.restaurant } as PosAccessSession
      persist(session)
      setLocked(false)
      return session
    },
    [login, persist, terminalExternalId, t],
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
    idleTimer.current = setTimeout(() => void lock(), idleMs.current)
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

  // A new idle-lock value from the office restarts the running timer with it.
  useEffect(() => {
    if (access && settings?.idleLockMinutes) touch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.idleLockMinutes])

  return { access, locked, terminalExternalId, chooseTerminal, signIn, signOut, lock }
}
