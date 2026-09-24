import { describe, expect, it, vi } from "vitest"

import { api } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

const shifts = api.domains.shifts

describe("shift cash operations and Z-report (W1-POS-08)", () => {
  it("takes direction, limit, manager rule and accounts from the cash operation type", async () => {
    const { t } = await setup()
    await t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-float-in", amount: 20_000, idempotencyKey: "in-1" })
    await expect(t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-float-in", amount: 600_000, idempotencyKey: "in-2" })).rejects.toThrow(/лимита/)
    await expect(t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-collection", amount: 5_000, idempotencyKey: "out-1" })).rejects.toThrow(/менеджер/i)
    await t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-collection", amount: 5_000, comment: "Инкассатор", idempotencyKey: "out-2", managerApprovalToken: "m1" })

    const events = await t.run((ctx) => ctx.db.query("shiftEvents").take(10))
    expect(events.filter((event) => event.cashOperationTypeExternalId).map((event) => [event.type, event.amount, event.reason])).toEqual([
      ["cash-in", 20_000, "Внесение размена"],
      ["cash-out", 5_000, "Инкассация: Инкассатор"],
    ])
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").take(10))
    expect(entries.map((entry) => [entry.debitAccountExternalId, entry.creditAccountExternalId, entry.amount])).toEqual([
      ["acc-1010", "acc-1030", 20_000],
      ["acc-1030", "acc-1010", 5_000],
    ])
    // Replay with the same key returns the same event.
    const again = await t.mutation(shifts.mutations.recordCashMovement, { sessionToken: cashier, cashOperationTypeExternalId: "cash-operation-type-float-in", amount: 20_000, idempotencyKey: "in-1" })
    expect(again).toBe(events.find((event) => event.idempotencyKey === "in-1")?._id)
  })

  it("close writes an immutable Z-report with the shift's totals; history links it", async () => {
    const { t, productId } = await setup()
    const order = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: order._id, idempotencyKey: "p", payments: [{ method: "cash", amount: order.total }] })
    const closed = await t.mutation(shifts.mutations.close, { sessionToken: cashier, countedCash: order.total, note: "" })
    const report = await t.query(shifts.queries.getZReport, { sessionToken: cashier, shiftId: closed.shiftId })
    expect(report).toMatchObject({ number: closed.zReportNumber, countedCash: 2300, variance: 0, nonFiscal: true, snapshot: { sales: 2300, serviceCharge: 300, saleOrderCount: 1 } })
    const history = await t.query(shifts.queries.history, { sessionToken: cashier, paginationOpts: { numItems: 5, cursor: null } })
    expect(history.page[0].zReportId).toBe(report?._id)
  })

  it("flags a shift open for more than 24 hours", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-24T09:00:00+05:00") })
    const { t } = await setup()
    expect((await t.query(shifts.queries.current, { sessionToken: cashier }))?.openedOver24h).toBe(false)
    vi.setSystemTime(Date.parse("2026-09-25T09:30:00+05:00"))
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("posSessions").take(10)) await ctx.db.patch(row._id, { expiresAt: Date.now() + 3_600_000 })
    })
    expect((await t.query(shifts.queries.current, { sessionToken: cashier }))?.openedOver24h).toBe(true)
    vi.useRealTimers()
  })
})
