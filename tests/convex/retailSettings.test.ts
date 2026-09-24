import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const retail = api.domains.retail

afterEach(() => vi.useRealTimers())

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.domains.finance.seed.seedChartOfAccounts, {})
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["almaty", "shymkent"]) {
      const restaurantId = await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
      const terminalId = await ctx.db.insert("posTerminals", { externalId: `${externalId}-01`, restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
      const employeeId = await ctx.db.insert("employees", { code: `c-${externalId}`, displayName: "Кассир", role: "cashier", restaurantIds: [restaurantId], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
      await ctx.db.insert("posSessions", { tokenHash: await digest(`${externalId}-cashier`), purpose: "operator", employeeId, terminalId, createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 86_400_000 })
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "editor", name: "Редактор", capabilities: ["office.payment-types.view", "office.payment-types.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "e", email: "e@sandyq.test", name: "Алматы", roleExternalId: "editor", restaurantScopes: ["almaty"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), editor: t.withIdentity({ email: "e@sandyq.test" }) }
}

const kaspi = { kind: "payment-type" as const, processorKind: "qr" as const, account: "inTransit", fiscal: true, revenue: true, manualEntry: true, externalAcceptance: true, combinable: true, allowsChange: false, opensCashDrawer: false }
const base = { kind: "payment-type" as const, code: "halyk-qr", name: "Halyk QR", effectiveFrom: 0, sortOrder: 5, restaurantExternalIds: [], data: kaspi }

describe("retail settings (W1-RTL-01/02)", () => {
  it("seeds the defaults idempotently and serves them to the POS", async () => {
    const { t } = await setup()
    expect((await t.mutation(internal.domains.retail.internal.seedDefaults, {})).created).toBe(11)
    expect((await t.mutation(internal.domains.retail.internal.seedDefaults, {})).created).toBe(0)
    const active = await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })
    expect(active.paymentTypes.map((row) => row.code)).toEqual(["cash", "card", "kaspi-qr"])
    expect(active.orderTypes.find((row) => row.code === "dine-in")?.data).toMatchObject({ isDefault: true, serviceChargePercent: 15 })
    expect(active.deletionReasons).toHaveLength(3)
    expect(active.cashOperationTypes.map((row) => row.code)).toEqual(["float-in", "collection"])
    await expect(t.query(retail.queries.activeForPos, { sessionToken: "stranger" })).rejects.toThrow()
  })

  it("draft → publish; editing a published version makes v2 and publishing it expires v1", async () => {
    const { t, admin } = await setup()
    const v1 = await admin.mutation(retail.mutations.saveSetting, base)
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes).toEqual([])
    await admin.mutation(retail.mutations.publishSetting, { externalId: v1 })
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes.map((row) => row.version)).toEqual([1])

    const v2 = await admin.mutation(retail.mutations.saveSetting, { ...base, externalId: v1, name: "Halyk QR (новый)" })
    expect(v2).not.toBe(v1)
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes[0].version).toBe(1) // v1 stays until v2 is published
    await admin.mutation(retail.mutations.publishSetting, { externalId: v2 })
    const rows = await t.run((ctx) => ctx.db.query("retailSettings").take(10))
    expect(rows.map((row) => [row.version, row.status])).toEqual([[1, "expired"], [2, "published"]])
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes.map((row) => row.name)).toEqual(["Halyk QR (новый)"])
    await expect(admin.mutation(retail.mutations.saveSetting, { ...base, externalId: v1 })).rejects.toThrow(/Истёкшую/)
    await expect(admin.mutation(retail.mutations.saveSetting, base)).rejects.toThrow(/уже занят/)

    const audit = await t.run((ctx) => ctx.db.query("auditEvents").take(20))
    expect(audit.filter((row) => row.action === "retail.setting.publish")).toHaveLength(2)
    const outbox = await t.run((ctx) => ctx.db.query("outboxEvents").take(20))
    expect(outbox.filter((row) => row.eventType === "retail.config.published")).toHaveLength(2)
  })

  it("validates data: service charge range, accounts, change only for cash, kind match", async () => {
    const { admin } = await setup()
    const orderType = { kind: "order-type" as const, code: "vip", name: "VIP", effectiveFrom: 0, sortOrder: 1, restaurantExternalIds: [] }
    await expect(admin.mutation(retail.mutations.saveSetting, { ...orderType, data: { kind: "order-type", serviceMode: "dine-in", promptStage: "start", isDefault: false, serviceChargePercent: 31 } })).rejects.toThrow(/0 до 30/)
    await expect(admin.mutation(retail.mutations.saveSetting, { ...base, data: { ...kaspi, account: "acc-9999" } })).rejects.toThrow(/не найден/)
    await expect(admin.mutation(retail.mutations.saveSetting, { ...base, data: { ...kaspi, allowsChange: true } })).rejects.toThrow(/Сдача/)
    await expect(admin.mutation(retail.mutations.saveSetting, { ...orderType, data: kaspi })).rejects.toThrow(/не соответствуют/)
  })

  it("rights and scopes: edit without approve, restaurant-scoped visibility", async () => {
    const { t, admin, editor } = await setup()
    await expect(editor.mutation(retail.mutations.saveSetting, base)).rejects.toThrow(/всей сети/)
    const almatyOnly = await editor.mutation(retail.mutations.saveSetting, { ...base, restaurantExternalIds: ["almaty"] })
    await expect(editor.mutation(retail.mutations.saveSetting, { ...base, code: "x", restaurantExternalIds: ["shymkent"] })).rejects.toThrow()
    await expect(editor.mutation(retail.mutations.publishSetting, { externalId: almatyOnly })).rejects.toThrow()
    await admin.mutation(retail.mutations.publishSetting, { externalId: almatyOnly })
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes).toHaveLength(1)
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "shymkent-cashier" })).paymentTypes).toHaveLength(0)
    const listed = await editor.query(retail.queries.listSettings, { kind: "payment-type", paginationOpts: { numItems: 10, cursor: null } })
    expect(listed.page.map((row) => row.code)).toEqual(["halyk-qr"])
    await expect(editor.query(retail.queries.listSettings, { kind: "order-type", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow()
  })

  it("the cron expires a published version past its end", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-24T12:00:00+05:00") })
    const { t, admin } = await setup()
    const id = await admin.mutation(retail.mutations.saveSetting, { ...base, effectiveTo: Date.parse("2026-09-25T00:00:00+05:00") })
    await admin.mutation(retail.mutations.publishSetting, { externalId: id })
    expect(await t.mutation(internal.domains.retail.internal.expireSettings, {})).toEqual({ expired: 0 })
    vi.setSystemTime(Date.parse("2026-09-25T00:05:00+05:00"))
    expect((await t.query(retail.queries.activeForPos, { sessionToken: "almaty-cashier" })).paymentTypes).toEqual([])
    expect(await t.mutation(internal.domains.retail.internal.expireSettings, {})).toEqual({ expired: 1 })
  })
})
