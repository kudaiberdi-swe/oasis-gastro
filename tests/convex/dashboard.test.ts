import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

describe("start page (W1-ADM-05)", () => {
  it("aggregates revenue, orders, documents and shift status from the facts", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "d", name: "Дашборд", capabilities: ["office.dashboard.view"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "d", email: "d@sandyq.test", name: "Д", roleExternalId: "d", restaurantScopes: ["almaty"], active: true })
    })
    const user = t.withIdentity({ email: "d@sandyq.test" })
    const order = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300 }] })
    const date = (await t.run((ctx) => ctx.db.query("dailySalesFacts").take(1)))[0].businessDate
    const result = await user.query(api.domains.platform.queries.dashboard, { from: date, to: date })
    expect(result).toMatchObject({ revenue: 2300, orders: 1, averageCheck: 2300, exchangeErrors: 0 })
    expect(result.restaurants).toEqual([{ restaurantExternalId: "almaty", name: "Алматы", documents: 0, turnover: 2300, orders: 1, status: "working" }])
    expect(result.series).toHaveLength(30)
    expect(result.series.at(-1)).toEqual({ date, value: 2300 })
    await expect(user.query(api.domains.platform.queries.dashboard, { restaurantExternalId: "shymkent", from: date, to: date })).rejects.toThrow()
  })
})
