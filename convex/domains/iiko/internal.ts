import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation, internalQuery } from "../../_generated/server"

// Sync bookkeeping for scripts/iiko/* (`npx convex run domains/iiko/internal:…`). Internal only:
// the office screen gets its own capability-gated queries (W1-IIKO-06).

export const importRun = internalQuery({
  args: { runExternalId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.query("iikoImportRuns").withIndex("by_external_id", (q) => q.eq("runExternalId", args.runExternalId)).unique()
  },
})

export const endpointStates = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("iikoEndpointStates").collect(),
})

export const mirrorCounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [departments, employees] = await Promise.all([
      ctx.db.query("iikoDepartments").collect(),
      ctx.db.query("iikoEmployees").collect(),
    ])
    return { departments: departments.length, employees: employees.length }
  },
})

// Untyped until overlays are redesigned per entity (W1-IIKO-04); never exposed publicly.
export const saveOverlay = internalMutation({
  args: { entityType: v.string(), sourceExternalId: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    const overlayKey = `${args.entityType}:${args.sourceExternalId}`
    const existing = await ctx.db.query("iikoEntityOverlays").withIndex("by_overlay_key", (q) => q.eq("overlayKey", overlayKey)).unique()
    const value = { overlayKey, entityType: args.entityType, sourceExternalId: args.sourceExternalId, data: args.data }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert("iikoEntityOverlays", value)
  },
})

/** Sandyq's own products (not from iiko), for the import script to match iiko dishes by name (W1-IIKO-04). */
export const productsForMatching = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("products").withIndex("by_external_id").paginate(args.paginationOpts)
    return { ...page, page: page.page.filter((product) => product.sourceSystem !== "iiko-server").map((product) => ({ externalId: product.externalId, name: product.name, linked: Boolean(product.iikoProductExternalId) })) }
  },
})

/** The iiko departments linked to Sandyq restaurants: the extract pulls prices and sales only for them. */
export const linkedDepartments = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("restaurantSourceLinks").take(200)).map((link) => link.iikoDepartmentExternalId),
})
