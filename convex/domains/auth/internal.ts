import { v } from "convex/values"

import { internalMutation, internalQuery } from "../../_generated/server"
import { LOCKOUT_DURATION_MS, LOCKOUT_THRESHOLD } from "../../lib/policy"
import { sessionPurpose } from "../../lib/validators"

export const getLoginRecord = internalQuery({
  args: { employeeCode: v.string(), terminalExternalId: v.string() },
  handler: async (ctx, args) => {
    const [employee, terminal] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("by_code", (q) => q.eq("code", args.employeeCode.trim()))
        .unique(),
      ctx.db
        .query("posTerminals")
        .withIndex("by_external_id", (q) => q.eq("externalId", args.terminalExternalId))
        .unique(),
    ])
    if (!employee || !terminal) return null
    const restaurant = await ctx.db.get(terminal.restaurantId)
    if (!restaurant || !employee.restaurantIds.includes(restaurant._id)) return null
    if (employee.terminalIds?.length && !employee.terminalIds.includes(terminal._id)) return null
    return { employee, terminal, restaurant }
  },
})

export const recordFailedAttempt = internalMutation({
  args: { employeeId: v.id("employees"), now: v.number() },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId)
    if (!employee) return
    const attempts = employee.failedAttempts + 1
    await ctx.db.patch(employee._id, {
      failedAttempts: attempts,
      ...(attempts >= LOCKOUT_THRESHOLD ? { lockedUntil: args.now + LOCKOUT_DURATION_MS } : {}),
    })
  },
})

export const createSession = internalMutation({
  args: {
    employeeId: v.id("employees"),
    terminalId: v.id("posTerminals"),
    tokenHash: v.string(),
    purpose: sessionPurpose,
    now: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.employeeId, { failedAttempts: 0, lockedUntil: undefined })
    return await ctx.db.insert("posSessions", {
      tokenHash: args.tokenHash,
      purpose: args.purpose,
      employeeId: args.employeeId,
      terminalId: args.terminalId,
      createdAt: args.now,
      lastActivityAt: args.now,
      expiresAt: args.expiresAt,
    })
  },
})

export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const retentionCutoff = Date.now() - 30 * 24 * 60 * 60_000
    const expired = await ctx.db
      .query("posSessions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", retentionCutoff))
      .take(200)
    for (const session of expired) await ctx.db.delete(session._id)
    return expired.length
  },
})
