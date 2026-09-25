import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { calculateKzPayroll, RULES_2026 } from "../../convex/lib/payroll"
import { setup } from "./fixtures/pos"

// W2-RPT-07: employees-02 «Сводный отчёт по зарплате» — the payroll runs of the period, checked
// against calculateKzPayroll on the bahandi fixture, behind office.payroll.view.

const config = { dateFrom: "2026-08-01", dateTo: "2026-08-31", restaurantExternalIds: [] }

describe("payroll summary (W2-RPT-07)", () => {
  it("sums the posted run per employee as calculateKzPayroll does; drafts on request; needs office.payroll.view", async () => {
    const { t } = await setup()
    const { cashierId, managerId } = await t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Кадры", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
      await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "analyst", email: "analyst@sandyq.test", name: "Аналитик", roleExternalId: "analyst", restaurantScopes: ["*"], active: true })
      const cashierId = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!._id
      const managerId = (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "900")).unique())!._id
      await ctx.db.patch(cashierId, { payType: "hourly", baseRate: 2000 })
      await ctx.db.patch(managerId, { payType: "salary", baseRate: 500_000 })
      await ctx.db.insert("attendanceRecords", { externalId: "a1", number: "ЯВ-1", employeeId: cashierId, employeeCode: "101", employeeName: "Кассир", organizationExternalId: "sandyq", restaurantExternalId: "almaty", businessDate: "2026-08-10", status: "approved", clockIn: 0, clockOut: 1, breakMinutes: 0, hours: 160, attendanceType: "worked", source: "office", version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
      return { cashierId, managerId }
    })
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const analyst = t.withIdentity({ email: "analyst@sandyq.test" })
    await t.mutation(internal.domains.workforce.payroll.seedRules2026, {})
    await admin.mutation(api.domains.workforce.payroll.activateRules, { externalId: "payroll-rules-kz-2026" })
    await admin.mutation(api.domains.workforce.payroll.saveAdjustment, { restaurantExternalId: "almaty", employeeId: cashierId, businessDate: "2026-08-20", kind: "bonus", amount: 20_000, comment: "План продаж" })
    await admin.mutation(api.domains.workforce.payroll.saveAdjustment, { restaurantExternalId: "almaty", employeeId: managerId, businessDate: "2026-08-15", kind: "advance", amount: 100_000, comment: "Аванс" })
    const { externalId } = await admin.mutation(api.domains.workforce.payroll.calculatePayroll, { restaurantExternalId: "almaty", from: "2026-08-01", to: "2026-08-31" })

    const execute = (reportId: string, extra?: Record<string, boolean>) => admin.query(api.domains.reports.queries.execute, { reportId, config: { ...config, ...(extra ? { extra } : {}) } })
    expect((await execute("employees-02")).rows).toEqual([]) // a draft is not a payroll yet
    expect((await execute("employees-02", { includeDrafts: true })).rows).toHaveLength(2)
    await admin.mutation(api.domains.workforce.payroll.postPayroll, { externalId })

    const report = await execute("employees-02")
    const cashier = calculateKzPayroll(160 * 2000 + 20_000, true, RULES_2026) // the bahandi fixture: 340 000
    const manager = calculateKzPayroll(500_000, true, RULES_2026)
    expect(manager).toMatchObject({ opv: 50_000, vosms: 10_000, ipn: 31_025, net: 408_975 })
    const cells = Object.fromEntries(report.rows.map((row) => [row.key, row.cells]))
    for (const [code, name, gross, taxes, advances] of [["101", "Кассир", 340_000, cashier, 0], ["900", "Менеджер", 500_000, manager, 100_000]] as const) {
      expect(cells[code]).toMatchObject({
        group: name, gross, opv: taxes.opv, vosms: taxes.vosms, ipn: taxes.ipn, withheld: taxes.employeeTaxes, advances, toPay: taxes.net - advances,
        socialContribution: taxes.socialContribution, socialTax: taxes.socialTax, oosms: taxes.oosms, opvr: taxes.opvr, employerTaxes: taxes.employerTaxes,
      })
    }
    expect(report.rows[0].key).toBe("900") // sorted by gross
    expect(report.totals).toMatchObject({ gross: 840_000, toPay: cashier.net + manager.net - 100_000, employerTaxes: cashier.employerTaxes + manager.employerTaxes })
    const run = (await t.run((ctx) => ctx.db.query("payrollRuns").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique()))!
    expect(report.totals.toPay).toBe(run.totals.toPay)
    expect(report.kpis.find((kpi) => kpi.key === "runs")?.value).toBe(1)
    expect((await admin.query(api.domains.reports.queries.execute, { reportId: "employees-02", config: { ...config, search: "касс" } })).rows.map((row) => row.key)).toEqual(["101"])

    // office.reports.view alone is not enough for salaries.
    await expect(analyst.query(api.domains.reports.queries.execute, { reportId: "employees-02", config })).rejects.toThrow(/Недостаточно прав/)
    expect((await analyst.query(api.domains.reports.queries.execute, { reportId: "sales-01", config })).rows).toEqual([])

    await t.run((ctx) => ctx.db.patch(run._id, { status: "reversed" }))
    expect((await execute("employees-02")).rows).toEqual([]) // a reversed run never counts
  })
})
