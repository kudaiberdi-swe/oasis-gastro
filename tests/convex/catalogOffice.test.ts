import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const office = api.domains.catalog.office

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { externalId: "sandyq", name: "Sandyq", currency: "KZT", timezone: "Asia/Almaty", active: true })
    for (const externalId of ["almaty", "shymkent"]) await ctx.db.insert("restaurants", { externalId, organizationExternalId: "sandyq", name: `Sandyq ${externalId}`, address: "—", timezone: "Asia/Almaty", active: true })
    await ctx.db.insert("categories", { externalId: "hot", label: "Негізгі тағамдар / Основные блюда", shortLabel: "Основные", sortOrder: 1, active: true })
    await ctx.db.insert("categories", { externalId: "salads", label: "Саламтар / Салаты", shortLabel: "Салаты", sortOrder: 2, active: true })
    const names = [["Бешбармак", "Бешбармақ"], ["Сорпа", "Сорпа"], ["Баурсаки", "Бауырсақ"]]
    for (let index = 0; index < 30; index += 1) {
      const [name, nameKk] = names[index % 3]
      const productId = await ctx.db.insert("products", {
        externalId: `p-${index}`,
        name: `${name} ${index}`,
        nameKk: `${nameKk} ${index}`,
        nameSort: `${name} ${index}`.toLocaleLowerCase("ru"),
        searchText: `${name} ${nameKk} ${index}`.toLocaleLowerCase("ru"),
        description: "",
        category: index % 2 ? "salads" : "hot",
        categorySort: 1,
        basePrice: 1000 + index * 100,
        popular: false,
        sku: `SKU-${index}`,
        baseUnit: "порц.",
        enabled: index !== 29,
        itemType: index % 10 === 0 ? "good" : "dish",
      })
      if (index === 0) {
        await ctx.db.insert("productPrices", { productId, restaurantExternalId: "almaty", priceKzt: 1650 })
        await ctx.db.insert("productPrices", { productId, restaurantExternalId: "shymkent", priceKzt: 1200 })
      }
    }
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "viewer", name: "Просмотр", capabilities: ["office.nomenclature.view", "office.product-groups.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "almaty", email: "almaty@sandyq.test", name: "Алматы", roleExternalId: "viewer", restaurantScopes: ["almaty"], active: true })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), viewer: t.withIdentity({ email: "almaty@sandyq.test" }) }
}

describe("product groups (W1-CAT-03)", () => {
  it("builds a hierarchy and rejects cycles, self-parents and missing rights", async () => {
    const { admin, viewer } = await setup()
    const warm = await admin.mutation(office.saveProductGroup, { label: "Тёплые салаты", shortLabel: "Тёплые", parentExternalId: "salads", sortOrder: 10, active: true })
    await expect(admin.mutation(office.saveProductGroup, { externalId: "salads", label: "Салаты", shortLabel: "Салаты", parentExternalId: warm, sortOrder: 2, active: true })).rejects.toThrow(/сама в себя/)
    await expect(admin.mutation(office.saveProductGroup, { externalId: warm, label: "Тёплые", shortLabel: "Т", parentExternalId: warm, sortOrder: 1, active: true })).rejects.toThrow(/сама в себя/)
    await expect(viewer.mutation(office.saveProductGroup, { label: "X", shortLabel: "X", sortOrder: 1, active: true })).rejects.toThrow(/Недостаточно прав/)
    await expect(admin.mutation(office.saveProductGroup, { externalId: "hot", label: "Основные", shortLabel: "Основные", sortOrder: 1, active: false })).rejects.toThrow(/активные блюда/)
    const groups = await admin.query(office.listProductGroups, {})
    expect(groups.find((group) => group.externalId === warm)?.parentExternalId).toBe("salads")
  })
})

describe("nomenclature register (W1-CAT-04)", () => {
  it("pages by 25, searches Kazakh names, filters by type and status", async () => {
    const { admin } = await setup()
    const first = await admin.query(office.listNomenclature, { paginationOpts: { numItems: 25, cursor: null } })
    const second = await admin.query(office.listNomenclature, { paginationOpts: { numItems: 25, cursor: first.continueCursor } })
    expect(first.page).toHaveLength(25)
    expect(first.page.length + second.page.length).toBe(30)

    const kazakh = await admin.query(office.listNomenclature, { search: "бешбармақ", paginationOpts: { numItems: 50, cursor: null } })
    expect(kazakh.page.length).toBeGreaterThan(0)
    expect(kazakh.page.every((row) => row.nameKk.startsWith("Бешбармақ"))).toBe(true)

    const goods = await admin.query(office.listNomenclature, { itemType: "good", paginationOpts: { numItems: 50, cursor: null } })
    expect(goods.page.map((row) => row.externalId).sort()).toEqual(["p-0", "p-10", "p-20"])
    const hidden = await admin.query(office.listNomenclature, { status: "hidden", paginationOpts: { numItems: 50, cursor: null } })
    expect(hidden.page.map((row) => row.externalId)).toEqual(["p-29"])
    const byPrice = await admin.query(office.listNomenclature, { sort: "price", paginationOpts: { numItems: 3, cursor: null } })
    expect(byPrice.page.map((row) => row.basePrice)).toEqual([1000, 1100, 1200])
  })

  it("shows a price range of the user's branches only", async () => {
    const { admin, viewer } = await setup()
    const all = await admin.query(office.listNomenclature, { search: "бешбармак 0", paginationOpts: { numItems: 5, cursor: null } })
    expect(all.page.find((row) => row.externalId === "p-0")?.priceRange).toEqual({ min: 1200, max: 1650 })
    const own = await viewer.query(office.listNomenclature, { search: "бешбармак 0", paginationOpts: { numItems: 5, cursor: null } })
    expect(own.page.find((row) => row.externalId === "p-0")?.priceRange).toEqual({ min: 1650, max: 1650 })
  })
})

describe("product card (W1-CAT-05)", () => {
  it("edits a Sandyq product, writes an overlay for an iiko one, and validates weight", async () => {
    const { t, admin, viewer } = await setup()
    const card = (await viewer.query(office.getProductCard, { externalId: "p-0" }))!
    expect(card.branchPrices.map((row) => row.restaurantExternalId)).toEqual(["almaty"])
    expect(card.branchPrices[0].resolvedPriceNow).toEqual({ price: 1650, source: "branch" })

    const edit = { externalId: "p-0", name: "Бешбармак", nameKk: "Бешбармақ", description: "", categoryExternalId: "hot", itemType: "dish" as const, prepArea: "hot", writeOffMethod: "ingredients" as const, sku: "B-1", basePrice: 7990, baseUnit: "порц." as const, enabled: true }
    await admin.mutation(office.saveProductCard, edit)
    expect((await t.run((ctx) => ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "p-0")).unique()))?.basePrice).toBe(7990)
    await expect(admin.mutation(office.saveProductCard, { ...edit, baseUnit: "шт", unitWeightKg: 0 })).rejects.toThrow(/больше нуля/)
    await expect(viewer.mutation(office.saveProductCard, edit)).rejects.toThrow(/Недостаточно прав/)

    await t.run((ctx) => ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "p-1")).unique().then((row) => ctx.db.patch(row!._id, { sourceSystem: "iiko-server" })))
    await admin.mutation(office.saveProductCard, { ...edit, externalId: "p-1", name: "Сорпа (Sandyq)", basePrice: 2450 })
    const [product, overlay] = await t.run(async (ctx) => [
      await ctx.db.query("products").withIndex("by_external_id", (q) => q.eq("externalId", "p-1")).unique(),
      await ctx.db.query("iikoEntityOverlays").withIndex("by_entity_type_and_source_external_id", (q) => q.eq("entityType", "product").eq("sourceExternalId", "p-1")).unique(),
    ])
    // The overlay is what a re-import keeps; the product row mirrors it at once so the POS shows the edit (W1-IIKO-04).
    expect(product?.name).toBe("Сорпа (Sandyq)")
    expect(overlay).toMatchObject({ label: "Сорпа (Sandyq)", localSettings: { price: 2450 } })
    expect((await admin.query(office.getProductCard, { externalId: "p-1" }))?.name).toBe("Сорпа (Sandyq)")
  })
})

describe("images (W1-CAT-06)", () => {
  it("needs the right to upload", async () => {
    const { viewer, admin } = await setup()
    await expect(viewer.mutation(office.generateImageUploadUrl, {})).rejects.toThrow(/Недостаточно прав/)
    expect(typeof (await admin.mutation(office.generateImageUploadUrl, {}))).toBe("string")
  })

  it("rejects a file over 2 MB and replaces the old file", async () => {
    const { t, admin } = await setup()
    const [text, first, second] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/png" })),
      await ctx.storage.store(new Blob([new Uint8Array(10)], { type: "image/png" })),
      await ctx.storage.store(new Blob([new Uint8Array(10)], { type: "image/png" })),
    ])
    await expect(admin.mutation(office.attachProductImage, { productExternalId: "p-0", storageId: text })).rejects.toThrow(/до 2 МБ/)
    await admin.mutation(office.attachProductImage, { productExternalId: "p-0", storageId: first })
    await admin.mutation(office.attachProductImage, { productExternalId: "p-0", storageId: second })
    expect(await t.run((ctx) => ctx.db.system.get(first))).toBeNull()
    expect((await admin.query(office.getProductCard, { externalId: "p-0" }))?.imageUrl).toBeTruthy()
  })
})
