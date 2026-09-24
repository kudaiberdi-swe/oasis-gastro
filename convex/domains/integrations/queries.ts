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
