import { ConvexError, v } from "convex/values"

import { mutation, query } from "../../_generated/server"
import { MAX_BUSINESS_DAY_CUTOFF_MINUTES } from "../../lib/time"
import { effectiveScopes, getOfficeAuthEmail, hasScope, requireOfficeCapability, requireOrganizationScope, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"

// «Рестораны» (W2-ADM-07): the canonical restaurants with terminal and warehouse counts. A new restaurant
// gets its main warehouse and joins its creator's scope; iiko restaurants keep their source fields.

const serviceMode = v.union(v.literal("fast-food"), v.literal("table-service"), v.literal("delivery"))

export const listRestaurants = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("inactive"))), organizationExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.restaurants.view")
    const scopes = await effectiveScopes(ctx, user, role)
    const restaurants = args.organizationExternalId
      ? await ctx.db.query("restaurants").withIndex("by_organization", (q) => q.eq("organizationExternalId", args.organizationExternalId!)).take(200)
      : await ctx.db.query("restaurants").take(200)
    const rows = []
    for (const restaurant of restaurants) {
      if (!hasScope(user.restaurantScopes, restaurant.externalId) && !hasScope(scopes.organizationScopes, restaurant.organizationExternalId)) continue
      if (args.status && restaurant.active !== (args.status === "active")) continue
      const [terminals, warehouses] = await Promise.all([
        ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", restaurant._id)).take(100),
        ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", restaurant.externalId)).take(100),
      ])
      rows.push({ ...restaurant, terminalCount: terminals.filter((row) => row.active).length, warehouseCount: warehouses.filter((row) => row.active).length })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  },
})

export const saveRestaurant = mutation({
  args: {
    externalId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    organizationExternalId: v.string(),
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    timezone: v.string(),
    currency: v.optional(v.string()),
    serviceMode: v.optional(serviceMode),
    businessDayCutoffMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.restaurants.edit")
    await requireOrganizationScope(ctx, user, args.organizationExternalId, role)
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название ресторана")
    const cutoff = args.businessDayCutoffMinutes ?? 0
    if (!(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= MAX_BUSINESS_DAY_CUTOFF_MINUTES)) throw new ConvexError(`Отсечка бизнес-дня — от 00:00 до ${String(MAX_BUSINESS_DAY_CUTOFF_MINUTES / 60).padStart(2, "0")}:00`)
    const organization = await ctx.db.query("organizations").withIndex("by_external_id", (q) => q.eq("externalId", args.organizationExternalId)).unique()
    if (!organization?.active) throw new ConvexError("Организация не найдена или отключена")
    const local = { city: args.city?.trim() || undefined, currency: args.currency, serviceMode: args.serviceMode ?? "table-service", businessDayCutoffMinutes: cutoff }
    let externalId = args.externalId
    if (externalId) {
      await requireRestaurantScope(ctx, user, externalId)
      const existing = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId!)).unique()
      if (!existing) throw new ConvexError("Ресторан не найден")
      if (args.expectedVersion !== undefined && (existing.version ?? 0) !== args.expectedVersion) throw new ConvexError("Ресторан изменил другой пользователь — обновите страницу")
      const readOnly = existing.sourceReadOnly || existing.sourceSystem === "iiko-server"
      await ctx.db.patch(existing._id, { ...local, ...(readOnly ? {} : { name, address: args.address.trim(), timezone: args.timezone, organizationExternalId: args.organizationExternalId }), version: (existing.version ?? 0) + 1 })
    } else {
      externalId = `restaurant-${crypto.randomUUID()}`
      await ctx.db.insert("restaurants", { externalId, organizationExternalId: args.organizationExternalId, name, address: args.address.trim(), timezone: args.timezone, active: true, ...local, version: 1 })
      await ctx.db.insert("warehouses", { externalId: `${externalId}-main`, name: `${name} · основной склад`, shortName: "Склад", restaurantExternalId: externalId, organizationExternalId: args.organizationExternalId, kind: "storage", allowNegativeStock: false, internalTransfers: true, isSalesDefault: true, active: true, searchText: `${name} основной склад`.toLocaleLowerCase("ru") })
      if (!user.restaurantScopes.includes("*")) {
        const officeUser = await ctx.db.query("officeUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
        if (officeUser) await ctx.db.patch(officeUser._id, { restaurantScopes: [...officeUser.restaurantScopes, externalId] })
      }
    }
    await writeOfficeAudit(ctx, email, { action: "restaurant.save", summary: `Ресторан «${name}»`, resourceType: "restaurant", resourceExternalId: externalId, restaurantExternalId: externalId, capability: "office.restaurants.edit" })
    await appendOutboxEvent(ctx, { aggregateType: "restaurant", aggregateExternalId: externalId, eventType: "restaurant.updated", organizationExternalId: args.organizationExternalId, payload: { name } })
    return externalId
  },
})

export const setRestaurantActive = mutation({
  args: { externalId: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.restaurants.edit")
    await requireRestaurantScope(ctx, user, args.externalId)
    const email = (await getOfficeAuthEmail(ctx))!
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!restaurant) throw new ConvexError("Ресторан не найден")
    if (!args.active) {
      const open = await ctx.db.query("shifts").withIndex("by_restaurant_status_closed", (q) => q.eq("restaurantId", restaurant._id).eq("status", "open")).first()
      if (open) throw new ConvexError("В ресторане открыта смена — закройте её перед отключением")
    }
    await ctx.db.patch(restaurant._id, { active: args.active, version: (restaurant.version ?? 0) + 1 })
    await writeOfficeAudit(ctx, email, { action: "restaurant.status", summary: `Ресторан «${restaurant.name}»: ${args.active ? "включён" : "отключён"}`, resourceType: "restaurant", resourceExternalId: restaurant.externalId, restaurantExternalId: restaurant.externalId, capability: "office.restaurants.edit" })
  },
})
