import { v } from "convex/values"

import { query } from "../../_generated/server"

export const importRun = query({
  args: { runExternalId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.query("iikoImportRuns").withIndex("by_external_id", (q) => q.eq("runExternalId", args.runExternalId)).unique()
  },
})

export const endpointStates = query({
  args: {},
  handler: async (ctx) => ctx.db.query("iikoEndpointStates").collect(),
})

// unprovisionedEmployees moved to domains/workforce/queries.ts:listUnprovisioned (office-gated,
// and enriched with resolved branch names) — this domain stays narrowly about read-only sync.

export const mirrorCounts = query({
  args: {},
  handler: async (ctx) => {
    const [departments, employees] = await Promise.all([
      ctx.db.query("iikoDepartments").collect(),
      ctx.db.query("iikoEmployees").collect(),
    ])
    return { departments: departments.length, employees: employees.length }
  },
})
