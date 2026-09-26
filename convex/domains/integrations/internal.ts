import { v } from "convex/values"
import type { FunctionReference, GenericMutationCtx } from "convex/server"

import { internal } from "../../_generated/api"
import { internalMutation } from "../../_generated/server"
import type { DataModel, Doc } from "../../_generated/dataModel"
import { CLOUD_API_PROVIDER, cloudApiWebhookFor } from "./adapters/cloudApiWebhook"

type MutationCtx = GenericMutationCtx<DataModel>

const PUBLISH_BATCH = 100
const PROCESS_BATCH = 50
export const MAX_JOB_ATTEMPTS = 5
/** How long a job handed to a network adapter may stay in «processing» before it counts as a failed attempt. */
const PROCESSING_LEASE_MS = 5 * 60 * 1000

/** The in-process event bus every outbox event goes to first; external providers get their own adapters. */
export const EVENT_BUS = "convex-event-bus"

type AdapterResult = { ok: true; result?: unknown } | { ok: false; error: string }

/**
 * Integration adapters by provider. Anything touching iiko stays read-only and never runs from here.
 * A provider without an adapter retries with backoff and ends in dead-letter.
 */
const ADAPTERS: Record<string, (job: Doc<"integrationJobs">) => AdapterResult> = {
  [EVENT_BUS]: () => ({ ok: true, result: { delivered: true } }),
  // W2-ACL-08: no e-mail provider yet (blocker Б-B6) — the letter is never reported as sent.
  email: () => ({ ok: false, error: "Провайдер e-mail не настроен (Б-B6)" }),
}

/** Adapters that call the network: they run in an action and report back through finishAsyncJob. */
const ASYNC_ADAPTERS: Record<string, FunctionReference<"action", "internal", { externalId: string }>> = {
  [CLOUD_API_PROVIDER]: internal.domains.integrations.adapters.cloudApiWebhook.deliverWebhook,
}

/** min(1 hour, 2^attempts × 30 s). */
export function retryDelayMs(attempts: number) {
  return Math.min(60 * 60 * 1000, 2 ** attempts * 30 * 1000)
}

const adapterOutcome = v.union(v.object({ ok: v.literal(true), result: v.optional(v.any()) }), v.object({ ok: v.literal(false), error: v.string() }))

async function applyOutcome(ctx: MutationCtx, job: Doc<"integrationJobs">, attempts: number, outcome: AdapterResult, now: number) {
  if (outcome.ok) {
    await ctx.db.patch(job._id, { status: "completed", attempts, result: outcome.result, error: undefined, updatedAt: now })
    return true
  }
  const dead = attempts >= MAX_JOB_ATTEMPTS
  await ctx.db.patch(job._id, { status: dead ? "dead-letter" : "retrying", attempts, error: outcome.error, nextAttemptAt: now + retryDelayMs(attempts), updatedAt: now })
  return false
}

async function insertOutboundJob(ctx: MutationCtx, event: Doc<"outboxEvents">, job: { provider: string; idempotencyKey: string; operation: string; payload: unknown }, now: number) {
  const existing = await ctx.db.query("integrationJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", job.idempotencyKey)).unique()
  if (existing) return
  await ctx.db.insert("integrationJobs", {
    externalId: `job-${crypto.randomUUID()}`,
    provider: job.provider,
    direction: "outbound",
    operation: job.operation,
    sourceExternalId: event.aggregateExternalId,
    idempotencyKey: job.idempotencyKey,
    status: "queued",
    attempts: 0,
    payload: job.payload,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    organizationExternalId: event.organizationExternalId,
  })
}

/** Pending outbox events → one integration job each (idempotencyKey outbox:<event>), plus the website's webhook when it is subscribed. */
export const publishOutboxEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const events = await ctx.db
      .query("outboxEvents")
      .withIndex("by_status_available", (q) => q.eq("status", "pending").lte("availableAt", now))
      .take(PUBLISH_BATCH)
    for (const event of events) {
      await insertOutboundJob(ctx, event, { provider: EVENT_BUS, idempotencyKey: `outbox:${event.externalId}`, operation: event.eventType, payload: { eventExternalId: event.externalId, aggregateType: event.aggregateType, payload: event.payload } }, now)
      const webhook = await cloudApiWebhookFor(ctx, event)
      if (webhook) await insertOutboundJob(ctx, event, { provider: CLOUD_API_PROVIDER, idempotencyKey: `webhook:${event.externalId}`, ...webhook }, now)
      await ctx.db.patch(event._id, { status: "published", publishedAt: now, attempts: event.attempts + 1 })
    }
    return { published: events.length }
  },
})

/** Runs due queued and retrying jobs through their adapter; a lapsed «processing» lease counts as a failed attempt. */
export const processIntegrationJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = [
      ...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", "queued").lte("nextAttemptAt", now)).take(PROCESS_BATCH)),
      ...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", "retrying").lte("nextAttemptAt", now)).take(PROCESS_BATCH)),
      ...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", "processing").lte("nextAttemptAt", now)).take(PROCESS_BATCH)),
    ].slice(0, PROCESS_BATCH)
    let completed = 0
    let failed = 0
    let dispatched = 0
    for (const job of due) {
      if (job.status === "processing") {
        failed += 1
        await applyOutcome(ctx, job, job.attempts, { ok: false, error: "Адаптер не ответил вовремя — повтор" }, now)
        continue
      }
      const attempts = job.attempts + 1
      const send = ASYNC_ADAPTERS[job.provider]
      if (send) {
        dispatched += 1
        await ctx.db.patch(job._id, { status: "processing", attempts, nextAttemptAt: now + PROCESSING_LEASE_MS, updatedAt: now })
        await ctx.scheduler.runAfter(0, send, { externalId: job.externalId })
        continue
      }
      const adapter = ADAPTERS[job.provider]
      const outcome: AdapterResult = adapter ? adapter(job) : { ok: false, error: `Адаптер «${job.provider}» не настроен` }
      if (await applyOutcome(ctx, job, attempts, outcome, now)) completed += 1
      else failed += 1
    }
    return { processed: due.length, completed, failed, dispatched }
  },
})

/** The result of a network adapter; ignored when the job has left «processing» meanwhile (lease lapsed, cancelled). */
export const finishAsyncJob = internalMutation({
  args: { externalId: v.string(), outcome: adapterOutcome },
  handler: async (ctx, args) => {
    const job = await ctx.db.query("integrationJobs").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!job || job.status !== "processing") return null
    await applyOutcome(ctx, job, job.attempts, args.outcome, Date.now())
    return null
  },
})
