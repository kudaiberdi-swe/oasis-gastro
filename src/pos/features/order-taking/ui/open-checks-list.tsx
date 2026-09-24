import { Plus } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { Money } from "@/shared/components/ui/money"
import { StatusPill } from "@/shared/components/ui/status-pill"
import { cn, focusRingClass } from "@/shared/lib/utils"

export type OpenCheckSummary = {
  orderId: string
  tableLabel?: string
  status: string
  total: number
  itemCount: number
}

// Selected: 2px foreground frame (1px border + 1px inset ring, so the card does not shift) and a
// --gold strip on the left (POS-DESIGN §7).
const selectedClass = "border-foreground ring-1 ring-inset ring-foreground"

export function OpenChecksList({ checks, activeOrderId, onSelect, onNew }: { checks: OpenCheckSummary[]; activeOrderId: string | null; onSelect: (orderId: string) => void; onNew: () => void }) {
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto">
      <Button variant="secondary" className={cn("h-[var(--control-h-pos)] w-full", !activeOrderId && selectedClass)} onClick={onNew}>
        <Plus /> Новый стол
      </Button>
      {checks.map((check) => {
        const active = activeOrderId === check.orderId
        return (
          <button
            key={check.orderId}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(check.orderId)}
            className={cn(
              "relative flex flex-col gap-1 overflow-hidden rounded-card border bg-card p-3 text-left hover:bg-muted",
              active ? cn(selectedClass, "pl-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-gold") : "border-border",
              focusRingClass,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display truncate text-body font-semibold">{check.tableLabel || "Без стола"}</span>
              {check.status === "held" && <StatusPill domain="order" status={check.status} />}
            </div>
            <div className="flex items-center justify-between text-caption text-muted-foreground">
              <span>{check.itemCount} поз.</span>
              <Money value={check.total} size="sm" />
            </div>
          </button>
        )
      })}
    </div>
  )
}
