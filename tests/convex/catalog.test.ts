import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import { categoryPrepArea } from "../../convex/domains/catalog/migrations"
import { pickPriceLine, resolvePrice, type PriceLine } from "../../convex/lib/pricing"
import { almatyWeekdayMinute } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const at = (local: string) => Date.parse(`${local}+05:00`)

const line = (overrides: Partial<PriceLine>): PriceLine => ({
  priceOrderId: "po-1",
  number: 1,
  productExternalId: "kazakh-et",
  price: 7000,
  effectiveFrom: at("2026-09-01T00:00:00"),
  restaurantExternalIds: [],
  schedule: [],
  ...overrides,
})

describe("price-order line choice (W1-CAT-02)", () => {
  const query = { productExternalId: "kazakh-et", restaurantExternalId: "almaty", at: at("2026-09-24T12:00:00") }

  it("later effectiveFrom wins, then the higher order number", () => {
    const early = line({ priceOrderId: "early", effectiveFrom: at("2026-09-01T00:00:00"), number: 9 })
    const late = line({ priceOrderId: "late", effectiveFrom: at("2026-09-20T00:00:00"), number: 2 })
    const tie = line({ priceOrderId: "tie", effectiveFrom: at("2026-09-20T00:00:00"), number: 3 })
    expect(pickPriceLine([early, late], query)?.priceOrderId).toBe("late")
    expect(pickPriceLine([early, late, tie], query)?.priceOrderId).toBe("tie")
  })

  it("stops at effectiveTo and respects restaurants and sizes", () => {
    const ending = line({ effectiveTo: at("2026-09-24T12:00:00") })
    expect(pickPriceLine([ending], query)).toBeUndefined()
    expect(pickPriceLine([line({ effectiveTo: at("2026-09-24T12:00:01") })], query)).toBeDefined()
    expect(pickPriceLine([line({ restaurantExternalIds: ["shymkent"] })], query)).toBeUndefined()
    expect(pickPriceLine([line({ sizeOptionId: "1l" })], query)).toBeUndefined()
  })

  it("applies weekday schedules with Sunday as 7", () => {
    expect(almatyWeekdayMinute(at("2026-09-27T10:30:00"))).toEqual({ weekday: 7, minute: 630 })
    const sundayLunch = line({ schedule: [{ weekdays: [7], fromMinute: 600, toMinute: 900 }] })
    expect(pickPriceLine([sundayLunch], { ...query, at: at("2026-09-27T11:00:00") })).toBeDefined()
    expect(pickPriceLine([sundayLunch], { ...query, at: at("2026-09-27T15:00:00") })).toBeUndefined()
    expect(pickPriceLine([sundayLunch], { ...query, at: at("2026-09-26T11:00:00") })).toBeUndefined()
  })
})

async function seedProduct(t: ReturnType<typeof convexTest>, extra: Record<string, unknown> = {}) {
  return t.run(async (ctx) => {
    await ctx.db.insert("categories", { externalId: "salads", label: "Саламтар / Салаты", shortLabel: "Салаты", sortOrder: 1, active: true })
    const productId = await ctx.db.insert("products", {
      externalId: "kazakh-et",
      name: "Қазақ ет",
      nameKk: "Қазақ ет",
      nameSort: "қазақ ет",
      searchText: "қазақ ет",
      description: "",
      category: "salads",
      categorySort: 1,
      basePrice: 5950,
      popular: false,
      sku: "KE",
      baseUnit: "порц.",
      enabled: true,
      ...extra,
    })
    return productId
  })
}

describe("resolvePrice", () => {
  it("branch price, then base price; iiko overlay price wins", async () => {
    const t = convexTest(schema, modules)
    const productId = await seedProduct(t)
    await t.run(async (ctx) => {
      await ctx.db.insert("productPrices", { productId, restaurantExternalId: "almaty", priceKzt: 7990 })
      const product = (await ctx.db.get(productId))!
      expect(await resolvePrice(ctx, { product, restaurantExternalId: "almaty", at: Date.now() })).toEqual({ price: 7990, source: "branch" })
      expect(await resolvePrice(ctx, { product, restaurantExternalId: "turkistan", at: Date.now() })).toEqual({ price: 5950, source: "base" })
      await ctx.db.patch(productId, { sourceSystem: "iiko-server" })
      await ctx.db.insert("iikoEntityOverlays", { overlayKey: "product:kazakh-et", entityType: "product", sourceExternalId: "kazakh-et", localSettings: { price: 8200 } })
      const iiko = (await ctx.db.get(productId))!
      expect(await resolvePrice(ctx, { product: iiko, restaurantExternalId: "almaty", at: Date.now() })).toEqual({ price: 8200, source: "overlay" })
    })
  })
})

describe("M-1 catalog backfill (W1-CAT-01)", () => {
  it("accepts pre-v2 products, fills them once, never invents weights", async () => {
    const t = convexTest(schema, modules)
    const productId = await seedProduct(t)
    const page = { numItems: 100, cursor: null }
    const dry = await t.mutation(internal.domains.catalog.migrations.m1BackfillProducts, { paginationOpts: page, dryRun: true })
    expect(dry.patched).toBe(1)
    expect((await t.run((ctx) => ctx.db.get(productId)))?.itemType).toBeUndefined()
    await t.mutation(internal.domains.catalog.migrations.m1BackfillProducts, { paginationOpts: page })
    const product = await t.run((ctx) => ctx.db.get(productId))
    expect(product).toMatchObject({ itemType: "dish", writeOffMethod: "ingredients", prepArea: "cold", customizable: false })
    expect(product?.unitWeightKg).toBeUndefined()
    const again = await t.mutation(internal.domains.catalog.migrations.m1BackfillProducts, { paginationOpts: page })
    expect(again.patched).toBe(0)
  })

  it("maps categories to kitchen areas and defaults to hot", () => {
    expect(categoryPrepArea("Дәстүрлі сусындар / Традиционные напитки")).toBe("bar")
    expect(categoryPrepArea("Нан-тоқаш өнімдері / Выпечка")).toBe("bakery")
    expect(categoryPrepArea("Саламтар / Салаты")).toBe("cold")
    expect(categoryPrepArea("Негізгі тағамдар / Основные блюда")).toBe("hot")
    expect(categoryPrepArea(undefined)).toBe("hot")
  })

  it("moves untyped overlay data into typed fields", async () => {
    const t = convexTest(schema, modules)
    await t.run((ctx) => ctx.db.insert("iikoEntityOverlays", { overlayKey: "product:x", entityType: "product", sourceExternalId: "x", data: { label: "Бешбармак", popular: true, price: 9000 } }))
    await t.mutation(internal.domains.catalog.migrations.m1bOverlays, { paginationOpts: { numItems: 10, cursor: null } })
    const [overlay] = await t.run((ctx) => ctx.db.query("iikoEntityOverlays").collect())
    expect(overlay).toMatchObject({ label: "Бешбармак", popular: true, localSettings: { price: 9000 }, sourceSystem: "iiko-server" })
    expect(overlay.data).toBeUndefined()
  })
})
