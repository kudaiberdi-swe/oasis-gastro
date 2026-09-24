import { convexTest, type TestConvex } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { resolvePrice, resolveSizedPrice } from "../../convex/lib/pricing"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (local: string) => Date.parse(`${local}+05:00`)

afterEach(() => vi.useRealTimers())

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["almaty", "shymkent"]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("categories", { externalId: "drinks", label: "Сусындар / Напитки", shortLabel: "Напитки", sortOrder: 1, active: true })
    await ctx.db.insert("products", { externalId: "shubat", name: "Шұбат", nameKk: "Шұбат", nameSort: "шұбат", searchText: "шұбат", description: "", category: "drinks", categorySort: 1, basePrice: 1000, popular: false, sku: "SH", baseUnit: "порц.", enabled: true })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "almaty-pricing", name: "Цены Алматы", capabilities: ["office.price-orders.view", "office.price-orders.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["sandyq"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "a", email: "a@sandyq.test", name: "Алматы", roleExternalId: "almaty-pricing", restaurantScopes: ["almaty"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), almaty: t.withIdentity({ email: "a@sandyq.test" }) }
}

const product = (t: TestConvex<typeof schema>) => t.run(async (ctx) => (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "shubat")).unique())!)
const priceAt = (t: TestConvex<typeof schema>, restaurantExternalId: string, moment: number) =>
  t.run(async (ctx) => resolvePrice(ctx, { product: (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "shubat")).unique())!, restaurantExternalId, at: moment }))

async function draftOrder(admin: ReturnType<TestConvex<typeof schema>["withIdentity"]>, overrides: Record<string, unknown> = {}) {
  const { externalId, number } = await admin.mutation(api.domains.pricing.mutations.createDraft, {})
  await admin.mutation(api.domains.pricing.mutations.save, {
    externalId,
    name: "Осеннее меню",
    effectiveFrom: at("2026-10-01T00:00:00"),
    effectiveTo: at("2026-11-01T00:00:00"),
    comment: "",
    posName: "Осень",
    replacesPreviousMenu: false,
    restaurantExternalIds: [],
    schedule: null,
    lines: [{ productExternalId: "shubat", included: true, newPrice: 1200 }],
    ...overrides,
  })
  return { externalId, number }
}

describe("price orders (W1-CAT-10)", () => {
  it("draft → scheduled → active → expired; the price follows the dates without touching the product", async () => {
    vi.useFakeTimers({ now: at("2026-09-24T12:00:00") })
    const { t, admin } = await setup()
    const { externalId, number } = await draftOrder(admin)
    expect(number).toBe("ЦЕН-2026-00001")
    expect(await admin.mutation(api.domains.pricing.mutations.publish, { externalId })).toBe("scheduled")

    expect((await priceAt(t, "almaty", at("2026-09-30T23:59:00"))).price).toBe(1000)
    expect(await priceAt(t, "almaty", at("2026-10-05T12:00:00"))).toEqual({ price: 1200, source: "price-order", priceOrderId: externalId })
    expect((await priceAt(t, "almaty", at("2026-11-02T12:00:00"))).price).toBe(1000)

    vi.setSystemTime(at("2026-10-01T00:00:30"))
    await t.mutation(internal.domains.pricing.crons.reconcileStatuses, {})
    expect((await admin.query(api.domains.pricing.queries.get, { externalId }))?.status).toBe("active")
    vi.setSystemTime(at("2026-11-01T00:00:30"))
    await t.mutation(internal.domains.pricing.crons.reconcileStatuses, {})
    expect((await admin.query(api.domains.pricing.queries.get, { externalId }))?.status).toBe("expired")
    expect((await product(t)).basePrice).toBe(1000)
  })

  it("a weekday schedule does not apply on Sunday", async () => {
    vi.useFakeTimers({ now: at("2026-09-24T12:00:00") })
    const { t, admin } = await setup()
    const { externalId } = await draftOrder(admin, { schedule: { name: "Завтраки", startMinute: 7 * 60, endMinute: 11 * 60, weekdays: [1, 2, 3, 4, 5] } })
    await admin.mutation(api.domains.pricing.mutations.publish, { externalId })
    expect((await priceAt(t, "almaty", at("2026-10-05T08:00:00"))).price).toBe(1200) // Monday 08:00
    expect((await priceAt(t, "almaty", at("2026-10-04T08:00:00"))).price).toBe(1000) // Sunday
    expect((await priceAt(t, "almaty", at("2026-10-05T12:00:00"))).price).toBe(1000) // Monday after 11:00
  })

  it("a Shymkent order neither prices Almaty nor shows to an Almaty-only user; active orders are frozen", async () => {
    vi.useFakeTimers({ now: at("2026-10-10T12:00:00") })
    const { t, admin, almaty } = await setup()
    const { externalId } = await draftOrder(admin, { restaurantExternalIds: ["shymkent"] })
    await admin.mutation(api.domains.pricing.mutations.publish, { externalId })
    expect((await priceAt(t, "shymkent", Date.now())).price).toBe(1200)
    expect((await priceAt(t, "almaty", Date.now())).price).toBe(1000)
    const visible = await almaty.query(api.domains.pricing.queries.list, { paginationOpts: { numItems: 20, cursor: null } })
    expect(visible.page).toHaveLength(0)
    expect(await almaty.query(api.domains.pricing.queries.get, { externalId })).toBeNull()
    await expect(admin.mutation(api.domains.pricing.mutations.save, { externalId, name: "X", effectiveFrom: 1, comment: "", posName: "", replacesPreviousMenu: false, restaurantExternalIds: [], schedule: null, lines: [] })).rejects.toThrow(/только черновик/)
    await expect(almaty.mutation(api.domains.pricing.mutations.createDraft, {}).then((draft) => almaty.mutation(api.domains.pricing.mutations.save, { externalId: draft.externalId, name: "Все", effectiveFrom: 1, comment: "", posName: "", replacesPreviousMenu: false, restaurantExternalIds: ["shymkent"], schedule: null, lines: [] }))).rejects.toThrow(/Нет доступа/)
  })

  it("two overlapping orders resolve deterministically", async () => {
    vi.useFakeTimers({ now: at("2026-09-24T12:00:00") })
    const { t, admin } = await setup()
    const first = await draftOrder(admin, { lines: [{ productExternalId: "shubat", included: true, newPrice: 1100 }] })
    const second = await draftOrder(admin, { lines: [{ productExternalId: "shubat", included: true, newPrice: 1300 }] })
    await admin.mutation(api.domains.pricing.mutations.publish, { externalId: first.externalId })
    await admin.mutation(api.domains.pricing.mutations.publish, { externalId: second.externalId })
    expect((await priceAt(t, "almaty", at("2026-10-05T12:00:00"))).priceOrderId).toBe(second.externalId)
  })
})

describe("size scales (W1-CAT-09)", () => {
  const scale = (options: { label: string; coefficient: number; isDefault: boolean; externalId?: string }[]) => ({
    name: "Шұбат",
    options: options.map((option, index) => ({ ...option, kitchenLabel: option.label, sortOrder: index, available: true })),
    productExternalIds: ["shubat"],
  })

  it("needs one default and positive coefficients; prices are base × coefficient, a size line wins", async () => {
    vi.useFakeTimers({ now: at("2026-09-24T12:00:00") })
    const { t, admin } = await setup()
    await expect(admin.mutation(api.domains.sizeScales.mutations.save, scale([{ label: "0,2 л", coefficient: 1, isDefault: true }, { label: "1 л", coefficient: 3.35, isDefault: true }]))).rejects.toThrow(/ровно один/)
    await expect(admin.mutation(api.domains.sizeScales.mutations.save, scale([{ label: "0,2 л", coefficient: 0, isDefault: true }]))).rejects.toThrow(/больше нуля/)
    const scaleId = await admin.mutation(api.domains.sizeScales.mutations.save, scale([{ label: "0,2 л", coefficient: 1, isDefault: true }, { label: "1 л", coefficient: 3.35, isDefault: false }]))
    const saved = (await admin.query(api.domains.sizeScales.queries.get, { externalId: scaleId }))!
    expect(saved.products.map((row) => row.externalId)).toEqual(["shubat"])
    const liter = saved.options.find((option) => option.label === "1 л")!

    const sized = () =>
      t.run(async (ctx) => {
        const option = (await ctx.db.query("sizeOptions").withIndex("by_external_id", (q) => q.eq("externalId", liter.externalId)).unique())!
        const shubat = (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "shubat")).unique())!
        return resolveSizedPrice(ctx, { product: shubat, restaurantExternalId: "almaty", at: at("2026-10-05T12:00:00"), sizeOption: option })
      })
    expect(await sized()).toEqual({ price: 3350, source: "base" })
    const { externalId } = await draftOrder(admin, { lines: [{ productExternalId: "shubat", sizeOptionExternalId: liter.externalId, included: true, newPrice: 2850 }] })
    await admin.mutation(api.domains.pricing.mutations.publish, { externalId })
    expect((await sized()).price).toBe(2850)

    await expect(
      admin.mutation(api.domains.sizeScales.mutations.save, { ...scale([{ label: "0,2 л", coefficient: 1, isDefault: true, externalId: saved.options[0].externalId }]), externalId: scaleId }),
    ).rejects.toThrow(/есть в приказе/)
  })
})
