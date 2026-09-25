import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { calculateKzPayroll, RULES_2026 } from "../../convex/lib/payroll"
import { setup } from "./fixtures/pos"

const at = (local: string) => Date.parse(`${local}+05:00`)

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Кадры", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  const cashierId = await t.run(async (ctx) => (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!._id)
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), cashierId }
}

describe("positions, shift types, schedule (W2-HR-02/03/04)", () => {
  it("validates references and refuses overlapping shifts; copy and publish a week", async () => {
    const { t } = await setup()
    const { admin, cashierId } = await office(t)
    const position = await admin.mutation(api.domains.workforce.references.savePosition, { code: "CASH", name: "Кассир", payType: "hourly", defaultRate: 1500, weeklyHours: 40 })
    await t.run((ctx) => ctx.db.patch(cashierId, { positionExternalId: position }))
    await expect(admin.mutation(api.domains.workforce.references.setPositionActive, { externalId: position, active: false })).rejects.toThrow(/активные сотрудники/)
    await admin.mutation(api.domains.workforce.references.saveShiftType, { code: "N", name: "Ночь", startMinute: 22 * 60, endMinute: 6 * 60, breakMinutes: 30, nightCoefficient: 1.5, holidayCoefficient: 2, colorToken: "cat-meat" })
    expect((await admin.query(api.domains.workforce.references.listShiftTypes, {}))[0]).toMatchObject({ timeLabel: "22:00–06:00", hours: 7.5 })
    await expect(admin.mutation(api.domains.workforce.references.saveShiftType, { code: "X", name: "X", startMinute: 540, endMinute: 540, breakMinutes: 0, nightCoefficient: 1, holidayCoefficient: 1, colorToken: "cat-meat" })).rejects.toThrow(/совпадают/)

    const shift = { restaurantExternalId: "almaty", employeeId: cashierId, breakMinutes: 60 }
    await admin.mutation(api.domains.workforce.schedule.saveEntry, { ...shift, start: at("2026-09-28T09:00:00"), end: at("2026-09-28T19:00:00") })
    await expect(admin.mutation(api.domains.workforce.schedule.saveEntry, { ...shift, start: at("2026-09-28T18:00:00"), end: at("2026-09-28T23:00:00") })).rejects.toThrow(/пересекается/)
    for (const day of ["29", "30"]) await admin.mutation(api.domains.workforce.schedule.saveEntry, { ...shift, start: at(`2026-09-${day}T09:00:00`), end: at(`2026-09-${day}T23:00:00`) })
    for (const day of ["01", "02"]) await admin.mutation(api.domains.workforce.schedule.saveEntry, { ...shift, start: at(`2026-10-${day}T09:00:00`), end: at(`2026-10-${day}T19:00:00`) })
    const week = await admin.query(api.domains.workforce.schedule.scheduleWeek, { restaurantExternalId: "almaty", weekStart: "2026-09-28" })
    const [row] = week.rows
    expect(row).toMatchObject({ plannedHours: 9 + 13 + 13 + 9 + 9, weeklyNorm: 40, overNorm: true })
    expect(await admin.mutation(api.domains.workforce.schedule.copyWeek, { restaurantExternalId: "almaty", fromWeekStart: "2026-09-28", toWeekStart: "2026-10-05" })).toEqual({ copied: 5, skipped: 0 })
    expect(await admin.mutation(api.domains.workforce.schedule.publishWeek, { restaurantExternalId: "almaty", weekStart: "2026-09-28" })).toEqual({ published: 5 })
  })
})

describe("payroll KZ (W2-HR-06)", () => {
  it("matches the bahandi fixture", () => {
    expect(calculateKzPayroll(500_000, true, RULES_2026)).toMatchObject({ opv: 50_000, vosms: 10_000, ipn: 31_025, net: 408_975, employeeTaxes: 91_025 })
    expect(calculateKzPayroll(500_000, false, RULES_2026, 8_500 * 4_325).ipn).toBe(66_000)
  })

  it("calculates from attendance, posts taxes as separate obligations, pays out, refuses reversal after a payout", async () => {
    const { t } = await setup()
    await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
    const { admin, cashierId } = await office(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(cashierId, { payType: "hourly", baseRate: 2000 })
      await ctx.db.insert("attendanceRecords", { externalId: "a1", number: "ЯВ-1", employeeId: cashierId, employeeCode: "101", employeeName: "Кассир", organizationExternalId: "sandyq", restaurantExternalId: "almaty", businessDate: "2026-08-10", status: "approved", clockIn: 0, clockOut: 1, breakMinutes: 0, hours: 160, attendanceType: "worked", source: "office", version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
    })
    await expect(admin.mutation(api.domains.workforce.payroll.calculatePayroll, { restaurantExternalId: "almaty", from: "2026-08-01", to: "2026-08-31" })).rejects.toThrow(/правил/)
    await t.mutation(internal.domains.workforce.payroll.seedRules2026, {})
    await admin.mutation(api.domains.workforce.payroll.activateRules, { externalId: "payroll-rules-kz-2026" })
    await admin.mutation(api.domains.workforce.payroll.saveAdjustment, { restaurantExternalId: "almaty", employeeId: cashierId, businessDate: "2026-08-20", kind: "bonus", amount: 20_000, comment: "План продаж" })
    const { externalId, totals } = await admin.mutation(api.domains.workforce.payroll.calculatePayroll, { restaurantExternalId: "almaty", from: "2026-08-01", to: "2026-08-31" })
    const expected = calculateKzPayroll(340_000, true, RULES_2026)
    expect(totals).toMatchObject({ gross: 340_000, net: expected.net, employerTaxes: expected.employerTaxes })
    await admin.mutation(api.domains.workforce.payroll.postPayroll, { externalId })
    const taxes = await t.run((ctx) => ctx.db.query("financeRecords").withIndex("by_module_status_date", (q) => q.eq("moduleId", "accounts-payable")).take(10))
    expect(taxes.map((row) => [row.data.obligationKind, row.amount, row.data.dueDate]).sort()).toEqual(
      [["tax", expected.ipn, "2026-09-25"], ["tax", expected.opv + expected.opvr, "2026-09-25"], ["tax", expected.vosms + expected.oosms, "2026-09-25"], ["tax", expected.socialContribution, "2026-09-25"], ["tax", expected.socialTax, "2026-09-25"]].sort(),
    )
    const run = (await admin.query(api.domains.workforce.payroll.getRun, { externalId }))!
    const debit = run.entries.reduce((sum, row) => sum + (row.debitAccountExternalId === "acc-7212" ? row.amount : 0), 0)
    expect(debit).toBe(expected.employerTaxes)
    expect(await admin.mutation(api.domains.workforce.payroll.createPayout, { runExternalId: externalId, method: "bank", lines: [{ employeeCode: "101", amount: 100_000 }] })).toEqual({ amount: 100_000, left: expected.net - 100_000 })
    await expect(admin.mutation(api.domains.workforce.payroll.reversePayroll, { externalId, reason: "Ошибка ставки" })).rejects.toThrow(/выплаты/)
  })
})
