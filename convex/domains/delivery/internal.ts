import { internalMutation, type MutationCtx } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { appendOutboxEvent } from "../../lib/outbox"

// Kitchen → delivery sync (W2-KDS-01) and default sources (W2-DLV-08).

/** A delivery ticket marked ready moves its order to «cooked» — once; later bumps change nothing. */
export async function markDeliveryCooked(ctx: MutationCtx, orderId: Id<"orders">) {
  const delivery = await ctx.db.query("deliveryOrders").withIndex("by_order", (q) => q.eq("orderId", orderId)).unique()
  if (!delivery || !["ready-to-cook", "cooking"].includes(delivery.status)) return false
  const now = Date.now()
  await ctx.db.patch(delivery._id, { status: "cooked", version: delivery.version + 1, updatedAt: now })
  await appendOutboxEvent(ctx, { aggregateType: "delivery-order", aggregateExternalId: delivery.externalId, eventType: "delivery-order.status.cooked", restaurantExternalId: delivery.restaurantExternalId, payload: { from: delivery.status, to: "cooked", by: "kitchen" } })
  return true
}

/** «Телефон» and «Сайт sandyq.kz», no commission; aggregators wait for the business decision. */
export const seedSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults = [
      { externalId: "source-phone", name: "Телефон", kind: "phone" as const },
      { externalId: "source-website", name: "Сайт sandyq.kz", kind: "website" as const },
    ]
    let created = 0
    for (const source of defaults) {
      if (await ctx.db.query("deliverySources").withIndex("by_external_id", (q) => q.eq("externalId", source.externalId)).unique()) continue
      await ctx.db.insert("deliverySources", { ...source, restaurantExternalIds: ["*"], commissionPercent: 0, confirmationRequired: false, settlementMode: "on-delivered", active: true, updatedAt: Date.now() })
      created += 1
    }
    return { created }
  },
})
