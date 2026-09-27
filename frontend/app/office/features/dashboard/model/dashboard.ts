import type { OfficeNavigationGroup, OfficeNavigationItem } from "@/office/model/navigation"
import { almatyBusinessDate } from "@/shared/lib/almaty-time"

import { shiftBusinessDate } from "../../reports/model/url-state"

// «Стартовая страница» (W1-ADM-05, OFFICE-DESIGN §3.7): the period presets, Russian plurals for the
// counters and the «Быстрый доступ» tiles. Pure functions, so the screen and the tests share them.

export type DashboardPeriod = "today" | "7d" | "30d"

export const DASHBOARD_PERIODS: { value: DashboardPeriod; label: string; days: number }[] = [
  { value: "today", label: "Сегодня", days: 1 },
  { value: "7d", label: "7 дней", days: 7 },
  { value: "30d", label: "30 дней", days: 30 },
]

export function isDashboardPeriod(value: string | null | undefined): value is DashboardPeriod {
  return DASHBOARD_PERIODS.some((period) => period.value === value)
}

/** Business dates (Asia/Almaty) of a preset, today included: «7 дней» = today and the six days before. */
export function periodRange(period: DashboardPeriod, now = Date.now()) {
  const to = almatyBusinessDate(now)
  const days = DASHBOARD_PERIODS.find((preset) => preset.value === period)?.days ?? 1
  return { from: shiftBusinessDate(to, -(days - 1)), to }
}

/** 1 документ, 2 документа, 5 документов. */
export function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = Math.abs(count) % 10
  const mod100 = Math.abs(count) % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export type QuickAccessTile = { item: OfficeNavigationItem; group: OfficeNavigationGroup }

/**
 * While «Избранное» is empty (W3-ADM-13 puts the pinned tiles first): the first section of every group the
 * user may open, in menu order. «Главная» itself is left out — the tiles lead away from the start page.
 */
export function quickAccessTiles(groups: OfficeNavigationGroup[], limit = 8): QuickAccessTile[] {
  return groups
    .filter((group) => group.id !== "home")
    .flatMap((group) => (group.items[0] ? [{ item: group.items[0], group }] : []))
    .slice(0, limit)
}
