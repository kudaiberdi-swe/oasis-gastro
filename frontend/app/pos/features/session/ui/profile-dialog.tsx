import { useState, type ReactNode } from "react"
import { Clock3, LockKeyhole, LogOut, Moon, Rows3, Rows4, Sun, UserRound } from "lucide-react"

import { HotkeyHints } from "@/pos/features/hotkeys/ui/hotkey-hints"
import { posErrorMessage, ruT, useT, type Translator } from "@/pos/i18n"
import { LanguageSwitch } from "@/pos/i18n/language-switch"
import { useTheme, type ThemeDensity, type ThemeMode } from "@/shared/components/theme-provider"
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SegmentedControl } from "@/shared/components/ui"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import type { EmployeeRole, PosAccessSession } from "@/shared/types/pos"

/** «Кассир», «Менеджер» … in the interface language. */
export function roleLabel(role: EmployeeRole, t: Translator = ruT) {
  return t(`role.${role}` as const)
}

/**
 * «Профиль сотрудника» (W1-POS-14): who is signed in on this terminal, clock in / clock out
 * (attendance, W1-HR-05), the screen settings (theme, density — moved out of the header — and the
 * RU/KK interface language), the hotkey hints (W3-POS-01), lock and sign out (danger).
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
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clockedIn = Boolean(attendance)

  async function toggleAttendance() {
    setBusy(true)
    setError(null)
    try {
      await (clockedIn ? onClockOut() : onClockIn())
    } catch (caught) {
      setError(posErrorMessage(t, caught, t("profile.attendanceFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("profile.title")}</DialogTitle>
          <DialogDescription>{t("profile.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 rounded-card border border-border p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-round bg-muted text-rust">
            <UserRound aria-hidden className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-title-sm font-semibold">{access.employee.displayName}</p>
            <p className="text-body-sm text-muted-foreground">
              {roleLabel(access.employee.role, t)} · {t("profile.code", { code: access.employee.code })}
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
              <p className="text-body font-semibold">{t("profile.attendance")}</p>
              <p className="text-body-sm text-muted-foreground" aria-live="polite">
                {attendance === undefined ? t("common.loadingEllipsis") : attendance ? t("profile.atWorkSince", { time: formatAlmatyTime(attendance.clockIn, t.intl) }) : t("profile.notClockedIn")}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="lg" onClick={toggleAttendance} disabled={busy || attendance === undefined}>
            {busy ? t("common.saving") : clockedIn ? t("profile.clockOut") : t("profile.clockIn")}
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
            <LockKeyhole /> {t("profile.lock")}
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              onOpenChange(false)
              onLogout()
            }}
          >
            <LogOut /> {t("profile.logout")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * «Экран» — this terminal's own look, kept in the browser (theme-provider), and the interface language
 * (frontend/app/pos/i18n): Russian or Kazakh, switched at once and remembered on this terminal.
 */
function ScreenSettings() {
  const t = useT()
  const { mode, setMode, density, setDensity } = useTheme()
  return (
    <section aria-labelledby="pos-screen-settings" className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h3 id="pos-screen-settings" className="text-body font-semibold">
        {t("profile.screen")}
      </h3>
      <SettingRow label={t("profile.theme")}>
        <SegmentedControl<ThemeMode>
          aria-label={t("profile.theme")}
          size="pos"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "day", label: t("profile.themeDay"), icon: <Sun aria-hidden /> },
            { value: "night", label: t("profile.themeNight"), icon: <Moon aria-hidden /> },
          ]}
        />
      </SettingRow>
      <SettingRow label={t("profile.density")}>
        <SegmentedControl<ThemeDensity>
          aria-label={t("profile.density")}
          size="pos"
          value={density}
          onValueChange={setDensity}
          options={[
            { value: "comfortable", label: t("profile.densityComfortable"), icon: <Rows3 aria-hidden /> },
            { value: "compact", label: t("profile.densityCompact"), icon: <Rows4 aria-hidden /> },
          ]}
        />
      </SettingRow>
      <SettingRow label={t("profile.language")}>
        <LanguageSwitch label={t("profile.language")} />
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
