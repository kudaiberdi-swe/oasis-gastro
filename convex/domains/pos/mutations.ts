import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import { requireOperator } from "../../lib/auth"

/** Marks a notification read for this employee only; others on the terminal still see it unread. */
export const markNotificationRead = mutation({
  args: { sessionToken: v.string(), notificationId: v.id("posNotifications") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const item = await ctx.db.get(args.notificationId)
    if (!item || item.terminalId !== access.terminal._id) return
    if (!item.readBy.includes(access.employee._id)) await ctx.db.patch(item._id, { readBy: [...item.readBy, access.employee._id] })
  },
})
