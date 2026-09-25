import { v, ConvexError } from "convex/values"

import { mutation } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireAnyOperator } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"
import { appendOutboxEvent } from "../../lib/outbox"
import { kitchenStatus } from "../../lib/validators"
import { markDeliveryCooked } from "../delivery/internal"
import { ticketRestaurantId } from "./access"

type Status = Doc<"kitchenTickets">["status"]
const FLOW: Status[] = ["queued", "preparing", "ready", "completed"]
const STATUS_LABEL: Record<Status, string> = { queued: "в очереди", preparing: "готовится", ready: "готов", completed: "выдан", cancelled: "отменён" }
// The time each status was reached; a bump-back clears the times after the status it returns to.
const REACHED_AT = { preparing: "startedAt", ready: "readyAt", completed: "completedAt" } as const

/** One step forward, or one step back (bump-back) when the cook tapped too early. */
export const setStatus = mutation({
  args: { sessionToken: v.string(), ticketId: v.id("kitchenTickets"), status: kitchenStatus },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    const ticket = await ctx.db.get(args.ticketId)
    // Another restaurant's ticket is reported as missing, not as forbidden.
    if (!ticket || (ticket.restaurantId ?? (await ticketRestaurantId(ctx, ticket))) !== access.restaurant._id) throw new ConvexError("Тикет не найден")
    const from = FLOW.indexOf(ticket.status)
    const to = FLOW.indexOf(args.status)
    if (from < 0 || to < 0 || Math.abs(to - from) !== 1) throw new ConvexError("Недопустимый переход статуса")
    const now = Date.now()
    const back = to < from
    const patch: Partial<Doc<"kitchenTickets">> = { status: args.status, updatedAt: now, restaurantId: access.restaurant._id }
    if (back) patch[REACHED_AT[ticket.status as keyof typeof REACHED_AT]] = undefined
    else patch[REACHED_AT[args.status as keyof typeof REACHED_AT]] = now
    await ctx.db.patch(ticket._id, patch)
    await writeAudit(ctx, access, {
      action: back ? "kitchen.bump-back" : "kitchen.status",
      summary: `Кухня: заказ №${ticket.orderNumber} — ${STATUS_LABEL[ticket.status]} → ${STATUS_LABEL[args.status]}`,
      orderId: ticket.orderId,
    })
    // A delivery ticket drives its delivery order to «cooked» (W2-KDS-01).
    if (args.status === "ready" && !back && ticket.source === "delivery") await markDeliveryCooked(ctx, ticket.orderId)
    if (args.status === "ready") {
      await appendOutboxEvent(ctx, { aggregateType: "kitchen-ticket", aggregateExternalId: String(ticket._id), eventType: "kitchen.ready", restaurantExternalId: access.restaurant.externalId, payload: { orderId: String(ticket.orderId), orderNumber: ticket.orderNumber, source: ticket.source } })
    }
  },
})
