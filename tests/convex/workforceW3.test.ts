import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { applyCheckoutFacts } from "../../convex/lib/reportFacts"
import { almatyBusinessDate } from "../../convex/lib/time"
import { setup } from "./fixtures/pos"

// W3-HR-07 «Мотивационные программы» and W3-HR-08 «Медкнижки и анализы».

type T = Awaited<ReturnType<typeof setup>>["t"]

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function office(t: T, extra: { email: string; capabilities: string[] }[] = []) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Кадры", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    for (const [index, user] of extra.entries()) {
      await ctx.db.insert("officeRoles", { externalId: `role-${index}`, name: user.email, capabilities: user.capabilities, system: false })
      await ctx.db.insert("officeUsers", { externalId: `user-${index}`, email: user.email, name: user.email, roleExternalId: `role-${index}`, restaurantScopes: ["almaty"], active: true })
    }
  })
  const ids = await t.run(async (ctx) => ({
    cashierId: (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "101")).unique())!._id,
    managerId: (await ctx.db.query("employees").withIndex("by_code", (q) => q.eq("code", "900")).unique())!._id,
    restaurantId: (await ctx.db.query("restaurants").withIndex("by_external_id", (q) => q.eq("externalId", "almaty")).unique())!._id,
  }))
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), ...ids }
}

/** A paid check as checkout leaves it, and its daily sales facts written by the checkout path. */
async function paidOrder(t: T, args: { restaurantId: Id<"restaurants">; createdBy: Id<"employees">; businessDate: string; total: number; number: number }) {
  await t.run(async (ctx) => {
    const createdAt = Date.parse(`${args.businessDate}T12:00:00+05:00`)
    const orderId = await ctx.db.insert("orders", {
      number: args.number,
      orderType: "dine-in",
      status: "paid",
      discountPercent: 0,
      subtotal: args.total,
      serviceChargePercent: 0,
      serviceChargeAmount: 0,
      total: args.total,
      restaurantId: args.restaurantId,
      createdBy: args.createdBy,
      createdAt,
      paidAt: createdAt + 600_000,
      businessDate: args.businessDate,
      searchText: "",
    })
    await applyCheckoutFacts(ctx, (await ctx.db.get(orderId))!, 0)
  })
}

const PROGRAM = {
  restaurantExternalId: "almaty",
  name: "План продаж августа",
  metric: "sales" as const,
  threshold: 50_000,
  rewardType: "fixed" as const,
  rewardValue: 15_000,
  startsAt: "2026-08-01",
  endsAt: "2026-08-31",
  requiresApproval: false,
  participants: {},
}

describe("motivation programs (W3-HR-07)", () => {
  it("counts sales per employee from the checks, accrues payroll bonuses once and posts nothing itself", async () => {
    const { t } = await setup()
    const { admin, cashierId, managerId, restaurantId } = await office(t)
    await paidOrder(t, { restaurantId, createdBy: cashierId, businessDate: "2026-08-05", total: 30_000, number: 1 })
    await paidOrder(t, { restaurantId, createdBy: cashierId, businessDate: "2026-08-20", total: 25_000, number: 2 })
    await paidOrder(t, { restaurantId, createdBy: cashierId, businessDate: "2026-09-02", total: 99_000, number: 3 }) // outside the period
    await paidOrder(t, { restaurantId, createdBy: managerId, businessDate: "2026-08-10", total: 10_000, number: 4 })

    const externalId = await admin.mutation(api.domains.workforce.motivation.save, PROGRAM)
    const draft = (await admin.query(api.domains.workforce.motivation.get, { externalId }))!
    expect(draft).toMatchObject({ status: "draft", number: expect.stringMatching(/^МП-2026-\d{5}$/) })
    await expect(admin.mutation(api.domains.workforce.motivation.accrue, { externalId })).rejects.toThrow(/опубликованной/)
    await admin.mutation(api.domains.workforce.motivation.transition, { externalId, action: "publish" })
    await expect(admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, externalId })).rejects.toThrow(/отключите/)

    const results = (await admin.query(api.domains.workforce.motivation.results, { externalId }))!
    expect(results.accruable).toBe(true)
    const byCode = new Map(results.rows.map((row) => [row.employeeCode, row]))
    expect(byCode.get("101")).toMatchObject({ fact: 55_000, fulfilled: true, reward: 15_000, accrued: null, basis: "Чеков: 2" })
    expect(byCode.get("900")).toMatchObject({ fact: 10_000, fulfilled: false, reward: 0 })
    expect(results.totals).toMatchObject({ participants: 2, fulfilled: 1, reward: 15_000, accrued: 0 })

    const journalBefore = await t.run(async (ctx) => (await ctx.db.query("journalEntries").take(200)).length)
    expect(await admin.mutation(api.domains.workforce.motivation.accrue, { externalId })).toEqual({ created: 1, skipped: 0, amount: 15_000, businessDate: "2026-08-31" })
    expect(await admin.mutation(api.domains.workforce.motivation.accrue, { externalId })).toMatchObject({ created: 0, skipped: 1, amount: 0 })
    const adjustments = await t.run((ctx) => ctx.db.query("payrollAdjustments").withIndex("by_source_employee", (q) => q.eq("sourceExternalId", externalId)).take(10))
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({ employeeId: cashierId, kind: "bonus", amount: 15_000, businessDate: "2026-08-31", restaurantExternalId: "almaty" })
    expect(adjustments[0].runExternalId).toBeUndefined()
    expect(await t.run(async (ctx) => (await ctx.db.query("journalEntries").take(200)).length)).toBe(journalBefore)
    expect((await admin.query(api.domains.workforce.motivation.results, { externalId }))!.rows.find((row) => row.employeeCode === "101")!.accrued).toBe(15_000)
    await expect(admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, externalId })).rejects.toThrow()

    // The bonus reaches the payroll sheet through the run, as any adjustment does.
    await t.run((ctx) => ctx.db.patch(cashierId, { payType: "salary", baseRate: 300_000 }))
    await t.mutation(internal.domains.workforce.payroll.seedRules2026, {})
    await admin.mutation(api.domains.workforce.payroll.activateRules, { externalId: "payroll-rules-kz-2026" })
    const run = await admin.mutation(api.domains.workforce.payroll.calculatePayroll, { restaurantExternalId: "almaty", from: "2026-08-01", to: "2026-08-31" })
    const sheet = (await admin.query(api.domains.workforce.payroll.getRun, { externalId: run.externalId }))!
    expect(sheet.run.lines.find((line) => line.employeeCode === "101")).toMatchObject({ adjustments: 15_000, gross: 315_000 })
  })

  it("validates the rule, filters participants and asks for the approve right when the program requires approval", async () => {
    const { t } = await setup()
    const { admin, managerId, restaurantId } = await office(t, [{ email: "hr@sandyq.test", capabilities: ["office.motivation.view", "office.motivation.edit", "office.payroll.edit"] }])
    await expect(admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, metric: "average-check", rewardType: "percent", rewardValue: 5 })).rejects.toThrow(/только от продаж/)
    await expect(admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, endsAt: "2026-07-31" })).rejects.toThrow(/раньше начала/)
    await expect(admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, metric: "attendance", threshold: 120 })).rejects.toThrow(/от 0 до 100/)

    await paidOrder(t, { restaurantId, createdBy: managerId, businessDate: "2026-08-10", total: 60_000, number: 1 })
    await paidOrder(t, { restaurantId, createdBy: managerId, businessDate: "2026-08-11", total: 20_000, number: 2 })
    const externalId = await admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, metric: "average-check", threshold: 35_000, requiresApproval: true, participants: { employeeCodes: ["900"] } })
    await admin.mutation(api.domains.workforce.motivation.transition, { externalId, action: "publish" })
    const results = (await admin.query(api.domains.workforce.motivation.results, { externalId }))!
    expect(results.rows.map((row) => [row.employeeCode, row.fact, row.fulfilled])).toEqual([["900", 40_000, true]])

    const hr = t.withIdentity({ email: "hr@sandyq.test" })
    await expect(hr.mutation(api.domains.workforce.motivation.accrue, { externalId })).rejects.toThrow(/Недостаточно прав/)
    expect(await admin.mutation(api.domains.workforce.motivation.accrue, { externalId })).toMatchObject({ created: 1, amount: 15_000 })
  })

  it("discipline is the share of published shifts started on time", async () => {
    const { t } = await setup()
    const { admin, cashierId } = await office(t)
    const at = (local: string) => Date.parse(`${local}+05:00`)
    await t.run(async (ctx) => {
      for (const [day, clockIn] of [["03", "09:02"], ["04", "09:40"], ["05", null]] as const) {
        await ctx.db.insert("scheduleEntries", { externalId: `s${day}`, employeeId: cashierId, employeeCode: "101", employeeName: "Кассир", restaurantExternalId: "almaty", businessDate: `2026-08-${day}`, start: at(`2026-08-${day}T09:00:00`), end: at(`2026-08-${day}T18:00:00`), breakMinutes: 60, plannedHours: 8, status: "published", version: 1, createdAt: 0, updatedAt: 0 })
        if (clockIn) await ctx.db.insert("attendanceRecords", { externalId: `a${day}`, number: `ЯВ-${day}`, employeeId: cashierId, employeeCode: "101", employeeName: "Кассир", organizationExternalId: "sandyq", restaurantExternalId: "almaty", businessDate: `2026-08-${day}`, status: "completed", clockIn: at(`2026-08-${day}T${clockIn}:00`), clockOut: at(`2026-08-${day}T18:00:00`), breakMinutes: 60, hours: 8, attendanceType: "worked", source: "pos", version: 1, searchText: "", createdAt: 0, updatedAt: 0 })
      }
    })
    const externalId = await admin.mutation(api.domains.workforce.motivation.save, { ...PROGRAM, metric: "attendance", threshold: 30, participants: { employeeCodes: ["101"] } })
    const [row] = (await admin.query(api.domains.workforce.motivation.results, { externalId }))!.rows
    expect(row).toMatchObject({ employeeCode: "101", fact: 33.3, fulfilled: true, basis: "Смен по графику: 3, опозданий и неявок: 2" })
  })
})

describe("medical records (W3-HR-08)", () => {
  it("refuses an end date not after the issue date; masks the number without office.employees.pii", async () => {
    const { t } = await setup()
    const { admin, cashierId } = await office(t, [{ email: "manager@sandyq.test", capabilities: ["office.medical-records.view"] }])
    const today = almatyBusinessDate(Date.now())
    const record = { employeeId: cashierId, restaurantExternalId: "almaty", documentType: "medical-book" as const, issuer: "Поликлиника №1", documentNumber: "MK-778812", fitForWork: true, comment: "Флюорография в порядке" }
    await expect(admin.mutation(api.domains.workforce.medical.save, { ...record, issuedAt: addDays(today, -10), expiresAt: addDays(today, -10) })).rejects.toThrow(/позже даты выдачи/)
    await expect(admin.mutation(api.domains.workforce.medical.save, { ...record, issuedAt: addDays(today, -10), expiresAt: addDays(today, -20) })).rejects.toThrow(/позже даты выдачи/)
    const externalId = await admin.mutation(api.domains.workforce.medical.save, { ...record, issuedAt: addDays(today, -10), expiresAt: addDays(today, 200) })
    expect((await admin.query(api.domains.workforce.medical.get, { externalId }))!).toMatchObject({ documentNumber: "MK-778812", comment: "Флюорография в порядке", piiHidden: false })
    const manager = t.withIdentity({ email: "manager@sandyq.test" })
    const masked = (await manager.query(api.domains.workforce.medical.get, { externalId }))!
    expect(masked).toMatchObject({ documentNumber: "•••••••12", piiHidden: true })
    expect(masked.comment).toBeUndefined()
    // An edit without the number and comment keeps them.
    await admin.mutation(api.domains.workforce.medical.save, { ...record, externalId, documentNumber: undefined, comment: undefined, issuedAt: addDays(today, -10), expiresAt: addDays(today, 300) })
    expect(await t.run(async (ctx) => (await ctx.db.query("medicalRecords").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())!)).toMatchObject({ documentNumber: "MK-778812", comment: "Флюорография в порядке", expiresAt: addDays(today, 300) })
    await expect(manager.mutation(api.domains.workforce.medical.transition, { externalId, action: "submit" })).rejects.toThrow(/Недостаточно прав/)
  })

  it("lists documents expiring within 30 days by the end-date index; the daily job takes the admission away", async () => {
    const { t } = await setup()
    const { admin, cashierId, managerId } = await office(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(cashierId, { admitted: true })
      await ctx.db.patch(managerId, { admitted: true })
    })
    const today = almatyBusinessDate(Date.now())
    const approved = async (employeeId: Id<"employees">, documentType: "medical-book" | "analysis", issuedAt: string, expiresAt: string) => {
      const externalId = await admin.mutation(api.domains.workforce.medical.save, { employeeId, restaurantExternalId: "almaty", documentType, issuedAt, expiresAt, issuer: "Поликлиника №1", documentNumber: "MK-1", fitForWork: true })
      await admin.mutation(api.domains.workforce.medical.transition, { externalId, action: "submit" })
      await admin.mutation(api.domains.workforce.medical.transition, { externalId, action: "approve" })
      return externalId
    }
    const soon = await approved(managerId, "analysis", addDays(today, -300), addDays(today, 5))
    await approved(managerId, "medical-book", addDays(today, -30), addDays(today, 60))
    const ended = await approved(cashierId, "medical-book", addDays(today, -365), addDays(today, -1))
    // A draft ending tomorrow does not count — only approved documents.
    await admin.mutation(api.domains.workforce.medical.save, { employeeId: cashierId, restaurantExternalId: "almaty", documentType: "analysis", issuedAt: addDays(today, -5), expiresAt: addDays(today, 1), issuer: "Лаборатория", documentNumber: "A-1", fitForWork: true })

    const expiring = await admin.query(api.domains.workforce.medical.expiringMedicalRecords, {})
    expect(expiring).toMatchObject({ withinDays: 30, count: 1, expiredCount: 1 })
    expect(expiring.rows.map((row) => row.externalId)).toEqual([soon])
    expect(expiring.expired.map((row) => row.externalId)).toEqual([ended])
    const filtered = await admin.query(api.domains.workforce.medical.list, { expiringWithinDays: 30, paginationOpts: { numItems: 50, cursor: null } })
    expect(filtered.page.map((row) => row.externalId)).toEqual([soon])

    expect(await t.mutation(internal.domains.workforce.medical.processMedicalExpiry, {})).toEqual({ processed: 1, revoked: 1, warned: 1 })
    const [cashier, manager] = await t.run(async (ctx) => [await ctx.db.get(cashierId), await ctx.db.get(managerId)])
    expect(cashier!.admitted).toBe(false)
    expect(manager!.admitted).toBe(true)
    const notices = await t.run((ctx) => ctx.db.query("posNotifications").take(20))
    expect(notices.map((row) => [row.severity, row.dedupeKey]).sort()).toEqual([["critical", `medical-expired:${ended}`], ["warning", `medical-expiring:${soon}`]])
    // A second run repeats nothing.
    expect(await t.mutation(internal.domains.workforce.medical.processMedicalExpiry, {})).toEqual({ processed: 0, revoked: 0, warned: 1 })
    expect(await t.run(async (ctx) => (await ctx.db.query("posNotifications").take(20)).length)).toBe(2)
  })

  it("a renewed document or the setting turned off keeps the admission", async () => {
    const { t } = await setup()
    const { admin, cashierId, managerId } = await office(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(cashierId, { admitted: true })
      await ctx.db.patch(managerId, { admitted: true })
    })
    const today = almatyBusinessDate(Date.now())
    const approved = async (employeeId: Id<"employees">, issuedAt: string, expiresAt: string) => {
      const externalId = await admin.mutation(api.domains.workforce.medical.save, { employeeId, restaurantExternalId: "almaty", documentType: "medical-book", issuedAt, expiresAt, issuer: "Поликлиника №1", documentNumber: "MK-1", fitForWork: true })
      await admin.mutation(api.domains.workforce.medical.transition, { externalId, action: "submit" })
      await admin.mutation(api.domains.workforce.medical.transition, { externalId, action: "approve" })
      return externalId
    }
    await approved(cashierId, addDays(today, -365), addDays(today, -2))
    await approved(cashierId, addDays(today, -3), addDays(today, 360)) // the renewal
    expect(await t.mutation(internal.domains.workforce.medical.processMedicalExpiry, {})).toMatchObject({ processed: 1, revoked: 0 })
    expect((await admin.query(api.domains.workforce.medical.expiringMedicalRecords, {})).expiredCount).toBe(0)

    await admin.mutation(api.domains.workforce.medical.saveSettings, { revokeAdmissionOnExpiry: false, notifyWithinDays: 0 })
    await approved(managerId, addDays(today, -365), addDays(today, -1))
    expect(await t.mutation(internal.domains.workforce.medical.processMedicalExpiry, {})).toEqual({ processed: 1, revoked: 0, warned: 0 })
    const [cashier, manager] = await t.run(async (ctx) => [await ctx.db.get(cashierId), await ctx.db.get(managerId)])
    expect([cashier!.admitted, manager!.admitted]).toEqual([true, true])
  })
})
