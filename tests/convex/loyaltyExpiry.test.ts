import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { cashier, draft, setup } from "./fixtures/pos"

const DAY = 86_400_000
const T0 = Date.parse("2026-08-01T12:00:00+05:00")

describe("loyalty expiration and reservation (W2-LOY-09)", () => {
  it("accrual 100 for 30 days, 40 spent → 60 expire after 31 days, once; transactions sum to the balance", async () => {
    const { t } = await setup()
    const accountId = await t.run(async (ctx) => {
      const guestId = await ctx.db.insert("guests", { phone: "77011234567", points: 60, createdAt: 0 })
      const accountId = await ctx.db.insert("loyaltyAccounts", { externalId: "acc", guestId, programExternalId: "p", kind: "bonus", balance: 60, reserved: 0, updatedAt: 0 })
      await ctx.db.insert("loyaltyTransactions", { guestId, accountId, kind: "accrual", points: 100, balanceAfter: 100, occurredAt: T0, expiresAt: T0 + 30 * DAY, idempotencyKey: "a1" })
      await ctx.db.insert("loyaltyTransactions", { guestId, accountId, kind: "redemption", points: -40, balanceAfter: 60, occurredAt: T0 + DAY, idempotencyKey: "r1" })
      return accountId
    })
    expect(await t.mutation(internal.domains.loyalty.expiry.expireLoyaltyPoints, { now: T0 + 29 * DAY })).toMatchObject({ expired: 0 })
    expect(await t.mutation(internal.domains.loyalty.expiry.expireLoyaltyPoints, { now: T0 + 31 * DAY })).toMatchObject({ expired: 60 })
    expect(await t.mutation(internal.domains.loyalty.expiry.expireLoyaltyPoints, { now: T0 + 32 * DAY })).toMatchObject({ expired: 0 })
    const { account, sum } = await t.run(async (ctx) => {
      const account = (await ctx.db.get(accountId))!
      const rows = await ctx.db.query("loyaltyTransactions").withIndex("by_account_occurred", (q) => q.eq("accountId", accountId)).collect()
      return { account, sum: rows.reduce((total, row) => total + row.points, 0) }
    })
    expect(account.balance).toBe(0)
    expect(sum).toBe(account.balance)
  })

  it("a planned redemption holds points on the account until checkout, a replacement or the 2-hour timeout", async () => {
    const { t, productId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("loyaltyPrograms", { externalId: "p-main", name: "Бонусы", status: "published", programKind: "bonus", accrualPercent: 5, maxRedemptionPercent: 50, welcomeBonus: 0, startsAt: 0, restaurantExternalIds: ["*"], priority: 1, createdAt: 0, updatedAt: 0 } as never)
      const guestId = await ctx.db.insert("guests", { phone: "77011234567", points: 1000, createdAt: 0 })
      await ctx.db.insert("loyaltyAccounts", { externalId: "acc", guestId, programExternalId: "p-main", kind: "bonus", balance: 1000, reserved: 0, updatedAt: 0 })
    })
    const reserved = () => t.run(async (ctx) => (await ctx.db.query("loyaltyAccounts").first())!.reserved)
    const first = await draft(t, productId)
    await t.mutation(api.domains.loyalty.mutations.attachGuestToOrder, { sessionToken: cashier, orderId: first._id, phone: "+7 701 123 45 67" })
    await t.mutation(api.domains.loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: first._id, redemption: 300 })
    await t.mutation(api.domains.loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: first._id, redemption: 200 })
    expect(await reserved()).toBe(200)

    const second = await draft(t, productId)
    await t.mutation(api.domains.loyalty.mutations.attachGuestToOrder, { sessionToken: cashier, orderId: second._id, phone: "+7 701 123 45 67" })
    expect((await t.query(api.domains.loyalty.queries.quoteForPos, { sessionToken: cashier, orderId: second._id }))?.balance).toBe(800)
    await t.mutation(api.domains.loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: second._id, redemption: 100 })
    expect(await reserved()).toBe(300)

    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: first._id, idempotencyKey: "pay-1", payments: [{ method: "cash", amount: 2300 - 200 }] })
    expect(await reserved()).toBe(100)

    await t.run((ctx) => ctx.db.patch(second._id, { loyaltyReservedAt: Date.now() - 3 * 3_600_000 }))
    expect(await t.mutation(internal.domains.loyalty.expiry.releaseStaleReservations, {})).toEqual({ released: 1 })
    expect(await reserved()).toBe(0)
    expect((await t.run((ctx) => ctx.db.get(second._id)))?.loyaltyRedemptionPlanned).toBeUndefined()
  })
})
