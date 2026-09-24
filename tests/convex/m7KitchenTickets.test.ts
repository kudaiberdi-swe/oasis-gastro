import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

const all = { paginationOpts: { numItems: 100, cursor: null } }

describe("M-7 kitchen tickets (W1-KDS-01)", () => {
  it("fills the restaurant from the order and prep areas from products; reports what it can't resolve", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.patch(productId, { prepArea: "cold" })
      const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
      const base = { orderType: "dine-in" as const, status: "paid" as const, discountPercent: 0, subtotal: 0, serviceChargePercent: 0, serviceChargeAmount: 0, total: 0, createdAt: 1, searchText: "" }
      const known = await ctx.db.insert("orders", { ...base, number: 1, restaurantId: restaurant._id })
      const orphan = await ctx.db.insert("orders", { ...base, number: 2 })
      for (const [orderId, number] of [[known, 1], [orphan, 2]] as const) {
        const ticketId = await ctx.db.insert("kitchenTickets", { orderId, orderNumber: number, status: "completed", fulfillment: "dine-in", source: "pos", createdAt: 1, updatedAt: 1 })
        await ctx.db.insert("kitchenTicketLines", { ticketId, productExternalId: "dish", productName: "Бешбармак", quantity: 1, instructions: [] })
      }
    })
    const dry = await t.mutation(internal.migrations.m7KitchenTickets.backfill, { ...all, dryRun: true })
    expect(dry).toMatchObject({ scanned: 2, tickets: 1, lines: 2, isDone: true })
    expect(dry.unresolved).toHaveLength(1)
    await t.mutation(internal.migrations.m7KitchenTickets.backfill, all)
    const tickets = await t.run((ctx) => ctx.db.query("kitchenTickets").take(5))
    expect(tickets.filter((ticket) => ticket.restaurantId)).toHaveLength(1)
    expect((await t.run((ctx) => ctx.db.query("kitchenTicketLines").take(5))).map((line) => line.prepArea)).toEqual(["cold", "cold"])
    expect((await t.mutation(internal.migrations.m7KitchenTickets.backfill, all)).lines).toBe(0)
  })
})
