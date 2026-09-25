import { afterEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { nextRunAt, periodFor } from "../../convex/lib/reportSchedule"
import { toXlsx } from "../../convex/lib/reportExport"
import { unzipSync, strFromU8 } from "fflate"
import { setup } from "./fixtures/pos"

const local = (value: string) => Date.parse(`${value}+05:00`)
const schedules = api.domains.reports.schedules

afterEach(() => {
  vi.useRealTimers()
})

describe("report mailing calendar (W2-RPT-06)", () => {
  it("monthly on the 31st falls on the last day of shorter months; weekly and daily go to the next slot", () => {
    const monthly = { cadence: "monthly" as const, timeOfDay: "08:00", dayOfMonth: 31 }
    expect(nextRunAt(monthly, local("2027-01-31T08:00:00"))).toBe(local("2027-02-28T08:00:00"))
    expect(nextRunAt(monthly, local("2028-01-31T09:00:00"))).toBe(local("2028-02-29T08:00:00"))
    expect(nextRunAt(monthly, local("2027-02-28T08:00:00"))).toBe(local("2027-03-31T08:00:00"))
    expect(nextRunAt({ cadence: "weekly", timeOfDay: "09:30", weekday: 1 }, local("2026-09-25T10:00:00"))).toBe(local("2026-09-28T09:30:00"))
    expect(nextRunAt({ cadence: "daily", timeOfDay: "08:00" }, local("2026-09-25T07:59:00"))).toBe(local("2026-09-25T08:00:00"))
    expect(periodFor("last-month", local("2026-03-01T08:00:00"))).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" })
    expect(periodFor("month-to-date", local("2026-03-01T08:00:00"))).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" })
    expect(periodFor("last-7-days", local("2026-09-25T08:00:00"))).toEqual({ dateFrom: "2026-09-18", dateTo: "2026-09-24" })
  })

  it("XLSX holds the same cells as the CSV, formulas as text", () => {
    const file = toXlsx({ columns: [{ key: "group", label: "Дата", unit: "text", align: "left" }, { key: "net", label: "Выручка", unit: "money", align: "right" }], rows: [{ key: "a", cells: { group: "=SUM(1)", net: 1234.4 } }], totals: { net: 1234.4 }, kpis: [], generatedAt: 0, sourceLabel: "Тест", truncated: false }, { title: "Выручка", dateFrom: "2026-09-01", dateTo: "2026-09-01", restaurants: [] })
    const sheet = strFromU8(unzipSync(file)["xl/worksheets/sheet1.xml"])
    expect(sheet).toContain("<t xml:space=\"preserve\">=SUM(1)</t>")
    expect(sheet).toContain("<v>1234</v>")
    expect(sheet).toContain("Итого")
  })
})

describe("report mailings (W2-RPT-06)", () => {
  it("dispatches a due schedule once per slot, stores the file, and skips an owner who lost the right", async () => {
    vi.useFakeTimers()
    const { t } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view", "office.report-schedules.view", "office.report-schedules.edit"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "analyst", email: "analyst@sandyq.test", name: "Аналитик", roleExternalId: "analyst", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    })
    const analyst = t.withIdentity({ email: "analyst@sandyq.test" })
    const base = { reportId: "sales-01", name: "Выручка вчера", recipients: ["owner@sandyq.kz"], cadence: "daily" as const, timeOfDay: "08:00", periodPreset: "yesterday" as const, config: { dateFrom: "2026-01-01", dateTo: "2026-01-01", restaurantExternalIds: [] } }
    await expect(analyst.mutation(schedules.saveSchedule, { ...base, format: "pdf" })).rejects.toThrow(/PDF/)
    await expect(analyst.mutation(schedules.saveSchedule, { ...base, format: "csv", recipients: ["не почта"] })).rejects.toThrow(/Некорректный email/)
    const { externalId } = await analyst.mutation(schedules.saveSchedule, { ...base, format: "xlsx" })
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("reportSchedules").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())!
      await ctx.db.patch(row._id, { nextRunAt: Date.now() - 60_000 })
    })
    expect(await t.mutation(internal.domains.reports.schedules.dispatchSchedules, {})).toEqual({ dispatched: 1 })
    expect(await t.mutation(internal.domains.reports.schedules.dispatchSchedules, {})).toEqual({ dispatched: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    let [row] = await analyst.query(schedules.listSchedules, {})
    expect(row).toMatchObject({ lastStatus: "Готово · ожидает провайдера отправки", reportTitle: expect.any(String) })
    expect(row.lastFileStorageId).toBeTruthy()
    expect(row.nextRunAt).toBeGreaterThan(Date.now())

    await t.run(async (ctx) => {
      const role = (await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", "analyst")).unique())!
      await ctx.db.patch(role._id, { capabilities: ["office.report-schedules.view", "office.report-schedules.edit"] })
    })
    await analyst.mutation(schedules.runScheduleNow, { externalId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    ;[row] = await analyst.query(schedules.listSchedules, {})
    expect(row.lastStatus).toBe("Нет доступа")
  })
})
