import { ConvexError, v } from "convex/values"

import { mutation } from "../../_generated/server"
import { envValue } from "../../lib/env"
import { enqueueIntegrationJob } from "../../lib/integrationQueue"
import { normalizePhone } from "../../lib/loyalty"
import { getOfficeAuthEmail, hasNetworkScope, requireOfficeCapability, requireRestaurantScope, writeOfficeAudit } from "../../lib/officeAccess"
import { TELEPHONY_PROVIDER, telephonyAdapter } from "../integrations/adapters/telephony"

// Office actions on calls (W3-DLV-09, B:delivery.ts:189-191). An outgoing call goes through the telephony
// adapter (W3-INT-06); with no provider it is refused at once — nothing pretends to dial.

const FINAL = ["missed", "completed", "failed"]

export const updateCall = mutation({
  args: { externalId: v.string(), status: v.union(v.literal("answered"), v.literal("missed"), v.literal("completed"), v.literal("failed")) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.telephony.edit")
    const email = (await getOfficeAuthEmail(ctx))!
    const call = await ctx.db.query("telephonyCalls").withIndex("by_external_id", (q) => q.eq("externalId", args.externalId)).unique()
    if (!call) throw new ConvexError("Звонок не найден")
    if (call.restaurantExternalId) await requireRestaurantScope(ctx, user, call.restaurantExternalId)
    else if (!hasNetworkScope(user)) throw new ConvexError("Звонок не найден")
    if (FINAL.includes(call.status)) throw new ConvexError("Звонок уже завершён")
    if (args.status === "completed" && call.status !== "answered") throw new ConvexError("Сначала отметьте ответ на звонок")
    const now = Date.now()
    await ctx.db.patch(call._id, { status: args.status, ...(args.status === "answered" ? { answeredAt: now } : { endedAt: now }), updatedAt: now })
    await writeOfficeAudit(ctx, email, {
      action: "telephony.call-update",
      summary: `Звонок: ${call.status} → ${args.status}`,
      resourceType: "telephony",
      resourceExternalId: call.externalId,
      ...(call.restaurantExternalId ? { restaurantExternalId: call.restaurantExternalId } : {}),
      capability: "office.telephony.edit",
    })
    return { status: args.status }
  },
})

/** An outgoing call from the office (a delivery card, the journal). Needs a connected provider. */
export const createCall = mutation({
  args: { phone: v.string(), restaurantExternalId: v.string(), deliveryExternalId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireOfficeCapability(ctx, "office.telephony.edit")
    await requireRestaurantScope(ctx, user, args.restaurantExternalId)
    if (!telephonyAdapter.configured(envValue)) throw new ConvexError("Провайдер телефонии не настроен")
    const email = (await getOfficeAuthEmail(ctx))!
    const phone = normalizePhone(args.phone)
    if (!phone) throw new ConvexError("Укажите корректный телефон")
    const restaurant = await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", args.restaurantExternalId)).unique()
    if (!restaurant?.active) throw new ConvexError("Ресторан не найден или отключён")
    const now = Date.now()
    const externalId = `office:${crypto.randomUUID()}`
    await ctx.db.insert("telephonyCalls", {
      externalId,
      provider: TELEPHONY_PROVIDER,
      direction: "outbound",
      status: "ringing",
      phone,
      restaurantExternalId: restaurant.externalId,
      ...(args.deliveryExternalId ? { deliveryExternalId: args.deliveryExternalId } : {}),
      operatorKey: email,
      startedAt: now,
      updatedAt: now,
    })
    // The job carries the call id only; the adapter reads the number from the call at dial time.
    await enqueueIntegrationJob(ctx, { provider: TELEPHONY_PROVIDER, operation: "call.originate", sourceExternalId: externalId, idempotencyKey: `call:${externalId}`, organizationExternalId: restaurant.organizationExternalId, payload: { callExternalId: externalId } })
    await writeOfficeAudit(ctx, email, { action: "telephony.call-create", summary: "Исходящий звонок", resourceType: "telephony", resourceExternalId: externalId, restaurantExternalId: restaurant.externalId, capability: "office.telephony.edit" })
    return { externalId }
  },
})
