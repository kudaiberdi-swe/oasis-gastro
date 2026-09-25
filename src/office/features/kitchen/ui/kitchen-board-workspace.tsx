import { useState } from "react"

import { OfficeStatePage } from "@/office/components/state-page"
import { PlatformErrorBoundary } from "@/office/features/platform/data/use-platform"
import { EmptyState, TonePill } from "@/shared/components/ui"

import { useKitchenSummary } from "../data/use-kitchen-summary"
import { activeTicketsLabel } from "../model/kitchen-link"
import { KitchenBoardLink } from "./kitchen-board-link"

/**
 * «Экран кухни» (/office/kitchen-board, W1-KDS-03): restaurants in scope with the number of active
 * tickets and a link to their kitchen screen. The board itself lives at /kitchen behind a PIN.
 */
export function KitchenBoardWorkspace() {
  const [attempt, setAttempt] = useState(0)
  return (
    <PlatformErrorBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <KitchenBoard />
    </PlatformErrorBoundary>
  )
}

function KitchenBoard() {
  const rows = useKitchenSummary()
  const total = rows?.reduce((sum, row) => sum + row.activeTickets, 0) ?? 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-muted-foreground">Экран кухни открывается в новой вкладке, вход — по PIN сотрудника кухни.</p>
        {rows ? <TonePill tone={total ? "info" : "neutral"}>Всего: {activeTicketsLabel(total)}</TonePill> : null}
      </div>
      {rows === undefined ? (
        <OfficeStatePage state={{ kind: "loading" }} />
      ) : rows.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title="Кухонных терминалов нет" description="Добавьте терминал ресторану в разделе «Терминалы», чтобы открыть экран кухни." />
        </div>
      ) : (
        <ul aria-label="Кухни ресторанов" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.restaurantExternalId}>
              <article aria-label={row.restaurantName} className="flex h-full flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-panel">
                <header className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="truncate text-body font-semibold text-foreground">{row.restaurantName}</h3>
                    <p className="truncate text-caption text-muted-foreground">{row.terminalName ?? "Кухонный терминал не назначен"}</p>
                  </div>
                  <TonePill tone={row.activeTickets ? "info" : "neutral"}>{activeTicketsLabel(row.activeTickets)}</TonePill>
                </header>
                <div className="mt-auto">
                  {row.terminalExternalId ? (
                    <KitchenBoardLink terminalExternalId={row.terminalExternalId} restaurantName={row.restaurantName} />
                  ) : (
                    <p className="text-caption text-muted-foreground">Нет активного терминала — экран кухни открыть нельзя.</p>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
