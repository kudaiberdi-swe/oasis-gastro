import type { ReactNode } from "react"
import { Bell, ChefHat, LayoutGrid, LockKeyhole, Menu, Monitor, Store, Wifi, WifiOff } from "lucide-react"

import { ruT, useT, type Translator } from "@/pos/i18n"
import { formatAlmatyTime } from "@/shared/lib/almaty-time"
import { cn, focusRingClass } from "@/shared/lib/utils"

// Focus on the dark rail is the light violet --nav-accent, not the ring meant for light surfaces.
const navFocus = cn(focusRingClass, "focus-visible:outline-nav-accent")
// A rail item: icon over a short label, at least 56px tall; the open section is the violet pill. Below
// 1280px the rail is 72px and shows icons only — the label stays for screen readers.
const railItem = cn(
  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-card px-1 py-2 text-nav-muted transition-colors hover:bg-nav-raised hover:text-nav-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground [&_svg]:size-[22px] [&_svg]:shrink-0",
  navFocus,
)
const railLabel = "text-center text-body-sm leading-tight font-medium max-[1279px]:sr-only"
// Round 48px icon buttons in the rail's lower group.
const railIcon = cn("relative grid size-12 place-items-center rounded-round text-nav-muted transition-colors hover:bg-nav-raised hover:text-nav-foreground [&_svg]:size-[22px]", navFocus)

/** Convex connection as the rail shows it: «Синхронизировано», sending changes, or no link. */
export type SyncState = "synced" | "syncing" | "offline"

const SYNC_KEY = { synced: "header.synced", syncing: "header.syncing", offline: "header.offline" } as const satisfies Record<SyncState, string>

/** `slow` — a request has been in flight long enough to show; quick ones never flash «Синхронизация…». */
export function syncStateFrom(connection: { isWebSocketConnected: boolean; hasEverConnected?: boolean }, slow = false): SyncState {
  if (!connection.isWebSocketConnected) return connection.hasEverConnected === false ? "syncing" : "offline"
  return slow ? "syncing" : "synced"
}

const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"]

/**
 * «24 сентября» / «24 қыркүйек» in Almaty time — the date beside the employee's role. Chrome ships no Kazakh
 * month names («М09 27»), so the kk month comes from our own table; only the numeric day and month come from Intl.
 */
export function headerDate(value: number, t: Translator = ruT) {
  if (t.locale !== "kk") return new Date(value).toLocaleDateString(t.intl, { timeZone: "Asia/Almaty", day: "numeric", month: "long" })
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", day: "numeric", month: "numeric" }).formatToParts(new Date(value))
  const day = parts.find((part) => part.type === "day")?.value ?? ""
  const month = Number(parts.find((part) => part.type === "month")?.value)
  return `${day} ${KK_MONTHS[month - 1] ?? ""}`.trim()
}

/** The connection as an icon with a status dot; the word is for screen readers and the tooltip (the rail has no room). */
export function SyncIndicator({ state }: { state: SyncState }) {
  const t = useT()
  const label = t(SYNC_KEY[state])
  return (
    <span title={label} className="relative grid size-12 place-items-center text-nav-foreground">
      {state === "offline" ? <WifiOff aria-hidden className="size-[22px] text-nav-muted" /> : <Wifi aria-hidden className={cn("size-[22px]", state === "synced" ? "text-nav-accent" : "text-nav-muted")} />}
      <span aria-hidden className={cn("absolute top-2.5 right-2.5 size-2 rounded-round", state === "offline" ? "bg-destructive" : state === "syncing" ? "bg-warning" : "bg-success")} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word.match(/\p{L}/u)?.[0] ?? "").join("").toLocaleUpperCase("ru") || "·"
}

/**
 * POS rail (redesign 2026-10, replaces the 64px header): a dark ink-violet column on the left like the office
 * sidebar. Top: the OASIS Gastro mark (its tooltip names the restaurant and the till). Sections: «Касса» (the cashier screen), «Зал» (the hall grid), «Экран кухни»
 * with the active ticket count, «Офис» (manager and administrator only; the office has its own sign-in, L-7),
 * «Главное меню». Below: the shift (opens the shift dialog), the connection, notifications with the unread
 * count, lock, and the profile (initials; name, role, date and the till in its tooltip). Theme, density and
 * language live in the profile dialog. Every target is at least 48px.
 */
export function PosRail({
  restaurantName,
  terminalName,
  city,
  view = "pos",
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
  kitchenCount = 0,
  onPos,
  onFloor,
  onKitchen,
  onMenu,
  onOpenShiftInfo,
  onNotifications,
  onProfile,
  onLock,
}: {
  restaurantName: string
  terminalName?: string
  /** «<касса> · <город>» in the tooltips of the mark and the profile. */
  city?: string
  /** The open section: the cashier screen or the kitchen board. */
  view?: "pos" | "kitchen"
  /** «Офис» — for manager and administrator. */
  showOfficeSwitch?: boolean
  officeHref?: string
  /** «Синхронизировано»: a SyncIndicator (the live one subscribes to the connection itself). */
  syncIndicator?: ReactNode
  /** The date beside the role; defaults to now. */
  now?: number
  employeeName: string
  employeeRole?: string
  shiftNumber?: number
  shiftOpenedAt?: number
  /** Open for more than 24 hours: the shift's dot turns warning. */
  shiftWarning?: boolean
  unreadNotifications?: number
  /** Active kitchen tickets, shown on «Экран кухни». */
  kitchenCount?: number
  onPos?: () => void
  onFloor?: () => void
  onKitchen?: () => void
  onMenu?: () => void
  onOpenShiftInfo: () => void
  onNotifications?: () => void
  onProfile?: () => void
  onLock: () => void
}) {
  const t = useT()
  const brand = restaurantName.startsWith("Sandyq") ? restaurantName : `Sandyq · ${restaurantName}`
  const place = [terminalName, city].filter(Boolean).join(" · ")
  const profileLine = [employeeRole, headerDate(now ?? Date.now(), t)].filter(Boolean).join(" · ")
  const kitchenLabel = t("pos.kitchenScreen")
  return (
    <header className="no-scrollbar flex h-full w-[72px] shrink-0 flex-col items-center gap-3 overflow-y-auto rounded-panel bg-nav px-2 py-3 text-nav-foreground min-[1280px]:w-24">
      <img
        src="/branding/oasis-gastro-mark.svg"
        alt="OASIS Gastro"
        title={[brand, place].filter(Boolean).join("\n")}
        width={64}
        height={64}
        className="mt-1 mb-2 size-9 shrink-0"
      />
      <nav aria-label={t("header.section")} className="flex w-full flex-col gap-1">
        <button type="button" aria-current={view === "pos" ? "page" : undefined} onClick={onPos} className={railItem}>
          <Store aria-hidden />
          <span className={railLabel}>{t("header.pos")}</span>
        </button>
        {onFloor ? (
          <button type="button" onClick={onFloor} className={railItem}>
            <LayoutGrid aria-hidden />
            <span className={railLabel}>{t("floor.title")}</span>
          </button>
        ) : null}
        {onKitchen ? (
          <button
            type="button"
            aria-current={view === "kitchen" ? "page" : undefined}
            aria-label={kitchenCount > 0 ? `${kitchenLabel} · ${kitchenCount}` : undefined}
            onClick={onKitchen}
            className={railItem}
          >
            <ChefHat aria-hidden />
            <span className={railLabel}>{kitchenLabel}</span>
            {kitchenCount > 0 ? (
              <span aria-hidden className="absolute top-1 right-1 grid h-6 min-w-6 place-items-center rounded-round bg-info px-1 text-body-sm leading-none font-semibold text-info-foreground tabular-nums">
                {kitchenCount > 99 ? "99+" : kitchenCount}
              </span>
            ) : null}
          </button>
        ) : null}
        {showOfficeSwitch ? (
          <a href={officeHref} className={railItem}>
            <Monitor aria-hidden />
            <span className={railLabel}>{t("header.office")}</span>
          </a>
        ) : null}
        {onMenu ? (
          <button type="button" onClick={onMenu} className={railItem}>
            <Menu aria-hidden />
            <span className={railLabel}>{t("header.mainMenu")}</span>
          </button>
        ) : null}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1 pt-2">
        {shiftNumber != null && (
          <button
            type="button"
            onClick={onOpenShiftInfo}
            aria-label={[t("header.shift", { number: shiftNumber }), shiftOpenedAt != null ? t("header.shiftOpenedAt", { time: formatAlmatyTime(shiftOpenedAt, t.intl) }) : "", shiftWarning ? t("header.shiftOver24") : ""].filter(Boolean).join(", ")}
            className={cn(railItem, "bg-nav-raised text-nav-foreground")}
          >
            <span className="flex items-center gap-1.5 text-center text-body-sm leading-tight font-semibold">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-round", shiftWarning ? "bg-warning" : "bg-success")} />
              <span className="max-[1279px]:hidden">{t("header.shift", { number: shiftNumber })}</span>
              <span className="tabular-nums min-[1280px]:hidden">№{shiftNumber}</span>
            </span>
            {shiftOpenedAt != null && <span className="text-body-sm leading-tight text-nav-muted tabular-nums">{formatAlmatyTime(shiftOpenedAt, t.intl)}</span>}
          </button>
        )}
        {syncIndicator}
        {onNotifications && (
          <button type="button" aria-label={unreadNotifications ? t("header.notificationsUnread", { count: unreadNotifications }) : t("header.notifications")} className={railIcon} onClick={onNotifications}>
            <Bell aria-hidden />
            {unreadNotifications > 0 && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 grid h-6 min-w-6 place-items-center rounded-round bg-destructive px-1 text-body-sm leading-none font-semibold text-destructive-foreground tabular-nums">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </button>
        )}
        <button type="button" aria-label={t("header.lock")} className={railIcon} onClick={onLock}>
          <LockKeyhole aria-hidden />
        </button>
        <button
          type="button"
          onClick={onProfile ?? onOpenShiftInfo}
          aria-label={t("header.profile", { name: employeeName })}
          title={[employeeName, profileLine, brand, place].filter(Boolean).join("\n")}
          className={cn("mt-1 grid size-12 place-items-center rounded-round border border-nav-muted/40 bg-nav-raised text-body font-semibold text-nav-foreground hover:border-nav-accent", navFocus)}
        >
          <span aria-hidden>{initials(employeeName)}</span>
        </button>
      </div>
    </header>
  )
}
