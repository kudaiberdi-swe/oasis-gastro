import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { businessDateFor } from "../lib/time"

// migration-batch M-2 (W1-POS-01): orders, lines and payments get their retail settings links.
//   orders    orderType → order-type setting («В зале» / «С собой» / «Доставка»), businessDate
//   lines     free-text modifiers[] → kitchenModifiers[], lineTotal
//   payments  method → payment-type setting by processorKind, restaurantId from the order
// Paged, idempotent (only fills missing fields), dry run by default in the runbook; every touched
// document gets migratedBy: "M-2" so rollback removes exactly what the migration added.
// Precondition: W1-RTL-02 defaults seeded (domains/retail/internal:seedDefaults).

const ORDER_TYPE_CODE = { "dine-in": "dine-in", takeaway: "takeaway", delivery: "delivery" } as const
const PAYMENT_TYPE_CODE = { cash: "cash", card: "card", qr: "kaspi-qr" } as const

async function settingByCode(ctx: MutationCtx, kind: "order-type" | "payment-type", code: string) {
  const versions = await ctx.db.query("retailSettings").withIndex("by_kind_code_version", (q) => q.eq("kind", kind).eq("code", code)).order("desc").take(20)
  return versions.find((row) => row.status === "published") ?? versions[0] ?? null
}

async function orderBusinessDate(ctx: MutationCtx, order: Doc<"orders">) {
  const shift = order.originatingShiftId ? await ctx.db.get(order.originatingShiftId) : null
  if (shift) return shift.businessDate
  const restaurant = order.restaurantId ? await ctx.db.get(order.restaurantId) : null
  return businessDateFor(order.createdAt, restaurant?.businessDayCutoffMinutes)
}

export const backfillOrders = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("orders").withIndex("by_status_created").paginate(args.paginationOpts)
    let patched = 0
    const missingSettings = new Set<string>()
    for (const order of page.page) {
      const patch: Partial<Doc<"orders">> = {}
      if (!order.orderTypeExternalId) {
        const setting = await settingByCode(ctx, "order-type", ORDER_TYPE_CODE[order.orderType])
        if (setting) Object.assign(patch, { orderTypeExternalId: setting.externalId, orderTypeName: setting.name })
        else missingSettings.add(`order-type:${ORDER_TYPE_CODE[order.orderType]}`)
      }
      if (!order.businessDate) patch.businessDate = await orderBusinessDate(ctx, order)
      if (!Object.keys(patch).length) continue
      patched += 1
      if (!args.dryRun) await ctx.db.patch(order._id, { ...patch, migratedBy: "M-2" })
    }
    return { scanned: page.page.length, patched, missingSettings: [...missingSettings], isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

export const backfillLines = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("orderLines").withIndex("by_order").paginate(args.paginationOpts)
    let patched = 0
    for (const line of page.page) {
      const patch: Partial<Doc<"orderLines">> = {}
      if (line.kitchenModifiers === undefined && line.modifiers.length) {
        patch.kitchenModifiers = line.modifiers.map((label) => ({ externalId: "free-text", label, quantity: 1, defaultQuantity: 0 }))
      }
      if (line.lineTotal === undefined) {
        const modifiers = (line.modifierSelections ?? []).reduce((sum, row) => sum + row.quantity * row.unitPrice, 0)
        patch.lineTotal = Math.round((line.unitPrice + modifiers) * line.quantity)
      }
      if (!Object.keys(patch).length) continue
      patched += 1
      if (!args.dryRun) await ctx.db.patch(line._id, { ...patch, migratedBy: "M-2" })
    }
    return { scanned: page.page.length, patched, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

export const backfillPayments = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("payments").withIndex("by_created_at").paginate(args.paginationOpts)
    let patched = 0
    const missingSettings = new Set<string>()
    for (const payment of page.page) {
      const patch: Partial<Doc<"payments">> = {}
      if (!payment.paymentTypeExternalId) {
        const setting = await settingByCode(ctx, "payment-type", PAYMENT_TYPE_CODE[payment.method])
        if (setting) Object.assign(patch, { paymentTypeExternalId: setting.externalId, paymentTypeName: setting.name })
        else missingSettings.add(`payment-type:${PAYMENT_TYPE_CODE[payment.method]}`)
      }
      if (!payment.processorKind) patch.processorKind = payment.method
      if (!payment.restaurantId) {
        const order = await ctx.db.get(payment.orderId)
        if (order?.restaurantId) patch.restaurantId = order.restaurantId
      }
      if (!Object.keys(patch).length) continue
      patched += 1
      if (!args.dryRun) await ctx.db.patch(payment._id, { ...patch, migratedBy: "M-2" })
    }
    return { scanned: page.page.length, patched, missingSettings: [...missingSettings], isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})

/** Removes the M-2 fields from documents marked migratedBy "M-2", one table per call. */
export const rollback = internalMutation({
  args: { table: v.union(v.literal("orders"), v.literal("orderLines"), v.literal("payments")), paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const page =
      args.table === "orders"
        ? await ctx.db.query("orders").withIndex("by_status_created").paginate(args.paginationOpts)
        : args.table === "orderLines"
          ? await ctx.db.query("orderLines").withIndex("by_order").paginate(args.paginationOpts)
          : await ctx.db.query("payments").withIndex("by_created_at").paginate(args.paginationOpts)
    let reverted = 0
    for (const row of page.page) {
      if (row.migratedBy !== "M-2") continue
      reverted += 1
      if (args.dryRun) continue
      if (args.table === "orders") await ctx.db.patch(row._id as Doc<"orders">["_id"], { orderTypeExternalId: undefined, orderTypeName: undefined, businessDate: undefined, migratedBy: undefined })
      else if (args.table === "orderLines") await ctx.db.patch(row._id as Doc<"orderLines">["_id"], { kitchenModifiers: undefined, lineTotal: undefined, migratedBy: undefined })
      else await ctx.db.patch(row._id as Doc<"payments">["_id"], { paymentTypeExternalId: undefined, paymentTypeName: undefined, processorKind: undefined, restaurantId: undefined, migratedBy: undefined })
    }
    return { scanned: page.page.length, reverted, isDone: page.isDone, continueCursor: page.continueCursor, dryRun: args.dryRun ?? false }
  },
})
