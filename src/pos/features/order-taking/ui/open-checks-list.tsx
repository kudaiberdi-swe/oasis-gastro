import { Plus } from "lucide-react"

import { formatTenge } from "@/shared/lib/utils"
import { cn } from "@/shared/lib/utils"

export type OpenCheckSummary = {
  orderId: string
  tableLabel?: string
  status: string
  total: number
  itemCount: number
}

export function OpenChecksList({ checks, activeOrderId, onSelect, onNew }: { checks: OpenCheckSummary[]; activeOrderId: string | null; onSelect: (orderId: string) => void; onNew: () => void }) {
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto">
      <button
        type="button"
        onClick={onNew}
        className={cn("flex items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-dashed border-border py-3 text-sm font-bold text-primary", !activeOrderId && "border-primary")}
      >
        <Plus className="size-4" /> Новый стол
      </button>
      {checks.map((check) => (
        <button
          key={check.orderId}
          type="button"
          onClick={() => onSelect(check.orderId)}
          className={cn(
            "flex flex-col gap-0.5 rounded-[var(--radius-card)] border p-3 text-left",
            activeOrderId === check.orderId ? "border-primary bg-primary/5" : "border-border bg-card",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{check.tableLabel || "Без стола"}</span>
            {check.status === "held" && <span className="text-xs font-semibold text-warning-foreground">отложен</span>}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{check.itemCount} поз.</span>
            <span className="font-semibold text-foreground">{formatTenge(check.total)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
