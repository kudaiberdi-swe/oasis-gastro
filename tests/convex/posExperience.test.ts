import { describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

describe("POS notifications and upsell (W1-POS-09)", () => {
  it("offers a popular dish from a category the check lacks, and needs a session", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("categories", { externalId: "drinks", label: "Напитки", shortLabel: "Напитки", sortOrder: 2, active: true })
      await ctx.db.insert("products", { externalId: "shubat", name: "Шұбат", nameKk: "Шұбат", nameSort: "шұбат", searchText: "шұбат", description: "", category: "drinks", categorySort: 2, basePrice: 850, popular: true, sku: "S", baseUnit: "порц.", enabled: true })
      await ctx.db.patch(productId, { popular: true })
    })
    const check = await draft(t, productId)
    expect(await t.query(api.domains.pos.queries.suggestion, { sessionToken: cashier, orderId: check._id })).toMatchObject({ externalId: "shubat", price: 850 })
    await expect(t.query(api.domains.pos.queries.suggestion, { sessionToken: "nobody", orderId: check._id })).rejects.toThrow()
  })

  it("read flags are per employee; a long shift is flagged once", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-24T09:00:00+05:00") })
    const { t } = await setup()
    vi.setSystemTime(Date.parse("2026-09-25T10:00:00+05:00"))
    await t.mutation(internal.domains.pos.internal.flagLongShifts, {})
    await t.mutation(internal.domains.pos.internal.flagLongShifts, {})
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("posSessions").take(10)) await ctx.db.patch(row._id, { expiresAt: Date.now() + 3_600_000 })
    })
    const page = await t.query(api.domains.pos.queries.notifications, { sessionToken: cashier, paginationOpts: { numItems: 10, cursor: null } })
    expect(page.page.map((item) => [item.severity, item.read])).toEqual([["critical", false]])
    expect(await t.query(api.domains.pos.queries.unreadNotificationCount, { sessionToken: cashier })).toBe(1)
    await t.mutation(api.domains.pos.mutations.markNotificationRead, { sessionToken: cashier, notificationId: page.page[0]._id })
    const [row] = await t.run((ctx) => ctx.db.query("posNotifications").take(5))
    expect(row.readBy).toHaveLength(1)
    vi.useRealTimers()
  })

  it("history can be limited to the open shift and shows what is left to refund per payment type", async () => {
    const { t, productId } = await setup()
    const check = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "p", payments: [{ method: "cash", amount: 1300 }, { method: "card", amount: 1000 }] })
    const page = await t.query(api.domains.orders.queries.list, { sessionToken: cashier, paginationOpts: { numItems: 10, cursor: null }, direction: "desc", currentShiftOnly: true })
    expect(page.page[0].refundableByPaymentType).toEqual({ "payment-type-cash": 1300, "payment-type-card": 1000 })
    // The refund list shows the Kazakh dish name second.
    expect(page.page[0].lines.map((line) => [line.productName, line.productNameKk])).toEqual([["Бешбармак", "Бешбармақ"]])
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 1300, note: "" })
    expect((await t.query(api.domains.orders.queries.list, { sessionToken: cashier, paginationOpts: { numItems: 10, cursor: null }, direction: "desc", currentShiftOnly: true })).page).toEqual([])
  })
})
