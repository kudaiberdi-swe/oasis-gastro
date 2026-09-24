import { ConvexError, v } from "convex/values"

import { mutation, type MutationCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { effectiveScopes, getOfficeAuthEmail, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { nextNumber } from "../../lib/numbering"
import { appendOutboxEvent } from "../../lib/outbox"
import { resolvePrice } from "../../lib/pricing"
import { businessDateFor } from "../../lib/time"
import { orderVisibleTo } from "./queries"

async function requireOrder(ctx: MutationCtx, externalId: string, restaurantScopes: string[]) {
  const order = await ctx.db.query("priceOrders").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!order || !orderVisibleTo(order, restaurantScopes)) throw new ConvexError("Приказ не найден")
  return order
}

/** Status after publishing, and when the cron should look at the order next. */
export function publishedState(order: Pick<Doc<"priceOrders">, "effectiveFrom" | "effectiveTo">, now: number) {
  if (order.effectiveTo !== undefined && order.effectiveTo <= now) return { status: "expired" as const, nextTransitionAt: undefined }
  if (order.effectiveFrom > now) return { status: "scheduled" as const, nextTransitionAt: order.effectiveFrom }
  return { status: "active" as const, nextTransitionAt: order.effectiveTo }
}

export const createDraft = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, role } = await requireOfficeCapability(ctx, "office.price-orders.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const scopes = await effectiveScopes(ctx, user, role)
    let organizationExternalId = scopes.organizationScopes.find((scope) => scope !== "*")
    if (!organizationExternalId) {
      const organizations = await ctx.db.query("organizations").take(3)
      const active = organizations.filter((organization) => organization.active)
      if (active.length !== 1) throw new ConvexError("Не удалось определить организацию приказа")
      organizationExternalId = active[0].externalId
    }
    const now = Date.now()
    const number = await nextNumber(ctx, { moduleId: "price-orders", prefix: "ЦЕН", organizationExternalId, businessDate: businessDateFor(now) })
    const externalId = `price-order-${crypto.randomUUID()}`
    const name = `Приказ ${number}`
    await ctx.db.insert("priceOrders", {
      externalId,
      number,
      name,
      nameSort: name.toLocaleLowerCase("ru"),
      searchText: `${number} ${name}`.toLocaleLowerCase("ru"),
      effectiveFrom: now,
      status: "draft",
      comment: "",
      posName: "",
      replacesPreviousMenu: false,
      // A branch user's order starts limited to their restaurants.
      restaurantExternalIds: user.restaurantScopes.includes("*") ? [] : user.restaurantScopes,
      organizationExternalId,
      createdBy: email,
      updatedAt: now,
    })
    await writeOfficeAudit(ctx, email, { action: "price-order.create", summary: `Создан приказ ${number}`, resourceType: "price-order", resourceExternalId: externalId, capability: "office.price-orders.edit" })
    return { externalId, number }
  },
})

export const save = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    comment: v.string(),
    posName: v.string(),
    replacesPreviousMenu: v.boolean(),
    restaurantExternalIds: v.array(v.string()),
    schedule: v.union(v.null(), v.object({ name: v.string(), startMinute: v.number(), endMinute: v.number(), weekdays: v.array(v.number()) })),
    lines: v.array(v.object({ productExternalId: v.string(), sizeOptionExternalId: v.optional(v.string()), included: v.boolean(), newPrice: v.number() })),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.price-orders.edit")
    for (const restaurant of args.restaurantExternalIds) await requireRestaurantScope(ctx, user, restaurant)
    if (args.restaurantExternalIds.length === 0 && !user.restaurantScopes.includes("*")) throw new ConvexError("Приказ для всех ресторанов может создать только пользователь с доступом ко всей сети")
    const email = (await getOfficeAuthEmail(ctx))!
    const order = await requireOrder(ctx, args.externalId, user.restaurantScopes)
    if (order.status !== "draft") throw new ConvexError("Изменить можно только черновик — действующий приказ отменяют или заменяют новым")
    const name = args.name.trim()
    if (!name) throw new ConvexError("Укажите название приказа")
    if (args.effectiveTo !== undefined && args.effectiveTo <= args.effectiveFrom) throw new ConvexError("Дата окончания должна быть позже даты начала")
    if (args.schedule) {
      const { startMinute, endMinute, weekdays } = args.schedule
      if (!(startMinute >= 0 && endMinute <= 1440 && startMinute < endMinute)) throw new ConvexError("Время расписания: начало раньше окончания, в пределах суток")
      if (weekdays.length === 0 || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new ConvexError("Дни недели — от 1 (пн) до 7 (вс)")
    }
    const seen = new Set<string>()
    const pricingRestaurant = args.restaurantExternalIds[0] ?? (await ctx.db.query("restaurants").withIndex("by_active_and_name", (q) => q.eq("active", true)).first())?.externalId
    if (!pricingRestaurant) throw new ConvexError("Нет активных ресторанов")

    const existingLines = await ctx.db.query("priceOrderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(200)
    for (const line of existingLines) await ctx.db.delete(line._id)
    for (const line of args.lines) {
      const key = `${line.productExternalId}:${line.sizeOptionExternalId ?? ""}`
      if (seen.has(key)) throw new ConvexError("Позиция указана в приказе дважды")
      seen.add(key)
      if (!Number.isInteger(line.newPrice) || line.newPrice < 0 || line.newPrice > 100_000_000) throw new ConvexError("Новая цена — целое число от 0 до 100 000 000 ₸")
      const product = await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", line.productExternalId)).unique()
      if (!product) throw new ConvexError("Блюдо не найдено")
      const size = line.sizeOptionExternalId ? await ctx.db.query("sizeOptions").withIndex("by_external_id", (q) => q.eq("externalId", line.sizeOptionExternalId!)).unique() : null
      if (line.sizeOptionExternalId && (!size || size.scaleId !== product.sizeScaleId)) throw new ConvexError(`Размер не относится к «${product.name}»`)
      // The price before this order takes effect (this draft is not in force, so it does not count).
      const previous = await resolvePrice(ctx, { product, restaurantExternalId: pricingRestaurant, at: args.effectiveFrom, sizeOptionId: size?._id, sizeCoefficient: size?.coefficient })
      await ctx.db.insert("priceOrderLines", {
        orderId: order._id,
        productId: product._id,
        productExternalId: product.externalId,
        ...(size ? { sizeOptionId: size._id, sizeLabel: size.label } : {}),
        included: line.included,
        previousPrice: previous.price,
        newPrice: line.newPrice,
        costAtSave: 0, // portion cost from the active recipe card arrives with W1-RCP-01
        productName: product.name,
      })
    }
    const schedules = await ctx.db.query("priceSchedules").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(5)
    for (const schedule of schedules) await ctx.db.delete(schedule._id)
    if (args.schedule) await ctx.db.insert("priceSchedules", { orderId: order._id, ...args.schedule, name: args.schedule.name.trim() || "Расписание" })

    await ctx.db.patch(order._id, {
      name,
      nameSort: name.toLocaleLowerCase("ru"),
      searchText: `${order.number} ${name} ${args.posName}`.toLocaleLowerCase("ru"),
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
      comment: args.comment.trim(),
      posName: args.posName.trim(),
      replacesPreviousMenu: args.replacesPreviousMenu,
      restaurantExternalIds: [...new Set(args.restaurantExternalIds)],
      updatedAt: Date.now(),
    })
    await writeOfficeAudit(ctx, email, { action: "price-order.update", summary: `Приказ ${order.number}: ${args.lines.length} позиций`, resourceType: "price-order", resourceExternalId: order.externalId, capability: "office.price-orders.edit" })
    return { lineCount: args.lines.length }
  },
})

export const publish = mutation({
  args: { externalId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.price-orders.post")
    const email = (await getOfficeAuthEmail(ctx))!
    const order = await requireOrder(ctx, args.externalId, user.restaurantScopes)
    if (order.status !== "draft") throw new ConvexError("Опубликовать можно только черновик")
    const line = await ctx.db.query("priceOrderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).first()
    if (!line) throw new ConvexError("В приказе нет позиций")
    const state = publishedState(order, Date.now())
    await ctx.db.patch(order._id, { ...state, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "price-order.publish", summary: `Опубликован приказ ${order.number}`, resourceType: "price-order", resourceExternalId: order.externalId, capability: "office.price-orders.post" })
    await appendOutboxEvent(ctx, { aggregateType: "price-order", aggregateExternalId: order.externalId, eventType: "price-order.published", organizationExternalId: order.organizationExternalId, payload: { number: order.number, status: state.status } })
    return state.status
  },
})

export const cancel = mutation({
  args: { externalId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.price-orders.cancel")
    const email = (await getOfficeAuthEmail(ctx))!
    const order = await requireOrder(ctx, args.externalId, user.restaurantScopes)
    if (order.status === "cancelled" || order.status === "expired") throw new ConvexError("Приказ уже завершён")
    const reason = args.reason.trim()
    if (reason.length < 3) throw new ConvexError("Укажите причину отмены")
    await ctx.db.patch(order._id, { status: "cancelled", nextTransitionAt: undefined, cancelReason: reason, updatedAt: Date.now() })
    await writeOfficeAudit(ctx, email, { action: "price-order.cancel", summary: `Отменён приказ ${order.number}: ${reason}`, resourceType: "price-order", resourceExternalId: order.externalId, capability: "office.price-orders.cancel" })
  },
})
