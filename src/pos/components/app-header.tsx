import { Bell, LockKeyhole, Menu, Moon, Rows3, Sun } from "lucide-react"

import { useTheme } from "@/shared/components/theme-provider"
import { Button } from "@/shared/components/ui/button"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn, focusRingClass } from "@/shared/lib/utils"

function Mark() {
  return (
    <svg viewBox="0 0 40 40" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 L26 20 L20 34 L14 20 Z" />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Icon buttons on the dark header: --nav-raised on hover, never white overlays (POS-DESIGN §6.2).
const navButton = "text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground"

/**
 * POS header (W1-POS-10/14): ☰ main menu, brand and branch, the shift pill (opens the shift
 * dialog), notifications with the unread count, theme, density, profile and lock.
 */
export function AppHeader({
  restaurantName,
  terminalName,
  employeeName,
  employeeRole,
  shiftNumber,
  shiftOpenedAt,
  shiftWarning = false,
  unreadNotifications = 0,
  onMenu,
  onOpenShiftInfo,
  onNotifications,
  onProfile,
  onLock,
}: {
  restaurantName: string
  terminalName?: string
  employeeName: string
  employeeRole?: string
  shiftNumber?: number
  shiftOpenedAt?: number
  /** Open for more than 24 hours: the pill's dot turns warning. */
  shiftWarning?: boolean
  unreadNotifications?: number
  onMenu?: () => void
  onOpenShiftInfo: () => void
  onNotifications?: () => void
  onProfile?: () => void
  onLock: () => void
}) {
  const { mode, setMode, density, setDensity } = useTheme()
  const brand = restaurantName.startsWith("Sandyq") ? restaurantName : `Sandyq · ${restaurantName}`
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-panel bg-nav px-2 text-nav-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <Button variant="ghost" size="icon" aria-label="Главное меню" className={navButton} onClick={onMenu}>
            <Menu />
          </Button>
        )}
        <span className="text-nav-accent">
          <Mark />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-display text-body font-semibold">{brand}</span>
          {terminalName && <span className="truncate text-body-sm text-nav-muted">{terminalName}</span>}
        </span>
        {shiftNumber != null && (
          <button
            type="button"
            onClick={onOpenShiftInfo}
            aria-label={`Смена №${shiftNumber}${shiftWarning ? ", открыта более 24 часов" : ""}`}
            className={cn("ml-2 inline-flex h-9 items-center gap-2 rounded-control bg-nav-raised px-3 text-body-sm font-semibold text-nav-foreground hover:text-nav-accent", focusRingClass)}
          >
            <span aria-hidden className={cn("size-2 rounded-round", shiftWarning ? "bg-warning" : "bg-success")} />
            Смена №{shiftNumber}
            {shiftOpenedAt != null && <span className="font-normal text-nav-muted">· {formatAlmatyTime(shiftOpenedAt)}</span>}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onNotifications && (
          <Button variant="ghost" size="icon" aria-label={unreadNotifications ? `Уведомления: ${unreadNotifications} новых` : "Уведомления"} className={cn(navButton, "relative")} onClick={onNotifications}>
            <Bell />
            {unreadNotifications > 0 && (
              <span aria-hidden className="absolute top-1 right-1 grid h-5 min-w-5 place-items-center rounded-round bg-destructive px-1 text-caption font-semibold text-destructive-foreground">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label={mode === "day" ? "Ночная тема" : "Дневная тема"} className={navButton} onClick={() => setMode(mode === "day" ? "night" : "day")}>
          {mode === "day" ? <Moon /> : <Sun />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={density === "compact" ? "Обычная плотность" : "Плотная раскладка"}
          aria-pressed={density === "compact"}
          className={cn(navButton, "aria-pressed:text-nav-accent")}
          onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
        >
          <Rows3 />
        </Button>
        <button
          type="button"
          onClick={onProfile ?? onOpenShiftInfo}
          aria-label={`Профиль: ${employeeName}`}
          className={cn("flex h-11 flex-col items-end justify-center rounded-control px-2 leading-tight hover:bg-nav-raised", focusRingClass)}
        >
          <span className="text-body-sm font-semibold text-nav-foreground">{employeeName}</span>
          {employeeRole && <span className="text-body-sm text-nav-muted">{employeeRole}</span>}
        </button>
        <Button variant="ghost" size="icon" aria-label="Заблокировать кассу" className={navButton} onClick={onLock}>
          <LockKeyhole />
        </Button>
      </div>
    </header>
  )
}
