import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

async function office(t: Awaited<ReturnType<typeof setup>>["t"]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("iikoDepartments", { externalId: "dep-almaty", name: "Sandyq Алматы", type: "DEPARTMENT", sourceHash: "h", importedAt: 0 })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "none", name: "Нет", capabilities: ["office.guests.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "n", email: "n@sandyq.test", name: "Нет", roleExternalId: "none", restaurantScopes: ["almaty"], active: true })
  })
  return { admin: t.withIdentity({ email: "admin@sandyq.test" }), stranger: t.withIdentity({ email: "n@sandyq.test" }) }
}

const empty = { departments: [], employees: [] }
const store = { externalId: "st-1", parentExternalId: "dep-almaty", code: "ALM", name: "Склад Алматы", deleted: false, payloadHash: "a" }
const terminal = { externalId: "term-1", name: "Касса iiko 1", anonymous: false, departmentExternalId: "dep-almaty", deleted: false, payloadHash: "b" }

describe("iiko stock master projections (W1-IIKO-02/03/06)", () => {
  it("skips stores and terminals of an unlinked department, never the first restaurant (B-24)", async () => {
    const { t } = await setup()
    await office(t)
    const result = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, warehouses: [store], terminals: [terminal] })
    expect(result.skipped["corporation/stores"]).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.query("warehouses").take(5))).toEqual([])
    const state = await t.run((ctx) => ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key", (q) => q.eq("endpointKey", "corporation/terminals")).unique())
    expect(state?.message).toMatch(/не сопоставлено/)
  })

  it("with a link: store and an inactive terminal with the next number; re-import changes nothing; anonymous skipped", async () => {
    const { t } = await setup()
    const { admin, stranger } = await office(t)
    await expect(stranger.mutation(api.domains.iiko.office.linkRestaurantToIikoDepartment, { restaurantExternalId: "almaty", iikoDepartmentExternalId: "dep-almaty" })).rejects.toThrow()
    await admin.mutation(api.domains.iiko.office.linkRestaurantToIikoDepartment, { restaurantExternalId: "almaty", iikoDepartmentExternalId: "dep-almaty" })
    const units = [{ externalId: "u-kg", code: "кг", name: "Килограмм", deleted: false, payloadHash: "c" }]
    const suppliers = [{ externalId: "sup-1", name: "ТОО Мясо", isSupplier: true, deleted: false, payloadHash: "d" }, { externalId: "cl-1", name: "Клиент", isSupplier: false, deleted: false, payloadHash: "e" }]
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, warehouses: [store], terminals: [terminal, { ...terminal, externalId: "anon", anonymous: true }], units, suppliers })
    const [warehouse] = await t.run((ctx) => ctx.db.query("warehouses").take(5))
    expect(warehouse).toMatchObject({ restaurantExternalId: "almaty", iikoStoreExternalId: "st-1", isSalesDefault: false, sourceSystem: "iiko-server" })
    const imported = (await t.run((ctx) => ctx.db.query("posTerminals").take(5))).find((row) => row.externalId === "iiko-terminal-term-1")!
    expect(imported).toMatchObject({ active: false, terminalNumber: 2, kind: "pos" })
    expect((await t.run((ctx) => ctx.db.query("posTerminals").take(5))).find((row) => row.externalId === "iiko-terminal-anon")).toBeUndefined()
    expect(await t.run((ctx) => ctx.db.query("units").take(5))).toMatchObject([{ externalId: "iiko-unit-u-kg", dimension: "mass" }])
    expect((await t.run((ctx) => ctx.db.query("suppliers").take(5))).map((row) => row.externalId)).toEqual(["iiko-supplier-sup-1"])

    const again = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, warehouses: [store], terminals: [terminal], units, suppliers })
    expect(again.changed).toEqual({ "corporation/stores": 0, "corporation/terminals": 0, "v2/entities/list?rootType=MeasureUnit": 0, suppliers: 0 })
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, terminals: [{ ...terminal, name: "Касса iiko 1 (новая)", payloadHash: "b2" }] })
    expect((await t.run((ctx) => ctx.db.query("posTerminals").withIndex("by_external_id", (q) => q.eq("externalId", "iiko-terminal-term-1")).unique()))?.terminalNumber).toBe(2)

    const links = await admin.query(api.domains.iiko.office.restaurantLinkOptions, {})
    expect(links.restaurants[0]).toMatchObject({ restaurantExternalId: "almaty", iikoDepartmentName: "Sandyq Алматы" })
    const overview = await admin.query(api.domains.iiko.office.integrationOverview, {})
    expect(overview.kpis.mirrored).toBe(4)
    await expect(stranger.query(api.domains.iiko.office.integrationOverview, {})).rejects.toThrow()
  })
})
