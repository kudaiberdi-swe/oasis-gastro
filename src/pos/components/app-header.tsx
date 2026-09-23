import { Moon, Sun } from "lucide-react"

import { useTheme } from "@/shared/components/theme-provider"
import { Button } from "@/shared/components/ui/button"

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
  const { mode, setMode } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between rounded-[var(--radius-panel)] bg-nav px-4 text-nav-foreground">
      <div className="flex items-center gap-2">
        <span className="text-[color:var(--brass)]">
          <Mark />
        </span>
        <span className="font-display text-base font-semibold">{restaurantName}</span>
        {shiftNumber != null && <span className="text-sm text-nav-foreground/55">· смена №{shiftNumber}</span>}
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
