import { ConvexError } from "convex/values"
import type { GenericMutationCtx } from "convex/server"

import type { DataModel } from "../_generated/dataModel"

type MutationCtx = GenericMutationCtx<DataModel>

/**
 * Transactional outbox (W1-PLT-06): written in the same mutation as the change it announces, so an
 * event exists exactly when the change committed. The organization comes from the restaurant or is
 * given explicitly — never guessed.
 */
export async function appendOutboxEvent(
  ctx: MutationCtx,
  event: {
    aggregateType: string
    aggregateExternalId: string
    eventType: string
    restaurantExternalId?: string
    organizationExternalId?: string
    payload?: unknown
  },
) {
  let organizationExternalId = event.organizationExternalId
  if (event.restaurantExternalId) {
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", event.restaurantExternalId!)).unique()
    if (!restaurant) throw new ConvexError("Ресторан события не найден")
    organizationExternalId = restaurant.organizationExternalId
  }
  if (!organizationExternalId) throw new ConvexError("У события нет ресторана или организации")
  const now = Date.now()
  const externalId = `event-${crypto.randomUUID()}`
  await ctx.db.insert("outboxEvents", {
    externalId,
    aggregateType: event.aggregateType,
    aggregateExternalId: event.aggregateExternalId,
    eventType: event.eventType,
    organizationExternalId,
    ...(event.restaurantExternalId ? { restaurantExternalId: event.restaurantExternalId } : {}),
    payload: event.payload ?? {},
    status: "pending",
    attempts: 0,
    availableAt: now,
    createdAt: now,
  })
  return externalId
}
