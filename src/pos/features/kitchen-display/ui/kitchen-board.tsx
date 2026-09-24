import { useKitchenBoard, useKitchenMutations } from "@/pos/features/kitchen-display/data/use-kitchen"
import { StatusPill } from "@/shared/components/ui/status-pill"
import { cn, focusRingClass } from "@/shared/lib/utils"
import type { KitchenStatus } from "@/shared/types/pos"

const COLUMNS: Array<{ status: KitchenStatus; next: KitchenStatus | null }> = [
  { status: "queued", next: "preparing" },
  { status: "preparing", next: "ready" },
  { status: "ready", next: "completed" },
]

export function KitchenBoard({ sessionToken }: { sessionToken: string }) {
  const tickets = useKitchenBoard(sessionToken)
  const { setStatus } = useKitchenMutations()

  return (
    <div className="grid h-full grid-cols-3 gap-4 bg-nav p-4">
      {COLUMNS.map((column) => {
        const columnTickets = tickets.filter((ticket) => ticket.status === column.status)
        return (
          <div key={column.status} className="flex min-h-0 flex-col rounded-panel bg-card p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-body font-semibold">
                <StatusPill domain="kitchen" status={column.status} className="h-7 text-body-sm" />
              </h2>
              <span className="text-body-sm font-semibold text-muted-foreground tabular-nums">{columnTickets.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {columnTickets.map((ticket) => (
                <button
                  key={ticket._id}
                  type="button"
                  onClick={() => column.next && void setStatus({ sessionToken, ticketId: ticket._id, status: column.next })}
                  className={cn("rounded-card border p-3 text-left", column.status === "ready" ? "border-success bg-success/10" : "border-border bg-background hover:bg-muted", focusRingClass)}
                >
                  <p className="font-display text-title-sm font-semibold tabular-nums">№{ticket.orderNumber}</p>
                  <ul className="mt-1 space-y-0.5">
                    {ticket.lines.map((line) => (
                      <li key={line._id} className="text-body-sm text-foreground">
                        {line.quantity}× {line.productName}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
