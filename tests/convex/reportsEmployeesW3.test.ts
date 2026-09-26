import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { REPORT_REGISTRY } from "../../convex/domains/reports/registry"
import type { ReportConfig } from "../../convex/lib/reportConfig"
import schema from "../../convex/schema"

// W3-RPT-01: the other employee reports on one synthetic September — a published schedule, attendance
// with a late arrival, an early leave, a missed and an unscheduled shift, sales facts in two
// restaurants, a posted payroll run with a payout, a bonus, a penalty and an advance.

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:00`)
const SEPTEMBER: ReportConfig = { dateFrom: "2026-09-01", dateTo: "2026-09-30", restaurantExternalIds: [] }

async function workforce() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const almaty = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    const shymkent = await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("positions", { externalId: "pos-cashier", code: "01", name: "Кассир", payType: "hourly", defaultRate: 2000, weeklyHours: 40, active: true, version: 1, createdAt: 0, updatedAt: 0 })
    await ctx.db.insert("shiftTypes", { externalId: "day", code: "Д", name: "Дневная", startMinute: 540, endMinute: 1260, breakMinutes: 60, nightCoefficient: 1, holidayCoefficient: 1, colorToken: "cat-1", active: true, version: 1, createdAt: 0, updatedAt: 0 })
    const base = { pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0, role: "cashier" as const }
    const aigerim = await ctx.db.insert("employees", { ...base, code: "101", displayName: "Айгерим", restaurantIds: [almaty], positionExternalId: "pos-cashier", iin: "900101300123" })
    const bauyrzhan = await ctx.db.insert("employees", { ...base, code: "102", displayName: "Бауыржан", restaurantIds: [shymkent] })
    for (const [day, status] of [["01", "published"], ["02", "published"], ["03", "published"], ["05", "draft"]] as const) {
      const date = `2026-09-${day}`
      await ctx.db.insert("scheduleEntries", { externalId: `s-${day}`, employeeId: aigerim, employeeCode: "101", employeeName: "Айгерим", restaurantExternalId: "almaty", businessDate: date, shiftTypeExternalId: "day", start: at(date, "09:00"), end: at(date, "21:00"), breakMinutes: 60, plannedHours: 11, status, version: 1, createdAt: 0, updatedAt: 0 })
    }
    const attendance = async (externalId: string, who: { id: typeof aigerim; code: string; name: string; restaurant: string }, date: string, clockIn: string, clockOut: string, hours: number, status: "completed" | "approved" | "cancelled") => {
      await ctx.db.insert("attendanceRecords", { externalId, number: `ЯВ-${externalId}`, employeeId: who.id, employeeCode: who.code, employeeName: who.name, organizationExternalId: "sandyq", restaurantExternalId: who.restaurant, businessDate: date, status, clockIn: at(date, clockIn), clockOut: at(date, clockOut), breakMinutes: 60, hours, attendanceType: "worked", source: "pos", version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
    }
    const a = { id: aigerim, code: "101", name: "Айгерим", restaurant: "almaty" }
    await attendance("a1", a, "2026-09-01", "09:10", "21:00", 10.83, "completed") // 10 minutes late
    await attendance("a2", a, "2026-09-02", "09:00", "20:30", 10.5, "approved") // leaves 30 minutes early
    await attendance("a4", a, "2026-09-04", "10:00", "16:00", 5, "completed") // not scheduled; 09-03 is missed
    await attendance("a5", a, "2026-09-06", "10:00", "16:00", 5, "cancelled")
    await attendance("b1", { id: bauyrzhan, code: "102", name: "Бауыржан", restaurant: "shymkent" }, "2026-09-01", "09:00", "18:00", 8, "completed")
    const fact = async (restaurant: string, code: string, name: string, orderCount: number, netAmount: number) => {
      await ctx.db.insert("dailySalesFacts", { restaurantExternalId: restaurant, businessDate: "2026-09-01", factType: "employee", dimensionKey: code, dimensionLabel: name, orderCount, guestCount: orderCount, quantity: 0, grossAmount: netAmount, discountAmount: 0, serviceChargeAmount: 0, netAmount, costAmount: 0, refundAmount: 0, refundCount: 0, serviceMinutesTotal: 0, zeroRevenueCount: 0, updatedAt: 0 })
    }
    await fact("almaty", "101", "Айгерим", 10, 50_000)
    await fact("shymkent", "102", "Бауыржан", 5, 20_000)
    const line = { employeeId: aigerim, employeeCode: "101", employeeName: "Айгерим", hours: 26.33, payType: "hourly" as const, rate: 3610, adjustments: 5000, advances: 20_000, gross: 100_000, opv: 10_000, vosms: 2000, ipn: 7000, oosms: 3000, opvr: 1500, socialContribution: 3500, socialTax: 5000, taxable: 81_000, employeeTaxes: 19_000, employerTaxes: 13_000, net: 81_000 }
    const run = { restaurantExternalId: "almaty", organizationExternalId: "sandyq", from: "2026-09-01", to: "2026-09-30", ruleExternalId: "r", ruleVersion: "2026", lines: [line], totals: { gross: 100_000, employeeTaxes: 19_000, employerTaxes: 13_000, net: 81_000, toPay: 61_000 }, version: 1, createdAt: 0, updatedAt: 0 }
    await ctx.db.insert("payrollRuns", { ...run, externalId: "run-09", number: "PAY-2026-09-almaty", status: "posted", paidAmount: 30_000 })
    await ctx.db.insert("payrollRuns", { ...run, externalId: "run-draft", number: "PAY-draft", status: "draft", paidAmount: 0 })
    await ctx.db.insert("payrollPayouts", { externalId: "payout-1", runExternalId: "run-09", method: "cash", amount: 30_000, lines: [{ employeeCode: "101", amount: 30_000 }], createdBy: "t", createdAt: 0 })
    for (const [externalId, date, kind, amount, comment] of [["adj-1", "2026-09-10", "bonus", 8000, "План продаж"], ["adj-2", "2026-09-11", "penalty", 3000, "Опоздание"], ["adj-3", "2026-09-15", "advance", 20_000, "Аванс"]] as const) {
      await ctx.db.insert("payrollAdjustments", { externalId, employeeId: aigerim, employeeCode: "101", restaurantExternalId: "almaty", businessDate: date, kind, amount, comment, createdBy: "t", createdAt: 0 })
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Кадры", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "analyst", email: "analyst@sandyq.test", name: "Аналитик", roleExternalId: "analyst", restaurantScopes: ["almaty"], active: true })
  })
  const run = (reportId: string, restaurants = ["almaty", "shymkent"], config: ReportConfig = SEPTEMBER) => t.run((ctx) => REPORT_REGISTRY[reportId].calculator(ctx, config, restaurants))
  return { t, run }
}

const cellsOf = (result: { rows: { key: string; cells: Record<string, number | string> }[] }) => Object.fromEntries(result.rows.map((row) => [row.key, row.cells]))

describe("employee reports (W3-RPT-01)", () => {
  it("04 plan-fact, 05 journal and 06 lateness against the published schedule", async () => {
    const { run } = await workforce()
    const planFact = cellsOf(await run("employees-04"))
    expect(planFact["101"]).toMatchObject({ plannedShifts: 3, plannedHours: 33, workedShifts: 3, workedHours: 26.33, deviationHours: -6.67, missed: 1, unscheduled: 1 })
    expect(planFact["102"]).toMatchObject({ plannedShifts: 0, workedShifts: 1, unscheduled: 1 })

    const journal = await run("employees-05", ["almaty"])
    expect(journal.rows.map((row) => row.cells.number)).toEqual(["ЯВ-a1", "ЯВ-a2", "ЯВ-a4", "ЯВ-a5"])
    expect(journal.rows[0].cells).toMatchObject({ date: "2026-09-01", clockIn: "09:10", clockOut: "21:00", status: "Завершена", source: "Касса" })
    expect(journal.rows[3].cells).toMatchObject({ status: "Отменена", hours: 0 })
    expect(journal.totals.hours).toBe(26.33)

    const late = await run("employees-06")
    expect(late.rows.map((row) => [row.cells.date, row.cells.lateMinutes, row.cells.earlyMinutes, row.cells.shift])).toEqual([["2026-09-01", 10, 0, "Дневная 09:00–21:00"], ["2026-09-02", 0, 30, "Дневная 09:00–21:00"]])
    expect(late.kpis.map((kpi) => kpi.value)).toEqual([1, 10, 1, 30])
  })

  it("01 personal card, 07–10 payroll, 11 efficiency; the IIN is never output", async () => {
    const { run } = await workforce()
    const personal = await run("employees-01")
    expect(cellsOf(personal)["101"]).toMatchObject({ group: "Айгерим", code: "101", position: "Кассир", shifts: 3, hours: 26.33, late: 1, orders: 10, revenue: 50_000, averageCheck: 5000, gross: 100_000, bonuses: 8000, penalties: 3000, toPay: 61_000 })
    expect(JSON.stringify(personal)).not.toContain("900101300123")
    expect((await run("employees-01", ["almaty", "shymkent"], { ...SEPTEMBER, extra: { employeeCode: "102" } })).rows.map((row) => row.key)).toEqual(["102"])

    expect(cellsOf(await run("employees-07"))["101"]).toMatchObject({ payType: "Почасовая", hours: 26.33, base: 95_000, adjustments: 5000, gross: 100_000 }) // the draft run is not counted
    expect(cellsOf(await run("employees-08"))["101"]).toMatchObject({ opv: 10_000, vosms: 2000, ipn: 7000, taxes: 19_000, advances: 20_000, withheld: 39_000, toPay: 61_000 })
    expect(cellsOf(await run("employees-09"))["101"]).toMatchObject({ advances: 20_000, toPay: 61_000, paidCash: 30_000, paidBank: 0, paid: 30_000, due: 31_000 })
    const bonuses = await run("employees-10")
    expect(bonuses.rows.map((row) => [row.cells.kind, row.cells.bonus, row.cells.penalty, row.cells.comment])).toEqual([["Премия", 8000, 0, "План продаж"], ["Штраф", 0, 3000, "Опоздание"]])
    expect(bonuses.kpis.find((kpi) => kpi.key === "net")?.value).toBe(5000)

    const efficiency = cellsOf(await run("employees-11"))
    expect(efficiency["101"]).toMatchObject({ hours: 26.33, orders: 10, revenue: 50_000, revenuePerHour: 1899, ordersPerHour: 0.38, averageCheck: 5000 })
    expect(efficiency["102"]).toMatchObject({ hours: 8, revenuePerHour: 2500 })
  })

  it("12 sales by employee keeps to the restaurants in scope (B-23); payroll reports need office.payroll.view", async () => {
    const { t, run } = await workforce()
    expect((await run("employees-12", ["almaty"])).rows.map((row) => [row.key, row.cells.revenue, row.cells.share])).toEqual([["101", 50_000, 100]])
    expect((await run("employees-12")).rows.map((row) => [row.key, row.cells.share])).toEqual([["101", 71.4], ["102", 28.6]])

    const analyst = t.withIdentity({ email: "analyst@sandyq.test" })
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const execute = (who: typeof admin, reportId: string, restaurantExternalIds: string[] = []) => who.query(api.domains.reports.queries.execute, { reportId, config: { ...SEPTEMBER, restaurantExternalIds } })
    expect((await execute(analyst, "employees-12")).rows.map((row) => row.key)).toEqual(["101"]) // a branch user sees their branch only
    await expect(execute(analyst, "employees-12", ["shymkent"])).rejects.toThrow(/Нет доступа/)
    for (const reportId of ["employees-01", "employees-07", "employees-08", "employees-09", "employees-10"]) await expect(execute(analyst, reportId)).rejects.toThrow(/Недостаточно прав/)
    expect((await execute(admin, "employees-07")).rows).toHaveLength(1)
  })
})

// employees-13…15 on the W3-HR-07/08 tables: two motivation programs of Айгерим (sales met and
// accrued, discipline missed), a draft and one of Шымкент; medical records around the end of September.
async function hr() {
  const { t, run } = await workforce()
  await t.run(async (ctx) => {
    const employees = await ctx.db.query("employees").collect()
    const aigerim = employees.find((row) => row.code === "101")!
    const bauyrzhan = employees.find((row) => row.code === "102")!
    await ctx.db.patch(aigerim._id, { admitted: false })
    const program = (externalId: string, number: string, name: string, restaurantExternalId: string, metric: "sales" | "attendance", threshold: number, status: "draft" | "published" | "expired", participants: { positionExternalIds?: string[]; employeeCodes?: string[] }) =>
      ctx.db.insert("motivationPrograms", { externalId, number, name, organizationExternalId: "sandyq", restaurantExternalId, status, metric, threshold, rewardType: "fixed", rewardValue: 5000, startsAt: "2026-09-01", endsAt: "2026-09-30", requiresApproval: false, participants, version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
    await program("mp-sales", "МП-2026-00001", "План продаж", "almaty", "sales", 40_000, "expired", { employeeCodes: ["101"] })
    await program("mp-discipline", "МП-2026-00002", "Без опозданий", "almaty", "attendance", 90, "published", { positionExternalIds: ["pos-cashier"] })
    await program("mp-draft", "МП-2026-00003", "Черновик", "almaty", "sales", 1, "draft", {})
    await program("mp-shymkent", "МП-2026-00004", "Шымкент", "shymkent", "sales", 10_000, "published", { employeeCodes: ["102"] })
    await ctx.db.insert("payrollAdjustments", { externalId: "adj-mp", employeeId: aigerim._id, employeeCode: "101", restaurantExternalId: "almaty", businessDate: "2026-09-30", kind: "bonus", amount: 5000, comment: "Мотивация", sourceExternalId: "mp-sales", createdBy: "t", createdAt: 0 })
    const medical = (externalId: string, who: typeof aigerim, restaurantExternalId: string, documentType: "medical-book" | "analysis" | "certificate", issuedAt: string, expiresAt: string, status: "draft" | "approved" | "cancelled", fitForWork = true) =>
      ctx.db.insert("medicalRecords", { externalId, number: `МК-${externalId}`, employeeId: who._id, employeeCode: who.code, employeeName: who.displayName, organizationExternalId: "sandyq", restaurantExternalId, status, documentType, issuedAt, expiresAt, issuer: "Поликлиника №1", documentNumber: `KZ-${externalId}-4521`, fitForWork, comment: "Диагноз не пишем", expiryProcessed: false, version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
    await medical("m1", aigerim, "almaty", "medical-book", "2025-10-01", "2026-10-10", "approved") // ends in 10 days
    await medical("m2", aigerim, "almaty", "analysis", "2026-03-01", "2026-09-20", "approved", false) // ended, not renewed
    await medical("m4", aigerim, "almaty", "certificate", "2025-09-05", "2026-09-05", "approved") // ended, renewed by m5
    await medical("m5", aigerim, "almaty", "certificate", "2026-09-04", "2027-09-04", "approved")
    await medical("m6", bauyrzhan, "shymkent", "medical-book", "2026-09-10", "2027-09-10", "draft")
    await medical("m7", bauyrzhan, "shymkent", "analysis", "2026-09-10", "2027-03-10", "cancelled")
    await medical("m8", bauyrzhan, "shymkent", "analysis", "2025-08-01", "2026-08-01", "approved", false) // ended before the period
    await ctx.db.insert("officeRoles", { externalId: "hr", name: "Кадровик", capabilities: ["office.reports.view", "office.medical-records.view", "office.motivation.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "hr", email: "hr@sandyq.test", name: "Кадровик", roleExternalId: "hr", restaurantScopes: ["*"], active: true })
  })
  const execute = (email: string, reportId: string, config: Partial<ReportConfig> = {}) => t.withIdentity({ email }).query(api.domains.reports.queries.execute, { reportId, config: { ...SEPTEMBER, ...config } })
  return { run, execute }
}

describe("motivation and medical records reports (W3-RPT-01: employees-13…15)", () => {
  it("13 motivation results per participant: fact, threshold, reward and the accrued bonus", async () => {
    const { run, execute } = await hr()
    const result = await run("employees-13", ["almaty"])
    expect(result.rows.map((row) => [row.cells.program, row.cells.group, row.cells.fact, row.cells.threshold, row.cells.fulfilled, row.cells.reward, row.cells.accrued, row.cells.status])).toEqual([
      ["МП-2026-00001 «План продаж»", "Айгерим", "50 000 ₸", "40 000 ₸", "Да", 5000, 5000, "Завершена"],
      ["МП-2026-00002 «Без опозданий»", "Айгерим", "33,3 %", "90 %", "Нет", 0, 0, "Опубликована"],
    ])
    expect(result.rows[1].cells.basis).toBe("Смен по графику: 3, опозданий и неявок: 2")
    expect(Object.fromEntries(result.kpis.map((kpi) => [kpi.key, kpi.value]))).toMatchObject({ programs: 2, participants: 2, fulfilled: 1, reward: 5000, accrued: 5000 })
    expect((await run("employees-13")).kpis.find((kpi) => kpi.key === "programs")?.value).toBe(3) // + Шымкент
    // A program outside the period is not listed.
    expect((await run("employees-13", ["almaty"], { ...SEPTEMBER, dateFrom: "2026-10-01", dateTo: "2026-10-31" })).rows).toEqual([])
    await expect(execute("analyst@sandyq.test", "employees-13")).rejects.toThrow(/Недостаточно прав/)
  })

  it("14 register with the state at the end of the period; the number is masked without office.employees.pii", async () => {
    const { run, execute } = await hr()
    const register = await run("employees-14")
    expect(register.rows.map((row) => [row.cells.number, row.cells.state, row.cells.status, row.cells.fit])).toEqual([
      ["МК-m4", "Продлён", "Согласована", "Годен"],
      ["МК-m2", "Истёк", "Согласована", "Не годен"],
      ["МК-m1", "Истекает", "Согласована", "Годен"],
      ["МК-m5", "Действует", "Согласована", "Годен"],
      ["МК-m6", "—", "Черновик", "Годен"],
    ])
    expect(Object.fromEntries(register.kpis.map((kpi) => [kpi.key, kpi.value]))).toMatchObject({ documents: 5, valid: 2, expiring: 1, expired: 1, unfit: 1 })
    expect(JSON.stringify(register)).not.toContain("Диагноз") // the comment never shows

    const masked = await execute("hr@sandyq.test", "employees-14")
    expect(masked.rows.find((row) => row.key === "m1")?.cells.documentNumber).toBe("••••••••21")
    expect(JSON.stringify(masked)).not.toContain("KZ-m1")
    expect(masked.sourceLabel).toMatch(/номера документов скрыты/)
    const open = await execute("admin@sandyq.test", "employees-14")
    expect(open.rows.find((row) => row.key === "m1")?.cells.documentNumber).toBe("KZ-m1-4521")
    await expect(execute("analyst@sandyq.test", "employees-14")).rejects.toThrow(/Недостаточно прав/)
  })

  it("15 expiring and expired documents without a renewal — the calculation of the medical banner", async () => {
    const { run, execute } = await hr()
    const expiring = await run("employees-15")
    expect(expiring.rows.map((row) => [row.cells.number, row.cells.state, row.cells.daysLeft, row.cells.admission])).toEqual([
      ["МК-m8", "Истёк", -60, "Есть"],
      ["МК-m2", "Истёк", -10, "Снят"],
      ["МК-m1", "Истекает", 10, "Снят"],
    ])
    expect(expiring.kpis.map((kpi) => kpi.value)).toEqual([1, 2, 2])
    expect((await run("employees-15", ["almaty"])).rows.map((row) => row.key)).toEqual(["m2", "m1"])
    const soon = await run("employees-15", ["almaty", "shymkent"], { ...SEPTEMBER, extra: { withinDays: 5 } })
    expect(soon.rows.map((row) => row.key)).toEqual(["m8", "m2"])
    expect((await execute("hr@sandyq.test", "employees-15")).rows[0].cells.documentNumber).toBe("••••••••21")
    await expect(execute("analyst@sandyq.test", "employees-15")).rejects.toThrow(/Недостаточно прав/)
  })
})
