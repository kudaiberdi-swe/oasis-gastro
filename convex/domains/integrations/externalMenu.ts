import { ConvexError, v } from "convex/values"

import { internal } from "../../_generated/api"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { getOfficeAuthEmail, hasNetworkScope, hasScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { appendOutboxEvent } from "../../lib/outbox"
import { buildMenu, type CloudMenu } from "./cloudApi"

// «Внешнее меню» (W3-INT-04, /office/external-menu): a channel record (website first, decision Г-9)
// and immutable per-restaurant snapshots of the Cloud API menu. «Опубликовать меню» schedules one
// snapshot per restaurant; an unchanged catalog keeps its version (content hash) and adds no row.
// GET /api/v1/menu serves the newest snapshot of a published channel, or the live catalog in mode «live».

const channel = v.union(v.literal("website"), v.literal("mobile-app"), v.literal("aggregators"), v.literal("all"))
const menuMode = v.union(v.literal("published"), v.literal("live"))
const recordStatus = v.union(v.literal("draft"), v.literal("published"), v.literal("inactive"))

const LIST_LIMIT = 100
const VERSIONS_LIMIT = 50
const PUBLISH_RESTAURANTS_LIMIT = 50

const visible = (record: Doc<"externalMenus">, scopes: string[]) => record.restaurantExternalIds.includes("*") || record.restaurantExternalIds.some((id) => hasScope(scopes, id))

async function requireRecord(ctx: QueryCtx, externalId: string) {
  const record = await ctx.db.query("externalMenus").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!record) throw new ConvexError("Запись внешнего меню не найдена")
  return record
}

/** "*" needs network scope; every named restaurant must be in the user's scope. */
async function requireRestaurantScopes(ctx: QueryCtx, user: { restaurantScopes: string[] }, restaurantExternalIds: string[]) {
  for (const id of restaurantExternalIds) {
    if (id === "*") {
      if (!hasNetworkScope(user)) throw new ConvexError("«Все рестораны» доступны только пользователю сети")
    } else await requireRestaurantScope(ctx, user, id)
  }
}

async function latestVersion(ctx: QueryCtx, recordExternalId: string) {
  return ctx.db.query("externalMenuVersions").withIndex("by_record_published", (q) => q.eq("recordExternalId", recordExternalId)).order("desc").first()
}

export const listExternalMenus = query({
  args: { status: v.optional(recordStatus) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.view")
    const rows = args.status
      ? await ctx.db.query("externalMenus").withIndex("by_status_updated", (q) => q.eq("status", args.status!)).order("desc").take(LIST_LIMIT)
      : await ctx.db.query("externalMenus").withIndex("by_creation_time").order("desc").take(LIST_LIMIT)
    const result = []
    for (const record of rows) {
      if (!visible(record, user.restaurantScopes)) continue
      const latest = await latestVersion(ctx, record.externalId)
      result.push({ ...record, latestVersion: latest?.version ?? null, latestVersionAt: latest?.publishedAt ?? null })
    }
    return result
  },
})

/** The card: the record and its version history (without snapshots) in the user's restaurants. */
export const externalMenu = query({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.view")
    const record = await ctx.db.query("externalMenus").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!record || !visible(record, user.restaurantScopes)) return null
    const versions = await ctx.db.query("externalMenuVersions").withIndex("by_record_published", (q) => q.eq("recordExternalId", record.externalId)).order("desc").take(VERSIONS_LIMIT)
    return {
      ...record,
      versions: versions
        .filter((row) => hasScope(user.restaurantScopes, row.restaurantExternalId))
        .map((row) => ({ id: row._id, restaurantExternalId: row.restaurantExternalId, version: row.version, itemCount: row.itemCount, publishedAt: row.publishedAt, publishedBy: row.publishedBy })),
    }
  },
})

/** Preview of one snapshot: the positions with their prices as the website sees them. */
export const externalMenuVersion = query({
  args: { versionId: v.id("externalMenuVersions") },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.view")
    const row = await ctx.db.get(args.versionId)
    if (!row || !hasScope(user.restaurantScopes, row.restaurantExternalId)) return null
    const snapshot = row.snapshot as CloudMenu
    const categories = new Map(snapshot.categories.map((category) => [category.externalId, category.name]))
    return {
      version: row.version,
      restaurantExternalId: row.restaurantExternalId,
      publishedAt: row.publishedAt,
      items: snapshot.items.map((item) => ({ externalId: item.externalId, name: item.name, nameKk: item.nameKk, category: categories.get(item.categoryExternalId) ?? "—", price: item.price, sizes: item.sizes.length, modifierGroups: item.modifierGroups.length })),
    }
  },
})

async function nextMenuNumber(ctx: MutationCtx) {
  const scopeKey = "external-menus"
  const counter = await ctx.db.query("documentCounters").withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey)).unique()
  const value = counter?.next ?? 1
  if (counter) await ctx.db.patch(counter._id, { next: value + 1 })
  else await ctx.db.insert("documentCounters", { scopeKey, next: value + 1 })
  return `EXM-${String(value).padStart(6, "0")}`
}

export const saveExternalMenu = mutation({
  args: { externalId: v.optional(v.string()), expectedVersion: v.optional(v.number()), name: v.string(), channel, mode: menuMode, restaurantExternalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const name = args.name.trim()
    if (name.length < 3) throw new ConvexError("Укажите название публикации")
    const restaurants = [...new Set(args.restaurantExternalIds)]
    if (restaurants.length === 0) throw new ConvexError("Выберите рестораны")
    if (restaurants.includes("*") && restaurants.length > 1) throw new ConvexError("«Все рестораны» не сочетаются с отдельными ресторанами")
    await requireRestaurantScopes(ctx, user, restaurants)
    for (const id of restaurants) {
      if (id === "*") continue
      const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", id)).unique()
      if (!restaurant) throw new ConvexError("Ресторан не найден")
    }
    const now = Date.now()
    const value = { name, channel: args.channel, mode: args.mode, restaurantExternalIds: restaurants, updatedAt: now }
    let externalId: string
    if (args.externalId) {
      const existing = await requireRecord(ctx, args.externalId)
      await requireRestaurantScopes(ctx, user, existing.restaurantExternalIds)
      if (args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем. Обновите карточку")
      externalId = existing.externalId
      await ctx.db.patch(existing._id, { ...value, version: existing.version + 1 })
    } else {
      externalId = `external-menu-${crypto.randomUUID()}`
      await ctx.db.insert("externalMenus", { ...value, externalId, number: await nextMenuNumber(ctx), status: "draft", version: 1, createdAt: now })
    }
    await writeOfficeAudit(ctx, email, { action: "external-menu.save", summary: `Внешнее меню «${name}» сохранено`, resourceType: "external-menu", resourceExternalId: externalId, ...(restaurants.length === 1 && restaurants[0] !== "*" ? { restaurantExternalId: restaurants[0] } : {}), capability: "office.external-menu.edit" })
    return externalId
  },
})

/** «Опубликовать меню»: the record goes live and every restaurant gets a snapshot (scheduled, one per restaurant). */
export const publishExternalMenu = mutation({
  args: { recordExternalId: v.string(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.approve")
    const email = (await getOfficeAuthEmail(ctx))!
    const record = await requireRecord(ctx, args.recordExternalId)
    await requireRestaurantScopes(ctx, user, record.restaurantExternalIds)
    if (args.expectedVersion !== undefined && record.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем. Обновите карточку")
    const restaurants = record.restaurantExternalIds.includes("*")
      ? (await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).take(PUBLISH_RESTAURANTS_LIMIT)).map((row) => row.externalId)
      : record.restaurantExternalIds
    if (restaurants.length === 0) throw new ConvexError("Нет активных ресторанов для публикации")
    const now = Date.now()
    await ctx.db.patch(record._id, { status: "published", publishedAt: now, publishedBy: email, version: record.version + 1, updatedAt: now })
    if (record.mode === "published") {
      for (const restaurantExternalId of restaurants) await ctx.scheduler.runAfter(0, internal.domains.integrations.externalMenu.snapshotExternalMenu, { recordExternalId: record.externalId, restaurantExternalId, publishedBy: email })
    }
    await writeOfficeAudit(ctx, email, { action: "external-menu.publish", summary: `Опубликовано внешнее меню «${record.name}» (${record.mode === "live" ? "живое меню" : `ресторанов: ${restaurants.length}`})`, resourceType: "external-menu", resourceExternalId: record.externalId, capability: "office.external-menu.approve" })
    return { restaurants: record.mode === "published" ? restaurants.length : 0 }
  },
})

/** «Снять с публикации»: the API falls back to the live catalog for this channel. */
export const deactivateExternalMenu = mutation({
  args: { recordExternalId: v.string(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.external-menu.approve")
    const email = (await getOfficeAuthEmail(ctx))!
    const record = await requireRecord(ctx, args.recordExternalId)
    await requireRestaurantScopes(ctx, user, record.restaurantExternalIds)
    if (args.expectedVersion !== undefined && record.version !== args.expectedVersion) throw new ConvexError("Запись изменена другим пользователем. Обновите карточку")
    if (record.status !== "published") throw new ConvexError("Снять можно только опубликованное меню")
    await ctx.db.patch(record._id, { status: "inactive", version: record.version + 1, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "external-menu.deactivate", summary: `Снято с публикации внешнее меню «${record.name}»`, resourceType: "external-menu", resourceExternalId: record.externalId, capability: "office.external-menu.approve" })
  },
})

/** One restaurant's snapshot; the same content hash as the newest version adds nothing. */
export const snapshotExternalMenu = internalMutation({
  args: { recordExternalId: v.string(), restaurantExternalId: v.string(), publishedBy: v.string() },
  handler: async (ctx, args) => {
    const record = await requireRecord(ctx, args.recordExternalId)
    if (record.status !== "published") return null
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant?.active) return null
    const now = Date.now()
    const menu = await buildMenu(ctx, restaurant, now)
    const latest = await ctx.db
      .query("externalMenuVersions")
      .withIndex("by_record_restaurant_published", (q) => q.eq("recordExternalId", record.externalId).eq("restaurantExternalId", restaurant.externalId))
      .order("desc")
      .first()
    if (latest?.version === menu.version) return { version: menu.version, created: false }
    await ctx.db.insert("externalMenuVersions", { recordExternalId: record.externalId, restaurantExternalId: restaurant.externalId, version: menu.version, snapshot: menu, itemCount: menu.items.length, publishedAt: now, publishedBy: args.publishedBy })
    await appendOutboxEvent(ctx, { aggregateType: "external-menu", aggregateExternalId: record.externalId, eventType: "external-menu.published", restaurantExternalId: restaurant.externalId, payload: { menuExternalId: record.externalId, channel: record.channel, version: menu.version, restaurantExternalId: restaurant.externalId, publishedAt: now } })
    return { version: menu.version, created: true }
  },
})
