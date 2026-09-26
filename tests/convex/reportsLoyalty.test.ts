import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { quintileScores, rfmSegment } from "../../convex/domains/reports/calculators/loyalty"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

// W3-RPT-04: the 14 guest and loyalty reports on a synthetic guest base — visits from the `guest` facts,
// RFM quintiles, balances by transactions, deposits, program and campaign effectiveness, consents,
// mailings, Г-11 statuses; personal data masked without office.guests.pii (Г-2).

type T = TestConvex<typeof schema>
const AUGUST = { dateFrom: "2026-08-01", dateTo: "2026-08-31", restaurantExternalIds: ["almaty"] }
const at = (date: string, hour = 6) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`)
const ZERO = { orderCount: 0, guestCount: 0, quantity: 0, grossAmount: 0, discountAmount: 0, serviceChargeAmount: 0, netAmount: 0, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 }

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "analyst", email: "analyst@sandyq.test", name: "Аналитик", roleExternalId: "analyst", restaurantScopes: ["*"], active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  const analyst = t.withIdentity({ email: "analyst@sandyq.test" })
  const run = (who: typeof admin, reportId: string, config: Partial<typeof AUGUST> & { extra?: Record<string, string | number | boolean>; search?: string } = {}) => who.query(api.domains.reports.queries.execute, { reportId, config: { ...AUGUST, ...config } })
  return { admin, analyst, run }
}

/**
 * Five guests of «Алматы» with one guest fact each (visits on their last day): g1 10 visits 50 000 ₸ on
 * 31.08 … g5 1 visit 1 000 ₸ on 01.08 (and a visit in July, so g5 is returning). Guests of «Астана» and
 * without a home restaurant sit outside the «Алматы» scope. Branch: 40 checks, 150 000 ₸.
 */
async function guestBase(t: T) {
  return t.run(async (ctx) => {
    await ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true })
    const spec = [
      { name: "Айгерим", phone: "77011112233", last: "2026-08-31", visits: 10, revenue: 50_000 },
      { name: "Болат", phone: "77012223344", last: "2026-08-30", visits: 6, revenue: 30_000 },
      { name: "Динара", phone: "77013334455", last: "2026-08-20", visits: 3, revenue: 9_000 },
      { name: "Ержан", phone: "77014445566", last: "2026-08-10", visits: 2, revenue: 4_000 },
      { name: "Жанна", phone: "77015556677", last: "2026-08-01", visits: 1, revenue: 1_000 },
    ]
    const ids: Id<"guests">[] = []
    for (const guest of spec) {
      const id = await ctx.db.insert("guests", { phone: guest.phone, name: guest.name, points: 0, createdAt: at("2026-01-01"), status: "active", restaurantExternalId: "almaty", consentState: "granted" })
      ids.push(id)
      await ctx.db.insert("dailySalesFacts", { ...ZERO, restaurantExternalId: "almaty", businessDate: guest.last, factType: "guest", dimensionKey: id, dimensionLabel: "Гость", orderCount: guest.visits, guestCount: guest.visits, netAmount: guest.revenue })
    }
    await ctx.db.insert("dailySalesFacts", { ...ZERO, restaurantExternalId: "almaty", businessDate: "2026-07-15", factType: "guest", dimensionKey: ids[4], dimensionLabel: "Гость", orderCount: 1, netAmount: 700 })
    await ctx.db.insert("dailySalesFacts", { ...ZERO, restaurantExternalId: "almaty", businessDate: "2026-08-15", factType: "branch", dimensionKey: "almaty", dimensionLabel: "Алматы", orderCount: 40, netAmount: 150_000 })
    const astana = await ctx.db.insert("guests", { phone: "77019990000", name: "Гость Астаны", points: 0, createdAt: at("2026-01-01"), status: "active", restaurantExternalId: "astana" })
    const homeless = await ctx.db.insert("guests", { phone: "77018880000", name: "Без ресторана", points: 0, createdAt: at("2026-01-01"), status: "active" })
    return { ids, astana, homeless }
  })
}

describe("guest visit reports (W3-RPT-04: loyalty-01…04)", () => {
  it("a checkout with a guest writes a guest fact; loyalty-01 masks the phone without office.guests.pii", async () => {
    const { t, productId } = await setup()
    const { admin, analyst, run } = await office(t)
    const check = await draft(t, productId) // 2300
    await t.mutation(api.domains.loyalty.mutations.attachGuestToOrder, { sessionToken: cashier, orderId: check._id, phone: "+7 701 123 45 67", name: "Асель" })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: check._id, idempotencyKey: "pay", payments: [{ method: "cash", amount: 2300 }] })
    const order = (await t.run((ctx) => ctx.db.get(check._id)))!
    const facts = await t.run((ctx) => ctx.db.query("dailySalesFacts").withIndex("by_restaurant_type_date", (q) => q.eq("restaurantExternalId", "almaty").eq("factType", "guest")).collect())
    expect(facts).toMatchObject([{ dimensionKey: order.guestId, dimensionLabel: "Гость", orderCount: 1, netAmount: 2300 }])

    const period = { dateFrom: order.businessDate!, dateTo: order.businessDate! }
    const full = await run(admin, "loyalty-01", period)
    expect(full.rows).toEqual([{ key: order.guestId, cells: { group: "Асель", phone: "77011234567", visits: 1, revenue: 2300, averageCheck: 2300, firstVisit: order.businessDate, lastVisit: order.businessDate } }])
    const masked = await run(analyst, "loyalty-01", period)
    expect(masked.rows[0].cells.phone).toBe("7701•••••67")
    expect(JSON.stringify(masked)).not.toContain("1234567")
  })

  it("new and returning, frequency buckets and RFM quintiles on the fixture", async () => {
    const { t } = await setup()
    const { admin, run } = await office(t)
    const { ids } = await guestBase(t)

    const activity = await run(admin, "loyalty-01")
    expect(activity.rows.map((row) => row.cells.group)).toEqual(["Айгерим", "Болат", "Динара", "Ержан", "Жанна"])
    expect(activity.totals).toEqual({ visits: 22, revenue: 94_000 })

    const returning = await run(admin, "loyalty-02")
    expect(returning.rows.map((row) => [row.key, row.cells.guests, row.cells.visits, row.cells.revenue])).toEqual([["new", 4, 21, 93_000], ["returning", 1, 1, 1_000]])
    expect(returning.kpis.find((kpi) => kpi.key === "returningShare")?.value).toBe(20)

    const frequency = await run(admin, "loyalty-03")
    expect(frequency.rows.map((row) => [row.cells.group, row.cells.guests])).toEqual([["1 визит", 1], ["2 визита", 1], ["3–4 визита", 1], ["5–9 визитов", 1], ["10 и более", 1]])

    expect(quintileScores([10, 10, 5], "high")).toEqual([2, 2, 1])
    expect(quintileScores([0, 30, 11], "low")).toEqual([4, 1, 2])
    expect(rfmSegment(5, 1)).toBe("Новые")
    const detail = await run(admin, "loyalty-04", { extra: { detail: true } })
    expect(detail.rows.map((row) => [row.key, row.cells.recencyDays, row.cells.code, row.cells.segment])).toEqual([
      [ids[0], 0, "555", "Чемпионы"],
      [ids[1], 1, "444", "Чемпионы"],
      [ids[2], 11, "333", "Лояльные"],
      [ids[3], 21, "222", "Спящие"],
      [ids[4], 30, "111", "Спящие"],
    ])
    const segments = await run(admin, "loyalty-04")
    expect(segments.rows.map((row) => [row.cells.group, row.cells.guests, row.cells.revenue])).toEqual([["Чемпионы", 2, 80_000], ["Лояльные", 1, 9_000], ["Спящие", 2, 5_000]])
  })
})

describe("accounts, programs and campaigns (W3-RPT-04: loyalty-05, 08, 09, 10, 13)", () => {
  it("balances at the dates with scope, deposit operations, program effectiveness, campaign attribution, categories", async () => {
    const { t } = await setup()
    const { admin, analyst, run } = await office(t)
    const { ids, astana, homeless } = await guestBase(t)
    await t.run(async (ctx) => {
      const program = { accrualPercent: 5, maxRedemptionPercent: 30, welcomeBonus: 0, startsAt: 0, restaurantExternalIds: ["*"], createdAt: 0, updatedAt: 0 }
      await ctx.db.insert("loyaltyPrograms", { ...program, externalId: "p-main", name: "Основная", status: "published", programKind: "bonus", priority: 1 })
      await ctx.db.insert("loyaltyPrograms", { ...program, externalId: "p-dep", name: "Депозит", status: "published", programKind: "deposit", priority: 2 })
      const account = async (guestId: Id<"guests">, programExternalId: string, kind: "bonus" | "deposit", balance: number, moves: [string, Doc<"loyaltyTransactions">["kind"], number, number][]) => {
        const accountId = await ctx.db.insert("loyaltyAccounts", { externalId: `${programExternalId}:${guestId}`, guestId, programExternalId, kind, balance, reserved: 0, updatedAt: 0 })
        for (const [date, txKind, points, balanceAfter] of moves) await ctx.db.insert("loyaltyTransactions", { guestId, kind: txKind, points, balanceAfter, occurredAt: at(date), accountId, programExternalId })
      }
      await account(ids[0], "p-main", "bonus", 600, [["2026-07-20", "accrual", 500, 500], ["2026-08-10", "accrual", 300, 800], ["2026-09-05", "redemption", -200, 600]])
      await account(ids[0], "p-dep", "deposit", 7_500, [["2026-08-05", "accrual", 10_000, 10_000], ["2026-08-06", "redemption", -2_500, 7_500], ["2026-08-06", "reservation", 0, 7_500]])
      await account(astana, "p-main", "bonus", 900, [["2026-08-02", "accrual", 900, 900]])
      await account(homeless, "p-main", "bonus", 400, []) // migrated balance without transactions
      // Points on a check of «Алматы»: accrued 2 500, redeemed 1 000.
      const restaurant = (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!
      const orderId = await ctx.db.insert("orders", { number: 1, orderType: "dine-in", status: "paid", discountPercent: 0, subtotal: 0, serviceChargePercent: 0, serviceChargeAmount: 0, total: 0, createdAt: at("2026-08-31"), searchText: "", restaurantId: restaurant._id, guestId: ids[0] })
      await ctx.db.insert("loyaltyTransactions", { guestId: ids[0], kind: "accrual", points: 2_500, balanceAfter: 0, occurredAt: at("2026-08-31"), orderId, programExternalId: "p-main" })
      await ctx.db.insert("loyaltyTransactions", { guestId: ids[0], kind: "redemption", points: -1_000, balanceAfter: 0, occurredAt: at("2026-08-31"), orderId, programExternalId: "p-main" })
      await ctx.db.insert("guestCategories", { externalId: "vip", code: "VIP", name: "VIP", color: "gold", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 365, active: true, createdAt: 0, updatedAt: 0 })
      await ctx.db.patch(ids[0], { categoryExternalIds: ["vip"] })
      await ctx.db.patch(ids[1], { categoryExternalIds: ["vip"] })
      // Campaign sends: g1 completed on 25.08 (visits on 31.08 — within 7 days), g2 completed on 01.08
      // (next visit on 30.08 — outside), g3 in dead-letter.
      const job = (guestId: Id<"guests">, status: Doc<"integrationJobs">["status"], date: string, error?: string) =>
        ctx.db.insert("integrationJobs", { externalId: `job-${guestId}`, provider: "messaging", direction: "outbound", operation: "send-campaign", sourceExternalId: "cmp-1", idempotencyKey: `campaign:cmp-1:${guestId}:sms`, status, attempts: 1, payload: { campaignExternalId: "cmp-1", guestId, channel: "sms", template: "Скидка 10 %" }, error, nextAttemptAt: at(date), createdAt: at(date), updatedAt: at(date, 8) })
      await job(ids[0], "completed", "2026-08-25")
      await job(ids[1], "completed", "2026-08-01")
      await job(ids[2], "dead-letter", "2026-08-25", "Провайдер не подключён")
      await ctx.db.insert("integrationJobs", { externalId: "job-mail", provider: "messaging", direction: "outbound", operation: "send-campaign", sourceExternalId: "cmp-2", idempotencyKey: `campaign:cmp-2:${ids[3]}:email`, status: "queued", attempts: 0, payload: { campaignExternalId: "cmp-2", guestId: ids[3], channel: "email" }, nextAttemptAt: at("2026-08-26"), createdAt: at("2026-08-26"), updatedAt: at("2026-08-26") })
    })

    const balances = await run(analyst, "loyalty-05")
    expect(balances.rows.map((row) => [row.cells.group, row.cells.program, row.cells.opening, row.cells.change, row.cells.closing])).toEqual([["Айгерим", "Депозит", 0, 7_500, 7_500], ["Айгерим", "Основная", 500, 300, 800]])
    expect(balances.rows[0].cells.phone).toBe("7701•••••33")
    expect(balances.kpis.find((kpi) => kpi.key === "deposit")?.value).toBe(7_500)
    // The whole network adds the guest of «Астана» and the guest without a home restaurant (stored balance).
    const network = await run(admin, "loyalty-05", { restaurantExternalIds: [] })
    expect(network.rows.map((row) => [row.cells.group, row.cells.closing])).toEqual([["Айгерим", 7_500], ["Гость Астаны", 900], ["Айгерим", 800], ["Без ресторана", 400]])

    const deposits = await run(admin, "loyalty-08")
    expect(deposits.rows.map((row) => [row.cells.group, row.cells.count, row.cells.incoming, row.cells.outgoing])).toEqual([["Пополнение", 1, 10_000, 0], ["Оплата депозитом", 1, 0, 2_500]])
    expect(deposits.kpis.find((kpi) => kpi.key === "closing")?.value).toBe(7_500)

    const programs = await run(admin, "loyalty-09")
    expect(programs.rows.map((row) => [row.key, row.cells.participants, row.cells.orders, row.cells.revenue, row.cells.accrued, row.cells.redeemed, row.cells.bonusCost])).toEqual([
      ["p-main", 1, 10, 50_000, 2_500, 1_000, 2],
      ["no-program", 4, 12, 44_000, 0, 0, 0],
      ["non-participants", 0, 18, 56_000, 0, 0, 0],
    ])
    expect(programs.kpis.find((kpi) => kpi.key === "participantShare")?.value).toBe(62.7)

    // Campaigns are network-level (no restaurant in the job): the report needs the whole network.
    expect((await run(admin, "loyalty-10")).rows).toEqual([])
    const campaigns = await run(admin, "loyalty-10", { restaurantExternalIds: [] })
    expect(campaigns.rows.map((row) => row.cells)).toEqual([
      { group: "cmp-1", channel: "SMS", sent: 2, failed: 1, converted: 1, conversion: 50, visits: 10, revenue: 50_000 },
      { group: "cmp-2", channel: "Email", sent: 0, failed: 0, converted: 0, conversion: 0, visits: 0, revenue: 0 },
    ])

    const sms = await run(admin, "loyalty-15", { restaurantExternalIds: [] })
    expect(sms.totals).toMatchObject({ total: 3, sent: 2, failed: 1, pending: 0 })
    expect(JSON.stringify(sms)).not.toMatch(/7701/)
    const email = await run(admin, "loyalty-16", { restaurantExternalIds: [] })
    expect(email.totals).toMatchObject({ total: 1, pending: 1, sent: 0 })
    // Mailings are network-level: a report on one restaurant does not show them.
    expect((await run(admin, "loyalty-15")).rows).toEqual([])

    const categories = await run(admin, "loyalty-13")
    expect(categories.rows.map((row) => [row.key, row.cells.guests, row.cells.active, row.cells.visits, row.cells.revenue])).toEqual([["none", 3, 3, 6, 14_000], ["vip", 2, 2, 16, 80_000]])
    expect(categories.totals).toMatchObject({ guests: 5, active: 5 })
  })
})

describe("consents and Г-11 statuses (W3-RPT-04: loyalty-11, 12, 14)", () => {
  it("counts the last consent per channel at the end date; coupons and referrals say the mechanic is off", async () => {
    const { t } = await setup()
    const { admin, run } = await office(t)
    const { ids } = await guestBase(t)
    await t.run(async (ctx) => {
      const consent = (guestId: Id<"guests">, channel: Doc<"guestConsents">["channel"], granted: boolean, date: string, validUntil?: string) => ctx.db.insert("guestConsents", { guestId, channel, granted, source: "office", actorKey: "admin@sandyq.test", recordedAt: at(date), validUntil: validUntil ? at(validUntil) : undefined })
      await consent(ids[0], "sms", true, "2026-08-01")
      await consent(ids[0], "email", true, "2026-08-01")
      await consent(ids[0], "email", false, "2026-08-20")
      await consent(ids[0], "personal-data", true, "2026-08-01")
      await consent(ids[1], "sms", true, "2026-08-01", "2026-08-15")
      await consent(ids[2], "sms", false, "2026-09-10") // after the end date — not counted yet
      await ctx.db.patch(ids[4], { consentState: "unknown" })
    })
    const report = await run(admin, "loyalty-14")
    const cells = Object.fromEntries(report.rows.map((row) => [row.key, row.cells]))
    expect(cells.sms).toMatchObject({ granted: 1, withdrawn: 0, expired: 1, missing: 3, grantedShare: 20 })
    expect(cells.email).toMatchObject({ granted: 0, withdrawn: 1, expired: 0, missing: 4 })
    expect(cells["personal-data"]).toMatchObject({ granted: 1, missing: 4 })
    expect(report.kpis.find((kpi) => kpi.key === "unknown")?.value).toBe(1)

    for (const reportId of ["loyalty-11", "loyalty-12"]) {
      const status = await run(admin, reportId)
      expect(status.sourceLabel).toMatch(/^Недоступно: механика выключена/)
      expect(status.rows).toEqual([])
    }
  })
})
