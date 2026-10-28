import { useEffect, useState, type ReactNode } from "react"

import { Banner, Button } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

// The client demo (SWA sandyq-demo → dev deployment): a build with VITE_DEMO_MODE=true. Sign-in goes through
// the normal paths; the buttons only fill in fixed demo accounts. The accounts themselves (demo-logins.ts)
// are imported dynamically behind the build-time flag, so a normal build does not contain them.

export const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === "true"

/** The only branch shown in demos (DEMO_RESTAURANT): a demo build opens its cash register without the terminal picker. */
export const DEMO_TERMINAL_ID = "shafran-09-01"

type DemoLogins = typeof import("./demo-logins")

/** The demo accounts, or null outside a demo build (and for the moment it takes to load the chunk). */
export function useDemoLogins(): DemoLogins | null {
  const [logins, setLogins] = useState<DemoLogins | null>(null)
  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE !== "true") return
    let live = true
    void import("./demo-logins").then((module) => {
      if (live) setLogins(module)
    })
    return () => {
      live = false
    }
  }, [])
  return logins
}

/** One button per demo role with a line on what it sees; a click signs in through the caller's existing path. */
export function DemoLoginButtons<T extends { label: string; hint: string }>({ logins, onPick }: { logins: readonly T[]; onPick: (login: T) => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(login: T) {
    setBusy(login.label)
    setError(null)
    try {
      await onPick(login)
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось войти"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-body-sm text-muted-foreground">Демо-вход: выберите роль</p>
      {logins.map((login) => (
        <Button key={login.label} variant="secondary" size="lg" className="h-auto flex-col items-start gap-0.5 py-3 text-left whitespace-normal" disabled={busy !== null} onClick={() => void pick(login)}>
          <span>{busy === login.label ? "Вход…" : login.label}</span>
          <span className="text-body-sm font-normal text-muted-foreground">{login.hint}</span>
        </Button>
      ))}
      {error && <Banner tone="danger" title={error} />}
    </div>
  )
}

/** «Демо-версия · данные тестовые» above every surface of a demo build; outside one, nothing changes. */
export function DemoFrame({ children }: { children: ReactNode }) {
  if (!isDemoMode()) return children
  return (
    <div className="flex h-full flex-col">
      <p role="note" className="shrink-0 border-b border-warning/45 bg-warning-surface px-4 py-1 text-center text-caption font-medium text-warning-foreground">
        Демо-версия · данные тестовые
      </p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
