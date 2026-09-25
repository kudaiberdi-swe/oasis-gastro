import { internalMutation } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"

const PUBLISH_BATCH = 100
const PROCESS_BATCH = 50
export const MAX_JOB_ATTEMPTS = 5

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

/** min(1 hour, 2^attempts × 30 s). */
export function retryDelayMs(attempts: number) {
  return Math.min(60 * 60 * 1000, 2 ** attempts * 30 * 1000)
}

/** Pending outbox events → one integration job each (idempotencyKey outbox:<event>). */
export const publishOutboxEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const events = await ctx.db
      .query("outboxEvents")
      .withIndex("by_status_available", (q) => q.eq("status", "pending").lte("availableAt", now))
      .take(PUBLISH_BATCH)
    for (const event of events) {
      const idempotencyKey = `outbox:${event.externalId}`
      const existing = await ctx.db.query("integrationJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique()
      if (!existing) {
        await ctx.db.insert("integrationJobs", {
          externalId: `job-${crypto.randomUUID()}`,
          provider: EVENT_BUS,
          direction: "outbound",
          operation: event.eventType,
          sourceExternalId: event.aggregateExternalId,
          idempotencyKey,
          status: "queued",
          attempts: 0,
          payload: { eventExternalId: event.externalId, aggregateType: event.aggregateType, payload: event.payload },
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
          organizationExternalId: event.organizationExternalId,
        })
      }
      await ctx.db.patch(event._id, { status: "published", publishedAt: now, attempts: event.attempts + 1 })
    }
    return { published: events.length }
  },
})

/** Runs due queued and retrying jobs through their adapter. */
export const processIntegrationJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const due = [
      ...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", "queued").lte("nextAttemptAt", now)).take(PROCESS_BATCH)),
      ...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", "retrying").lte("nextAttemptAt", now)).take(PROCESS_BATCH)),
    ].slice(0, PROCESS_BATCH)
    let completed = 0
    let failed = 0
    for (const job of due) {
      const adapter = ADAPTERS[job.provider]
      const attempts = job.attempts + 1
      const outcome: AdapterResult = adapter ? adapter(job) : { ok: false, error: `Адаптер «${job.provider}» не настроен` }
      if (outcome.ok) {
        completed += 1
        await ctx.db.patch(job._id, { status: "completed", attempts, result: outcome.result, error: undefined, updatedAt: now })
      } else {
        failed += 1
        const dead = attempts >= MAX_JOB_ATTEMPTS
        await ctx.db.patch(job._id, { status: dead ? "dead-letter" : "retrying", attempts, error: outcome.error, nextAttemptAt: now + retryDelayMs(attempts), updatedAt: now })
      }
    }
    return { processed: due.length, completed, failed }
  },
})
