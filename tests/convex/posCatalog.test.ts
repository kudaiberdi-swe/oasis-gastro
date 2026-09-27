import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const branch = async (externalId: string) => {
      const restaurantId = await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: externalId, address: "—", timezone: "Asia/Almaty", active: true })
      const terminalId = await ctx.db.insert("posTerminals", { externalId: `${externalId}-01`, restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
      return { restaurantId, terminalId }
    }
    const almaty = await branch("almaty")
    const shymkent = await branch("shymkent")
    await ctx.db.insert("categories", { externalId: "drinks", label: "Напитки", shortLabel: "Напитки", sortOrder: 1, active: true })
    const scaleId = await ctx.db.insert("sizeScales", { externalId: "shubat-scale", name: "Шұбат", nameSort: "шұбат", searchText: "шұбат", sortOrder: 1 })
    await ctx.db.insert("sizeOptions", { externalId: "small", scaleId, label: "0,2 л", kitchenLabel: "0,2", coefficient: 1, sortOrder: 1, isDefault: true, available: true })
    await ctx.db.insert("sizeOptions", { externalId: "big", scaleId, label: "1 л", kitchenLabel: "1 л", coefficient: 3, sortOrder: 2, isDefault: false, available: false })
    const product = (externalId: string, name: string) =>
      ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name.toLocaleLowerCase("ru"), searchText: name.toLocaleLowerCase("ru"), description: "", category: "drinks", categorySort: 1, basePrice: 1000, popular: false, sku: externalId, baseUnit: "порц.", enabled: true })
    const shubatId = await product("shubat", "Шұбат")
    await ctx.db.patch(shubatId, { sizeScaleId: scaleId })
    const mishuzhykId = await product("mi-shuzhyk", "Ми шұжық")
    await ctx.db.insert("productPrices", { productId: shubatId, restaurantExternalId: "almaty", priceKzt: 850 })
    const employee = async (code: string, role: "cashier" | "manager", restaurantIds: typeof almaty.restaurantId[]) =>
      ctx.db.insert("employees", { code, displayName: code, role, restaurantIds, pinSalt: "s", pinHash: "h", active: true, failedAttempts: 0 })
    const cashierA = await employee("101", "cashier", [almaty.restaurantId])
    const cashierB = await employee("102", "cashier", [shymkent.restaurantId])
    const manager = await employee("900", "manager", [shymkent.restaurantId])
    const session = async (token: string, employeeId: typeof cashierA, terminalId: typeof almaty.terminalId, purpose: "operator" | "manager-approval" = "operator") =>
      ctx.db.insert("posSessions", { tokenHash: await digest(token), purpose, employeeId, terminalId, createdAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 60_000 })
    await session("almaty-cashier", cashierA, almaty.terminalId)
    await session("shymkent-cashier", cashierB, shymkent.terminalId)
    await session("shymkent-manager", manager, shymkent.terminalId, "manager-approval")
    return { shubatId, mishuzhykId }
  })
  return { t, ...ids }
}

const pos = api.domains.catalog.pos

describe("product configuration (W1-CAT-12)", () => {
  it("prices sizes for the session's branch and flags unavailable ones", async () => {
    const { t } = await setup()
    const almaty = (await t.query(pos.getProductConfiguration, { sessionToken: "almaty-cashier", productExternalId: "shubat" }))!
    expect(almaty.product).toMatchObject({ price: 850, available: true })
    expect(almaty.sizes).toEqual([
      expect.objectContaining({ externalId: "small", price: 850, isDefault: true, available: true }),
      expect.objectContaining({ externalId: "big", price: 2550, available: false }),
    ])
    const shymkent = (await t.query(pos.getProductConfiguration, { sessionToken: "shymkent-cashier", productExternalId: "shubat" }))!
    expect(shymkent.product.price).toBe(1000)
    await expect(t.query(pos.getProductConfiguration, { sessionToken: "stranger", productExternalId: "shubat" })).rejects.toThrow()
  })
})

describe("barcode lookup (W3-POS-01)", () => {
  it("finds a product by its barcode at the session's branch price; unknown, hidden, off the branch menu or no session", async () => {
    const { t, shubatId, mishuzhykId } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.patch(shubatId, { barcode: "4870200012345" })
      await ctx.db.patch(mishuzhykId, { barcode: "SQ-0002", enabled: false })
    })
    const found = await t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "almaty-cashier", barcode: " 4870200012345\n" })
    expect(found).toMatchObject({ externalId: "shubat", price: 850, available: true })
    // Shymkent has no price of its own for this dish: it is not on that branch's menu, so the scan finds nothing.
    expect(await t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "shymkent-cashier", barcode: "4870200012345" })).toBeNull()
    expect(await t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "almaty-cashier", barcode: "0000000000000" })).toBeNull()
    expect(await t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "almaty-cashier", barcode: "SQ-0002" })).toBeNull()
    expect(await t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "almaty-cashier", barcode: "   " })).toBeNull()
    await expect(t.query(api.domains.catalog.queries.findByBarcode, { sessionToken: "stranger", barcode: "4870200012345" })).rejects.toThrow()
  })
})

describe("favorites (W1-CAT-13)", () => {
  it("toggles per cashier and skips deleted or stop-listed dishes", async () => {
    const { t, shubatId } = await setup()
    expect(await t.mutation(pos.toggleFavorite, { sessionToken: "almaty-cashier", productExternalId: "shubat" })).toEqual({ favorite: true })
    expect(await t.query(pos.favoriteIds, { sessionToken: "almaty-cashier" })).toEqual(["shubat"])
    expect(await t.query(pos.favoriteIds, { sessionToken: "shymkent-cashier" })).toEqual([])
    const listed = await t.query(pos.favoriteProducts, { sessionToken: "almaty-cashier", paginationOpts: { numItems: 10, cursor: null } })
    expect(listed.page.map((row) => [row.externalId, row.price])).toEqual([["shubat", 850]])
    await t.run((ctx) => ctx.db.patch(shubatId, { enabled: false }))
    expect((await t.query(pos.favoriteProducts, { sessionToken: "almaty-cashier", paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([])
    expect(await t.mutation(pos.toggleFavorite, { sessionToken: "almaty-cashier", productExternalId: "shubat" })).toEqual({ favorite: false })
    expect(await t.query(pos.favoriteIds, { sessionToken: "almaty-cashier" })).toEqual([])
  })
})

describe("stop list (W1-CAT-14)", () => {
  async function addLine(t: TestConvex<typeof schema>, sessionToken: string, productId: Awaited<ReturnType<typeof setup>>["mishuzhykId"]) {
    await t.mutation(api.domains.shifts.mutations.open, { sessionToken, openingCash: 0, note: "" })
    return t.mutation(api.domains.orders.mutations.saveDraft, { sessionToken, clientOrderId: crypto.randomUUID(), tableLabel: "Стол 1", orderType: "dine-in", discountPercent: 0, comment: "", lines: [{ productId, quantity: 1 }] })
  }

  it("a dish stopped in Shymkent cannot be ordered there but can in Almaty; a past `until` frees it", async () => {
    const { t, mishuzhykId } = await setup()
    await t.mutation(pos.setAvailabilityFromPos, { sessionToken: "shymkent-cashier", productExternalId: "mi-shuzhyk", available: false, reason: "Закончилось", managerApprovalToken: "shymkent-manager" })
    await expect(addLine(t, "shymkent-cashier", mishuzhykId)).rejects.toThrow(/нет в наличии/)
    await expect(addLine(t, "almaty-cashier", mishuzhykId)).resolves.toBeDefined()
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("productAvailability").withIndex("by_product", (q) => q.eq("productId", mishuzhykId)).first())!
      await ctx.db.patch(row._id, { until: Date.now() - 1000 })
    })
    const config = await t.query(pos.getProductConfiguration, { sessionToken: "shymkent-cashier", productExternalId: "mi-shuzhyk" })
    expect(config?.product.available).toBe(true)
  })

  it("needs a manager to stop a dish from the POS", async () => {
    const { t } = await setup()
    await expect(t.mutation(pos.setAvailabilityFromPos, { sessionToken: "shymkent-cashier", productExternalId: "mi-shuzhyk", available: false, reason: "Закончилось" })).rejects.toThrow(/подтверждение менеджера/)
  })
})
