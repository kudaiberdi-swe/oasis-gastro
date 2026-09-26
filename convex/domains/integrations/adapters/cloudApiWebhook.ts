import { v } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import { internal } from "../../../_generated/api"
import { internalAction, internalQuery } from "../../../_generated/server"
import type { DataModel, Doc } from "../../../_generated/dataModel"
import { CLOUD_API_SECRET_ENV, readEnv, SIGNATURE_HEADER, signRequest, TIMESTAMP_HEADER } from "../../../lib/hmac"

type MutationCtx = GenericMutationCtx<DataModel>

// Outgoing Cloud API webhooks (W3-INT-03/04): the website learns about the status of the orders it
// sent and about a newly published menu. Events come from the transactional outbox, go through the
// integration queue (provider «cloud-api») and leave in an action, signed like incoming requests.
// Without CLOUD_API_WEBHOOK_URL or CLOUD_API_SECRET the job fails honestly and ends in dead-letter.

export const CLOUD_API_PROVIDER = "cloud-api"
export const WEBHOOK_URL_ENV = "CLOUD_API_WEBHOOK_URL"
const TIMEOUT_MS = 10_000

type OutboxEvent = Doc<"outboxEvents">

/** The webhook an outbox event produces, or null when the website has not subscribed to it. */
export async function cloudApiWebhookFor(ctx: MutationCtx, event: OutboxEvent) {
  if (event.aggregateType === "delivery-order" && event.eventType.startsWith("delivery-order.status.")) {
    const delivery = await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", event.aggregateExternalId)).unique()
    // Only orders that came through the API (they carry the channel's own id).
    if (!delivery?.sourceOrderId) return null
    const payload = event.payload as { from?: string; to?: string }
    return {
      operation: "delivery-order.status",
      payload: { event: "delivery-order.status", eventId: event.externalId, orderId: delivery.sourceOrderId, externalId: delivery.externalId, number: delivery.number, status: payload.to ?? delivery.status, previousStatus: payload.from ?? null, occurredAt: event.createdAt },
    }
  }
  if (event.eventType === "external-menu.published") {
    const payload = event.payload as { menuExternalId: string; channel: string; version: string; restaurantExternalId: string; publishedAt: number }
    if (payload.channel !== "website" && payload.channel !== "all") return null
    return { operation: "external-menu.published", payload: { event: "external-menu.published", eventId: event.externalId, ...payload } }
  }
  return null
}

export const webhookJob = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, args) => ctx.db.query("integrationJobs").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique(),
})

/** Sends one job: POST of the payload to the website with the x-sandyq-* signature headers. */
export const deliverWebhook = internalAction({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.domains.integrations.adapters.cloudApiWebhook.webhookJob, { externalId: args.externalId })
    if (!job || job.status !== "processing") return null
    const url = readEnv(WEBHOOK_URL_ENV)
    const secret = readEnv(CLOUD_API_SECRET_ENV)
    let outcome: { ok: true; result?: unknown } | { ok: false; error: string }
    if (!url || !secret) {
      outcome = { ok: false, error: `Вебхук Cloud API не настроен: задайте ${WEBHOOK_URL_ENV} и ${CLOUD_API_SECRET_ENV}` }
    } else {
      const body = JSON.stringify(job.payload)
      const timestamp = String(Date.now())
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const target = new URL(url)
        const signature = await signRequest(secret, { timestamp, method: "POST", pathAndQuery: `${target.pathname}${target.search}`, body })
        const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature, "x-sandyq-event-id": job.idempotencyKey }, body, signal: controller.signal })
        outcome = response.ok ? { ok: true, result: { httpStatus: response.status } } : { ok: false, error: `Сайт ответил ${response.status}` }
      } catch (error) {
        outcome = { ok: false, error: `Сайт недоступен: ${error instanceof Error ? error.message : "ошибка сети"}` }
      } finally {
        clearTimeout(timer)
      }
    }
    await ctx.runMutation(internal.domains.integrations.internal.finishAsyncJob, { externalId: job.externalId, outcome })
    return null
  },
})
