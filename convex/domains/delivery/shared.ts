import { ConvexError } from "convex/values"

import type { MutationCtx, QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import type { DeliveryStatus } from "../../lib/deliveryCore"
import { almatyBusinessDate } from "../../lib/time"

// Helpers shared by delivery queries and mutations (W2-DLV-02…08).

export const TAB_STATUSES: Record<string, DeliveryStatus[] | null> = {
  active: ["unprocessed", "unconfirmed", "waiting", "ready-to-cook", "cooking", "cooked", "awaiting-dispatch", "on-way"],
  unprocessed: ["unprocessed", "unconfirmed"],
  waiting: ["waiting", "ready-to-cook", "cooking", "cooked", "awaiting-dispatch"],
  "on-way": ["on-way"],
  closed: ["delivered", "closed", "cancelled"],
  all: null,
}

export async function requireRestaurant(ctx: QueryCtx, externalId: string) {
  const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!restaurant) throw new ConvexError("Ресторан не найден")
  return restaurant
}

export async function requireDelivery(ctx: QueryCtx, externalId: string) {
  const order = await ctx.db.query("deliveryOrders").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()
  if (!order) throw new ConvexError("Заказ доставки не найден")
  return order
}

export const sourceServes = (source: Pick<Doc<"deliverySources">, "restaurantExternalIds">, restaurantExternalId: string) =>
  source.restaurantExternalIds.includes("*") || source.restaurantExternalIds.includes(restaurantExternalId)

/** The restaurant's virtual delivery till: delivery orders are numbered and paid on its shift (B-DLV-3). */
export async function deliveryTerminalOf(ctx: QueryCtx, restaurant: Doc<"restaurants">) {
  const terminals = await ctx.db.query("posTerminals").withIndex("by_restaurant_number", (q) => q.eq("restaurantId", restaurant._id)).take(100)
  return { terminal: terminals.find((terminal) => terminal.kind === "delivery") ?? null, nextNumber: terminals.reduce((max, terminal) => Math.max(max, terminal.terminalNumber), 0) + 1 }
}

export async function ensureDeliveryTerminal(ctx: MutationCtx, restaurant: Doc<"restaurants">) {
  const { terminal, nextNumber } = await deliveryTerminalOf(ctx, restaurant)
  if (terminal) return terminal
  const id = await ctx.db.insert("posTerminals", { externalId: `${restaurant.externalId}-delivery`, restaurantId: restaurant._id, name: "Доставка", terminalNumber: nextNumber, nextOrderNumber: 1, active: true, kind: "delivery" })
  return (await ctx.db.get(id))!
}

/** DEL-000001: one server sequence per organization (never a client timestamp). */
export async function nextDeliveryNumber(ctx: MutationCtx, organizationExternalId: string) {
  const scopeKey = `delivery-orders:${organizationExternalId}`
  const counter = await ctx.db.query("documentCounters").withIndex("by_scope_key", (q) => q.eq("scopeKey", scopeKey)).unique()
  const value = counter?.next ?? 1
  if (counter) await ctx.db.patch(counter._id, { next: value + 1 })
  else await ctx.db.insert("documentCounters", { scopeKey, next: value + 1 })
  return `DEL-${String(value).padStart(6, "0")}`
}

export const todayStart = (now: number) => Date.parse(`${almatyBusinessDate(now)}T00:00:00+05:00`)
