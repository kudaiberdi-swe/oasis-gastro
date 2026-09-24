import type { TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { REPORT_CATALOG } from "../../convex/domains/reports/catalog"
import { REPORT_REGISTRY } from "../../convex/domains/reports/registry"
import schema from "../../convex/schema"
import { cashier, draft, setup } from "./fixtures/pos"

type T = TestConvex<typeof schema>
const facts = (t: T) => t.run((ctx) => ctx.db.query("dailySalesFacts").take(200))
const strip = (rows: Awaited<ReturnType<typeof facts>>) => rows.map(({ _id, _creationTime, updatedAt, ...rest }) => rest).sort((a, b) => `${a.factType}${a.dimensionKey}`.localeCompare(`${b.factType}${b.dimensionKey}`))

async function office(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "none", name: "Без отчётов", capabilities: ["office.guests.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "x", email: "x@sandyq.test", name: "Гость", roleExternalId: "none", restaurantScopes: ["almaty"], active: true })
    await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик филиала", capabilities: ["office.reports.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "b", email: "b@sandyq.test", name: "Филиал", roleExternalId: "analyst", restaurantScopes: ["almaty"], active: true })
  })
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), stranger: t.withIdentity({ email: "x@sandyq.test" }), branch: t.withIdentity({ email: "b@sandyq.test" }) }
}

describe("report catalog and registry (W1-RPT-01)", () => {
  it("has the 190 reports in 10 families; every calculator belongs to the catalog", () => {
    expect(new Set(REPORT_CATALOG.map((report) => report.id)).size).toBe(190)
    const sizes = ["sales", "stock", "menu", "finance", "employees", "production", "delivery", "loyalty", "chain", "integrations"].map((family) => REPORT_CATALOG.filter((report) => report.family === family).length)
    expect(sizes).toEqual([29, 28, 15, 22, 15, 15, 23, 16, 12, 15])
    for (const id of Object.keys(REPORT_REGISTRY)) expect(REPORT_CATALOG.some((report) => report.id === id)).toBe(true)
  })

  it("execute: rights, scope, in development, a year at most; coverage counts calculators", async () => {
    const { t } = await setup()
    const { admin, stranger, branch } = await office(t)
    const config = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] }
    await expect(stranger.query(api.domains.reports.queries.execute, { reportId: "sales-01", config })).rejects.toThrow(/Недостаточно прав/)
    await expect(admin.query(api.domains.reports.queries.execute, { reportId: "stock-05", config })).rejects.toThrow(/в разработке/)
    await expect(admin.query(api.domains.reports.queries.execute, { reportId: "sales-01", config: { ...config, dateFrom: "2025-01-01" } })).rejects.toThrow(/года/)
    await expect(branch.query(api.domains.reports.queries.execute, { reportId: "sales-01", config: { ...config, restaurantExternalIds: ["shymkent"] } })).rejects.toThrow(/Нет доступа/)
    expect((await branch.query(api.domains.reports.queries.execute, { reportId: "sales-01", config: { ...config, restaurantExternalIds: ["almaty"] } })).rows).toEqual([])
    const coverage = await admin.query(api.domains.reports.queries.coverage, {})
    expect(coverage).toMatchObject({ total: 190, implemented: Object.keys(REPORT_REGISTRY).length, notApplicableKz: 3 })
  })
})

describe("daily sales facts (W1-RPT-02)", () => {
  it("two checks feed the facts once; a refund is netted; rebuild gives the same numbers; reports read them", async () => {
    const { t, productId } = await setup()
    const { admin } = await office(t)
    const one = await draft(t, productId) // 2 × 1000 + 15 %
    const two = await draft(t, productId, 1)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: one._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: one._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: two._id, idempotencyKey: "p2", payments: [{ method: "card", amount: 1150 }] })
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: one._id, idempotencyKey: "r1", amount: 690, method: "cash", reason: "Остыло", managerApprovalToken: "m1" })

    const incremental = await facts(t)
    const branch = incremental.find((row) => row.factType === "branch")!
    expect(branch).toMatchObject({ orderCount: 2, netAmount: 3450, serviceChargeAmount: 450, refundAmount: 690, refundCount: 1, quantity: 3 })
    expect(incremental.filter((row) => row.factType === "payment-type").map((row) => [row.dimensionKey, row.netAmount, row.refundAmount]).sort()).toEqual([["payment-type-card", 1150, 0], ["payment-type-cash", 2300, 690]])
    expect(incremental.find((row) => row.factType === "product")).toMatchObject({ quantity: 3, netAmount: 3450 })

    const date = branch.businessDate
    await t.mutation(internal.domains.reports.internal.rebuildDailySalesFacts, { restaurantExternalId: "almaty", businessDate: date })
    expect(strip(await facts(t))).toEqual(strip(incremental))
    expect((await t.mutation(internal.domains.reports.internal.backfillDailySalesFacts, { paginationOpts: { numItems: 100, cursor: null }, dryRun: true })).pending).toBe(0)

    const byDay = await admin.query(api.domains.reports.queries.execute, { reportId: "sales-01", config: { dateFrom: date, dateTo: date, restaurantExternalIds: [] } })
    expect(byDay.rows[0].cells).toMatchObject({ orderCount: 2, netAmount: 3450, refundAmount: 690, averageCheck: 1725 })
    expect(byDay.kpis.find((kpi) => kpi.key === "netOfRefunds")?.value).toBe(2760)
    const dashboard = await admin.query(api.domains.reports.queries.dashboardSummary, { restaurantExternalIds: [], dateFrom: date, dateTo: date })
    expect(dashboard).toMatchObject({ revenue: 2760, orders: 2, averageCheck: 1725 })
  })

  it("the backfill replays orders sold before the facts existed", async () => {
    const { t, productId } = await setup()
    const one = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: one._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("dailySalesFacts").take(100)) await ctx.db.delete(row._id)
      for (const row of await ctx.db.query("reportFactEvents").take(100)) await ctx.db.delete(row._id)
    })
    const args = { paginationOpts: { numItems: 100, cursor: null } }
    expect((await t.mutation(internal.domains.reports.internal.backfillDailySalesFacts, { ...args, dryRun: true })).pending).toBe(1)
    expect(await facts(t)).toHaveLength(0)
    await t.mutation(internal.domains.reports.internal.backfillDailySalesFacts, args)
    expect((await facts(t)).find((row) => row.factType === "branch")?.netAmount).toBe(2300)
  })
})

describe("W1 report calculators (W1-RPT-06/07/08)", () => {
  it("every implemented report runs on real data; P&L, cash flow and timesheet add up", async () => {
    const { t, productId } = await setup()
    const { admin } = await office(t)
    const one = await draft(t, productId)
    await t.mutation(api.domains.orders.mutations.checkout, { sessionToken: cashier, orderId: one._id, idempotencyKey: "p1", payments: [{ method: "cash", amount: 2300 }] })
    await t.mutation(api.domains.orders.mutations.refund, { sessionToken: cashier, orderId: one._id, idempotencyKey: "r1", amount: 300, method: "cash", reason: "Остыло", managerApprovalToken: "m1" })
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 2000, note: "" })
    const date = (await facts(t)).find((row) => row.factType === "branch")!.businessDate
    const config = { dateFrom: date, dateTo: date, restaurantExternalIds: [] }
    for (const reportId of Object.keys(REPORT_REGISTRY)) {
      const result = await admin.query(api.domains.reports.queries.execute, { reportId, config })
      expect(result.columns.length, reportId).toBeGreaterThan(0)
    }
    const pnl = await admin.query(api.domains.reports.queries.execute, { reportId: "finance-02", config })
    expect(pnl.rows.find((row) => row.key === "net-revenue")?.cells.amount).toBe(2300 - 300)
    const flow = await admin.query(api.domains.reports.queries.execute, { reportId: "finance-03", config })
    expect(flow.rows[0].cells).toMatchObject({ incoming: 2300, outgoing: 300, net: 2000 })
    const timesheet = await admin.query(api.domains.reports.queries.execute, { reportId: "employees-03", config })
    expect(timesheet.rows).toHaveLength(1)
    const shiftsReport = await admin.query(api.domains.reports.queries.execute, { reportId: "sales-27", config })
    expect(shiftsReport.rows[0].cells).toMatchObject({ expected: 2000, counted: 2000, variance: 0, status: "Закрыта" })
  })
})

