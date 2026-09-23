import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"

import { query } from "../../_generated/server"
import type { MutationCtx, QueryCtx } from "../../_generated/server"
import type { Doc } from "../../_generated/dataModel"
import { requireOperator } from "../../lib/auth"
import { orderStatus as orderStatusValidator } from "../../lib/validators"

export async function hydrateOrder(ctx: QueryCtx | MutationCtx, order: Doc<"orders">) {
  const [rawLines, payments, creator] = await Promise.all([
    ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100),
    ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(100),
    order.createdBy ? ctx.db.get(order.createdBy) : null,
  ])
  const lines = await Promise.all(
    rawLines.map(async (line) => {
      const product = await ctx.db.get(line.productId)
      return {
        ...line,
        product: product
          ? { externalId: product.externalId, name: product.name, nameKk: product.nameKk, description: product.description, category: product.category }
          : null,
      }
    }),
  )
  return { ...order, lines, payments, createdByName: creator?.displayName ?? "Исторический заказ", createdByRole: creator?.role }
}

/** All checks (draft or held) currently open at this terminal — Sandyq is full-service, several tables at once. */
export const listOpenChecks = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const [drafts, held] = await Promise.all([
      ctx.db.query("orders").withIndex("by_terminal_status_created", (q) => q.eq("terminalId", access.terminal._id).eq("status", "draft")).collect(),
      ctx.db.query("orders").withIndex("by_terminal_status_created", (q) => q.eq("terminalId", access.terminal._id).eq("status", "held")).collect(),
    ])
    const open = [...drafts, ...held].sort((a, b) => a.createdAt - b.createdAt)
    return Promise.all(
      open.map(async (order) => {
        const lines = await ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100)
        return {
          orderId: order._id,
          number: order.number,
          tableLabel: order.tableLabel,
          status: order.status,
          total: order.total,
          itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
          updatedAt: order.updatedAt ?? order.createdAt,
        }
      }),
    )
  },
})

export const getCheck = query({
  args: { sessionToken: v.string(), orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const order = await ctx.db.get(args.orderId)
    if (!order || order.restaurantId !== access.restaurant._id) return null
    return hydrateOrder(ctx, order)
  },
})

export const list = query({
  args: {
    sessionToken: v.string(),
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(orderStatusValidator),
    direction: v.union(v.literal("asc"), v.literal("desc")),
  },
  handler: async (ctx, args) => {
    const access = await requireOperator(ctx, args.sessionToken)
    const search = args.search?.trim().toLocaleLowerCase("ru")
    const result = search
      ? await ctx.db
          .query("orders")
          .withSearchIndex("search_orders", (q) => {
            const searched = q.search("searchText", search).eq("terminalId", access.terminal._id)
            return args.status ? searched.eq("status", args.status) : searched
          })
          .paginate(args.paginationOpts)
      : args.status
        ? await ctx.db
            .query("orders")
            .withIndex("by_terminal_status_created", (q) => q.eq("terminalId", access.terminal._id).eq("status", args.status!))
            .order(args.direction)
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("orders")
            .withIndex("by_terminal_created", (q) => q.eq("terminalId", access.terminal._id))
            .order(args.direction)
            .paginate(args.paginationOpts)

    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (order) => {
          const [lines, payments, creator] = await Promise.all([
            ctx.db.query("orderLines").withIndex("by_order", (q) => q.eq("orderId", order._id)).take(100),
            ctx.db.query("payments").withIndex("by_order_created", (q) => q.eq("orderId", order._id)).take(100),
            order.createdBy ? ctx.db.get(order.createdBy) : null,
          ])
          const refundableByMethod = { cash: 0, card: 0, qr: 0 }
          for (const payment of payments) refundableByMethod[payment.method] += payment.type === "sale" ? payment.amount : -payment.amount
          return {
            ...order,
            lines,
            payments,
            createdByName: creator?.displayName ?? "Исторический заказ",
            itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
            refundableByMethod,
            refundableAmount: Object.values(refundableByMethod).reduce((sum, amount) => sum + amount, 0),
          }
        }),
      ),
    }
  },
})
