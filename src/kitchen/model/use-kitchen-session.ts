import { useAction, useMutation } from "convex/react"
import { useCallback, useEffect, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { PosAccessSession } from "@/shared/types/pos"

// The kitchen signs in with the same PIN session as the cashier (purpose "operator"), but keeps its
// own storage keys: a kitchen screen and a cashier are usually different devices, and a board that
// hangs on the wall must not idle-lock after five minutes like the POS does.
const STORAGE_KEY = "sandyq-kitchen-session"
const TERMINAL_KEY = "sandyq-kitchen-terminal"

function rememberTerminal(externalId: string | null) {
  try {
    if (externalId) window.localStorage.setItem(TERMINAL_KEY, externalId)
    else window.localStorage.removeItem(TERMINAL_KEY)
  } catch {
    /* blocked storage: the choice lasts for this visit */
  }
}

/** `?terminal=` (the office link opens the restaurant's kitchen terminal) wins, then the remembered one. */
function resolveTerminalExternalId(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("terminal")
  if (fromQuery) {
    rememberTerminal(fromQuery)
    return fromQuery
  }
  try {
    return window.localStorage.getItem(TERMINAL_KEY)
  } catch {
    return null
  }
}

function readStoredAccess(): PosAccessSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PosAccessSession
    return parsed.expiresAt > Date.now() ? parsed : null
  } catch {
    return null
  }
}

export function useKitchenSession() {
  const [access, setAccess] = useState<PosAccessSession | null>(() => readStoredAccess())
  const [terminalExternalId, setTerminalExternalId] = useState<string | null>(() => resolveTerminalExternalId())
  /** Why the board was left without the cook asking: an expired or revoked session. */
  const [endedReason, setEndedReason] = useState<string | null>(null)
  const login = useAction(api.domains.auth.actions.login)
  const logoutMutation = useMutation(api.domains.auth.mutations.logout)

  const persist = useCallback((value: PosAccessSession | null) => {
    setAccess(value)
    try {
      // sessionStorage, like the POS: a reload keeps the board, a closed browser asks for the PIN again
      // (a cashier or manager may sign in here too, and their token must not outlive the tab).
      if (value) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      else window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* storage unavailable: the session still works until reload */
    }
  }, [])

  const chooseTerminal = useCallback((externalId: string | null) => {
    rememberTerminal(externalId)
    const url = new URL(window.location.href)
    if (url.searchParams.has("terminal")) {
      url.searchParams.delete("terminal")
      window.history.replaceState(null, "", url)
    }
    setTerminalExternalId(externalId)
  }, [])

  const signIn = useCallback(
    async (employeeCode: string, pin: string) => {
      if (!terminalExternalId) throw new Error("Не задан терминал")
      const result = await login({ employeeCode, pin, terminalExternalId, purpose: "operator" })
      const session = { sessionToken: result.sessionToken, expiresAt: result.expiresAt, employee: result.employee, terminal: result.terminal, restaurant: result.restaurant } as PosAccessSession
      setEndedReason(null)
      persist(session)
      return session
    },
    [login, persist, terminalExternalId],
  )

  const signOut = useCallback(async () => {
    if (access) await logoutMutation({ sessionToken: access.sessionToken }).catch(() => {})
    setEndedReason(null)
    persist(null)
  }, [access, logoutMutation, persist])

  /** The server refused the session (expired, revoked, access removed): back to the PIN screen. */
  const drop = useCallback(
    (reason: string) => {
      setEndedReason(reason)
      persist(null)
    },
    [persist],
  )

  // The 12-hour operator session ends on the server; end it here at the same moment.
  useEffect(() => {
    if (!access) return
    const timer = setTimeout(() => drop("Сессия истекла. Войдите снова"), Math.max(0, access.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [access, drop])

  return { access, terminalExternalId, endedReason, chooseTerminal, signIn, signOut, drop }
}
