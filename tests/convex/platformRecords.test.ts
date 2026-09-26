import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { resolveSetting } from "../../convex/lib/settings"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const records = api.domains.platform.records
const cashier = "cashier-token"

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", legalName: "ТОО «Sandyq Group»", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const almaty = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Sandyq Алматы", address: "пр. Достык, 97", timezone: "Asia/Almaty", active: true })
    const shymkent = await ctx.db.insert("restaurants", { externalId: "shymkent", organizationExternalId: "sandyq", name: "Sandyq Шымкент", address: "—", timezone: "Asia/Almaty", active: true })
    const terminalId = await ctx.db.insert("posTerminals", { externalId: "t1", restaurantId: almaty, name: "Касса 1", terminalNumber: 1, nextOrderNumber: 1, active: true })
    await ctx.db.insert("posTerminals", { externalId: "t2", restaurantId: shymkent, name: "Касса Шымкент", terminalNumber: 1, nextOrderNumber: 1, active: true })
    const employeeId = await ctx.db.insert("employees", { code: "101", displayName: "Кассир", role: "cashier", restaurantIds: [almaty], pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    await ctx.db.insert("posSessions", { createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 3_600_000, terminalId, tokenHash: await digest(cashier), purpose: "operator", employeeId })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "branch-admin", name: "Администратор филиала", capabilities: ["office.print-templates.*", "office.equipment.*", "office.system-settings.*"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "branch", email: "branch@sandyq.test", name: "Филиал", roleExternalId: "branch-admin", restaurantScopes: ["almaty"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), branch: t.withIdentity({ email: "branch@sandyq.test" }) }
}

const template = (overrides: Record<string, unknown> = {}) => ({
  moduleId: "print-templates" as const,
  name: "Предчек Алматы",
  restaurantExternalId: "almaty",
  businessDate: "2026-09-26",
  data: { documentType: "precheck", language: "ru", copies: 1, widthMm: 80, template: "[center][bold]ПРЕДЧЕК АЛМАТЫ\nИтого || {{totals.total}}" },
  ...overrides,
})

const setting = (key: string, value: string | number | boolean, scope: "organization" | "restaurant" | "terminal", scopeExternalId: string, restaurantExternalId = scopeExternalId) => ({
  moduleId: "system-settings" as const,
  name: key,
  restaurantExternalId,
  businessDate: "2026-09-26",
  data: { key, value, scope, scopeExternalId },
})

describe("print templates (W3-ADM-10)", () => {
  it("rejects an unknown placeholder on save and publishes a valid template for the POS", async () => {
    const { admin, t } = await setup()
    await expect(admin.mutation(records.save, template({ data: { ...template().data, template: "Стол {{order.tabel}}" } }))).rejects.toThrow(/Строка 1: Неизвестный плейсхолдер \{\{order\.tabel\}\}/)
    await expect(admin.mutation(records.save, template({ data: { ...template().data, widthMm: 72 } }))).rejects.toThrow(/58 или 80/)

    // The seed publishes the organization's Sandyq templates; a restaurant's own one wins over them.
    expect(await t.mutation(internal.domains.platform.printTemplates.seedSandyqTemplates, {})).toMatchObject({ created: 4 })
    expect(await t.mutation(internal.domains.platform.printTemplates.seedSandyqTemplates, {})).toMatchObject({ created: 0, existing: 4 })
    let settings = await t.query(api.domains.pos.queries.terminalSettings, { sessionToken: cashier })
    expect(settings.printTemplates.precheck?.name).toBe("Предчек Sandyq")
    expect(settings.printTemplates.receipt?.template).toContain("Қызмет ақысы {{totals.serviceChargePercent}} % / Обслуживание")
    expect(settings.organizationName).toBe("ТОО «Sandyq Group»")

    const saved = await admin.mutation(records.save, template())
    expect(saved.number).toBe("ШП-2026-00005")
    await admin.mutation(records.transition, { moduleId: "print-templates", externalId: saved.externalId, action: "publish", expectedVersion: 1 })
    settings = await t.query(api.domains.pos.queries.terminalSettings, { sessionToken: cashier })
    expect(settings.printTemplates.precheck).toMatchObject({ externalId: saved.externalId, template: template().data.template })

    // A second version replaces the first: one live template per type and place.
    const next = await admin.mutation(records.save, template({ name: "Предчек Алматы v2" }))
    await admin.mutation(records.transition, { moduleId: "print-templates", externalId: next.externalId, action: "publish", expectedVersion: 1 })
    expect((await admin.query(records.get, { moduleId: "print-templates", externalId: saved.externalId }))?.status).toBe("inactive")
    settings = await t.query(api.domains.pos.queries.terminalSettings, { sessionToken: cashier })
    expect(settings.printTemplates.precheck?.externalId).toBe(next.externalId)
  })

  it("renders the preview on demo data and keeps network-wide templates away from a branch user", async () => {
    const { admin, branch } = await setup()
    const preview = await admin.query(api.domains.platform.printTemplates.renderPrintTemplate, { draftTemplate: "<b>{{order.number}}</b>\n{{order.nope}}", documentType: "receipt" })
    expect(preview.lines[0]).toMatchObject({ kind: "text", left: "<b>142</b>" })
    expect(preview.errors).toEqual(["Строка 2: Неизвестный плейсхолдер {{order.nope}}"])

    await expect(branch.mutation(records.save, template({ restaurantExternalId: "organization:sandyq" }))).rejects.toThrow(/всем ресторанам сети/)
    await expect(branch.mutation(records.save, template({ restaurantExternalId: "shymkent" }))).rejects.toThrow(/Нет доступа к ресторану/)
    const network = await admin.mutation(records.save, template({ restaurantExternalId: "organization:sandyq" }))
    const own = await branch.mutation(records.save, template())
    const listed = await branch.query(records.list, { moduleId: "print-templates", paginationOpts: { numItems: 20, cursor: null } })
    expect(listed.page.map((row) => row.externalId)).toEqual([own.externalId])
    expect(await branch.query(records.get, { moduleId: "print-templates", externalId: network.externalId })).toBeNull()
    const all = await admin.query(records.list, { moduleId: "print-templates", paginationOpts: { numItems: 20, cursor: null } })
    expect(all.page).toHaveLength(2)
  })
})

describe("equipment (W3-ADM-11)", () => {
  const equipment = (data: Record<string, string | number | boolean | null>, routing?: { station: string; printerExternalId: string }[]) => ({
    moduleId: "equipment" as const,
    name: "Принтер горячего цеха",
    restaurantExternalId: "almaty",
    businessDate: "2026-09-26",
    data: { type: "kitchen-printer", serial: "SN-1", driver: "ESC/POS", endpoint: "192.168.1.50:9100", terminalExternalId: "t1", ...data },
    ...(routing ? { routing } : {}),
  })

  it("adds a kitchen printer for «Горячий цех» and refuses a terminal of another restaurant", async () => {
    const { admin } = await setup()
    await expect(admin.mutation(records.save, equipment({ terminalExternalId: "t2" }))).rejects.toThrow(/Терминал относится к другому ресторану/)
    await expect(admin.mutation(records.save, equipment({ endpoint: "192.168.1.50 9100" }))).rejects.toThrow(/без пробелов/)
    const printer = await admin.mutation(records.save, equipment({}, [{ station: "hot", printerExternalId: "self" }]))
    const stored = await admin.query(records.get, { moduleId: "equipment", externalId: printer.externalId })
    expect(stored).toMatchObject({ status: "active", routing: [{ station: "hot", printerExternalId: "self" }], lookupKey: "terminal|t1" })

    // The receipt printer sends the bar to the kitchen printer; a scale cannot route, a station is listed once.
    await admin.mutation(records.save, equipment({ type: "receipt-printer" }, [{ station: "bar", printerExternalId: printer.externalId }]))
    await expect(admin.mutation(records.save, equipment({ type: "scale" }, [{ station: "hot", printerExternalId: "self" }]))).rejects.toThrow(/только у принтеров/)
    await expect(admin.mutation(records.save, equipment({}, [{ station: "hot", printerExternalId: "self" }, { station: "hot", printerExternalId: "self" }]))).rejects.toThrow(/указана дважды/)
    await expect(admin.mutation(records.save, equipment({}, [{ station: "hot", printerExternalId: "equipment-missing" }]))).rejects.toThrow(/не найден/)
    await expect(admin.mutation(records.save, { ...equipment({}), restaurantExternalId: "organization:sandyq" })).rejects.toThrow(/привязывается к ресторану/)
  })
})

describe("system settings (W3-ADM-12)", () => {
  it("resolves terminal → restaurant → organization → default", async () => {
    const { admin, t } = await setup()
    const read = () => t.run((ctx) => resolveSetting(ctx, "security.posIdleLockMinutes", { organizationExternalId: "sandyq", restaurantExternalId: "almaty", terminalExternalId: "t1" }))
    expect(await read()).toEqual({ value: 5, source: "default" })

    const publish = async (args: ReturnType<typeof setting>) => {
      const saved = await admin.mutation(records.save, args)
      await admin.mutation(records.transition, { moduleId: "system-settings", externalId: saved.externalId, action: "publish", expectedVersion: 1 })
      return saved
    }
    await publish(setting("security.posIdleLockMinutes", 15, "organization", "sandyq", "organization:sandyq"))
    expect(await read()).toMatchObject({ value: 15, source: "organization" })
    await publish(setting("security.posIdleLockMinutes", "10", "restaurant", "almaty"))
    expect(await read()).toMatchObject({ value: 10, source: "restaurant" })
    const terminal = await publish(setting("security.posIdleLockMinutes", 2, "terminal", "t1", "almaty"))
    expect(await read()).toMatchObject({ value: 2, source: "terminal", recordExternalId: terminal.externalId })

    // The POS reads its idle lock from the setting.
    expect((await t.query(api.domains.pos.queries.terminalSettings, { sessionToken: cashier })).idleLockMinutes).toBe(2)
    await admin.mutation(records.transition, { moduleId: "system-settings", externalId: terminal.externalId, action: "deactivate", expectedVersion: 2 })
    expect((await t.query(api.domains.pos.queries.terminalSettings, { sessionToken: cashier })).idleLockMinutes).toBe(10)

    // Another restaurant inherits only the organization's value; JSON settings keep their shape.
    expect(await t.run((ctx) => resolveSetting(ctx, "security.posIdleLockMinutes", { organizationExternalId: "sandyq", restaurantExternalId: "shymkent" }))).toMatchObject({ value: 15, source: "organization" })
    expect(await t.run((ctx) => resolveSetting(ctx, "accounting.foodCostThresholds", { organizationExternalId: "sandyq" }))).toEqual({ value: { warningFrom: 30, dangerAbove: 35 }, source: "default" })
  })

  it("rejects an unknown key, a value of the wrong type and a scope the key does not allow", async () => {
    const { admin, t } = await setup()
    await expect(t.run((ctx) => resolveSetting(ctx, "security.nope" as never, { organizationExternalId: "sandyq" }))).rejects.toThrow(/Неизвестная настройка «security.nope»/)
    await expect(admin.mutation(records.save, setting("security.nope", 1, "restaurant", "almaty"))).rejects.toThrow(/Неизвестная настройка/)
    await expect(admin.mutation(records.save, setting("security.posIdleLockMinutes", "пять", "restaurant", "almaty"))).rejects.toThrow(/должно быть числом/)
    await expect(admin.mutation(records.save, setting("security.posIdleLockMinutes", 500, "restaurant", "almaty"))).rejects.toThrow(/от 1 до 120/)
    await expect(admin.mutation(records.save, setting("accounting.foodCostThresholds", "{\"warningFrom\": 40, \"dangerAbove\": 35}", "restaurant", "almaty"))).rejects.toThrow(/warningFrom < dangerAbove/)
    await expect(admin.mutation(records.save, setting("accounting.foodCostThresholds", "{не json", "restaurant", "almaty"))).rejects.toThrow(/Некорректный JSON/)
    await expect(admin.mutation(records.save, setting("tax.vatRate", 12, "restaurant", "almaty"))).rejects.toThrow(/только для: организации/)
    await expect(admin.mutation(records.save, setting("security.posIdleLockMinutes", 3, "terminal", "t2", "almaty"))).rejects.toThrow(/другому ресторану/)
    const saved = await admin.mutation(records.save, setting("accounting.foodCostThresholds", "{\"warningFrom\": 28, \"dangerAbove\": 33}", "restaurant", "almaty"))
    expect((await admin.query(records.get, { moduleId: "system-settings", externalId: saved.externalId }))?.data).toMatchObject({ category: "accounting", valueType: "json", value: "{\"warningFrom\":28,\"dangerAbove\":33}" })
  })
})
