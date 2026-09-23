import { v } from "convex/values"

import { mutation } from "../../_generated/server"
import { requireOperator, sha256, touchSession } from "../../lib/auth"
import { writeAudit } from "../../lib/audit"

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    await writeAudit(ctx, access, { action: "session.logout", summary: "Кассир завершил рабочую сессию" })
    await ctx.db.patch(access.session._id, { revokedAt: Date.now() })
  },
})

export const lock = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    await touchSession(ctx, access.session._id)
    await writeAudit(ctx, access, { action: "session.lock", summary: "Касса заблокирована" })
    await ctx.db.patch(access.session._id, { revokedAt: Date.now() })
  },
})

export const revoke = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.sessionToken)
    const session = await ctx.db
      .query("posSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique()
    if (session) await ctx.db.patch(session._id, { revokedAt: Date.now() })
  },
})
