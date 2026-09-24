import { Moon, Rows3, Sun } from "lucide-react"

import { useTheme } from "@/shared/components/theme-provider"
import { Button } from "@/shared/components/ui/button"
import { cn, focusRingClass } from "@/shared/lib/utils"

function Mark() {
  return (
    <svg viewBox="0 0 40 40" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 L26 20 L20 34 L14 20 Z" />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

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
  const { mode, setMode, density, setDensity } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between rounded-panel bg-nav px-4 text-nav-foreground">
      <div className="flex items-center gap-2">
        <span className="text-nav-accent">
          <Mark />
        </span>
        <span className="font-display text-body font-semibold">{restaurantName}</span>
        {shiftNumber != null && <span className="text-body-sm text-nav-muted">· смена №{shiftNumber}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={mode === "day" ? "Ночная тема" : "Дневная тема"}
          className="text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground"
          onClick={() => setMode(mode === "day" ? "night" : "day")}
        >
          {mode === "day" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={density === "compact" ? "Обычная плотность" : "Плотная раскладка"}
          aria-pressed={density === "compact"}
          className="text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground aria-pressed:text-nav-accent"
          onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
        >
          <Rows3 className="size-4" />
        </Button>
        <button type="button" onClick={onOpenShiftInfo} className={cn("rounded-control px-1 text-body-sm font-semibold text-nav-muted hover:text-nav-foreground", focusRingClass)}>
          {employeeName}
        </button>
        <Button variant="ghost" size="sm" className="text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground" onClick={onLock}>
          Блокировать
        </Button>
      </div>
    </header>
  )
}
