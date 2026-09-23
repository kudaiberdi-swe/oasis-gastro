import { useKitchenBoard, useKitchenMutations } from "@/pos/features/kitchen-display/data/use-kitchen"
import { cn } from "@/shared/lib/utils"
import type { KitchenStatus } from "@/shared/types/pos"

const COLUMNS: Array<{ status: KitchenStatus; title: string; next: KitchenStatus | null }> = [
  { status: "queued", title: "В очереди", next: "preparing" },
  { status: "preparing", title: "Готовится", next: "ready" },
  { status: "ready", title: "Готово", next: "completed" },
]

export function KitchenBoard({ sessionToken }: { sessionToken: string }) {
  const tickets = useKitchenBoard(sessionToken)
  const { setStatus } = useKitchenMutations()

  return (
    <div className="grid h-full grid-cols-3 gap-4 bg-nav p-4">
      {COLUMNS.map((column) => {
        const columnTickets = tickets.filter((ticket) => ticket.status === column.status)
        return (
          <div key={column.status} className="flex min-h-0 flex-col rounded-[var(--radius-panel)] bg-card/95 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-extrabold">{column.title}</h2>
              <span className="text-xs font-semibold text-muted-foreground">{columnTickets.length}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {columnTickets.map((ticket) => (
                <button
                  key={ticket._id}
                  type="button"
                  onClick={() => column.next && void setStatus({ sessionToken, ticketId: ticket._id, status: column.next })}
                  className={cn("rounded-[var(--radius-card)] border p-3 text-left", column.status === "ready" ? "border-success bg-success/10" : "border-border bg-background")}
                >
                  <p className="font-display text-base font-semibold">№{ticket.orderNumber}</p>
                  <ul className="mt-1 space-y-0.5">
                    {ticket.lines.map((line) => (
                      <li key={line._id} className="text-sm text-foreground">
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
