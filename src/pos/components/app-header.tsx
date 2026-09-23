import { Moon, Sun, UtensilsCrossed } from "lucide-react"

import { useTheme } from "@/shared/components/theme-provider"
import { Button } from "@/shared/components/ui/button"

export function AppHeader({
  restaurantName,
  employeeName,
  shiftNumber,
  onOpenShiftInfo,
  onLock,
}: {
  restaurantName: string
  employeeName: string
  shiftNumber?: number
  onOpenShiftInfo: () => void
  onLock: () => void
}) {
  const { mode, setMode } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between rounded-[var(--radius-panel)] bg-nav px-4 text-nav-foreground">
      <div className="flex items-center gap-2 text-sm font-bold">
        <UtensilsCrossed className="size-4" />
        <span>{restaurantName}</span>
        {shiftNumber != null && <span className="text-nav-foreground/60">· смена №{shiftNumber}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="text-nav-foreground hover:bg-white/10 hover:text-nav-foreground" onClick={() => setMode(mode === "day" ? "night" : "day")}>
          {mode === "day" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
        <button type="button" onClick={onOpenShiftInfo} className="text-sm font-semibold text-nav-foreground/80 hover:text-nav-foreground">
          {employeeName}
        </button>
        <Button variant="ghost" size="sm" className="text-nav-foreground hover:bg-white/10 hover:text-nav-foreground" onClick={onLock}>
          Блокировать
        </Button>
      </div>
    </header>
  )
}
