import { describe, expect, it } from "vitest"

import { internal } from "../../convex/_generated/api"
import { setup } from "./fixtures/pos"

describe("recipe import from CSV (W1-RCP-04)", () => {
  it("creates draft versions only, reports unknown products and ingredients, dry run writes nothing", async () => {
    const { t } = await setup()
    await t.run((ctx) => ctx.db.insert("inventoryItems", { externalId: "meat", name: "Говядина", nameSort: "говядина", searchText: "говядина", unit: "кг", kind: "ingredient", active: true }))
    const rows = [
      { product: "Бешбармак", ingredient: "Говядина", unit: "кг" as const, quantity: 0.25, coldLossPercent: 20 },
      { product: "Бешбармак", ingredient: "Тесто", unit: "кг" as const, quantity: 0.1 },
      { product: "Неизвестное", ingredient: "Говядина", unit: "кг" as const, quantity: 0.1 },
      { product: "Бешбармак", ingredient: "Говядина", unit: "шт" as const, quantity: 1 },
    ]
    const dry = await t.mutation(internal.domains.recipes.seed.importRecipesFromCsv, { rows, effectiveFrom: 0, dryRun: true })
    expect(dry).toMatchObject({ draftsCreated: 1, linesCreated: 1, unmatchedProducts: ["Неизвестное"], unmatchedIngredients: ["Бешбармак: Тесто"] })
    expect(dry.invalid).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.query("recipeVersions").take(5))).toEqual([])
    await t.mutation(internal.domains.recipes.seed.importRecipesFromCsv, { rows, effectiveFrom: 0 })
    const [version] = await t.run((ctx) => ctx.db.query("recipeVersions").take(5))
    expect(version).toMatchObject({ status: "draft", version: 1 })
    const [line] = await t.run((ctx) => ctx.db.query("recipeLines").take(5))
    expect(line).toMatchObject({ name: "Говядина", quantity: 0.25, coldLossPercent: 20 })
  })
})
