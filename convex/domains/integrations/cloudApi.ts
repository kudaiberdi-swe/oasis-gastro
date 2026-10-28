import { ConvexError, v } from "convex/values"

import { internalMutation, internalQuery, query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { stopListActive } from "../../lib/availability"
import { CLOUD_API_SECRET_ENV, readEnv, sha256Hex } from "../../lib/hmac"
import { loadModifierAssignments } from "../../lib/modifierPricing"
import { hasScope, requireOfficeCapability } from "../../lib/officeAccess"
import { priceOrdersInForce, resolveWith } from "../../lib/pricing"
import { writeDeliveryOrder } from "../delivery/mutations"
import { sourceServes } from "../delivery/shared"
import { WEBHOOK_URL_ENV } from "./adapters/cloudApiWebhook"

// Cloud API (W3-INT-03, decision Г-9): the menu, the stop list and incoming delivery orders for the
// restaurant website. The HTTP routes (convex/http.ts) check the HMAC signature and the nonce first and
// only then call these internal functions — there is no public function that takes a secret.
// Prices come only from resolvePrice, availability only from the branch stop list, orders only through
// the delivery domain's writeDeliveryOrder, so the API can never disagree with the POS.

/** The seeded «Сайт» source (W2-DLV-08): the default channel of every API call. */
export const CLOUD_API_SOURCE = "source-website"
const API_SOURCE_KINDS: Doc<"deliverySources">["kind"][] = ["website", "app", "aggregator"]
export const MENU_CHANNELS = ["website", "mobile-app", "aggregators", "all"] as const
export type MenuChannel = (typeof MENU_CHANNELS)[number]

const NONCE_CLEANUP_BATCH = 200
const MAX_ORDER_LINES = 50

/** A failure the route turns into an HTTP status; ConvexError texts become 400. */
type Refusal = { error: string; status: 404 | 409 }

async function channelRestaurant(ctx: QueryCtx, restaurantExternalId: string, sourceExternalId = CLOUD_API_SOURCE): Promise<{ restaurant: Doc<"restaurants">; source: Doc<"deliverySources"> } | Refusal> {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", restaurantExternalId)).unique()
  if (!restaurant?.active) return { status: 404, error: "Ресторан не найден" }
  const source = await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", sourceExternalId)).unique()
  if (!source?.active || !API_SOURCE_KINDS.includes(source.kind) || !sourceServes(source, restaurant.externalId)) return { status: 404, error: "Ресторан не обслуживается этим каналом" }
  return { restaurant, source }
}

async function imageUrl(ctx: QueryCtx, row: { imageStorageId?: Doc<"products">["imageStorageId"]; imagePath?: string }) {
  if (row.imageStorageId) return (await ctx.storage.getUrl(row.imageStorageId)) ?? null
  return row.imagePath ?? null
}

/**
 * The menu of a restaurant at a moment: dishes enabled for the POS, their categories, sizes and
 * modifier groups, every price through the one price rule. `version` is a hash of the content, so the
 * same catalog gives the same version (W3-INT-04). The branch stop list is not part of it — it
 * changes during the day and has its own route.
 */
export async function buildMenu(ctx: QueryCtx, restaurant: Doc<"restaurants">, at: number) {
  const restaurantExternalId = restaurant.externalId
  const products = await ctx.db.query("products").withIndex("by_enabled_and_name", (q) => q.eq("enabled", true)).collect()
  products.sort((a, b) => a.categorySort - b.categorySort || a.nameSort.localeCompare(b.nameSort, "ru"))
  const orders = await priceOrdersInForce(ctx, restaurantExternalId, at)
  const items = []
  for (const product of products) {
    const price = await resolveWith(ctx, orders, { product, restaurantExternalId, at })
    const options = product.sizeScaleId ? await ctx.db.query("sizeOptions").withIndex("by_scale_sort", (q) => q.eq("scaleId", product.sizeScaleId!)).take(20) : []
    const sizes = []
    for (const option of options) {
      const sized = await resolveWith(ctx, orders, { product, restaurantExternalId, at, sizeOptionId: option._id, sizeCoefficient: option.coefficient })
      sizes.push({ externalId: option.externalId, name: option.label, nameKk: option.labelKk ?? null, price: sized.price, isDefault: option.isDefault, available: option.available })
    }
    const groupRows = await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).take(20)
    const [groupDocs, assignments] = await Promise.all([Promise.all(groupRows.map((row) => ctx.db.get(row.groupId))), loadModifierAssignments(ctx, product)])
    items.push({
      externalId: product.externalId,
      name: product.name,
      nameKk: product.nameKk || null,
      description: product.description || null,
      categoryExternalId: product.category,
      price: price.price,
      imageUrl: await imageUrl(ctx, product),
      sizes,
      modifierGroups: assignments.map((group, index) => ({
        externalId: groupDocs[index]?.externalId ?? "",
        name: groupDocs[index]?.name ?? "",
        nameKk: groupDocs[index]?.nameKk ?? null,
        required: group.required,
        minQuantity: group.minQuantity,
        maxQuantity: group.maxQuantity,
        freeQuantity: group.freeQuantity,
        options: group.rules.map((rule) => ({
          externalId: rule.modifier.externalId,
          name: rule.modifier.name,
          nameKk: rule.modifier.nameKk ?? null,
          price: rule.modifier.price,
          minQuantity: rule.minQuantity,
          maxQuantity: rule.maxQuantity,
          defaultQuantity: rule.defaultQuantity,
          freeQuantity: rule.freeQuantity,
          available: rule.modifier.available,
        })),
      })),
    })
  }
  const used = new Set(items.map((item) => item.categoryExternalId))
  const categoryRows = await ctx.db.query("categories").withIndex("by_sort_order").take(200)
  const categories = categoryRows
    .filter((category) => used.has(category.externalId) && category.active !== false)
    .map((category) => ({ externalId: category.externalId, name: category.label, nameKk: null, parentExternalId: category.parentExternalId ?? null, sortOrder: category.sortOrder }))
  const content = { restaurantExternalId, currency: "KZT", categories, items }
  const version = (await sha256Hex(JSON.stringify(content))).slice(0, 16)
  return { ...content, version, generatedAt: at }
}

export type CloudMenu = Awaited<ReturnType<typeof buildMenu>>

/** The published external-menu record of the channel serving the restaurant (the newest), if any. */
async function publishedChannelRecord(ctx: QueryCtx, channel: MenuChannel, restaurantExternalId: string) {
  const candidates = []
  for (const candidate of new Set<MenuChannel>([channel, "all"])) {
    candidates.push(...(await ctx.db.query("externalMenus").withIndex("by_channel_status", (q) => q.eq("channel", candidate).eq("status", "published")).take(20)))
  }
  return candidates.filter((record) => record.restaurantExternalIds.includes("*") || record.restaurantExternalIds.includes(restaurantExternalId)).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))[0] ?? null
}

/** GET /api/v1/menu: the last published version of the channel, or the live catalog (mode «live» or nothing published yet). */
export const cloudMenu = internalQuery({
  args: { restaurantExternalId: v.string(), channel: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const channel = (args.channel ?? "website") as MenuChannel
    if (!MENU_CHANNELS.includes(channel)) return { status: 404 as const, error: "Неизвестный канал меню" }
    const found = await channelRestaurant(ctx, args.restaurantExternalId)
    if ("error" in found) return found
    const restaurant = { externalId: found.restaurant.externalId, name: found.restaurant.name }
    const record = await publishedChannelRecord(ctx, channel, found.restaurant.externalId)
    if (record?.mode === "published") {
      const published = await ctx.db
        .query("externalMenuVersions")
        .withIndex("by_record_restaurant_published", (q) => q.eq("recordExternalId", record.externalId).eq("restaurantExternalId", found.restaurant.externalId))
        .order("desc")
        .first()
      if (published) return { menu: { ...(published.snapshot as CloudMenu), restaurant, channel, source: "published" as const, menuExternalId: record.externalId, publishedAt: published.publishedAt } }
    }
    const menu = await buildMenu(ctx, found.restaurant, Date.now())
    return { menu: { ...menu, restaurant, channel, source: "live" as const, menuExternalId: record?.externalId ?? null, publishedAt: null } }
  },
})

/** GET /api/v1/stop-lists: dishes of the menu the branch has stopped right now (W1-CAT-14). */
export const cloudStopList = internalQuery({
  args: { restaurantExternalId: v.string() },
  handler: async (ctx, args) => {
    const found = await channelRestaurant(ctx, args.restaurantExternalId)
    if ("error" in found) return found
    const at = Date.now()
    const rows = await ctx.db.query("productAvailability").withIndex("by_restaurant_available", (q) => q.eq("restaurantExternalId", found.restaurant.externalId).eq("available", false)).collect()
    const items = []
    for (const row of rows) {
      if (!stopListActive(row, at)) continue
      const product = await ctx.db.get(row.productId)
      if (!product?.enabled) continue // not in the menu at all
      items.push({ productExternalId: product.externalId, until: row.until ?? null })
    }
    return { stopList: { restaurantExternalId: found.restaurant.externalId, generatedAt: at, items } }
  },
})

const orderLine = v.object({ productExternalId: v.string(), quantity: v.number(), sizeExternalId: v.optional(v.string()), modifierSelections: v.optional(v.array(v.object({ modifierExternalId: v.string(), quantity: v.number() }))) })

/**
 * POST /api/v1/delivery/orders → the delivery domain (W2-DLV-02) with the «Сайт» source.
 * Idempotent by the channel's orderId: a repeat returns the order already created, never a second one.
 */
export const ingestDeliveryOrder = internalMutation({
  args: {
    orderId: v.string(),
    sourceExternalId: v.optional(v.string()),
    restaurantExternalId: v.string(),
    customerName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    expectedAt: v.number(),
    comment: v.optional(v.string()),
    lines: v.array(orderLine),
  },
  handler: async (ctx, args) => {
    const orderId = args.orderId.trim()
    if (!/^[\w.:-]{1,64}$/.test(orderId)) throw new ConvexError("orderId: 1–64 символа — буквы, цифры, «.», «:», «-», «_»")
    if (args.lines.length > MAX_ORDER_LINES) throw new ConvexError(`Не больше ${MAX_ORDER_LINES} позиций в заказе`)
    const found = await channelRestaurant(ctx, args.restaurantExternalId, args.sourceExternalId)
    if ("error" in found) return found
    const existing = await ctx.db.query("deliveryOrders").withIndex("by_source_order", (q) => q.eq("sourceExternalId", found.source.externalId).eq("sourceOrderId", orderId)).unique()
    if (existing) {
      if (existing.restaurantExternalId !== found.restaurant.externalId) return { status: 409 as const, error: "orderId уже использован для другого ресторана" }
      return { order: { orderId, externalId: existing.externalId, number: existing.number, status: existing.status, total: existing.total, duplicate: true } }
    }
    const saved = await writeDeliveryOrder(
      ctx,
      {
        restaurantExternalId: found.restaurant.externalId,
        customerName: args.customerName,
        phone: args.phone,
        email: args.email,
        address: args.address,
        latitude: args.latitude,
        longitude: args.longitude,
        sourceExternalId: found.source.externalId,
        expectedAt: args.expectedAt,
        comment: args.comment ?? "",
        lines: args.lines,
      },
      { actorKey: `api:${found.source.externalId}`, sourceOrderId: orderId },
    )
    return { order: { orderId, externalId: saved.externalId, number: saved.number, status: saved.status, total: saved.total, duplicate: false } }
  },
})

/** POST /api/v1/webhooks/:provider → an inbound job of the integration queue, once per eventId. */
export const ingestWebhook = internalMutation({
  args: { provider: v.string(), eventId: v.string(), eventType: v.optional(v.string()), payload: v.any() },
  handler: async (ctx, args) => {
    if (!/^[a-z0-9-]{2,40}$/.test(args.provider)) throw new ConvexError("Неизвестный провайдер вебхука")
    const eventId = args.eventId.trim()
    if (!/^[\w.:-]{1,100}$/.test(eventId)) throw new ConvexError("eventId: 1–100 символов — буквы, цифры, «.», «:», «-», «_»")
    const idempotencyKey = `webhook:${args.provider}:${eventId}`
    const existing = await ctx.db.query("integrationJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey)).unique()
    if (existing) return { jobExternalId: existing.externalId, duplicate: true }
    const now = Date.now()
    const externalId = `job-${crypto.randomUUID()}`
    await ctx.db.insert("integrationJobs", {
      externalId,
      provider: args.provider,
      direction: "inbound",
      operation: args.eventType?.slice(0, 80) || "webhook",
      sourceExternalId: eventId,
      idempotencyKey,
      status: "queued",
      attempts: 0,
      payload: args.payload,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    return { jobExternalId: externalId, duplicate: false }
  },
})

/** One accepted signature = one row; a second request with it is a replay (409). */
export const claimNonce = internalMutation({
  args: { key: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("apiNonces").withIndex("by_key", (q) => q.eq("key", args.key)).unique()
    if (existing) return false
    await ctx.db.insert("apiNonces", { key: args.key, expiresAt: args.expiresAt })
    return true
  },
})

/** Cron: nonces whose signature can no longer pass the time window. */
export const cleanupApiNonces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("apiNonces").withIndex("by_expires", (q) => q.lt("expiresAt", Date.now())).take(NONCE_CLEANUP_BATCH)
    for (const row of expired) await ctx.db.delete(row._id)
    return { deleted: expired.length }
  },
})

const RECENT_ORDERS = 10

/** The Cloud API card: whether the secret and the webhook are set (never their values) and the last API orders. */
export const cloudApiStatus = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.integration-cloud-api.view")
    const source = await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", CLOUD_API_SOURCE)).unique()
    const recent = source ? await ctx.db.query("deliveryOrders").withIndex("by_source_created", (q) => q.eq("sourceExternalId", source.externalId)).order("desc").take(50) : []
    return {
      secretEnv: CLOUD_API_SECRET_ENV,
      secretConfigured: Boolean(readEnv(CLOUD_API_SECRET_ENV)),
      webhookEnv: WEBHOOK_URL_ENV,
      webhookConfigured: Boolean(readEnv(WEBHOOK_URL_ENV)),
      source: source ? { externalId: source.externalId, name: source.name, active: source.active, restaurantExternalIds: source.restaurantExternalIds } : null,
      recentOrders: recent
        .filter((order) => order.sourceOrderId && hasScope(user.restaurantScopes, order.restaurantExternalId))
        .slice(0, RECENT_ORDERS)
        .map((order) => ({ externalId: order.externalId, number: order.number, sourceOrderId: order.sourceOrderId!, restaurantExternalId: order.restaurantExternalId, status: order.status, total: order.total, createdAt: order.createdAt })),
    }
  },
})
