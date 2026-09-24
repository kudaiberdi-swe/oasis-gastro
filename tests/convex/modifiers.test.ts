import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { priceModifiers, validateAndPriceModifiers, type GroupAssignment } from "../../convex/lib/modifierPricing"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

const sauce = (externalId: string, name: string, price: number, overrides: Partial<GroupAssignment["rules"][number]> = {}) => ({
  modifier: { externalId, name, price, available: true },
  minQuantity: 0,
  maxQuantity: 5,
  defaultQuantity: 0,
  freeQuantity: 0,
  ...overrides,
})

const group = (rules: GroupAssignment["rules"], overrides: Partial<GroupAssignment> = {}): GroupAssignment => ({
  required: false,
  minQuantity: 0,
  maxQuantity: 10,
  freeQuantity: 0,
  enforceItemLimits: true,
  rules,
  ...overrides,
})

describe("modifier pricing (W1-CAT-07)", () => {
  it("shares the group's free pool: 2 free, 3 chosen → 1 paid", () => {
    const { priced } = priceModifiers([group([sauce("ketchup", "Кетчуп", 200), sauce("garlic", "Чесночный", 300)], { freeQuantity: 2 })], [
      { externalId: "ketchup", quantity: 2 },
      { externalId: "garlic", quantity: 1 },
    ])
    expect(priced).toEqual([
      { externalId: "ketchup", name: "Кетчуп", quantity: 2, unitPrice: 0 },
      { externalId: "garlic", name: "Чесночный", quantity: 1, unitPrice: 300 },
    ])
  })

  it("checks rule limits only when enforceItemLimits is on", () => {
    const rules = [sauce("cheese", "Сыр", 400, { maxQuantity: 1 })]
    expect(() => priceModifiers([group(rules)], [{ externalId: "cheese", quantity: 3 }])).toThrow(/Проверьте количество «Сыр»/)
    expect(priceModifiers([group(rules, { enforceItemLimits: false })], [{ externalId: "cheese", quantity: 3 }]).priced[0]).toMatchObject({ quantity: 3, unitPrice: 400 })
    expect(() => priceModifiers([group(rules, { enforceItemLimits: false, maxQuantity: 2 })], [{ externalId: "cheese", quantity: 3 }])).toThrow(/слишком много/)
  })

  it("labels removed defaults and additions for the kitchen", () => {
    const onion = sauce("onion", "Лук", 0, { defaultQuantity: 1, maxQuantity: 2 })
    const cheese = sauce("cheese", "Сыр", 400)
    const { kitchenModifiers, priced } = priceModifiers([group([onion, cheese])], [
      { externalId: "onion", quantity: 0 },
      { externalId: "cheese", quantity: 2 },
    ])
    expect(kitchenModifiers.map((row) => row.label)).toEqual(["БЕЗ ЛУК", "+СЫР ×2"])
    expect(priced.map((row) => row.externalId)).toEqual(["cheese"])
  })

  it("requires a choice in a required group and rejects unknown or unavailable modifiers", () => {
    expect(() => priceModifiers([group([sauce("a", "А", 100)], { required: true, minQuantity: 1 })], [])).toThrow(/обязательные/)
    expect(() => priceModifiers([group([sauce("a", "А", 100)])], [{ externalId: "other", quantity: 1 }])).toThrow(/не разрешён/)
    expect(() => priceModifiers([group([{ ...sauce("a", "А", 100), modifier: { externalId: "a", name: "А", price: 100, available: false } }])], [{ externalId: "a", quantity: 1 }])).toThrow(/недоступен/)
    expect(() => priceModifiers([], [{ externalId: "a", quantity: 1 }])).toThrow(/недоступны/)
  })
})

describe("modifier office API", () => {
  it("builds groups, rules and prices a real product; edit needs the right", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("categories", { externalId: "hot", label: "Горячее", shortLabel: "Горячее", sortOrder: 1, active: true })
      await ctx.db.insert("products", { externalId: "burger", name: "Бургер", nameKk: "Бургер", nameSort: "бургер", searchText: "бургер", description: "", category: "hot", categorySort: 1, basePrice: 2500, popular: false, sku: "B", baseUnit: "шт", enabled: true })
      await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
      await ctx.db.insert("officeRoles", { externalId: "viewer", name: "Просмотр", capabilities: ["office.modifiers.view"], system: false })
      await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
      await ctx.db.insert("officeUsers", { externalId: "viewer", email: "viewer@sandyq.test", name: "Просмотр", roleExternalId: "viewer", restaurantScopes: ["*"], active: true })
    })
    const admin = t.withIdentity({ email: "admin@sandyq.test" })
    const viewer = t.withIdentity({ email: "viewer@sandyq.test" })
    await expect(viewer.mutation(api.domains.modifiers.mutations.saveGroup, { name: "Соусы", sortOrder: 1 })).rejects.toThrow(/Недостаточно прав/)
    const sauces = await admin.mutation(api.domains.modifiers.mutations.saveGroup, { name: "Соусы", sortOrder: 1 })
    const other = await admin.mutation(api.domains.modifiers.mutations.saveGroup, { name: "Напитки", sortOrder: 2 })
    const ketchup = await admin.mutation(api.domains.modifiers.mutations.save, { groupExternalId: sauces, name: "Кетчуп", price: 200, ingredientQuantity: 0.03, unit: "кг", available: true })
    const cola = await admin.mutation(api.domains.modifiers.mutations.save, { groupExternalId: other, name: "Кола", price: 600, ingredientQuantity: 0.3, unit: "л", available: true })
    await admin.mutation(api.domains.modifiers.mutations.assignGroup, { productExternalId: "burger", groupExternalId: sauces })
    const rules = { productExternalId: "burger", groupExternalId: sauces, required: true, minQuantity: 1, maxQuantity: 3, freeQuantity: 1, enforceItemLimits: true }
    await expect(admin.mutation(api.domains.modifiers.mutations.saveProductRules, { ...rules, rules: [{ modifierExternalId: ketchup, minQuantity: 0, maxQuantity: 2, defaultQuantity: 3, freeQuantity: 0, sortOrder: 1 }] })).rejects.toThrow(/по умолчанию/)
    await expect(admin.mutation(api.domains.modifiers.mutations.saveProductRules, { ...rules, rules: [{ modifierExternalId: cola, minQuantity: 0, maxQuantity: 2, defaultQuantity: 0, freeQuantity: 0, sortOrder: 1 }] })).rejects.toThrow(/не из этой группы/)
    await admin.mutation(api.domains.modifiers.mutations.saveProductRules, { ...rules, rules: [{ modifierExternalId: ketchup, minQuantity: 0, maxQuantity: 3, defaultQuantity: 0, freeQuantity: 0, sortOrder: 1 }] })

    const result = await t.run(async (ctx) => {
      const product = (await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "burger")).unique())!
      await expect(validateAndPriceModifiers(ctx, product, [])).rejects.toThrow(/обязательные/)
      return validateAndPriceModifiers(ctx, product, [{ externalId: ketchup, quantity: 2 }])
    })
    expect(result.priced).toEqual([{ externalId: ketchup, name: "Кетчуп", quantity: 2, unitPrice: 100 }])
    const designer = await viewer.query(api.domains.modifiers.queries.getProductRules, { productExternalId: "burger" })
    expect(designer?.[0]).toMatchObject({ groupName: "Соусы", required: true, freeQuantity: 1 })
  })
})
