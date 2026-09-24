import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "retail", name: "Розница", capabilities: ["office.orders.view", "office.cash-shifts.view", "office.cash-operations.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "a", email: "a@sandyq.test", name: "Алматы", roleExternalId: "retail", restaurantScopes: ["almaty"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "s", email: "s@sandyq.test", name: "Шымкент", roleExternalId: "retail", restaurantScopes: ["shymkent"], active: true })
  })
  return { almaty: t.withIdentity({ email: "a@sandyq.test" }), shymkent: t.withIdentity({ email: "s@sandyq.test" }) }
}

const page = { paginationOpts: { numItems: 20, cursor: null } }

describe("office retail views (W1-RTL-04/05/06)", () => {
  it("orders by status with the receipt card; another restaurant sees nothing", async () => {
    const { t, productId } = await setup()
    const { almaty, shymkent } = await office(t)
    const paid = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: paid._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 2300, tendered: 3000 }] })
    await draft(t, productId, 1)
    expect((await almaty.query(api.domains.retail.office.listOrders, { ...page, status: "all" })).page).toHaveLength(2)
    const paidOnly = await almaty.query(api.domains.retail.office.listOrders, { ...page, status: "paid" })
    expect(paidOnly.page.map((row) => [row.number, row.total, row.source])).toEqual([[paid.number, 2300, "Sandyq POS"]])
    expect((await shymkent.query(api.domains.retail.office.listOrders, { ...page, status: "all" })).page).toEqual([])
    const detail = (await almaty.query(api.domains.retail.office.getOrderDetail, { orderId: paid._id }))!
    expect(detail.totals).toMatchObject({ subtotal: 2000, serviceCharge: 300, total: 2300 })
    expect(detail.payments[0]).toMatchObject({ name: "Наличные", amount: 2300, change: 700 })
    expect(await shymkent.query(api.domains.retail.office.getOrderDetail, { orderId: paid._id })).toBeNull()
  })

  it("cash operations journal and shift cards with sales and acceptance status", async () => {
    const { t, productId } = await setup()
    const { almaty, shymkent } = await office(t)
    await t.mutation(api.domains.shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-float-in", amount: 10_000, idempotencyKey: "in" })
    const journal = await almaty.query(api.domains.retail.office.listCashOperations, page)
    expect(journal.page.map((row) => [row.direction, row.amount, row.operationTypeName])).toEqual([["cash-in", 10_000, "Внесение размена"]])
    expect((await shymkent.query(api.domains.retail.office.listCashOperations, page)).page).toEqual([])
    const check = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "p", payments: [{ method: "card", amount: 2300 }] })
    const [open] = (await almaty.query(api.domains.retail.office.listShifts, { ...page, status: "open" })).page
    expect(open).toMatchObject({ status: "open", sales: 2300, refunds: 0 })
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 10_000, note: "" })
    const [closed] = (await almaty.query(api.domains.retail.office.listShifts, { ...page, status: "closed" })).page
    expect(closed).toMatchObject({ status: "closed", expectedCash: 10_000, variance: 0 })
    expect(closed.zReportNumber).toMatch(/^Z-/)
  })
})
