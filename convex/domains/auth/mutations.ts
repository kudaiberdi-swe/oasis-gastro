import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import { requireAnyOperator, touchSession } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    await writeAudit(ctx, access, { action: "session.logout", summary: "Кассир завершил рабочую сессию" })
    await ctx.db.patch(access.session._id, { revokedAt: Date.now() })
  },
})

export const lock = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAnyOperator(ctx, args.sessionToken)
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "session.lock", summary: "Касса заблокирована" })
    await ctx.db.patch(access.session._id, { revokedAt: Date.now() })
  },
})
