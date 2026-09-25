import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import { effectiveScopes, hasScope, requireOfficeCapability } from "../../lib/officeAccess"
import { integrationJobStatus } from "./validators"

/** «Очередь интеграций»: jobs of the user's organizations, newest first. */
export const listIntegrationJobs = query({
  args: { status: v.optional(integrationJobStatus), provider: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.integration-jobs.view")
    const scopes = await effectiveScopes(ctx, user, role)
    const base = args.status
      ? ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", args.status!))
      : ctx.db.query("integrationJobs").withIndex("by_creation_time")
    const network = scopes.organizationScopes.includes("*")
    const result = await base
      .order("desc")
      .filter((q) => (args.provider ? q.eq(q.field("provider"), args.provider) : true))
      .paginate(args.paginationOpts)
    return {
      ...result,
      // Jobs without an organization are system-level: network users only.
      page: result.page.filter((job) => (job.organizationExternalId ? hasScope(scopes.organizationScopes, job.organizationExternalId) : network)),
    }
  },
})

const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|authorization|credential|key)$/i

/** Secrets never leave the backend: matching keys are masked at any depth (B:platformOperations redactSecrets). */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEY.test(key) ? "••••" : redactSecrets(item, depth + 1)]))
}

export const getIntegrationJob = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.integration-jobs.view")
    const scopes = await effectiveScopes(ctx, user, role)
    const job = await ctx.db.query("integrationJobs").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!job) return null
    const visible = job.organizationExternalId ? hasScope(scopes.organizationScopes, job.organizationExternalId) : scopes.organizationScopes.includes("*")
    if (!visible) return null
    return { ...job, payload: redactSecrets(job.payload), result: redactSecrets(job.result) }
  },
})
