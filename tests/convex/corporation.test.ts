import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { isValidKzBin } from "../../convex/lib/bin"
import { cashier, setup } from "./fixtures/pos"

async function admin(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
  })
  return t.withIdentity({ email: "admin@sandyq.test" })
}

describe("corporation (W2-ADM-06/07/08/09)", () => {
  it("checks the KZ BIN control digit", () => {
    // 1..9,0,1 × weights 1..11 = 296 ≡ 10 (mod 11) → second weights give 377 ≡ 3: the control digit is 3.
    expect(isValidKzBin("123456789013")).toBe(true)
    expect(isValidKzBin("123456789012")).toBe(false)
    expect(isValidKzBin("12345678901")).toBe(false)
    expect(isValidKzBin("12345678901a")).toBe(false)
  })

  it("organizations: BIN check, cannot disable with active restaurants", async () => {
    const { t } = await setup()
    const office = await admin(t)
    await expect(office.mutation(api.domains.corporation.organizations.saveOrganization, { externalId: "sandyq", name: "Sandyq", bin: "123456789012", currency: "KZT", timezone: "Asia/Almaty", jurisdiction: "KZ" })).rejects.toThrow(/БИН/)
    await expect(office.mutation(api.domains.corporation.organizations.setOrganizationActive, { externalId: "sandyq", active: false })).rejects.toThrow(/рестораны/)
    const [row] = await office.query(api.domains.corporation.organizations.listOrganizations, {})
    expect(row).toMatchObject({ externalId: "sandyq", activeRestaurantCount: 1 })
  })

  it("restaurants: a new one gets its main warehouse; one with an open shift cannot be disabled", async () => {
    const { t } = await setup()
    const office = await admin(t)
    const id = await office.mutation(api.domains.corporation.restaurants.saveRestaurant, { organizationExternalId: "sandyq", name: "Sandyq Астана", address: "Туран, 1", city: "Астана", timezone: "Asia/Almaty", businessDayCutoffMinutes: 240 })
    const warehouses = await t.run((ctx) => ctx.db.query("warehouses").withIndex("by_restaurant_active", (q) => q.eq("restaurantExternalId", id)).take(5))
    expect(warehouses.map((row) => row.isSalesDefault)).toEqual([true])
    await expect(office.mutation(api.domains.corporation.restaurants.saveRestaurant, { organizationExternalId: "sandyq", name: "X", address: "", timezone: "Asia/Almaty", businessDayCutoffMinutes: 900 })).rejects.toThrow(/Отсечка/)
    await expect(office.mutation(api.domains.corporation.restaurants.setRestaurantActive, { externalId: "almaty", active: false })).rejects.toThrow(/открыта смена/)
    await t.mutation(api.domains.shifts.mutations.close, { sessionToken: cashier, countedCash: 0, note: "" })
    await office.mutation(api.domains.corporation.restaurants.setRestaurantActive, { externalId: "almaty", active: false })
    const rows = await office.query(api.domains.corporation.restaurants.listRestaurants, {})
    expect(rows.find((row) => row.externalId === id)).toMatchObject({ warehouseCount: 1, terminalCount: 0 })
  })

  it("departments: a tree without cycles inside one organization; integration job payload secrets hidden", async () => {
    const { t } = await setup()
    const office = await admin(t)
    const ops = await office.mutation(api.domains.corporation.departments.saveDepartment, { organizationExternalId: "sandyq", code: "OPS", name: "Операционный департамент", kind: "office" })
    const kitchen = await office.mutation(api.domains.corporation.departments.saveDepartment, { organizationExternalId: "sandyq", code: "KIT", name: "Цех", kind: "production", parentExternalId: ops })
    const [first] = await t.run((ctx) => ctx.db.query("departments").take(1))
    await expect(office.mutation(api.domains.corporation.departments.saveDepartment, { externalId: ops, expectedVersion: first.version, organizationExternalId: "sandyq", code: "OPS", name: "Операционный департамент", kind: "office", parentExternalId: kitchen })).rejects.toThrow(/самого себя/)
    expect((await office.query(api.domains.corporation.departments.listDepartments, {})).map((row) => [row.code, row.level])).toEqual([["OPS", 0], ["KIT", 1]])

    await t.run((ctx) => ctx.db.insert("integrationJobs", { externalId: "job-1", provider: "bank", direction: "outbound", operation: "statement", idempotencyKey: "k", status: "failed", attempts: 5, payload: { account: "KZ..", apiKey: "secret", nested: { password: "p" } }, nextAttemptAt: 0, createdAt: 0, updatedAt: 0 }))
    const job = await office.query(api.domains.integrations.queries.getIntegrationJob, { externalId: "job-1" })
    expect(job?.payload).toEqual({ account: "KZ..", apiKey: "••••", nested: { password: "••••" } })
  })
})
