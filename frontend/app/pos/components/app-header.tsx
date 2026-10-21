import type { ReactNode } from "react"
import { Bell, LockKeyhole, Menu, Monitor, Store, Wifi, WifiOff } from "lucide-react"

import { ruT, useT, type Translator } from "@/pos/i18n"
import { Button } from "@/shared/components/ui/button"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn, focusRingClass } from "@/shared/lib/utils"

/**
 * The Sandyq mark (frontend/public/branding/sandyq-kz-reserve-logo.svg, 23×31): white on the ink-violet header,
 * which is --nav in both themes, so the one variant reads by day and at night.
 */
function Logo() {
  return <img src="/branding/sandyq-kz-reserve-logo.svg" alt="Sandyq" width={24} height={32} className="h-8 w-auto shrink-0" />
}

// Focus on the dark header is the light violet --nav-accent, not the ring meant for light surfaces.
const navFocus = "focus-visible:outline-nav-accent"
// Round icon buttons on the dark header: --nav-raised on hover, never white overlays (POS-DESIGN §6.2).
const navButton = cn("rounded-round text-nav-foreground hover:bg-nav-raised hover:text-nav-foreground", navFocus)

/** Convex connection as the header shows it: «Синхронизировано», sending changes, or no link. */
export type SyncState = "synced" | "syncing" | "offline"

const SYNC_KEY = { synced: "header.synced", syncing: "header.syncing", offline: "header.offline" } as const satisfies Record<SyncState, string>

/** `slow` — a request has been in flight long enough to show; quick ones never flash «Синхронизация…». */
export function syncStateFrom(connection: { isWebSocketConnected: boolean; hasEverConnected?: boolean }, slow = false): SyncState {
  if (!connection.isWebSocketConnected) return connection.hasEverConnected === false ? "syncing" : "offline"
  return slow ? "syncing" : "synced"
}

const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"]

/**
 * «24 сентября» / «24 қыркүйек» in Almaty time — the date under the employee's role. Chrome ships no Kazakh
 * month names («М09 27»), so the kk month comes from our own table; only the numeric day and month come from Intl.
 */
export function headerDate(value: number, t: Translator = ruT) {
  if (t.locale !== "kk") return new Date(value).toLocaleDateString(t.intl, { timeZone: "Asia/Almaty", day: "numeric", month: "long" })
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", day: "numeric", month: "numeric" }).formatToParts(new Date(value))
  const day = parts.find((part) => part.type === "day")?.value ?? ""
  const month = Number(parts.find((part) => part.type === "month")?.value)
  return `${day} ${KK_MONTHS[month - 1] ?? ""}`.trim()
}

/** «Касса / Офис» (manager and administrator only). The office has its own sign-in (L-7). */
function SurfaceSwitch({ officeHref }: { officeHref: string }) {
  const t = useT()
  const item = "inline-flex h-9 items-center gap-2 rounded-round px-3 text-body-sm [&_svg]:size-[18px]"
  return (
    <nav aria-label={t("header.section")} className="flex items-center gap-1 rounded-round bg-nav-raised p-1">
      <span aria-current="page" className={cn(item, "bg-primary font-semibold text-primary-foreground")}>
        <Store aria-hidden />
        {t("header.pos")}
      </span>
      <a href={officeHref} className={cn(item, "font-medium text-nav-muted hover:text-nav-foreground", focusRingClass, navFocus)}>
        <Monitor aria-hidden />
        {t("header.office")}
      </a>
    </nav>
  )
}

/** ≥1440 — icon and text; narrower — icon and a dot, the text stays for screen readers (§11.2). */
export function SyncIndicator({ state }: { state: SyncState }) {
  const t = useT()
  const label = t(SYNC_KEY[state])
  return (
    <span title={label} className="inline-flex h-11 items-center gap-2 px-2 text-body-sm font-medium text-nav-foreground">
      {state === "offline" ? <WifiOff aria-hidden className="size-[18px] text-nav-muted" /> : <Wifi aria-hidden className={cn("size-[18px]", state === "synced" ? "text-nav-accent" : "text-nav-muted")} />}
      <span aria-hidden className={cn("size-2 rounded-round min-[1440px]:hidden", state === "offline" ? "bg-destructive" : state === "syncing" ? "bg-warning" : "bg-success")} />
      <span className="sr-only min-[1440px]:not-sr-only">{label}</span>
    </span>
  )
}

/**
 * POS header 64px, ink-violet like the office sidebar (W1-POS-10/14, POS-DESIGN §11.2): ☰ main menu, the Sandyq logo, brand and «<касса> ·
 * <город>», «Касса / Офис», the shift pill (opens the shift dialog), «Синхронизировано», notifications
 * with the unread count, lock and the profile (name, role · date). Theme and density live in the
 * profile dialog, not here.
 */
export function AppHeader({
  restaurantName,
  terminalName,
  city,
  showOfficeSwitch = false,
  officeHref = "/office",
  syncIndicator,
  now,
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
  /** «<касса> · <город>» under the brand. */
  city?: string
  /** «Касса / Офис» — for manager and administrator. */
  showOfficeSwitch?: boolean
  officeHref?: string
  /** «Синхронизировано»: a SyncIndicator (the live one subscribes to the connection itself). */
  syncIndicator?: ReactNode
  /** The date under the role; defaults to now. */
  now?: number
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
  const t = useT()
  const brand = restaurantName.startsWith("Sandyq") ? restaurantName : `Sandyq · ${restaurantName}`
  const place = [terminalName, city].filter(Boolean).join(" · ")
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 rounded-panel bg-nav px-3 text-nav-foreground">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <Button variant="ghost" size="icon" aria-label={t("header.mainMenu")} className={cn(navButton, "size-12")} onClick={onMenu}>
            <Menu />
          </Button>
        )}
        <span className={cn("flex min-w-0 items-center gap-3", !onMenu && "pl-2")}>
          <Logo />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-body font-semibold">{brand}</span>
            {place && <span className="truncate text-body-sm text-nav-muted">{place}</span>}
          </span>
        </span>
        {showOfficeSwitch && (
          <span className="ml-2 shrink-0">
            <SurfaceSwitch officeHref={officeHref} />
          </span>
        )}
        {shiftNumber != null && (
          <button
            type="button"
            onClick={onOpenShiftInfo}
            aria-label={[t("header.shift", { number: shiftNumber }), shiftOpenedAt != null ? t("header.shiftOpenedAt", { time: formatAlmatyTime(shiftOpenedAt, t.intl) }) : "", shiftWarning ? t("header.shiftOver24") : ""].filter(Boolean).join(", ")}
            className={cn("ml-2 inline-flex h-12 shrink-0 items-center gap-2 rounded-round bg-nav-raised px-4 text-body-sm font-semibold text-nav-foreground hover:text-nav-accent", focusRingClass, navFocus)}
          >
            <span aria-hidden className={cn("size-2 rounded-round", shiftWarning ? "bg-warning" : "bg-success")} />
            {t("header.shift", { number: shiftNumber })}
            {shiftOpenedAt != null && <span className="font-normal text-nav-muted">· {t("header.shiftOpened", { time: formatAlmatyTime(shiftOpenedAt, t.intl) })}</span>}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {syncIndicator}
        {onNotifications && (
          <Button variant="ghost" size="icon" aria-label={unreadNotifications ? t("header.notificationsUnread", { count: unreadNotifications }) : t("header.notifications")} className={cn(navButton, "relative size-12")} onClick={onNotifications}>
            <Bell />
            {unreadNotifications > 0 && (
              <span aria-hidden className="absolute top-0 right-0 grid h-6 min-w-6 place-items-center rounded-round bg-destructive px-1 text-body-sm leading-none font-semibold text-destructive-foreground tabular-nums">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label={t("header.lock")} className={cn(navButton, "size-12")} onClick={onLock}>
          <LockKeyhole />
        </Button>
        <button
          type="button"
          onClick={onProfile ?? onOpenShiftInfo}
          aria-label={t("header.profile", { name: employeeName })}
          className={cn("ml-1 flex h-12 max-w-56 flex-col items-end justify-center rounded-control px-3 leading-tight hover:bg-nav-raised", focusRingClass, navFocus)}
        >
          <span className="max-w-full truncate text-body-sm font-semibold text-nav-foreground">{employeeName}</span>
          <span className="max-w-full truncate text-body-sm text-nav-muted">{[employeeRole, headerDate(now ?? Date.now(), t)].filter(Boolean).join(" · ")}</span>
        </button>
      </div>
    </header>
  )
}
