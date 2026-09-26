import { httpRouter } from "convex/server"
import { ConvexError } from "convex/values"

import { internal } from "./_generated/api"
import { httpAction, type ActionCtx } from "./_generated/server"
import { auth } from "./auth"
import { telephonyWebhook } from "./domains/telephony/internal"
import { CLOUD_API_SECRET_ENV, MAX_BODY_BYTES, readEnv, verifySignedRequest } from "./lib/hmac"

const http = httpRouter()

auth.addHttpRoutes(http)

// --- Cloud API (W3-INT-03/04, decision Г-9; contract in docs/cloud-api.md) ---------------------------
// Every route: body limit → HMAC signature and ±5 min window → one-time nonce → internal function.
// Errors are JSON {error} with the ConvexError text; never a stack trace.

type Refusal = { status: number; error: string }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })

function errorResponse(error: unknown) {
  if (error instanceof ConvexError) return json(400, { error: typeof error.data === "string" ? error.data : "Некорректный запрос" })
  return json(500, { error: "Внутренняя ошибка" })
}

/** Reads the body (≤256 KB) and checks the signature and the nonce; a Response means «refused». */
async function authenticate(ctx: ActionCtx, request: Request): Promise<{ body: string } | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_BODY_BYTES) return json(413, { error: "Тело запроса больше 256 КБ" })
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json(413, { error: "Тело запроса больше 256 КБ" })
  const verified = await verifySignedRequest(request, body, { secret: readEnv(CLOUD_API_SECRET_ENV) })
  if (!verified.ok) return json(verified.status, { error: verified.error })
  const fresh = await ctx.runMutation(internal.domains.integrations.cloudApi.claimNonce, { key: verified.nonceKey, expiresAt: verified.expiresAt })
  if (!fresh) return json(409, { error: "Повтор запроса: подпись уже использована" })
  return { body }
}

function refused(result: object): result is Refusal {
  return "error" in result && "status" in result
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body)
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const cloudRoute = (handler: (ctx: ActionCtx, request: Request, body: string) => Promise<Response>) =>
  httpAction(async (ctx, request) => {
    try {
      const checked = await authenticate(ctx, request)
      if (checked instanceof Response) return checked
      return await handler(ctx, request, checked.body)
    } catch (error) {
      return errorResponse(error)
    }
  })

http.route({
  path: "/api/v1/menu",
  method: "GET",
  handler: cloudRoute(async (ctx, request) => {
    const url = new URL(request.url)
    const restaurant = url.searchParams.get("restaurant")?.trim()
    if (!restaurant) return json(400, { error: "Укажите restaurant" })
    const result = await ctx.runQuery(internal.domains.integrations.cloudApi.cloudMenu, { restaurantExternalId: restaurant, channel: url.searchParams.get("channel")?.trim() || undefined })
    if (refused(result)) return json(result.status, { error: result.error })
    return json(200, result.menu)
  }),
})

http.route({
  path: "/api/v1/stop-lists",
  method: "GET",
  handler: cloudRoute(async (ctx, request) => {
    const restaurant = new URL(request.url).searchParams.get("restaurant")?.trim()
    if (!restaurant) return json(400, { error: "Укажите restaurant" })
    const result = await ctx.runQuery(internal.domains.integrations.cloudApi.cloudStopList, { restaurantExternalId: restaurant })
    if (refused(result)) return json(result.status, { error: result.error })
    return json(200, result.stopList)
  }),
})

const isString = (value: unknown): value is string => typeof value === "string"
const isOptional = <T>(value: unknown, check: (value: unknown) => value is T) => value === undefined || value === null || check(value)
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** The order body as ingestDeliveryOrder takes it, or the name of the first bad field. */
function parseOrder(value: Record<string, unknown>) {
  for (const field of ["orderId", "restaurantExternalId", "customerName", "phone", "address"]) if (!isString(value[field])) return { field }
  for (const field of ["sourceExternalId", "email", "comment"]) if (!isOptional(value[field], isString)) return { field }
  for (const field of ["latitude", "longitude"]) if (!isOptional(value[field], isNumber)) return { field }
  if (!isNumber(value.expectedAt)) return { field: "expectedAt" }
  if (!Array.isArray(value.lines)) return { field: "lines" }
  const lines = []
  for (const [index, raw] of value.lines.entries()) {
    const line = raw as Record<string, unknown> | null
    if (!line || typeof line !== "object" || !isString(line.productExternalId) || !isNumber(line.quantity) || !isOptional(line.sizeExternalId, isString)) return { field: `lines[${index}]` }
    const selections = line.modifierSelections
    if (selections !== undefined && selections !== null && (!Array.isArray(selections) || selections.some((row) => !row || !isString((row as Record<string, unknown>).modifierExternalId) || !isNumber((row as Record<string, unknown>).quantity)))) return { field: `lines[${index}].modifierSelections` }
    lines.push({
      productExternalId: line.productExternalId,
      quantity: line.quantity,
      ...(isString(line.sizeExternalId) ? { sizeExternalId: line.sizeExternalId } : {}),
      ...(Array.isArray(selections) ? { modifierSelections: selections.map((row) => ({ modifierExternalId: String((row as Record<string, unknown>).modifierExternalId), quantity: Number((row as Record<string, unknown>).quantity) })) } : {}),
    })
  }
  const optional = (field: string) => (isString(value[field]) ? { [field]: value[field] as string } : {})
  return {
    order: {
      orderId: value.orderId as string,
      restaurantExternalId: value.restaurantExternalId as string,
      customerName: value.customerName as string,
      phone: value.phone as string,
      address: value.address as string,
      expectedAt: value.expectedAt as number,
      ...optional("sourceExternalId"),
      ...optional("email"),
      ...optional("comment"),
      ...(isNumber(value.latitude) ? { latitude: value.latitude } : {}),
      ...(isNumber(value.longitude) ? { longitude: value.longitude } : {}),
      lines,
    },
  }
}

http.route({
  path: "/api/v1/delivery/orders",
  method: "POST",
  handler: cloudRoute(async (ctx, _request, body) => {
    const value = parseJson(body)
    if (!value) return json(400, { error: "Тело запроса — JSON-объект" })
    const parsed = parseOrder(value)
    if ("field" in parsed) return json(400, { error: `Некорректное поле ${parsed.field}` })
    const result = await ctx.runMutation(internal.domains.integrations.cloudApi.ingestDeliveryOrder, parsed.order)
    if (refused(result)) return json(result.status, { error: result.error })
    return json(result.order.duplicate ? 200 : 201, result.order)
  }),
})

// Incoming calls of the telephony provider, signed with TELEPHONY_WEBHOOK_SECRET (W3-DLV-09). An exact
// path, so it wins over the Cloud API prefix route below.
http.route({ path: "/api/v1/webhooks/telephony", method: "POST", handler: telephonyWebhook })

http.route({
  pathPrefix: "/api/v1/webhooks/",
  method: "POST",
  handler: cloudRoute(async (ctx, request, body) => {
    const provider = new URL(request.url).pathname.slice("/api/v1/webhooks/".length)
    const value = parseJson(body)
    if (!value) return json(400, { error: "Тело запроса — JSON-объект" })
    const eventId = isString(value.eventId) ? value.eventId : request.headers.get("x-idempotency-key")
    if (!eventId) return json(400, { error: "Укажите eventId" })
    const result = await ctx.runMutation(internal.domains.integrations.cloudApi.ingestWebhook, { provider, eventId, eventType: isString(value.type) ? value.type : undefined, payload: value })
    return json(result.duplicate ? 200 : 202, { jobExternalId: result.jobExternalId, duplicate: result.duplicate })
  }),
})

export default http
