import { useState } from "react"
import { Clock3, LockKeyhole, LogOut, UserRound } from "lucide-react"

import { HotkeyHints } from "@/pos/features/hotkeys/ui/hotkey-hints"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import type { EmployeeRole, PosAccessSession } from "@/shared/types/pos"

export const ROLE_LABEL: Record<EmployeeRole, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }

/**
 * «Профиль сотрудника» (W1-POS-14): who is signed in on this terminal, clock in / clock out
 * (attendance, W1-HR-05), the hotkey hints (W3-POS-01), lock and sign out (danger).
 */
export function ProfileDialog({
  open,
  onOpenChange,
  access,
  attendance,
  onClockIn,
  onClockOut,
  onLock,
  onLogout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: Pick<PosAccessSession, "employee" | "restaurant" | "terminal">
  /** undefined while loading; null when not clocked in. */
  attendance: { clockIn: number } | null | undefined
  onClockIn: () => Promise<unknown>
  onClockOut: () => Promise<unknown>
  onLock: () => void
  onLogout: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clockedIn = Boolean(attendance)

  async function toggleAttendance() {
    setBusy(true)
    setError(null)
    try {
      await (clockedIn ? onClockOut() : onClockIn())
    } catch (caught) {
      setError(errorMessage(caught, "Не удалось отметить явку"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Профиль сотрудника</DialogTitle>
          <DialogDescription>Текущая защищённая сессия терминала.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 rounded-card border border-border p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-round bg-muted text-rust">
            <UserRound aria-hidden className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-title-sm font-semibold">{access.employee.displayName}</p>
            <p className="text-body-sm text-muted-foreground">
              {ROLE_LABEL[access.employee.role]} · код {access.employee.code}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {access.restaurant.name} · {access.terminal.name}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-muted/40 p-4">
          <div className="flex items-center gap-3">
            <Clock3 aria-hidden className="size-5 text-muted-foreground" />
            <div>
              <p className="text-body font-semibold">Явка</p>
              <p className="text-body-sm text-muted-foreground" aria-live="polite">
                {attendance === undefined ? "Загрузка…" : attendance ? `На работе с ${formatAlmatyTime(attendance.clockIn)}` : "Приход не отмечен"}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="lg" onClick={toggleAttendance} disabled={busy || attendance === undefined}>
            {busy ? "Сохранение…" : clockedIn ? "Отметить уход" : "Отметить приход"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <HotkeyHints />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              onOpenChange(false)
              onLock()
            }}
          >
            <LockKeyhole /> Заблокировать
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              onOpenChange(false)
              onLogout()
            }}
          >
            <LogOut /> Выйти
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
