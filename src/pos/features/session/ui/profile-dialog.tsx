import { useState, type ReactNode } from "react"
import { Clock3, LockKeyhole, LogOut, Moon, Rows3, Rows4, Sun, UserRound } from "lucide-react"

import { HotkeyHints } from "@/pos/features/hotkeys/ui/hotkey-hints"
import { useTheme, type ThemeDensity, type ThemeMode } from "@/shared/components/theme-provider"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SegmentedControl } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { errorMessage } from "@/shared/lib/error-message"
import type { EmployeeRole, PosAccessSession } from "@/shared/types/pos"

export const ROLE_LABEL: Record<EmployeeRole, string> = { cashier: "Кассир", manager: "Менеджер", administrator: "Администратор", kitchen: "Кухня" }

/**
 * «Профиль сотрудника» (W1-POS-14): who is signed in on this terminal, clock in / clock out
 * (attendance, W1-HR-05), the screen settings (theme, density — moved out of the header — and the
 * reserved RU/KK interface switch), the hotkey hints (W3-POS-01), lock and sign out (danger).
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Профиль сотрудника</DialogTitle>
          <DialogDescription>Кто работает на этой кассе.</DialogDescription>
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
        <ScreenSettings />
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

/**
 * «Экран» — this terminal's own look, kept in the browser (theme-provider). The interface language
 * row reserves the RU/KK switch: Russian works now, Kazakh is shown as «скоро» until the i18n layer.
 */
function ScreenSettings() {
  const { mode, setMode, density, setDensity } = useTheme()
  return (
    <section aria-labelledby="pos-screen-settings" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h3 id="pos-screen-settings" className="text-body font-semibold">
        Экран
      </h3>
      <SettingRow label="Тема">
        <SegmentedControl<ThemeMode>
          aria-label="Тема"
          size="pos"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "day", label: "Дневная", icon: <Sun aria-hidden /> },
            { value: "night", label: "Ночная", icon: <Moon aria-hidden /> },
          ]}
        />
      </SettingRow>
      <SettingRow label="Плотность">
        <SegmentedControl<ThemeDensity>
          aria-label="Плотность"
          size="pos"
          value={density}
          onValueChange={setDensity}
          options={[
            { value: "comfortable", label: "Обычная", icon: <Rows3 aria-hidden /> },
            { value: "compact", label: "Плотная", icon: <Rows4 aria-hidden /> },
          ]}
        />
      </SettingRow>
      <SettingRow label="Язык интерфейса">
        <SegmentedControl<"ru" | "kk">
          aria-label="Язык интерфейса"
          size="pos"
          value="ru"
          onValueChange={() => {}}
          options={[
            { value: "ru", label: "Русский" },
            {
              value: "kk",
              disabled: true,
              label: (
                <span>
                  <span lang="kk">Қазақша</span> · скоро
                </span>
              ),
            },
          ]}
        />
      </SettingRow>
    </section>
  )
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <div className="[&>*]:w-full">{children}</div>
    </div>
  )
}
