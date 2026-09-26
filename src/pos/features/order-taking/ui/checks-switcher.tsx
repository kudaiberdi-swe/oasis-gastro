import { LayoutGrid } from "lucide-react"

import { Button } from "@/shared/components/ui/button"

/**
 * The order panel's title: «Зал · N открыто» opens the hall grid (floor-grid.tsx) — tables, open checks,
 * a new check — beside the current check's table and number. Replaces the 380px open-checks popover.
 */
export function ChecksSwitcher({ tableLabel, orderNumber, openCount, onOpenFloor }: { tableLabel: string; orderNumber?: number; openCount: number; onOpenFloor: () => void }) {
  const title = tableLabel.trim() || "Новый заказ"
  return (
    <>
      <Button
        variant="secondary"
        className="h-[var(--control-h-pos)] px-3 text-body"
        onClick={onOpenFloor}
      >
        <LayoutGrid aria-hidden /> Зал · {openCount} открыто
      </Button>
      <p className="min-w-0 truncate font-display text-title font-semibold">
        {title}
        {orderNumber !== undefined && <span className="font-sans text-body-sm font-normal text-muted-foreground"> · №{orderNumber}</span>}
      </p>
    </>
  )
}
