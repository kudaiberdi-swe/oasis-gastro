import type { GenericMutationCtx } from "convex/server"

import type { DataModel, Doc } from "../../../_generated/dataModel"
import { CLOUD_API_SECRET_ENV, SIGNATURE_HEADER, signRequest, TIMESTAMP_HEADER } from "../../../lib/hmac"
import { httpFailure, type ProviderAdapter } from "./types"

type MutationCtx = GenericMutationCtx<DataModel>

// Outgoing Cloud API webhooks (W3-INT-03/04): the website learns about the status of the orders it
// sent and about a newly published menu. Events come from the transactional outbox, go through the
// integration queue (provider «cloud-api») and leave through this adapter (W3-INT-06), signed like
// incoming requests. Without CLOUD_API_WEBHOOK_URL or CLOUD_API_SECRET the job ends in dead-letter.

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

/** Sends one job: POST of the payload to the website with the x-sandyq-* signature headers. */
export const cloudApiAdapter: ProviderAdapter = {
  provider: CLOUD_API_PROVIDER,
  cardModuleId: null, // configured by env on its own page (/office/integration-cloud-api), not by a card
  configured: (env) => Boolean(env(WEBHOOK_URL_ENV) && env(CLOUD_API_SECRET_ENV)),
  async send(job, context) {
    const url = context.env(WEBHOOK_URL_ENV)
    const secret = context.env(CLOUD_API_SECRET_ENV)
    if (!url || !secret) return { status: "not-configured", error: `Вебхук Cloud API не настроен: задайте ${WEBHOOK_URL_ENV} и ${CLOUD_API_SECRET_ENV}` }
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return { status: "not-configured", error: `${WEBHOOK_URL_ENV} — некорректный адрес` }
    }
    const body = JSON.stringify(job.payload)
    const timestamp = String(Date.now())
    const signature = await signRequest(secret, { timestamp, method: "POST", pathAndQuery: `${target.pathname}${target.search}`, body })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await context.fetch(target, { method: "POST", headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature, "x-sandyq-event-id": job.idempotencyKey }, body, signal: controller.signal })
      return response.ok ? { status: "ok", result: { httpStatus: response.status } } : httpFailure("Сайт", response.status)
    } catch (error) {
      return { status: "retry", error: `Сайт недоступен: ${error instanceof Error ? error.message.slice(0, 200) : "ошибка сети"}` }
    } finally {
      clearTimeout(timer)
    }
  },
}
