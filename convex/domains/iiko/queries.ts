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

/** Candidates for provisionPosAccess — active iiko employees not yet linked to a POS login. */
export const unprovisionedEmployees = query({
  args: {},
  handler: async (ctx) => {
    const [iikoEmployees, posEmployees] = await Promise.all([
      ctx.db.query("iikoEmployees").withIndex("by_active_and_display_name", (q) => q.eq("active", true)).take(500),
      ctx.db.query("employees").collect(),
    ])
    const linked = new Set(posEmployees.map((e) => e.iikoEmployeeExternalId).filter(Boolean))
    return iikoEmployees.filter((e) => !linked.has(e.externalId))
  },
})

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
