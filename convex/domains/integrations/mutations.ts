import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, writeOfficeAudit } from "../../lib/officeAccess"

async function requireJob(ctx: MutationCtx, externalId: string) {
  const { user, role } = await requireOfficeCapability(ctx, "office.integration-jobs.edit")
  const job = await ctx.db.query("integrationJobs").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!job) throw new ConvexError("Задание не найдено")
  const scopes = await effectiveScopes(ctx, user, role)
  const allowed = job.organizationExternalId ? hasScope(scopes.organizationScopes, job.organizationExternalId) : scopes.organizationScopes.includes("*")
  if (!allowed) throw new ConvexError("Задание не найдено")
  const email = (await getOfficeAuthEmail(ctx))!
  return { job, email }
}

/** Sends a failed or dead-letter job back to the queue with a fresh attempt budget. */
export const retryIntegrationJob = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { job, email } = await requireJob(ctx, args.externalId)
    if (!["failed", "dead-letter", "retrying", "cancelled"].includes(job.status)) throw new ConvexError("Повторить можно только неуспешное или отменённое задание")
    const now = Date.now()
    await ctx.db.patch(job._id, { status: "queued", attempts: 0, nextAttemptAt: now, error: undefined, updatedAt: now })
    await writeOfficeAudit(ctx, email, { action: "integration-job.retry", summary: `Повтор задания ${job.operation} (${job.provider})`, resourceType: "integration-job", resourceExternalId: job.externalId, capability: "office.integration-jobs.edit" })
  },
})

export const cancelIntegrationJob = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { job, email } = await requireJob(ctx, args.externalId)
    if (!["queued", "retrying"].includes(job.status)) throw new ConvexError("Отменить можно только задание в очереди")
    await ctx.db.patch(job._id, { status: "cancelled", updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "integration-job.cancel", summary: `Отменено задание ${job.operation} (${job.provider})`, resourceType: "integration-job", resourceExternalId: job.externalId, capability: "office.integration-jobs.edit" })
  },
})
