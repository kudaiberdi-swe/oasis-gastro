import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"

type Severity = "info" | "warning" | "critical"

/** One notification per terminal; with a dedupeKey a repeat of the same condition is not re-sent. */
export async function createNotification(ctx: MutationCtx, args: { terminalId: Id<"posTerminals">; title: string; message: string; severity: Severity; dedupeKey?: string }) {
  if (args.dedupeKey) {
    const existing = await ctx.db.query("posNotifications").withIndex("by_terminal_dedupe", (q) => q.eq("terminalId", args.terminalId).eq("dedupeKey", args.dedupeKey)).first()
    if (existing) return existing._id
  }
  return ctx.db.insert("posNotifications", { ...args, createdAt: Date.now(), readBy: [] })
}

/** For every terminal of a restaurant (stock below minimum, office messages). */
export async function notifyRestaurant(ctx: MutationCtx, restaurantId: Id<"restaurants">, notification: { title: string; message: string; severity: Severity; dedupeKey?: string }) {
  const terminals = await ctx.db.query("posTerminals").withIndex("by_restaurant_active_and_number", (q) => q.eq("restaurantId", restaurantId).eq("active", true)).take(50)
  for (const terminal of terminals) await createNotification(ctx, { terminalId: terminal._id, ...notification })
}

export const create = internalMutation({
  args: { terminalId: v.id("posTerminals"), title: v.string(), message: v.string(), severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")), dedupeKey: v.optional(v.string()) },
  handler: async (ctx, args) => createNotification(ctx, args),
})

/** Hourly: a shift open for more than 24 hours gets a critical notice on its terminal. */
export const flagLongShifts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db.query("shifts").withIndex("by_status_opened", (q) => q.eq("status", "open").lt("openedAt", Date.now() - 24 * 3_600_000)).take(200)
    for (const shift of open) {
      await createNotification(ctx, { terminalId: shift.terminalId, title: "Смена открыта больше 24 часов", message: `Смена №${shift.number} открыта с ${shift.businessDate}. Закройте её и снимите Z-отчёт.`, severity: "critical", dedupeKey: `long-shift:${shift._id}` })
    }
    return { flagged: open.length }
  },
})
