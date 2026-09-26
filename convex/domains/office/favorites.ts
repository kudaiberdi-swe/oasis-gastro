import { ConvexError, v } from "convex/values"

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { CAPABILITY_CATALOG, PERSONAL_SECTIONS } from "../../lib/capabilities"
import { allowsCapability, requireOfficeCapability } from "../../lib/officeAccess"
import { findReport } from "../reports/catalog"

// «Избранное» of the office (W3-ADM-13, L-8): pinned sections and documents of the signed-in user, plus the
// user's favorite report views (reportViews.favorite, W1-RPT-05) in the same list. Any office user may
// use it (a personal section, lib/capabilities.ts), and only ever sees and changes their own rows.
// A section the role no longer opens drops out of the list instead of leading to «Нет доступа».

export const FAVORITES_LIMIT = 50
// Favorite report views read per call; the report domain lists at most 200 per owner.
const REPORT_VIEWS_LIMIT = 100
const LABEL_MAX = 120

const kind = v.union(v.literal("section"), v.literal("report"), v.literal("document"))
type FavoriteKind = Doc<"officeFavorites">["kind"]

export type FavoriteItem = {
  /** "<kind>:<targetId>" — what reorderFavorites takes. */
  id: string
  kind: FavoriteKind
  targetId: string
  label: string
  sortOrder: number
  /** Report views only: the catalog report and its title. */
  reportId?: string
  reportTitle?: string
}

const favoriteId = (kind: FavoriteKind, targetId: string) => `${kind}:${targetId}`

function parseFavoriteId(id: string): { kind: FavoriteKind; targetId: string } | null {
  const match = /^(section|report|document):(.+)$/.exec(id)
  return match ? { kind: match[1] as FavoriteKind, targetId: match[2] } : null
}

const SECTION_IDS = new Set(CAPABILITY_CATALOG.map((section) => section.id))

/** The section a section/document favorite opens: "receipts" or "receipts/<id>" → "receipts". */
function sectionOf(kind: FavoriteKind, targetId: string): string | null {
  if (kind === "section") return SECTION_IDS.has(targetId) ? targetId : null
  if (kind === "document") {
    const match = /^([a-z0-9-]+)\/([A-Za-z0-9_-]{1,120})$/.exec(targetId)
    return match && SECTION_IDS.has(match[1]) ? match[1] : null
  }
  return null
}

async function ownRows(ctx: QueryCtx, userExternalId: string) {
  // Bounded: toggleFavorite keeps at most FAVORITES_LIMIT section/document rows plus the report placements.
  return ctx.db.query("officeFavorites").withIndex("by_user_sort", (q) => q.eq("userExternalId", userExternalId)).take(FAVORITES_LIMIT + REPORT_VIEWS_LIMIT)
}

async function favoriteReportViews(ctx: QueryCtx, userExternalId: string, role: { capabilities: string[] }) {
  if (!allowsCapability(role.capabilities, "office.report-favorites.view")) return []
  return ctx.db.query("reportViews").withIndex("by_owner_favorite", (q) => q.eq("ownerKey", userExternalId).eq("favorite", true)).take(REPORT_VIEWS_LIMIT)
}

/** The merged list: own rows the role still opens, then favorite report views without a placement yet (oldest first). */
async function buildList(ctx: QueryCtx, user: { externalId: string }, role: { capabilities: string[] }): Promise<FavoriteItem[]> {
  const [rows, views] = await Promise.all([ownRows(ctx, user.externalId), favoriteReportViews(ctx, user.externalId, role)])
  const viewsById = new Map(views.map((view) => [view.externalId, view]))
  const placed = new Set<string>()
  const items: FavoriteItem[] = []
  for (const row of rows) {
    if (row.kind === "report") {
      const view = viewsById.get(row.targetId)
      if (!view || placed.has(view.externalId)) continue
      placed.add(view.externalId)
      items.push({ id: favoriteId("report", view.externalId), kind: "report", targetId: view.externalId, label: view.name, sortOrder: row.sortOrder, reportId: view.reportId, reportTitle: findReport(view.reportId)?.title ?? view.reportId })
      continue
    }
    const section = sectionOf(row.kind, row.targetId)
    if (!section || !allowsCapability(role.capabilities, `office.${section}.view`)) continue
    items.push({ id: favoriteId(row.kind, row.targetId), kind: row.kind, targetId: row.targetId, label: row.label, sortOrder: row.sortOrder })
  }
  let next = (rows.at(-1)?.sortOrder ?? -1) + 1
  for (const view of [...views].sort((a, b) => a.createdAt - b.createdAt)) {
    if (placed.has(view.externalId)) continue
    items.push({ id: favoriteId("report", view.externalId), kind: "report", targetId: view.externalId, label: view.name, sortOrder: next++, reportId: view.reportId, reportTitle: findReport(view.reportId)?.title ?? view.reportId })
  }
  return items
}

export const listFavorites = query({
  args: {},
  handler: async (ctx) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.favorites.view")
    return buildList(ctx, user, role)
  },
})

async function rowOf(ctx: MutationCtx, userExternalId: string, kind: FavoriteKind, targetId: string) {
  return ctx.db
    .query("officeFavorites")
    .withIndex("by_user_target", (q) => q.eq("userExternalId", userExternalId).eq("kind", kind).eq("targetId", targetId))
    .first()
}

async function ownFavoriteView(ctx: MutationCtx, userExternalId: string, externalId: string) {
  const view = await ctx.db.query("reportViews").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  return view && view.ownerKey === userExternalId && view.favorite ? view : null
}

/**
 * Pins or unpins a section («В избранное» in the page header) or a document. A report view is only
 * unpinned here (its view stays saved, just not a favorite); it is added from the report itself.
 */
export const toggleFavorite = mutation({
  args: { kind, targetId: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.favorites.edit")
    const targetId = args.targetId.trim()

    if (args.kind === "report") {
      const view = await ownFavoriteView(ctx, user.externalId, targetId)
      if (!view) throw new ConvexError("Отчёт добавляется в избранное из самого отчёта")
      await ctx.db.patch(view._id, { favorite: false, updatedAt: Date.now() })
      const placement = await rowOf(ctx, user.externalId, "report", targetId)
      if (placement) await ctx.db.delete(placement._id)
      return { favorite: false }
    }

    const section = sectionOf(args.kind, targetId)
    if (!section || PERSONAL_SECTIONS.includes(section)) throw new ConvexError("Раздел не найден")
    if (!allowsCapability(role.capabilities, `office.${section}.view`)) throw new ConvexError("Нет доступа к разделу")
    const existing = await rowOf(ctx, user.externalId, args.kind, targetId)
    if (existing) {
      await ctx.db.delete(existing._id)
      return { favorite: false }
    }
    const label = args.label.trim()
    if (!label) throw new ConvexError("Укажите название")
    if (label.length > LABEL_MAX) throw new ConvexError(`Название — не длиннее ${LABEL_MAX} символов`)
    const rows = await ownRows(ctx, user.externalId)
    if (rows.filter((row) => row.kind !== "report").length >= FAVORITES_LIMIT) throw new ConvexError(`В избранном не больше ${FAVORITES_LIMIT} разделов и документов`)
    await ctx.db.insert("officeFavorites", { userExternalId: user.externalId, kind: args.kind, targetId, label, sortOrder: (rows.at(-1)?.sortOrder ?? -1) + 1, createdAt: Date.now() })
    return { favorite: true }
  },
})

/**
 * New order of the list (drag or keyboard on /office/favorites): `ids` from listFavorites, first = top.
 * Ids that are gone meanwhile are skipped; rows missing from `ids` keep their relative order after them.
 */
export const reorderFavorites = mutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.favorites.edit")
    if (args.ids.length > FAVORITES_LIMIT + REPORT_VIEWS_LIMIT) throw new ConvexError("Слишком длинный список")
    if (new Set(args.ids).size !== args.ids.length) throw new ConvexError("Список содержит повторы")
    const rows = await ownRows(ctx, user.externalId)
    const byId = new Map(rows.map((row) => [favoriteId(row.kind, row.targetId), row]))
    const ordered: (Doc<"officeFavorites"> | { insert: { kind: "report"; targetId: string; label: string } })[] = []
    for (const id of args.ids) {
      const parsed = parseFavoriteId(id)
      if (!parsed) throw new ConvexError("Неизвестный элемент избранного")
      const row = byId.get(id)
      if (row) {
        ordered.push(row)
        byId.delete(id)
        continue
      }
      // A favorite report view gets its placement row the first time the list is reordered.
      if (parsed.kind !== "report") continue
      const view = await ownFavoriteView(ctx, user.externalId, parsed.targetId)
      if (view) ordered.push({ insert: { kind: "report", targetId: view.externalId, label: view.name } })
    }
    for (const row of byId.values()) {
      // The placement of a report view that is no longer a favorite (removed in «Избранные отчёты») goes away.
      if (row.kind === "report" && !(await ownFavoriteView(ctx, user.externalId, row.targetId))) await ctx.db.delete(row._id)
      else ordered.push(row)
    }
    const now = Date.now()
    for (const [index, entry] of ordered.entries()) {
      if ("insert" in entry) await ctx.db.insert("officeFavorites", { userExternalId: user.externalId, ...entry.insert, sortOrder: index, createdAt: now })
      else if (entry.sortOrder !== index) await ctx.db.patch(entry._id, { sortOrder: index })
    }
    return null
  },
})
