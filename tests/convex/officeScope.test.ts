import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

// An office user scoped to branch A must never see or change branch B (S-6, S-7).
async function seedTwoBranches(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const branch = async (externalId: string, city: string) => {
      const restaurantId = await ctx.db.insert("restaurants", {
        externalId,
        organizationExternalId: "sandyq",
        name: `Sandyq · ${city}`,
        address: city,
        timezone: "Asia/Almaty",
        city,
        currency: "KZT",
        active: true,
      })
      await ctx.db.insert("posTerminals", { externalId: `${externalId}-01`, restaurantId, name: "Касса 1", terminalNumber: 1, nextOrderNumber: 1, active: true })
      return restaurantId
    }
    const restaurantA = await branch("branch-a", "Алматы")
    const restaurantB = await branch("branch-b", "Шымкент")

    await ctx.db.insert("officeRoles", {
      externalId: "branch-manager",
      name: "Управляющий филиала",
      capabilities: ["office.finance.*", "office.reports.*", "office.stock.*", "office.workforce.*", "office.loyalty.*"],
      system: false,
    })
    await ctx.db.insert("officeUsers", { externalId: "a-manager", email: "a@sandyq.test", name: "Менеджер A", roleExternalId: "branch-manager", restaurantScopes: ["branch-a"], active: true })

    const now = Date.now()
    for (const [restaurantExternalId, amount] of [["branch-a", 1000], ["branch-b", 5000]] as const) {
      await ctx.db.insert("ledgerEntries", {
        restaurantExternalId,
        businessDate: "2026-09-24",
        occurredAt: now,
        kind: "revenue",
        category: "Продажи",
        amount,
        sourceModuleId: "manual",
        sourceExternalId: `seed-${restaurantExternalId}`,
        description: "",
        createdAt: now,
      })
    }
    const itemId = await ctx.db.insert("inventoryItems", { externalId: "flour", name: "Мука", nameSort: "мука", searchText: "мука", unit: "кг", active: true })
    await ctx.db.insert("stockBalances", { restaurantExternalId: "branch-a", inventoryItemId: itemId, quantity: 10, averageUnitCost: 300, updatedAt: now })
    await ctx.db.insert("stockBalances", { restaurantExternalId: "branch-b", inventoryItemId: itemId, quantity: 99, averageUnitCost: 300, updatedAt: now })

    const employee = (code: string, restaurantId: typeof restaurantA) =>
      ctx.db.insert("employees", { code, displayName: `Кассир ${code}`, role: "cashier" as const, restaurantIds: [restaurantId], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    const employeeA = await employee("1001", restaurantA)
    const employeeB = await employee("2001", restaurantB)
    return { employeeA, employeeB }
  })
}

describe("office restaurant scope", () => {
  it("filters every per-restaurant office query to the user's branches", async () => {
    const t = convexTest(schema, modules)
    await seedTwoBranches(t)
    const office = t.withIdentity({ email: "a@sandyq.test" })

    expect((await office.query(api.domains.finance.queries.listEntries, {})).map((entry) => entry.restaurantExternalId)).toEqual(["branch-a"])
    expect(await office.query(api.domains.finance.queries.summary, {})).toMatchObject({ revenue: 1000 })
    await expect(office.query(api.domains.finance.queries.summary, { restaurantExternalId: "branch-b" })).rejects.toThrow("Нет доступа к ресторану")
    expect((await office.query(api.domains.finance.queries.restaurantsForFilter, {})).map((r) => r.externalId)).toEqual(["branch-a"])

    await expect(office.query(api.domains.reports.queries.salesSummary, { restaurantExternalId: "branch-b" })).rejects.toThrow("Нет доступа к ресторану")
    expect((await office.query(api.domains.reports.queries.restaurantsForFilter, {})).map((r) => r.externalId)).toEqual(["branch-a"])

    expect((await office.query(api.domains.workforce.queries.listPosEmployees, {})).map((e) => e.code)).toEqual(["1001"])
    expect((await office.query(api.domains.workforce.queries.listBranches, {})).map((r) => r.externalId)).toEqual(["branch-a"])

    // The guest base is network-wide: a branch-scoped user gets a clear refusal, not other branches' guests.
    await expect(office.query(api.domains.loyalty.queries.listGuests, {})).rejects.toThrow("всем ресторанам сети")
  })

  it("refuses to change employees outside the user's branches", async () => {
    const t = convexTest(schema, modules)
    const { employeeA, employeeB } = await seedTwoBranches(t)
    const office = t.withIdentity({ email: "a@sandyq.test" })

    await expect(office.mutation(api.domains.workforce.mutations.resetPin, { employeeId: employeeB, pin: "4321" })).rejects.toThrow("Сотрудник вне доступных ресторанов")
    await expect(office.mutation(api.domains.workforce.mutations.setEmployeeActive, { employeeId: employeeB, active: false })).rejects.toThrow("Сотрудник вне доступных ресторанов")
    await expect(
      office.mutation(api.domains.workforce.mutations.updateEmployeeAssignment, { employeeId: employeeB, role: "cashier", restaurantExternalIds: ["branch-a"] }),
    ).rejects.toThrow("Сотрудник вне доступных ресторанов")

    await office.mutation(api.domains.workforce.mutations.setEmployeeActive, { employeeId: employeeA, active: false })
    expect(await t.run(async (ctx) => (await ctx.db.get(employeeA))?.active)).toBe(false)
  })
})
