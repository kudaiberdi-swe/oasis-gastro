import { convexTest, type TestConvex } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { calculateRecipe, foodCostPercent, recipeChecks } from "../../convex/lib/recipeMath"
import { recipeVersionAt } from "../../convex/lib/recipes"
import { almatyDayStart } from "../../convex/lib/time"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const day = (date: string) => almatyDayStart(date)

describe("recipe math (W1-RCP-01)", () => {
  it("applies cold then hot losses and converts л/шт to kg", () => {
    const summary = calculateRecipe(
      [
        { unit: "кг", quantity: 0.35, unitWeightKg: 1, coldLossPercent: 20, hotLossPercent: 15, unitCost: 4000 },
        { unit: "л", quantity: 0.1, unitWeightKg: 1.03, coldLossPercent: 0, hotLossPercent: 0, unitCost: 900 },
        { unit: "шт", quantity: 2, unitWeightKg: 0.05, coldLossPercent: 10, hotLossPercent: 0, unitCost: 60 },
      ],
      1,
    )
    expect(summary.grossKg).toBeCloseTo(0.35 + 0.103 + 0.1, 4)
    expect(summary.lines[0].netKg).toBeCloseTo(0.28, 6)
    expect(summary.lines[0].outputKg).toBeCloseTo(0.238, 6)
    expect(summary.costPerBatch).toBe(Math.round(0.35 * 4000 + 0.1 * 900 + 2 * 60))
    expect(summary.portionOutputG).toBe(Math.round((0.238 + 0.103 + 0.09) * 1000))
  })

  it("divides by the batch and colours food cost from the price", () => {
    const summary = calculateRecipe([{ unit: "кг", quantity: 1, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0, unitCost: 2320 }], 10)
    expect(summary.costPerPortion).toBe(232)
    expect(foodCostPercent(232, 400)).toBe(58)
    expect(foodCostPercent(232, 0)).toBeNull()
  })

  it("checks units, yield, zero costs and the start date", () => {
    const lines = [{ unit: "шт" as const, quantity: 1, unitWeightKg: 0, coldLossPercent: 0, hotLossPercent: 0, unitCost: 0 }]
    const checks = recipeChecks({ lines, summary: calculateRecipe(lines, 1), batchYield: 1, effectiveFrom: day("2026-09-10"), firstSaleAt: day("2026-09-01") })
    expect(checks.filter((check) => !check.ok).map((check) => check.code)).toEqual(["units", "yield", "costs", "date"])
  })
})

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    const restaurantId = await ctx.db.insert("restaurants", { externalId: "almaty", organizationExternalId: "sandyq", name: "Алматы", address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("posTerminals", { externalId: "t", restaurantId, name: "Касса", terminalNumber: 1, nextOrderNumber: 1, active: true })
    await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
    for (const [externalId, name] of [["beshbarmak", "Бешбармак"], ["broth", "Сорпа-основа"]]) {
      await ctx.db.insert("products", { externalId, name, nameKk: name, nameSort: name, searchText: name, description: "", category: "hot", categorySort: 1, basePrice: 7990, popular: false, sku: externalId, baseUnit: "порц.", enabled: true })
    }
    const meat = await ctx.db.insert("inventoryItems", { externalId: "horse-meat", name: "Конина", nameSort: "конина", searchText: "конина", unit: "кг", active: true })
    await ctx.db.insert("stockBalances", { restaurantExternalId: "almaty", inventoryItemId: meat, quantity: 10, averageUnitCost: 4000, updatedAt: 1 })
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }) }
}

const meatLine = (quantity: number) => ({ kind: "item" as const, inventoryItemExternalId: "horse-meat", unit: "кг" as const, quantity, unitWeightKg: 1, coldLossPercent: 30, hotLossPercent: 0 })

async function productId(t: TestConvex<typeof schema>, externalId: string) {
  return t.run(async (ctx) => (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", externalId)).unique())!._id)
}

describe("recipe versions", () => {
  it("a sale on 10.09 uses the version from 01.09, one on 20.09 the version from 15.09", async () => {
    const { t, admin } = await setup()
    const first = await admin.mutation(api.domains.recipes.mutations.saveRecipeDraft, { productExternalId: "beshbarmak", batchYield: 1, effectiveFrom: day("2026-09-01"), technology: "", lines: [meatLine(0.35)] })
    await admin.mutation(api.domains.recipes.mutations.activateRecipeVersion, { versionId: first })
    const second = await admin.mutation(api.domains.recipes.mutations.saveRecipeDraft, { productExternalId: "beshbarmak", batchYield: 1, effectiveFrom: day("2026-09-15"), technology: "", lines: [meatLine(0.4)] })
    await admin.mutation(api.domains.recipes.mutations.activateRecipeVersion, { versionId: second })
    const id = await productId(t, "beshbarmak")
    await t.run(async (ctx) => {
      expect((await recipeVersionAt(ctx, id, day("2026-09-10")))?._id).toBe(first)
      expect((await recipeVersionAt(ctx, id, day("2026-09-20")))?._id).toBe(second)
    })
    const card = await admin.query(api.domains.recipes.queries.getRecipe, { productExternalId: "beshbarmak", at: day("2026-09-20"), restaurantExternalId: "almaty" })
    expect(card?.summary).toMatchObject({ costPerPortion: 1600, price: 7990, foodCostPercent: 20 })
    const versions = await admin.query(api.domains.recipes.queries.listRecipeVersions, { productExternalId: "beshbarmak" })
    expect(versions.map((version) => [version.version, version.status])).toEqual([[2, "active"], [1, "superseded"]])
  })

  it("refuses activation into a closed period and preparation cycles", async () => {
    const { t, admin } = await setup()
    await t.run((ctx) => ctx.db.insert("periodLocks", { externalId: "l", organizationExternalId: "sandyq", kind: "final", lockedThrough: day("2026-08-31"), active: true, reason: "Август", createdBy: "a", createdAt: 1 }))
    const late = await admin.mutation(api.domains.recipes.mutations.saveRecipeDraft, { productExternalId: "beshbarmak", batchYield: 1, effectiveFrom: day("2026-08-20"), technology: "", lines: [meatLine(0.35)] })
    await expect(admin.mutation(api.domains.recipes.mutations.activateRecipeVersion, { versionId: late })).rejects.toThrow(/закрыт по 31\.08\.2026/)

    const broth = await admin.mutation(api.domains.recipes.mutations.saveRecipeDraft, {
      productExternalId: "broth",
      batchYield: 10,
      effectiveFrom: day("2026-09-01"),
      technology: "",
      lines: [{ kind: "preparation", componentProductExternalId: "beshbarmak", unit: "кг", quantity: 1, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0 }],
    })
    await admin.mutation(api.domains.recipes.mutations.activateRecipeVersion, { versionId: broth })
    await expect(
      admin.mutation(api.domains.recipes.mutations.saveRecipeDraft, {
        productExternalId: "beshbarmak",
        batchYield: 1,
        effectiveFrom: day("2026-09-01"),
        technology: "",
        lines: [{ kind: "preparation", componentProductExternalId: "broth", unit: "кг", quantity: 0.2, unitWeightKg: 1, coldLossPercent: 0, hotLossPercent: 0 }],
      }),
    ).rejects.toThrow(/само блюдо/)
  })
})
