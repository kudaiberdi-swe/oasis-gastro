import { v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalAction, internalMutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { canMessageGuest } from "../../lib/consents"
import { envValue } from "../../lib/env"
import { insideAlmatyWindow, nextAlmatyWindowTime } from "../../lib/time"
import { countCampaignJob } from "../loyalty/campaigns"
import { adapterFor, EVENT_BUS, runAdapter } from "./adapters"
import { CLOUD_API_PROVIDER, cloudApiWebhookFor } from "./adapters/cloudApiWebhook"
import type { AdapterCard, AdapterJob, AdapterRecipient, AdapterResult } from "./adapters/types"

export { EVENT_BUS }

const PUBLISH_BATCH = 100
const PROCESS_BATCH = 50
export const MAX_JOB_ATTEMPTS = 5
/** A claimed job not finished within this time is taken again — no job stays in «processing». */
export const PROCESSING_LEASE_MS = 10 * 60 * 1000

/** min(1 hour, 2^attempts × 30 s). */
export function retryDelayMs(attempts: number) {
  return Math.min(60 * 60 * 1000, 2 ** attempts * 30 * 1000)
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

export type ClaimedJob = AdapterJob & { maxAttempts: number; card: AdapterCard | null; recipient: AdapterRecipient | null }

type Payload = Record<string, unknown>

function quietHoursOf(payload: Payload): { start: number; end: number } | null {
  const quiet = payload.quietHours as { start?: unknown; end?: unknown } | undefined
  return quiet && typeof quiet.start === "number" && typeof quiet.end === "number" ? { start: quiet.start, end: quiet.end } : null
}

/** The published card of the provider's section for the job's organization. */
async function publishedCard(ctx: MutationCtx, job: Doc<"integrationJobs">): Promise<AdapterCard | null> {
  const moduleId = adapterFor(job.provider)?.cardModuleId
  if (!moduleId || !job.organizationExternalId) return null
  const card = await ctx.db
    .query("integrationCards")
    .withIndex("by_module_org_status", (q) => q.eq("moduleId", moduleId).eq("organizationExternalId", job.organizationExternalId!).eq("status", "published"))
    .first()
  return card ? { number: card.number, name: card.name, provider: card.provider, mode: card.mode, endpoint: card.endpoint, secretRef: card.secretRef, maxAttempts: card.maxAttempts, settings: card.settings } : null
}

async function deadLetter(ctx: MutationCtx, job: Doc<"integrationJobs">, attempts: number, error: string, now: number) {
  await ctx.db.patch(job._id, { status: "dead-letter", attempts, error, updatedAt: now })
  await afterJobSettled(ctx, job, "dead-letter")
}

/** Domain bookkeeping when a job reaches a final state (campaign counters, W3-LOY-08). */
async function afterJobSettled(ctx: MutationCtx, job: Doc<"integrationJobs">, status: "completed" | "dead-letter") {
  await countCampaignJob(ctx, job, status)
}

/**
 * Takes due jobs for processing: queued and retrying ones whose time came, and «processing» ones whose
 * lease ran out (the action died). Jobs outside their quiet hours move to the next window without an
 * attempt; a guest job whose consent lapsed since queueing ends in dead-letter without sending.
 */
export const claimIntegrationJobs = internalMutation({
  args: {},
  handler: async (ctx): Promise<ClaimedJob[]> => {
    const now = Date.now()
    const due: Doc<"integrationJobs">[] = []
    for (const status of ["queued", "retrying", "processing"] as const) {
      if (due.length >= PROCESS_BATCH) break
      due.push(...(await ctx.db.query("integrationJobs").withIndex("by_status_attempt", (q) => q.eq("status", status).lte("nextAttemptAt", now)).take(PROCESS_BATCH - due.length)))
    }
    const claimed: ClaimedJob[] = []
    for (const job of due) {
      const payload = (job.payload ?? {}) as Payload
      const quiet = quietHoursOf(payload)
      if (quiet && !insideAlmatyWindow(now, quiet.start, quiet.end)) {
        await ctx.db.patch(job._id, { status: job.status === "processing" ? "retrying" : job.status, nextAttemptAt: nextAlmatyWindowTime(now, quiet.start, quiet.end), updatedAt: now })
        continue
      }
      const card = await publishedCard(ctx, job)
      const maxAttempts = card?.maxAttempts ?? MAX_JOB_ATTEMPTS
      if (job.status === "processing" && job.attempts >= maxAttempts) {
        await deadLetter(ctx, job, job.attempts, "Обработка прервана: адаптер не ответил вовремя", now)
        continue
      }
      let recipient: AdapterRecipient | null = null
      if (typeof payload.guestExternalId === "string") {
        const guest = await ctx.db.query("guests").withIndex("by_external_id", (q) => q.eq("externalId", payload.guestExternalId as string)).unique()
        const channel = job.provider === "sms" || job.provider === "email" ? job.provider : null
        if (!guest || !channel || !(await canMessageGuest(ctx, guest, channel, now))) {
          await deadLetter(ctx, job, job.attempts, "Нет действующего согласия гостя на рассылку — сообщение не отправлено", now)
          continue
        }
        recipient = channel === "sms" ? { phone: guest.phone } : { email: guest.email }
      }
      const attempts = job.attempts + 1
      await ctx.db.patch(job._id, { status: "processing", attempts, nextAttemptAt: now + PROCESSING_LEASE_MS, updatedAt: now })
      claimed.push({
        externalId: job.externalId,
        provider: job.provider,
        operation: job.operation,
        payload: job.payload,
        idempotencyKey: job.idempotencyKey,
        attempts,
        ...(job.organizationExternalId ? { organizationExternalId: job.organizationExternalId } : {}),
        maxAttempts,
        card,
        recipient,
      })
    }
    return claimed
  },
})

const outcome = v.object({
  status: v.union(v.literal("ok"), v.literal("retry"), v.literal("failed"), v.literal("not-configured")),
  error: v.optional(v.string()),
  result: v.optional(v.any()),
})

/**
 * Records an adapter's outcome. A job cancelled or taken again meanwhile (attempts differ) is left alone.
 * Temporary errors back off exponentially until maxAttempts; a missing provider or a final refusal goes
 * straight to dead-letter with its reason.
 */
export const finishIntegrationJob = internalMutation({
  args: { externalId: v.string(), attempts: v.number(), maxAttempts: v.number(), outcome },
  handler: async (ctx, args) => {
    const job = await ctx.db.query("integrationJobs").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!job || job.status !== "processing" || job.attempts !== args.attempts) return null
    const now = Date.now()
    if (args.outcome.status === "ok") {
      await ctx.db.patch(job._id, { status: "completed", result: args.outcome.result, error: undefined, updatedAt: now })
      await afterJobSettled(ctx, job, "completed")
      return "completed"
    }
    const error = args.outcome.error ?? "Ошибка адаптера"
    if (args.outcome.status === "retry" && job.attempts < args.maxAttempts) {
      await ctx.db.patch(job._id, { status: "retrying", error, nextAttemptAt: now + retryDelayMs(job.attempts), updatedAt: now })
      return "retrying"
    }
    await deadLetter(ctx, job, job.attempts, error, now)
    return "dead-letter"
  },
})

/** Cron: claim due jobs, run each through its adapter (fetch is allowed here), record the outcome. */
export const processIntegrationJobs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; completed: number; failed: number }> => {
    const claimed: ClaimedJob[] = await ctx.runMutation(internal.domains.integrations.internal.claimIntegrationJobs, {})
    let completed = 0
    for (const job of claimed) {
      const { maxAttempts, card, recipient, ...adapterJob } = job
      const result: AdapterResult = await runAdapter(adapterJob, { card, recipient, env: envValue, fetch: (input, init) => fetch(input, init) })
      if (result.status === "ok") completed += 1
      await ctx.runMutation(internal.domains.integrations.internal.finishIntegrationJob, {
        externalId: job.externalId,
        attempts: job.attempts,
        maxAttempts,
        outcome: result.status === "ok" ? { status: "ok", ...(result.result !== undefined ? { result: result.result } : {}) } : { status: result.status, error: result.error },
      })
    }
    return { processed: claimed.length, completed, failed: claimed.length - completed }
  },
})
