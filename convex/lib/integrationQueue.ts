import { ConvexError } from "convex/values"
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"

type QueryCtx = GenericQueryCtx<DataModel>
type MutationCtx = GenericMutationCtx<DataModel>

// The one way a domain puts work on the integration queue (W3-INT-06): idempotent by key, never an iiko
// write, and nothing for providers that do not exist in the organization's jurisdiction.

/** Providers of the Russian jurisdiction only (D4): under KZ no exchange job is ever created for them. */
export const RU_ONLY_PROVIDERS: readonly string[] = ["egais"]

/** organizations.jurisdiction is optional; Sandyq is Kazakhstan, so an unset value means KZ. */
export async function organizationJurisdiction(ctx: QueryCtx, organizationExternalId: string | undefined) {
  if (!organizationExternalId) return "KZ"
  const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", organizationExternalId)).unique()
  return organization?.jurisdiction ?? "KZ"
}

export type EnqueueJob = {
  provider: string
  operation: string
  idempotencyKey: string
  payload: unknown
  sourceExternalId?: string
  organizationExternalId?: string
  direction?: "inbound" | "outbound"
  nextAttemptAt?: number
}

/** Queues a job once per idempotency key; a repeat returns the existing job with created: false. */
export async function enqueueIntegrationJob(ctx: MutationCtx, job: EnqueueJob) {
  if (RU_ONLY_PROVIDERS.includes(job.provider) && (await organizationJurisdiction(ctx, job.organizationExternalId)) === "KZ") {
    throw new ConvexError("ЕГАИС не применяется в юрисдикции KZ — задание обмена не создаётся")
  }
  const existing = await ctx.db.query("integrationJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", job.idempotencyKey)).unique()
  if (existing) return { externalId: existing.externalId, created: false }
  const now = Date.now()
  const externalId = `job-${crypto.randomUUID()}`
  await ctx.db.insert("integrationJobs", {
    externalId,
    provider: job.provider,
    direction: job.direction ?? "outbound",
    operation: job.operation,
    ...(job.sourceExternalId ? { sourceExternalId: job.sourceExternalId } : {}),
    idempotencyKey: job.idempotencyKey,
    status: "queued",
    attempts: 0,
    payload: job.payload,
    nextAttemptAt: job.nextAttemptAt ?? now,
    createdAt: now,
    updatedAt: now,
    ...(job.organizationExternalId ? { organizationExternalId: job.organizationExternalId } : {}),
  })
  return { externalId, created: true }
}
