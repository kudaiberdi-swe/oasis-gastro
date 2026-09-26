import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { httpAction, internalMutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { envValue } from "../../lib/env"
import { MAX_BODY_BYTES, verifySignedRequest } from "../../lib/hmac"
import { GENERIC_PROVIDER, TELEPHONY_MAPPERS, type CallStatus } from "./providers"

// Incoming calls (W3-DLV-09): POST /api/v1/webhooks/telephony?provider=<id> → signature check (the Cloud
// API scheme of lib/hmac.ts with its own secret, env TELEPHONY_WEBHOOK_SECRET) → the provider's mapper →
// ingestCall. A repeated event updates the same row (externalId provider:callId), so a retry of the
// webhook never creates a duplicate — no nonce is needed.

export const TELEPHONY_SECRET_ENV = "TELEPHONY_WEBHOOK_SECRET"
const OPEN_DELIVERY: Doc<"deliveryOrders">["status"][] = ["unprocessed", "unconfirmed", "waiting", "ready-to-cook", "cooking", "cooked", "awaiting-dispatch", "on-way"]

/** ringing → answered → a final state; a late «ringing» never takes a finished call back. */
const RANK: Record<CallStatus, number> = { ringing: 0, answered: 1, missed: 2, completed: 2, failed: 2 }

/** The ways one Kazakhstan number may be stored: 7701…, 8701…, 701…. */
export function phoneVariants(phone: string) {
  const digits = phone.replace(/\D/g, "")
  const local = digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) ? digits.slice(1) : digits.length === 10 ? digits : null
  return [...new Set([digits, ...(local ? [local, `7${local}`, `8${local}`] : [])])]
}

async function findGuest(ctx: MutationCtx, phone: string) {
  for (const candidate of phoneVariants(phone)) {
    const guest = await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", candidate)).first()
    if (guest) return guest
  }
  return null
}

/** The latest open delivery order with this phone (of the call's restaurant when it is known). */
async function findOpenDelivery(ctx: MutationCtx, phone: string, restaurantExternalId: string | undefined) {
  const variants = phoneVariants(phone)
  for (const candidate of variants) {
    const rows = await ctx.db
      .query("deliveryOrders")
      .withSearchIndex("search_delivery_orders", (q) => (restaurantExternalId ? q.search("searchText", candidate).eq("restaurantExternalId", restaurantExternalId) : q.search("searchText", candidate)))
      .take(20)
    const open = rows.filter((row) => variants.includes(row.phone) && OPEN_DELIVERY.includes(row.status)).sort((a, b) => b.createdAt - a.createdAt)
    if (open.length) return open[0]
  }
  return null
}

export const ingestCall = internalMutation({
  args: {
    provider: v.string(),
    callId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    status: v.union(v.literal("ringing"), v.literal("answered"), v.literal("missed"), v.literal("completed"), v.literal("failed")),
    phone: v.string(),
    startedAt: v.number(),
    answeredAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    restaurantExternalId: v.optional(v.string()),
    operatorKey: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const externalId = `${args.provider}:${args.callId}`
    const now = Date.now()
    const restaurant = args.restaurantExternalId ? await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId!)).unique() : null
    const restaurantExternalId = restaurant?.externalId
    const existing = await ctx.db.query("telephonyCalls").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
    const times = {
      ...(args.answeredAt !== undefined ? { answeredAt: args.answeredAt } : {}),
      ...(args.endedAt !== undefined ? { endedAt: args.endedAt } : {}),
      ...(args.durationSeconds !== undefined ? { durationSeconds: args.durationSeconds } : {}),
      ...(args.operatorKey ? { operatorKey: args.operatorKey } : {}),
      ...(args.recordingUrl ? { recordingUrl: args.recordingUrl } : {}),
    }
    if (existing) {
      const status = RANK[args.status] >= RANK[existing.status] ? args.status : existing.status
      await ctx.db.patch(existing._id, { ...times, status, ...(restaurantExternalId && !existing.restaurantExternalId ? { restaurantExternalId } : {}), updatedAt: now })
      return { externalId, duplicate: true }
    }
    const guest = await findGuest(ctx, args.phone)
    const delivery = await findOpenDelivery(ctx, args.phone, restaurantExternalId)
    await ctx.db.insert("telephonyCalls", {
      externalId,
      provider: args.provider,
      direction: args.direction,
      status: args.status,
      phone: args.phone,
      ...(restaurantExternalId ?? delivery?.restaurantExternalId ? { restaurantExternalId: restaurantExternalId ?? delivery?.restaurantExternalId } : {}),
      ...(guest ? { guestId: guest._id } : {}),
      ...(delivery ? { deliveryExternalId: delivery.externalId } : {}),
      startedAt: args.startedAt,
      ...times,
      updatedAt: now,
    })
    return { externalId, duplicate: false }
  },
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** POST /api/v1/webhooks/telephony: without TELEPHONY_WEBHOOK_SECRET every request is 401. */
export const telephonyWebhook = httpAction(async (ctx, request) => {
  const provider = new URL(request.url).searchParams.get("provider") ?? GENERIC_PROVIDER
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json(413, { error: "Слишком большой запрос" })
  const secret = envValue(TELEPHONY_SECRET_ENV)
  if (!secret) return json(401, { error: "Вебхук телефонии не настроен" })
  const check = await verifySignedRequest(request, body, { secret })
  if (!check.ok) return json(401, { error: check.error })
  const mapper = TELEPHONY_MAPPERS[provider]
  if (!mapper) return json(400, { error: `Неизвестный провайдер телефонии «${provider.slice(0, 40)}»` })
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return json(400, { error: "Тело запроса — не JSON" })
  }
  const event = mapper(parsed)
  if (!event) return json(400, { error: "Не хватает полей звонка: callId, direction, status, phone, startedAt" })
  try {
    const result = await ctx.runMutation(internal.domains.telephony.internal.ingestCall, { provider, ...event })
    return json(200, result)
  } catch (error) {
    return json(400, { error: error instanceof ConvexError ? String(error.data) : "Звонок не принят" })
  }
})
