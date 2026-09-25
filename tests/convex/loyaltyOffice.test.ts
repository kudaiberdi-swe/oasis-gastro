import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

const office = api.domains.loyalty.office
const page = { paginationOpts: { numItems: 20, cursor: null } }

async function users(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "crm", name: "CRM", capabilities: ["office.guests.view", "office.guests.edit", "office.loyalty-programs.view", "office.loyalty-programs.edit", "office.guest-categories.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "crm", email: "crm@sandyq.test", name: "CRM", roleExternalId: "crm", restaurantScopes: ["almaty"], active: true })
  })
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), crm: t.withIdentity({ email: "crm@sandyq.test" }) }
}

describe("office loyalty (W1-LOY-04/05/06)", () => {
  it("creates a guest only with both consents, masks personal data without the pii right, consents append", async () => {
    const { t } = await setup()
    const { admin, crm } = await users(t)
    const guest = { name: "Айдана", phone: "+7 701 555 44 33", email: "aidana@mail.kz", categoryExternalIds: [], restaurantExternalId: "almaty" }
    await expect(crm.mutation(office.saveGuest, guest)).rejects.toThrow(/согласия/)
    const guestId = await crm.mutation(office.saveGuest, { ...guest, consents: { personalData: true, crossBorder: true } })
    await expect(crm.mutation(office.saveGuest, { ...guest, consents: { personalData: true, crossBorder: true } })).rejects.toThrow(/уже есть/)
    const masked = (await crm.query(office.getGuest, { guestId }))!
    expect(masked.guest.phone).toBe("7701•••••33")
    expect(masked.guest.email).toBe("a•••••@mail.kz")
    expect(masked.consents).toHaveLength(2)
    expect((await admin.query(office.getGuest, { guestId }))?.guest.phone).toBe("77015554433")
    // Saving the masked card keeps the real phone.
    await crm.mutation(office.saveGuest, { guestId, name: "Айдана С.", phone: masked.guest.phone, email: masked.guest.email ?? undefined, categoryExternalIds: [] })
    expect((await admin.query(office.getGuest, { guestId }))?.guest).toMatchObject({ phone: "77015554433", name: "Айдана С." })
    await crm.mutation(office.recordConsent, { guestId, channel: "sms", granted: false })
    expect((await admin.query(office.getGuest, { guestId }))?.consents).toHaveLength(3)
    expect((await crm.query(office.listGuests, { ...page, search: "7701" })).page).toHaveLength(1)
  })

  it("programs: validation, publish needs approve, same-priority overlap refused; adjustments need approve", async () => {
    const { t } = await setup()
    const { admin, crm } = await users(t)
    const base = { name: "Бонусы", programKind: "bonus" as const, accrualPercent: 5, maxRedemptionPercent: 30, welcomeBonus: 0, startsAt: 0, restaurantExternalIds: ["almaty"], priority: 1 }
    await expect(crm.mutation(office.saveProgram, { ...base, accrualPercent: 120 })).rejects.toThrow(/0 до 100/)
    const { externalId } = await crm.mutation(office.saveProgram, base)
    await expect(crm.mutation(office.transitionProgram, { externalId, action: "publish" })).rejects.toThrow()
    await admin.mutation(office.transitionProgram, { externalId, action: "publish" })
    const second = await crm.mutation(office.saveProgram, { ...base, name: "Дубль" })
    expect(second.overlaps.map((row) => row.name)).toEqual(["Бонусы"])
    await expect(admin.mutation(office.transitionProgram, { externalId: second.externalId, action: "publish" })).rejects.toThrow(/приоритет/)

    const guestId = await crm.mutation(office.saveGuest, { name: "Гость", phone: "77010000001", categoryExternalIds: [], consents: { personalData: true, crossBorder: true } })
    await expect(crm.mutation(office.adjustBalance, { guestId, programExternalId: externalId, amount: 100, reason: "Компенсация" })).rejects.toThrow()
    expect(await admin.mutation(office.adjustBalance, { guestId, programExternalId: externalId, amount: 100, reason: "Компенсация" })).toEqual({ balance: 100 })
    await expect(admin.mutation(office.adjustBalance, { guestId, programExternalId: externalId, amount: -200, reason: "Ошибка" })).rejects.toThrow(/Недостаточно/)
  })

  it("automatic categories follow spend and visits; manual ones stay", async () => {
    const { t } = await setup()
    const { admin } = await users(t)
    const gold = await admin.mutation(office.saveCategory, { code: "gold", name: "Золото", color: "accent", assignment: "automatic", minimumSpend: 50_000, minimumVisits: 3, validDays: 365, active: true })
    const vip = await admin.mutation(office.saveCategory, { code: "vip", name: "VIP", color: "primary", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0, active: true })
    await expect(admin.mutation(office.saveCategory, { code: "gold", name: "Дубль", color: "accent", assignment: "manual", minimumSpend: 0, minimumVisits: 0, validDays: 0, active: true })).rejects.toThrow(/занят/)
    const guestId = await admin.mutation(office.saveGuest, { name: "Постоянный", phone: "77010000002", categoryExternalIds: [vip], consents: { personalData: true, crossBorder: true } })
    await t.run((ctx) => ctx.db.patch(guestId, { turnover: 80_000, visits: 5 }))
    await t.mutation(internal.domains.loyalty.office.recalculateGuestCategories, { cursor: null })
    expect((await t.run((ctx) => ctx.db.get(guestId)))?.categoryExternalIds).toEqual([vip, gold])
  })
})
