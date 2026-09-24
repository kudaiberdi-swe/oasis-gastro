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
