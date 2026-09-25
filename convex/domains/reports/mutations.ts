import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope } from "../../lib/officeAccess"
import { checkReportPeriod, reportConfig } from "../../lib/reportConfig"
import { findReport } from "./catalog"

// Saved report views and favorites (W1-RPT-05): only the owner sees them; restaurants in a view are
// checked against the scope on save and dropped on open when access is gone.

export const listViews = query({
  args: { reportId: v.optional(v.string()), favoritesOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-favorites.view")
    const rows = args.reportId
      ? await ctx.db.query("reportViews").withIndex("by_owner_report", (q) => q.eq("ownerKey", user.externalId).eq("reportId", args.reportId!)).take(200)
      : args.favoritesOnly
        ? await ctx.db.query("reportViews").withIndex("by_owner_favorite", (q) => q.eq("ownerKey", user.externalId).eq("favorite", true)).take(200)
        : await ctx.db.query("reportViews").withIndex("by_owner_report", (q) => q.eq("ownerKey", user.externalId)).take(200)
    const network = user.restaurantScopes.includes("*")
    return rows
      .filter((row) => !args.favoritesOnly || row.favorite)
      .map((row) => ({ ...row, reportTitle: findReport(row.reportId)?.title ?? row.reportId, config: { ...row.config, restaurantExternalIds: row.config.restaurantExternalIds.filter((id) => network || user.restaurantScopes.includes(id)) } }))
  },
})

export const saveView = mutation({
  args: { externalId: v.optional(v.string()), reportId: v.string(), name: v.string(), favorite: v.boolean(), config: reportConfig },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-favorites.edit")
    if (!findReport(args.reportId)) throw new ConvexError("Отчёт не найден")
    for (const restaurant of args.config.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    checkReportPeriod(args.config)
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название представления")
    await getOfficeAuthEmail(ctx)
    const now = Date.now()
    if (args.externalId) {
      const row = await ctx.db.query("reportViews").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId!)).unique()
      if (!row || row.ownerKey !== user.externalId) throw new ConvexError("Представление не найдено")
      await ctx.db.patch(row._id, { name, favorite: args.favorite, config: args.config, updatedAt: now })
      return row.externalId
    }
    const externalId = `report-view-${crypto.randomUUID()}`
    await ctx.db.insert("reportViews", { externalId, ownerKey: user.externalId, reportId: args.reportId, name, favorite: args.favorite, config: args.config, createdAt: now, updatedAt: now })
    return externalId
  },
})

export const deleteView = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-favorites.edit")
    const row = await ctx.db.query("reportViews").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!row || row.ownerKey !== user.externalId) throw new ConvexError("Представление не найдено")
    await ctx.db.delete(row._id)
  },
})

/** Adds the report with its current filters to favorites, or removes its favorite views. */
export const toggleFavorite = mutation({
  args: { reportId: v.string(), config: reportConfig },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.report-favorites.edit")
    const report = findReport(args.reportId)
    if (!report) throw new ConvexError("Отчёт не найден")
    for (const restaurant of args.config.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    const views = await ctx.db.query("reportViews").withIndex("by_owner_report", (q) => q.eq("ownerKey", user.externalId).eq("reportId", args.reportId)).take(50)
    const favorites = views.filter((view) => view.favorite)
    if (favorites.length) {
      for (const view of favorites) await ctx.db.delete(view._id)
      return { favorite: false }
    }
    const now = Date.now()
    await ctx.db.insert("reportViews", { externalId: `report-view-${crypto.randomUUID()}`, ownerKey: user.externalId, reportId: args.reportId, name: report.title, favorite: true, config: args.config, createdAt: now, updatedAt: now })
    return { favorite: true }
  },
})
