import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

const rsv = api.domains.loyalty.reservations
const at = (time: string) => Date.parse(`2026-12-20T${time}:00+05:00`)

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Хостес", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  const admin = t.withIdentity({ email: "admin@sandyq.test" })
  const table = (label: string, capacity: number) => admin.mutation(rsv.saveTable, { restaurantExternalId: "almaty", hall: "Основной", label, capacity, shape: "rect", x: 1, y: 1, width: 2, height: 2, rotation: 0, active: true })
  return { admin, t4: await table("Стол 4", 4), t6: await table("Стол 6", 6) }
}

const booking = (tableExternalIds: string[], start: string, end: string, extra: Record<string, unknown> = {}) => ({ restaurantExternalId: "almaty", recordType: "reservation" as const, hall: "Основной", tableExternalIds, guestName: "Дана", phone: "+77011234567", start: at(start), end: at(end), guestCount: 4, occasion: "вечер", prepayment: 0, menu: "", ...extra })

describe("reservations and the floor plan (W2-LOY-07)", () => {
  it("refuses an overlapping booking of a table, allows the next slot, checks capacity", async () => {
    const { t } = await setup()
    const { admin, t4, t6 } = await office(t)
    await admin.mutation(rsv.saveReservation, booking([t4], "19:00", "21:00"))
    await expect(admin.mutation(rsv.saveReservation, booking([t4], "20:00", "22:00"))).rejects.toThrow(/уже забронирован/)
    await admin.mutation(rsv.saveReservation, booking([t4], "21:00", "23:00"))
    await expect(admin.mutation(rsv.saveReservation, booking([t4], "12:00", "13:00", { guestCount: 5 }))).rejects.toThrow(/Вместимость/)
    await admin.mutation(rsv.saveReservation, booking([t4, t6], "12:00", "13:00", { guestCount: 9, recordType: "banquet" }))
    const plan = await admin.query(rsv.floorPlan, { restaurantExternalId: "almaty", date: "2026-12-20" })
    expect(plan.halls).toEqual(["Основной"])
    expect(plan.tables.find((row) => row.externalId === t4)?.reservations.map((row) => row.start)).toEqual([at("12:00"), at("19:00"), at("21:00")])
  })

  it("approval posts the prepayment as an advance; cancel frees the table and reverses it", async () => {
    const { t } = await setup()
    const { admin, t4 } = await office(t)
    await expect(admin.mutation(rsv.saveReservation, booking([t4], "19:00", "21:00", { prepayment: 10_000 }))).rejects.toThrow(/тип оплаты/)
    const saved = await admin.mutation(rsv.saveReservation, booking([t4], "19:00", "21:00", { prepayment: 10_000, prepaymentTypeExternalId: "payment-type-cash" }))
    let version = saved.version
    for (const action of ["submit", "approve"] as const) version = (await admin.mutation(rsv.transitionReservation, { externalId: saved.externalId, action, expectedVersion: version })).version
    const entries = () => t.run((ctx) => ctx.db.query("journalEntries").withIndex("by_source", (q) => q.eq("sourceExternalId", saved.externalId)).collect())
    expect((await entries()).map((row) => [row.debitAccountExternalId, row.creditAccountExternalId, row.amount])).toEqual([["acc-1010", "acc-3520", 10_000]])
    expect(await admin.query(rsv.reservationSummary, {})).toEqual({ upcoming: 1 })

    await expect(admin.mutation(rsv.transitionReservation, { externalId: saved.externalId, action: "cancel", expectedVersion: version })).rejects.toThrow(/причину/)
    await admin.mutation(rsv.transitionReservation, { externalId: saved.externalId, action: "cancel", expectedVersion: version, reason: "Гость перенёс" })
    const rows = await entries()
    expect(rows.reduce((sum, row) => sum + (row.reversalOf ? -row.amount : row.amount), 0)).toBe(0)
    await admin.mutation(rsv.saveReservation, booking([t4], "19:30", "21:00"))
  })
})
