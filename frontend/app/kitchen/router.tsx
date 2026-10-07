import { Component, type ReactNode } from "react"

import { KitchenBoard } from "@/kitchen/features/board/ui/kitchen-board"
import { useKitchenSession } from "@/kitchen/model/use-kitchen-session"
import { useTerminalOptions } from "@/pos/features/session/data/use-terminal-options"
import { LoginScreen } from "@/pos/features/session/ui/login-screen"
import { TerminalPicker } from "@/pos/features/session/ui/terminal-picker"
import { Banner } from "@/shared/components/ui"
import { errorMessage } from "@/shared/lib/error-message"

/** «Экран кухни · Sandyq Алматы · Главная касса»; a kitchen (kds) terminal opened by link has no picker entry. */
export function kitchenTerminalLabel(restaurantName?: string, terminalName?: string) {
  const terminal = restaurantName && terminalName?.startsWith(restaurantName) ? terminalName.slice(restaurantName.length).replace(/^\s*[·—-]\s*/, "") : terminalName
  return ["Экран кухни", restaurantName, terminal].filter(Boolean).join(" · ")
}

/**
 * The board query throws when the server refuses the session (expired, revoked, access removed).
 * Instead of a blank screen the cook lands on the PIN screen with the reason.
 */
class BoardBoundary extends Component<{ onError: (reason: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(errorMessage(error, "Сессия кухни завершена. Войдите снова"))
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** `/kitchen`: its own full-screen surface, no POS header. Terminal → PIN (POS-DESIGN §11.1) → board. */
export function KitchenRouter() {
  const session = useKitchenSession()
  const terminalOptions = useTerminalOptions("kitchen")

  if (!session.terminalExternalId) {
    return <TerminalPicker options={terminalOptions} onChoose={session.chooseTerminal} />
  }

  if (!session.access) {
    const branch = terminalOptions?.find((option) => option.terminals.some((terminal) => terminal.externalId === session.terminalExternalId))
    const terminal = branch?.terminals.find((candidate) => candidate.externalId === session.terminalExternalId)
    return (
      <div className="relative h-full">
        <LoginScreen surface="kitchen" onLogin={session.signIn} terminalLabel={kitchenTerminalLabel(branch?.restaurantName, terminal?.name)} onChangeTerminal={() => session.chooseTerminal(null)} />
        {session.endedReason ? (
          <div className="absolute inset-x-0 top-6 mx-auto w-full max-w-sm px-4">
            <Banner tone="warning" title={session.endedReason} className="bg-card" />
          </div>
        ) : null}
      </div>
    )
  }

  const { access } = session
  return (
    <BoardBoundary key={access.sessionToken} onError={session.drop}>
      <KitchenBoard sessionToken={access.sessionToken} restaurantName={access.restaurant.name} employeeName={access.employee.displayName} onLock={() => void session.signOut()} />
    </BoardBoundary>
  )
}
