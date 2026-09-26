import { ChartColumn, FileText, type LucideIcon } from "lucide-react"

import { findOfficeGroup, findOfficeItem } from "@/office/model/navigation"

// «Избранное» (W3-ADM-13): what a pinned row looks like as a tile and how the list is reordered.
// Pure functions, so the screen, «Быстрый доступ» and the tests share them.

export type FavoriteRow = {
  id: string
  kind: "section" | "report" | "document"
  targetId: string
  label: string
  sortOrder: number
  reportId?: string
  reportTitle?: string
}

export type FavoriteTile = {
  id: string
  href: string
  /** The small line above the title: the menu group, «Отчёт · …» or the document's section. */
  caption: string
  title: string
  description?: string
  icon: LucideIcon
}

/** Section and document titles come from the menu (fresh after a rename); the stored label is the fallback. */
export function favoriteTile(row: FavoriteRow): FavoriteTile {
  if (row.kind === "report") {
    return { id: row.id, href: `/office/report-favorites/${row.targetId}`, caption: `Отчёт · ${row.reportTitle ?? "Избранный отчёт"}`, title: row.label, icon: ChartColumn }
  }
  const sectionId = row.kind === "document" ? row.targetId.split("/")[0] : row.targetId
  const item = findOfficeItem(sectionId)
  const group = findOfficeGroup(sectionId)
  if (row.kind === "document") return { id: row.id, href: `/office/${row.targetId}`, caption: item?.label ?? "Документ", title: row.label, icon: FileText }
  return { id: row.id, href: `/office/${row.targetId}`, caption: group?.label ?? "Раздел", title: item?.label ?? row.label, description: item?.description, icon: group?.icon ?? FileText }
}

/** The list in the order of `ids` (rows missing from it keep their order after), sortOrder renumbered. */
export function applyOrder<T extends { id: string; sortOrder: number }>(rows: T[], ids: string[]): T[] {
  const position = new Map(ids.map((id, index) => [id, index]))
  return [...rows]
    .sort((a, b) => (position.get(a.id) ?? ids.length + a.sortOrder) - (position.get(b.id) ?? ids.length + b.sortOrder))
    .map((row, index) => ({ ...row, sortOrder: index }))
}

/** `ids` with one of them moved to `toIndex` (clamped); the same array when nothing moves. */
export function moveId(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id)
  const to = Math.max(0, Math.min(ids.length - 1, toIndex))
  if (from < 0 || from === to) return ids
  const next = ids.filter((candidate) => candidate !== id)
  next.splice(to, 0, id)
  return next
}
