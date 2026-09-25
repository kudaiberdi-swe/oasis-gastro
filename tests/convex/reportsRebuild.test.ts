import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

describe("M-8b sales facts rebuild over a range (W2-RPT-03)", () => {
  it("brings back facts of a past day, day by day, without doubling", async () => {
    const { t, productId } = await setup()
    const check = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "pay-1", payments: [{ method: "cash", amount: 2300 }] })
    const date = (await t.run((ctx) => ctx.db.get(check._id)))!.businessDate!
    const channelFacts = () => t.run(async (ctx) => (await ctx.db.query("dailySalesFacts").collect()).filter((row) => row.factType === "channel"))
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("dailySalesFacts").collect()) if (row.factType === "channel") await ctx.db.delete(row._id)
    })
    expect(await t.mutation(internal.domains.reports.internal.rebuildDailySalesFactsRange, { dateFrom: date, dateTo: date, dryRun: true })).toMatchObject({ days: 1, dryRun: true })
    // The range schedules one rebuild per restaurant and day; the rebuild itself is what it schedules.
    const scheduled = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length)
    await t.mutation(internal.domains.reports.internal.rebuildDailySalesFactsRange, { dateFrom: date, dateTo: date })
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length)).toBe(scheduled + 1)
    await t.mutation(internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: "almaty", businessDate: date })
    await t.mutation(internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: "almaty", businessDate: date })
    const facts = await channelFacts()
    expect(facts.map((row) => [row.dimensionKey, row.netAmount])).toEqual([["pos", 2300]])
  })
})
