import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { isValidPin } from "../../convex/lib/policy"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

async function seedBranches(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const base = { organizationExternalId: "sandyq", address: "—", timezone: "Asia/Almaty", currency: "KZT" }
    const almaty = await ctx.db.insert("restaurants", { ...base, externalId: "almaty", name: "Sandyq Алматы", city: "Алматы", active: true })
    const closed = await ctx.db.insert("restaurants", { ...base, externalId: "closed", name: "Закрытый филиал", city: "Тараз", active: false })
    const noTerminals = await ctx.db.insert("restaurants", { ...base, externalId: "iiko-only", name: "Только в iiko", active: true })
    void noTerminals
    const terminal = { nextOrderNumber: 1 }
    await ctx.db.insert("posTerminals", { ...terminal, externalId: "almaty-01", restaurantId: almaty, name: "Главная касса", terminalNumber: 1, active: true })
    await ctx.db.insert("posTerminals", { ...terminal, externalId: "almaty-02", restaurantId: almaty, name: "Касса выдачи", terminalNumber: 2, active: true })
    await ctx.db.insert("posTerminals", { ...terminal, externalId: "almaty-03", restaurantId: almaty, name: "Старая касса", terminalNumber: 3, active: false })
    await ctx.db.insert("posTerminals", { ...terminal, externalId: "closed-01", restaurantId: closed, name: "Касса", terminalNumber: 1, active: true })
    await ctx.db.insert("employees", { code: "101", displayName: "Кассир", role: "cashier", restaurantIds: [almaty], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
  })
}

describe("posTerminalOptions (W0-POS-01)", () => {
  it("lists only active terminals of active branches, with no ids or staff", async () => {
    const t = convexTest(schema, modules)
    await seedBranches(t)
    const options = await t.query(api.domains.auth.queries.posTerminalOptions, {})
    expect(options).toEqual([
      {
        restaurantExternalId: "almaty",
        restaurantName: "Sandyq Алматы",
        city: "Алматы",
        address: "—",
        terminals: [
          { externalId: "almaty-01", name: "Главная касса", terminalNumber: 1 },
          { externalId: "almaty-02", name: "Касса выдачи", terminalNumber: 2 },
        ],
      },
    ])
    expect(JSON.stringify(options)).not.toMatch(/_id|Кассир|pin/i)
  })
})

describe("PIN length rule (W0-POS-02)", () => {
  it("accepts 4–6 digits only", () => {
    expect(["1234", "12345", "123456"].every(isValidPin)).toBe(true)
    expect(["123", "1234567", "12a4", ""].some(isValidPin)).toBe(false)
  })

  it("rejects a 7-digit PIN at login with the generic message", async () => {
    const t = convexTest(schema, modules)
    await seedBranches(t)
    await expect(t.action(api.domains.auth.actions.login, { employeeCode: "101", pin: "1234567", terminalExternalId: "almaty-01", purpose: "operator" })).rejects.toThrow(
      /Неверный код сотрудника или PIN/,
    )
  })
})
