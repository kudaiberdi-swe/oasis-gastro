import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

type T = TestConvex<typeof schema>
const loyalty = api.domains.loyalty
const orders = api.domains.orders.mutations
const all = { paginationOpts: { numItems: 100, cursor: null } }

async function program(t: T, overrides: Record<string, unknown> = {}) {
  await t.run((ctx) =>
    ctx.db.insert("loyaltyPrograms", { externalId: "p-main", name: "Бонусы", status: "published", programKind: "bonus", accrualPercent: 5, maxRedemptionPercent: 50, welcomeBonus: 0, startsAt: 0, restaurantExternalIds: ["*"], priority: 1, createdAt: 0, updatedAt: 0, ...overrides } as never),
  )
}

async function guestWithPoints(t: T, points: number) {
  return t.run(async (ctx) => {
    const guestId = await ctx.db.insert("guests", { phone: "77011234567", name: "Айдана", points, createdAt: 0 })
    if (points) await ctx.db.insert("loyaltyTransactions", { guestId, kind: "adjustment", points, balanceAfter: points, reason: "Старт", occurredAt: 0 })
    return guestId
  })
}

async function checkWithGuest(t: T, productId: Id<"products">) {
  const check = await draft(t, productId) // 2300
  await t.mutation(loyalty.mutations.attachGuestToOrder, { sessionToken: cashier, orderId: check._id, phone: "+7 701 123 45 67" })
  return check
}

describe("loyalty v2 (W1-LOY-01/02/03)", () => {
  it("M-5 moves points to an account of «Базовая», reports mismatches, is idempotent", async () => {
    const { t } = await setup()
    const guestId = await guestWithPoints(t, 1000)
    await t.run((ctx) => ctx.db.insert("guests", { phone: "77019998877", points: 50, createdAt: 0 })) // no transactions → mismatch
    const dry = await t.mutation(internal.migrations.m5Loyalty.migrateGuests, { ...all, dryRun: true })
    expect(dry).toMatchObject({ guests: 2, accountsToCreate: 1, transactionsToLink: 1 })
    expect(dry.mismatches).toHaveLength(1)
    await t.mutation(internal.migrations.m5Loyalty.ensureBaseProgram, {})
    await t.mutation(internal.migrations.m5Loyalty.migrateGuests, all)
    expect((await t.mutation(internal.migrations.m5Loyalty.migrateGuests, all)).accountsToCreate).toBe(0)
    const [account] = await t.run((ctx) => ctx.db.query("loyaltyAccounts").take(5))
    expect(account).toMatchObject({ guestId, programExternalId: "loyalty-program-base", balance: 1000, migrationBatch: "M-5" })
  })

  it("partial redemption: 300 of the allowed, the rest paid, liability posting, accrual on what was paid", async () => {
    const { t, productId } = await setup()
    await program(t)
    await guestWithPoints(t, 1000)
    await t.mutation(internal.migrations.m5Loyalty.migrateGuests, all) // no base program: accounts come from checkout
    const check = await checkWithGuest(t, productId)
    const quote = (await t.query(loyalty.queries.quoteForPos, { sessionToken: cashier, orderId: check._id }))!
    expect(quote).toMatchObject({ program: { externalId: "p-main" }, maxRedemption: 0 }) // no p-main account yet
    await t.run(async (ctx) => {
      const guest = (await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", "77011234567")).unique())!
      await ctx.db.insert("loyaltyAccounts", { externalId: "acc-guest", guestId: guest._id, programExternalId: "p-main", kind: "bonus", balance: 1000, reserved: 0, updatedAt: 0 })
    })
    expect((await t.query(loyalty.queries.quoteForPos, { sessionToken: cashier, orderId: check._id }))?.maxRedemption).toBe(1000) // min(1000, 50 % of 2300)
    await expect(t.mutation(loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: check._id, redemption: 1200 })).rejects.toThrow(/от 0 до 1000/)
    await t.mutation(loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: check._id, redemption: 300 })
    await expect(t.mutation(orders.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "x", payments: [{ method: "cash", amount: 2300 }] })).rejects.toThrow(/не равна/)
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "pay", payments: [{ method: "cash", amount: 2000 }] })
    const order = await t.run(async (ctx) => (await ctx.db.get(check._id))!)
    expect(order).toMatchObject({ loyaltyRedeemed: 300, loyaltyAccrued: 100, loyaltyProgramExternalId: "p-main" }) // 5 % of 2000
    const account = await t.run(async (ctx) => (await ctx.db.query("loyaltyAccounts").withIndex("by_guest_program", (q) => q.eq("guestId", order.guestId!).eq("programExternalId", "p-main")).unique())!)
    expect(account.balance).toBe(1000 - 300 + 100)
    const liability = await t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_external_id", (q) => q.eq("externalId", "loyalty:pay")).unique())
    expect(liability).toMatchObject({ debitAccountExternalId: "acc-3510", creditAccountExternalId: "acc-6010", amount: 300 })

    // Refund of half the money gives back half the redemption and takes half the accrual.
    await t.mutation(orders.refund, { sessionToken: cashier, orderId: check._id, idempotencyKey: "r", amount: 1000, method: "cash", reason: "Половина", managerApprovalToken: "m1" })
    const after = await t.run(async (ctx) => (await ctx.db.get(account._id))!)
    expect(after.balance).toBe(800 + 150 - 50)
  })

  it("a Shymkent program does not apply in Almaty; without any program the old 1 % accrual stays", async () => {
    const { t, productId } = await setup()
    await program(t, { restaurantExternalIds: ["shymkent"] })
    await guestWithPoints(t, 0)
    const check = await checkWithGuest(t, productId)
    expect((await t.query(loyalty.queries.quoteForPos, { sessionToken: cashier, orderId: check._id }))?.program).toBeNull()
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "pay", payments: [{ method: "card", amount: 2300 }] })
    const guest = await t.run(async (ctx) => (await ctx.db.query("guests").withIndex("by_phone", (q) => q.eq("phone", "77011234567")).unique())!)
    expect(guest.points).toBe(23)
  })

  it("POS search needs a session and masks phones", async () => {
    const { t } = await setup()
    await guestWithPoints(t, 10)
    await expect(t.query(loyalty.queries.searchForPos, { sessionToken: "nobody", query: "7701" })).rejects.toThrow()
    const [found] = await t.query(loyalty.queries.searchForPos, { sessionToken: cashier, query: "7701" })
    expect(found.phone).toBe("7701•••••67")
  })

  it("attaches a searched guest by id and pays a check fully with points", async () => {
    const { t, productId } = await setup()
    await program(t, { maxRedemptionPercent: 100 })
    const guestId = await guestWithPoints(t, 5000)
    await t.run((ctx) => ctx.db.insert("loyaltyAccounts", { externalId: "a", guestId, programExternalId: "p-main", kind: "bonus", balance: 5000, reserved: 0, updatedAt: 0 }))
    const check = await draft(t, productId) // 2300
    await t.mutation(loyalty.mutations.attachGuestToOrder, { sessionToken: cashier, orderId: check._id, guestId })
    expect((await t.query(loyalty.queries.quoteForPos, { sessionToken: cashier, orderId: check._id }))?.accrualPercent).toBe(5)
    await t.mutation(loyalty.mutations.setOrderRedemption, { sessionToken: cashier, orderId: check._id, redemption: 2300 })
    await t.mutation(orders.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "points", payments: [] })
    expect(await t.run(async (ctx) => (await ctx.db.get(check._id))!)).toMatchObject({ status: "paid", loyaltyRedeemed: 2300, loyaltyAccrued: 0 })
  })
})

