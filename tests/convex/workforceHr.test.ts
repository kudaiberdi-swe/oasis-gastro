import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { cashier, setup } from "./fixtures/pos"

async function withOffice(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "hr", name: "Кадры Алматы", capabilities: ["office.employees.view", "office.employees.edit", "office.attendance.view", "office.attendance.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "hr", email: "hr@sandyq.test", name: "Кадры", roleExternalId: "hr", restaurantScopes: ["almaty"], active: true })
  })
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), hr: t.withIdentity({ email: "hr@sandyq.test" }) }
}

describe("employees HR card (W1-HR-01)", () => {
  it("creates a POS employee without iiko, checks PIN and IIN, masks personal data without the pii right", async () => {
    const { t } = await setup()
    const { admin, hr } = await withOffice(t)
    const base = { displayName: "Айгерім Серікова", employeeCode: "555", role: "cashier" as const, restaurantExternalIds: ["almaty"] }
    for (const pin of ["123", "1234567"]) await expect(hr.mutation(api.domains.workforce.mutations.createPosEmployee, { ...base, pin })).rejects.toThrow(/PIN/)
    await expect(hr.mutation(api.domains.workforce.mutations.createPosEmployee, { ...base, pin: "4821", iin: "123" })).rejects.toThrow(/ИИН/)
    await expect(hr.mutation(api.domains.workforce.mutations.createPosEmployee, { ...base, pin: "4821", restaurantExternalIds: ["almaty", "shymkent"] })).rejects.toThrow()
    const { employeeId } = await hr.mutation(api.domains.workforce.mutations.createPosEmployee, { ...base, pin: "4821", iin: "900101300123", phone: "+7 701 123 45 67", payType: "hourly", baseRate: 2000 })

    expect((await hr.query(api.domains.workforce.queries.getEmployee, { employeeId }))?.iin).toBe("••••••••0123")
    expect((await admin.query(api.domains.workforce.queries.getEmployee, { employeeId }))?.iin).toBe("900101300123")
    const listed = await hr.query(api.domains.workforce.queries.listEmployees, { search: "айгер", paginationOpts: { numItems: 50, cursor: null } })
    expect(listed.page.map((row) => [row.code, row.baseRate])).toEqual([["555", 2000]])
    expect(JSON.stringify(listed)).not.toContain("pinHash")

    await hr.mutation(api.domains.workforce.mutations.updateEmployeeProfile, { employeeId, displayName: "Айгерім Серікова", admitted: true, iin: "••••••••0123" })
    const kept = await admin.query(api.domains.workforce.queries.getEmployee, { employeeId })
    expect(kept).toMatchObject({ iin: "900101300123", phone: "+7 701 123 45 67", baseRate: 2000, admitted: true }) // left out or masked → kept
    await admin.mutation(api.domains.workforce.mutations.updateEmployeeProfile, { employeeId, displayName: "Айгерім Серікова", phone: "" })
    expect((await admin.query(api.domains.workforce.queries.getEmployee, { employeeId }))?.phone).toBeUndefined() // empty string clears
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").take(20))
    expect(audit.find((row) => row.action === "workforce.profile.update")?.summary).toContain("admitted")
    expect(audit.map((row) => row.summary).join(" ")).not.toContain("900101300123")
  })
})

describe("attendance (W1-HR-05)", () => {
  it("a shift opens and closes the opener's attendance; clock-in is idempotent; clock-out needs an open one", async () => {
    const { t } = await setup() // the fixture opens a shift
    const [open] = await t.run((ctx) => ctx.db.query("attendanceRecords").take(5))
    expect(open).toMatchObject({ status: "active", source: "pos-shift" })
    expect((await t.mutation(api.domains.workforce.attendance.clockIn, { sessionToken: cashier })).alreadyOpen).toBe(true)
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 0, note: "" })
    const [closed] = await t.run((ctx) => ctx.db.query("attendanceRecords").take(5))
    expect(closed.status).toBe("completed")
    expect(closed.hours).toBeGreaterThanOrEqual(0)
    await expect(t.mutation(api.domains.workforce.attendance.clockOut, { sessionToken: cashier })).rejects.toThrow(/Нет открытой/)
    expect(await t.query(api.domains.workforce.attendance.myAttendance, { sessionToken: cashier })).toBeNull()
  })

  it("an office correction of POS times needs a reason, keeps the originals and goes through approval", async () => {
    const { t } = await setup()
    const { admin } = await withOffice(t)
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 0, note: "" })
    const [record] = await t.run((ctx) => ctx.db.query("attendanceRecords").take(5))
    const input = { externalId: record.externalId, employeeId: record.employeeId, restaurantExternalId: "almaty", clockIn: record.clockIn - 3_600_000, clockOut: record.clockOut, breakMinutes: 0, attendanceType: "worked" as const }
    await expect(admin.mutation(api.domains.workforce.attendance.save, input)).rejects.toThrow(/причину/)
    await admin.mutation(api.domains.workforce.attendance.save, { ...input, correctionReason: "Забыл отметиться" })
    const corrected = (await admin.query(api.domains.workforce.attendance.get, { externalId: record.externalId }))!
    expect(corrected).toMatchObject({ status: "draft", original: { clockIn: record.clockIn }, correctionReason: "Забыл отметиться" })
    await expect(admin.mutation(api.domains.workforce.attendance.transition, { externalId: record.externalId, action: "approve" })).rejects.toThrow(/недоступно/)
    await admin.mutation(api.domains.workforce.attendance.transition, { externalId: record.externalId, action: "submit" })
    await admin.mutation(api.domains.workforce.attendance.transition, { externalId: record.externalId, action: "approve" })
    expect((await admin.query(api.domains.workforce.attendance.get, { externalId: record.externalId }))?.status).toBe("approved")
  })
})
