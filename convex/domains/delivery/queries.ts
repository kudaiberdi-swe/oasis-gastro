import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import { query, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { OPEN_DELIVERY_STATUSES } from "../../lib/deliveryCore"
import { hasScope, requireOfficeCapability, requireRestaurantScope, scopedRestaurants } from "../../lib/officeAccess"
import { isAvailable } from "../../lib/availability"
import { maskPhone } from "../../lib/pii"
import { resolvePrice } from "../../lib/pricing"
import { productConfigurationFor } from "../catalog/pos"
import { activeSettingsAt } from "../../lib/retailSettings"
import { sourceServes, TAB_STATUSES, todayStart } from "./shared"

// Delivery registries and cards (W2-DLV-02/04…08). Every list goes through an index and the user's scope.

const channel = v.optional(v.union(v.literal("delivery"), v.literal("call-center")))
/** The call center works on the same orders under its own section rights. */
const orderCapability = (from: "delivery" | "call-center" | undefined, action: string) => (from === "call-center" ? `office.call-center.${action}` : `office.delivery-orders.${action}`)

async function canSeePii(ctx: QueryCtx) {
  try {
    await requireOfficeCapability(ctx, "office.guests.pii")
    return true
  } catch {
    return false
  }
}

async function row(ctx: QueryCtx, order: Doc<"deliveryOrders">, pii: boolean) {
  const courier = order.courierExternalId ? await ctx.db.query("couriers").withIndex("by_external_id", (q) => q.eq("externalId", order.courierExternalId!)).unique() : null
  const source = await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", order.sourceExternalId)).unique()
  return {
    externalId: order.externalId,
    number: order.number,
    status: order.status,
    restaurantExternalId: order.restaurantExternalId,
    customerName: order.customerName,
    phone: pii ? order.phone : maskPhone(order.phone),
    address: order.address,
    expectedAt: order.expectedAt,
    predictedCookingCompleteAt: order.predictedCookingCompleteAt ?? null,
    courierName: courier?.name ?? null,
    courierExternalId: order.courierExternalId ?? null,
    sourceExternalId: order.sourceExternalId,
    settlementMode: source?.settlementMode ?? "on-delivered",
    total: order.total,
    paymentStatus: order.paymentStatus,
    late: OPEN_DELIVERY_STATUSES.includes(order.status) && order.expectedAt < Date.now(),
    version: order.version,
  }
}

export const overview = query({
  args: { restaurantExternalId: v.optional(v.string()), tab: v.string(), search: v.optional(v.string()), channel, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, args.channel === "call-center" ? "office.call-center.view" : "office.delivery-orders.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const statuses = TAB_STATUSES[args.tab]
    if (statuses === undefined) throw new ConvexError("Неизвестная вкладка")
    const needle = args.search?.trim().toLocaleLowerCase("ru")
    const inTab = (order: Doc<"deliveryOrders">) => !statuses || statuses.includes(order.status)
    const page = needle
      ? await ctx.db.query("deliveryOrders").withSearchIndex("search_delivery_orders", (q) => (args.restaurantExternalId ? q.search("searchText", needle).eq("restaurantExternalId", args.restaurantExternalId) : q.search("searchText", needle))).paginate(args.paginationOpts)
      : args.restaurantExternalId
        ? await ctx.db.query("deliveryOrders").withIndex("by_restaurant_created", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).order("desc").filter((q) => (statuses ? q.or(...statuses.map((status) => q.eq(q.field("status"), status))) : true)).paginate(args.paginationOpts)
        : await ctx.db.query("deliveryOrders").order("desc").filter((q) => (statuses ? q.or(...statuses.map((status) => q.eq(q.field("status"), status))) : true)).paginate(args.paginationOpts)
    const pii = await canSeePii(ctx)
    const visible = page.page.filter((order) => inTab(order) && hasScope(user.restaurantScopes, order.restaurantExternalId))
    // The operator's queue: unprocessed first, then by the promised time.
    if (args.channel === "call-center") visible.sort((a, b) => Number(b.status === "unprocessed") - Number(a.status === "unprocessed") || a.expectedAt - b.expectedAt)
    return { ...page, page: await Promise.all(visible.map((order) => row(ctx, order, pii))) }
  },
})

/** KPI cards over the registry: active, late, on the way, delivered today — per status index, bounded. */
export const kpis = query({
  args: { restaurantExternalId: v.optional(v.string()), channel },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, args.channel === "call-center" ? "office.call-center.view" : "office.delivery-orders.view")
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const now = Date.now()
    const start = todayStart(now)
    const visible = (order: Doc<"deliveryOrders">) => (args.restaurantExternalId ? order.restaurantExternalId === args.restaurantExternalId : hasScope(user.restaurantScopes, order.restaurantExternalId))
    const result = { active: 0, late: 0, onWay: 0, deliveredToday: 0 }
    for (const status of OPEN_DELIVERY_STATUSES) {
      const page = args.restaurantExternalId
        ? await ctx.db.query("deliveryOrders").withIndex("by_restaurant_status_time", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!).eq("status", status)).take(200)
        : await ctx.db.query("deliveryOrders").withIndex("by_status_time", (q) => q.eq("status", status)).take(200)
      const rows = page.filter(visible)
      result.active += rows.length
      result.late += rows.filter((order) => order.expectedAt < now).length
      if (status === "on-way") result.onWay = rows.length
    }
    for (const status of ["delivered", "closed"] as const) {
      const rows = await ctx.db.query("deliveryOrders").withIndex("by_status_time", (q) => q.eq("status", status).gte("expectedAt", start - 12 * 3_600_000)).take(200)
      result.deliveredToday += rows.filter((order) => visible(order) && (order.actualDeliveredAt ?? 0) >= start).length
    }
    return result
  },
})

export const order = query({
  args: { externalId: v.string(), channel },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, orderCapability(args.channel, "view"))
    const delivery = await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!delivery || !hasScope(user.restaurantScopes, delivery.restaurantExternalId)) return null
    await requireRestaurantScope(ctx, user, delivery.restaurantExternalId)
    const lines = delivery.orderId ? await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", delivery.orderId!)).take(200) : []
    const [source, zone, courier] = await Promise.all([
      ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", delivery.sourceExternalId)).unique(),
      delivery.zoneExternalId ? ctx.db.query("deliveryZones").withIndex("by_external_id", (q) => q.eq("externalId", delivery.zoneExternalId!)).unique() : null,
      delivery.courierExternalId ? ctx.db.query("couriers").withIndex("by_external_id", (q) => q.eq("externalId", delivery.courierExternalId!)).unique() : null,
    ])
    return {
      ...delivery,
      phone: (await canSeePii(ctx)) ? delivery.phone : maskPhone(delivery.phone),
      source: source ? { externalId: source.externalId, name: source.name, kind: source.kind, settlementMode: source.settlementMode, defaultPaymentTypeExternalId: source.defaultPaymentTypeExternalId ?? null } : null,
      zone: zone ? { externalId: zone.externalId, name: zone.name, deliveryFee: zone.deliveryFee, minimumOrder: zone.minimumOrder } : null,
      courier: courier ? { externalId: courier.externalId, name: courier.name, status: courier.status } : null,
      lines: lines.filter((line) => !line.voidedAt).map((line) => ({ productExternalId: line.productExternalId ?? "", productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal ?? line.unitPrice * line.quantity, sizeExternalId: line.sizeExternalId ?? null, sizeLabel: line.sizeLabel ?? null, modifierSelections: [
        ...(line.modifierSelections ?? []),
        // Removed defaults («БЕЗ ЛУКА») as explicit zeros, so saving the card again keeps them removed.
        ...(line.kitchenModifiers ?? []).filter((modifier) => modifier.quantity === 0).map((modifier) => ({ externalId: modifier.externalId, name: modifier.label, quantity: 0, unitPrice: 0 })),
      ] })),
    }
  },
})

/** Pickers of the order card: restaurants in scope, the restaurant's sources, couriers and payment types. */
export const references = query({
  args: { restaurantExternalId: v.optional(v.string()), channel },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, orderCapability(args.channel, "view"))
    const restaurants = (await scopedRestaurants(ctx, user)).filter((restaurant) => restaurant.active)
    if (!args.restaurantExternalId) return { restaurants: restaurants.map(({ externalId, name, city }) => ({ externalId, name, city: city ?? null })), sources: [], couriers: [], paymentTypes: [] }
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const active = await ctx.db.query("deliverySources").withIndex("by_active", (q) => q.eq("active", true)).take(100)
    const sources = active.filter((source) => sourceServes(source, args.restaurantExternalId!))
    const couriers = await ctx.db.query("couriers").withIndex("by_restaurant_status", (q) => q.eq("restaurantExternalId", args.restaurantExternalId!)).take(200)
    const paymentTypes = await activeSettingsAt(ctx, "payment-type", args.restaurantExternalId, Date.now())
    return {
      restaurants: restaurants.map(({ externalId, name, city }) => ({ externalId, name, city: city ?? null })),
      sources: sources.map(({ externalId, name, kind, commissionPercent, settlementMode, defaultPaymentTypeExternalId }) => ({ externalId, name, kind, commissionPercent, settlementMode, defaultPaymentTypeExternalId: defaultPaymentTypeExternalId ?? null })),
      couriers: couriers.filter((courier) => courier.active).map(({ externalId, name, status, transport }) => ({ externalId, name, status, transport })),
      paymentTypes: paymentTypes.map((row) => ({ externalId: row.externalId, name: row.name })),
    }
  },
})

/** Dishes for the order card at the restaurant's price in force (resolvePrice), with the stop list. */
export const products = query({
  args: { restaurantExternalId: v.string(), search: v.string(), channel },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, orderCapability(args.channel, "view"))
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const needle = args.search.trim().toLocaleLowerCase("ru")
    const rows = needle
      ? await ctx.db.query("products").withSearchIndex("search_products", (q) => q.search("searchText", needle).eq("enabled", true)).take(20)
      : await ctx.db.query("products").withIndex("by_enabled_and_popular_and_name", (q) => q.eq("enabled", true).eq("popular", true)).take(20)
    const now = Date.now()
    return Promise.all(
      rows.filter((product) => product.itemType !== "preparation").map(async (product) => ({
        productExternalId: product.externalId,
        name: product.name,
        price: (await resolvePrice(ctx, { product, restaurantExternalId: args.restaurantExternalId, at: now })).price,
        available: await isAvailable(ctx, product._id, args.restaurantExternalId, now),
        hasSizes: Boolean(product.sizeScaleId),
        hasModifiers: Boolean(await ctx.db.query("productModifierGroups").withIndex("by_product", (q) => q.eq("productId", product._id)).first()),
      })),
    )
  },
})

/** Sizes and modifier groups of a dish for the order card, at the restaurant's prices. */
export const productConfiguration = query({
  args: { restaurantExternalId: v.string(), productExternalId: v.string(), channel },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, orderCapability(args.channel, "view"))
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    return productConfigurationFor(ctx, args.restaurantExternalId, args.productExternalId)
  },
})

export const zones = query({
  args: { restaurantExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.delivery-zones.view")
    const restaurants = args.restaurantExternalId ? [args.restaurantExternalId] : (await scopedRestaurants(ctx, user)).map((restaurant) => restaurant.externalId)
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const rows = []
    for (const restaurantExternalId of restaurants) rows.push(...(await ctx.db.query("deliveryZones").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurantExternalId)).take(100)))
    return rows.sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority)
  },
})

export const couriers = query({
  args: { restaurantExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.couriers.view")
    const restaurants = args.restaurantExternalId ? [args.restaurantExternalId] : (await scopedRestaurants(ctx, user)).map((restaurant) => restaurant.externalId)
    if (args.restaurantExternalId) await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    const pii = await canSeePii(ctx)
    const rows = []
    for (const restaurantExternalId of restaurants) rows.push(...(await ctx.db.query("couriers").withIndex("by_restaurant_status", (q) => q.eq("restaurantExternalId", restaurantExternalId)).take(200)))
    return rows.map((courier) => ({ ...courier, phone: pii ? courier.phone : maskPhone(courier.phone) })).sort((a, b) => a.name.localeCompare(b.name, "ru"))
  },
})

export const sources = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireOfficeCapability(ctx, "office.delivery-sources.view")
    const rows = [...(await ctx.db.query("deliverySources").withIndex("by_active", (q) => q.eq("active", true)).take(200)), ...(await ctx.db.query("deliverySources").withIndex("by_active", (q) => q.eq("active", false)).take(200))]
    return rows.filter((source) => source.restaurantExternalIds.includes("*") || source.restaurantExternalIds.some((id) => hasScope(user.restaurantScopes, id)))
  },
})
