import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { SYSTEM_ROLES } from "../../convex/lib/systemRoles"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const access = api.domains.office.access

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    for (const [org, restaurants] of [["sandyq", ["almaty", "shymkent"]], ["tary", ["tary-1"]]] as const) {
      await ctx.db.insert("organizations", { externalId: org, name: org, currency: "KZT", timezone: "Asia/Almaty", active: true })
      for (const externalId of restaurants) {
        await ctx.db.insert("restaurants", { externalId, organizationExternalId: org, name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
      }
    }
  })
  await t.mutation(internal.domains.office.internal.seedSystemRoles, {})
  await t.run(async (ctx) => {
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "manager", email: "manager@sandyq.test", name: "Управляющий", roleExternalId: "almaty-hr", restaurantScopes: ["almaty"], active: true })
    await ctx.db.insert("officeRoles", { externalId: "almaty-hr", name: "Кадры Алматы", capabilities: ["office.users.view", "office.users.edit", "office.roles.view", "office.roles.edit", "office.employees.view"], system: false })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), manager: t.withIdentity({ email: "manager@sandyq.test" }) }
}

const user = (overrides: Record<string, unknown> = {}) => ({
  externalId: "cashier-lead",
  email: "lead@sandyq.test",
  name: "Старший кассир",
  roleExternalId: "report-viewer",
  restaurantScopes: ["almaty"],
  warehouseScopes: [] as string[],
  active: true,
  ...overrides,
})

describe("system roles (W1-ACL-03)", () => {
  it("seeds seven roles once, the administrator with full access", async () => {
    const { t } = await setup()
    const again = await t.mutation(internal.domains.office.internal.seedSystemRoles, {})
    expect(again).toMatchObject({ created: 0, updated: 0 })
    const roles = await t.run((ctx) => ctx.db.query("officeRoles").collect())
    expect(roles.filter((role) => role.system).map((role) => role.externalId).sort()).toEqual(SYSTEM_ROLES.map((role) => role.externalId).sort())
    expect(roles.find((role) => role.externalId === "administrator")?.capabilities).toEqual(["*"])
    expect(roles.find((role) => role.externalId === "report-viewer")?.capabilities.every((capability) => capability.endsWith(".view"))).toBe(true)
  })

  it("a seeded role gets the actions its sections gained later (W3), never a section the office took away", async () => {
    const { t } = await setup()
    await t.run(async (ctx) => {
      const hr = (await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", "hr-payroll")).unique())!
      const manager = (await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", "restaurant-manager")).unique())!
      // As seeded before W3: motivation without approve, medical records without the approval actions.
      await ctx.db.patch(hr._id, { capabilities: hr.capabilities.filter((right) => !["office.motivation.approve", "office.medical-records.approve", "office.medical-records.cancel"].includes(right)) })
      // The office took medical records away from the restaurant manager.
      await ctx.db.patch(manager._id, { capabilities: manager.capabilities.filter((right) => !right.startsWith("office.medical-records.")) })
    })
    const result = await t.mutation(internal.domains.office.internal.seedSystemRoles, {})
    expect(result.updated).toBeGreaterThanOrEqual(1)
    const roles = await t.run((ctx) => ctx.db.query("officeRoles").collect())
    const hr = roles.find((role) => role.externalId === "hr-payroll")!.capabilities
    expect(hr).toEqual(expect.arrayContaining(["office.motivation.approve", "office.medical-records.approve", "office.medical-records.cancel"]))
    expect(roles.find((role) => role.externalId === "restaurant-manager")!.capabilities.some((right) => right.startsWith("office.medical-records."))).toBe(false)
    expect((await t.mutation(internal.domains.office.internal.seedSystemRoles, {})).updated).toBe(0)
  })

  it("lists roles with the number of sections they cover", async () => {
    const { admin } = await setup()
    const data = await admin.query(access.listAccessControl, {})
    expect(data.roles.find((role) => role.externalId === "administrator")).toMatchObject({ fullAccess: true, sectionCount: 91 })
    expect(data.roles.find((role) => role.externalId === "report-viewer")?.sectionCount).toBe(3)
    expect(data.roles.find((role) => role.externalId === "accountant")?.sectionCount).toBe(15)
  })
})

describe("M-6 scope backfill (W1-ACL-02)", () => {
  it("dry run writes nothing; the run fills scopes once; admins get *", async () => {
    const { t } = await setup()
    const page = { numItems: 100, cursor: null }
    const dry = await t.mutation(internal.domains.office.migrations.m6BackfillScopes, { paginationOpts: page, dryRun: true })
    expect(dry).toMatchObject({ patched: 2, skipped: 0 })
    expect((await t.run((ctx) => ctx.db.query("officeUsers").collect())).every((row) => row.organizationScopes === undefined)).toBe(true)
    await t.mutation(internal.domains.office.migrations.m6BackfillScopes, { paginationOpts: page })
    const users = await t.run((ctx) => ctx.db.query("officeUsers").collect())
    expect(users.find((row) => row.externalId === "admin")).toMatchObject({ organizationScopes: ["*"], warehouseScopes: ["*"] })
    expect(users.find((row) => row.externalId === "manager")).toMatchObject({ organizationScopes: ["sandyq"], warehouseScopes: ["*"] })
    const second = await t.mutation(internal.domains.office.migrations.m6BackfillScopes, { paginationOpts: page })
    expect(second).toMatchObject({ patched: 0, skipped: 2 })
  })
})

describe("saveRole / saveUser rules (W1-ACL-04)", () => {
  it("rejects unknown rights, an administrator without *, and rights the editor lacks", async () => {
    const { admin, manager } = await setup()
    await expect(admin.mutation(access.saveRole, { externalId: "x", name: "X", fullAccess: false, capabilities: ["office.nowhere.view"] })).rejects.toThrow(/Неизвестное право/)
    await expect(admin.mutation(access.saveRole, { externalId: "administrator", name: "Администратор", fullAccess: false, capabilities: ["office.reports.view"] })).rejects.toThrow(/полный доступ/)
    await expect(manager.mutation(access.saveRole, { externalId: "cfo", name: "Финдиректор", fullAccess: false, capabilities: ["office.payments.approve"] })).rejects.toThrow(/которого нет у вас/)
    await expect(manager.mutation(access.saveRole, { externalId: "all", name: "Все", fullAccess: true, capabilities: [] })).rejects.toThrow(/которого нет у вас/)
    await expect(admin.mutation(access.saveRole, { externalId: "Кассир", name: "Кассир", fullAccess: false, capabilities: ["office.reports.view"] })).rejects.toThrow(/Заполните код/)
    const saved = await admin.mutation(access.saveRole, { externalId: "Cashier Analyst", name: "Кассир-аналитик", fullAccess: false, capabilities: ["office.reports.view"] })
    expect(saved).toBe("cashier-analyst")
  })

  it("keeps users inside the editor's restaurants and organizations", async () => {
    const { admin, manager } = await setup()
    await admin.mutation(access.saveRole, { externalId: "hr-almaty", name: "Кадры", fullAccess: false, capabilities: ["office.employees.view"] })
    await expect(manager.mutation(access.saveUser, user({ roleExternalId: "hr-almaty", restaurantScopes: ["shymkent"] }))).rejects.toThrow(/вне вашей области/)
    await expect(manager.mutation(access.saveUser, user({ roleExternalId: "accountant" }))).rejects.toThrow(/которого нет у вас/)
    await manager.mutation(access.saveUser, user({ roleExternalId: "hr-almaty" }))
    const created = await admin.query(access.listAccessControl, {})
    expect(created.users.find((row) => row.externalId === "cashier-lead")).toMatchObject({ organizationScopes: ["sandyq"], restaurantScopes: ["almaty"] })
    await expect(admin.mutation(access.saveUser, user({ externalId: "other", email: "lead@sandyq.test" }))).rejects.toThrow(/таким email/)
  })

  it("does not let an editor switch themselves off", async () => {
    const { admin } = await setup()
    await expect(admin.mutation(access.setUserActive, { externalId: "admin", active: false })).rejects.toThrow(/собственную/)
    await expect(admin.mutation(access.saveUser, user({ externalId: "admin", email: "admin@sandyq.test", roleExternalId: "administrator", restaurantScopes: ["*"], active: false }))).rejects.toThrow(/собственную/)
    await admin.mutation(access.setUserActive, { externalId: "manager", active: false })
  })

  it("a branch editor sees users of their organization only", async () => {
    const { t, manager } = await setup()
    await t.run((ctx) => ctx.db.insert("officeUsers", { externalId: "tary-boss", email: "boss@tary.test", name: "Tary", roleExternalId: "report-viewer", restaurantScopes: ["tary-1"], active: true }))
    const data = await manager.query(access.listAccessControl, {})
    expect(data.users.map((row) => row.externalId)).not.toContain("tary-boss")
    expect(data.restaurants.map((row) => row.externalId)).toEqual(["almaty"])
  })
})

describe("setOfficePassword (W1-ACL-07)", () => {
  it("refuses an inactive office user and a weak password", async () => {
    const { t } = await setup()
    await t.run((ctx) => ctx.db.insert("officeUsers", { externalId: "gone", email: "gone@sandyq.test", name: "Уволен", roleExternalId: "report-viewer", restaurantScopes: ["almaty"], active: false }))
    await expect(t.action(internal.domains.office.adminMaintenance.setOfficePassword, { email: "gone@sandyq.test", password: "StrongPass2026" })).rejects.toThrow(/Активный офисный пользователь не найден/)
    await expect(t.action(internal.domains.office.adminMaintenance.setOfficePassword, { email: "admin@sandyq.test", password: "short" })).rejects.toThrow(/минимум 10 символов/)
    await expect(t.action(internal.domains.office.adminMaintenance.setOfficePassword, { email: "admin@sandyq.test", password: "alllowercase123" })).rejects.toThrow(/заглавная/)
  })

  it("keeps passwords out of the repository", async () => {
    const { readFileSync } = await import("node:fs")
    const script = readFileSync("scripts/set-office-password.sh", "utf8")
    expect(script).toMatch(/read -r -s/)
    expect(script).not.toMatch(/PASSWORD=["'][^"'$]/)
  })
})
