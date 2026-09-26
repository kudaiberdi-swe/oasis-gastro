import { describe, expect, it } from "vitest"

import { api, internal } from "../../convex/_generated/api"
import { recipeLinesOf } from "../../convex/lib/recipes"
import { setup } from "./fixtures/pos"

// W1-IIKO-04/05, W2-IIKO-08/09, W2-RTL-01 (decisions Б-B4 and D7 of 2026-09-26): iiko catalog, recipes,
// prices, opening balances and sales projections. Synthetic data.

const empty = { departments: [], employees: [] }
const dish = { externalId: "i-dish", name: "Қазақ ет", num: "101", parentExternalId: "g-hot", type: "DISH", unitName: "порц", defaultSalePrice: 7990, includedInMenu: true, deleted: false, payloadHash: "p1" }
const meat = { externalId: "i-meat", name: "Конина", parentExternalId: "g-goods", type: "GOODS", unitName: "кг", includedInMenu: false, deleted: false, payloadHash: "p2" }
const broth = { externalId: "i-broth", name: "Сорпа ПФ", parentExternalId: "g-hot", type: "PREPARED", unitName: "л", includedInMenu: false, deleted: false, payloadHash: "p3" }

async function linked(options: { link?: boolean } = {}) {
  const { t } = await setup()
  await t.run(async (ctx) => {
    await ctx.db.insert("officeRoles", { externalId: "administrator", name: "Администратор", capabilities: ["*"], system: true })
    await ctx.db.insert("officeRoles", { externalId: "none", name: "Нет", capabilities: ["office.guests.view"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "admin", email: "admin@sandyq.test", name: "Админ", roleExternalId: "administrator", restaurantScopes: ["*"], organizationScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "n", email: "n@sandyq.test", name: "Нет", roleExternalId: "none", restaurantScopes: ["almaty"], active: true })
    if (options.link !== false) await ctx.db.insert("restaurantSourceLinks", { restaurantExternalId: "almaty", iikoDepartmentExternalId: "dep-almaty", confirmedBy: "admin@sandyq.test", confirmedAt: 0 })
  })
  return { t, admin: t.withIdentity({ email: "admin@sandyq.test" }), stranger: t.withIdentity({ email: "n@sandyq.test" }) }
}

const product = (t: Awaited<ReturnType<typeof linked>>["t"], iikoId: string) => t.run((ctx) => ctx.db.query("products").withIndex("by_iiko_product", (q) => q.eq("iikoProductExternalId", iikoId)).first())

describe("iiko catalog projection (W1-IIKO-04)", () => {
  it("a new iiko dish stays hidden; office edits live in the overlay and survive a re-import", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, productGroups: [{ externalId: "g-hot", name: "Меню Кухня", deleted: false, payloadHash: "g" }], products: [dish] })
    const created = (await product(t, "i-dish"))!
    expect(created).toMatchObject({ externalId: "iiko-product-i-dish", enabled: false, basePrice: 7990, baseUnit: "порц.", itemType: "dish", category: "iiko-group-g-hot", sourceReadOnly: true })
    await t.run(async (ctx) => {
      await ctx.db.insert("iikoEntityOverlays", { overlayKey: "product:iiko-product-i-dish", entityType: "product", sourceExternalId: "iiko-product-i-dish", label: "Қазақ ет (зал)", labelKk: "Қазақша ет", visibleInPos: true, localSettings: { price: 8500 } })
    })
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [{ ...dish, name: "Казах ет", defaultSalePrice: 7000, payloadHash: "p1b" }] })
    expect(await product(t, "i-dish")).toMatchObject({ name: "Қазақ ет (зал)", nameKk: "Қазақша ет", enabled: true, basePrice: 8500 })
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [{ ...dish, deleted: true, payloadHash: "p1c" }] })
    expect(await product(t, "i-dish")).toMatchObject({ enabled: false, sourceDeleted: true })
  })

  it("a seed dish with the same name is linked, keeping its names, visibility and price; goods and preparations become stock items", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [{ ...dish, name: "Бешбармак", matchProductExternalId: "dish" }, meat, broth] })
    const seed = (await product(t, "i-dish"))!
    expect(seed).toMatchObject({ externalId: "dish", name: "Бешбармак", nameKk: "Бешбармақ", enabled: true, basePrice: 1000 })
    expect(seed.sourceSystem).toBeUndefined()
    const items = await t.run((ctx) => ctx.db.query("inventoryItems").take(10))
    expect(items.map((item) => [item.externalId, item.kind, item.unit, item.productExternalId ?? null])).toEqual([
      ["iiko-item-i-meat", "ingredient", "кг", null],
      ["iiko-item-i-broth", "preparation", "л", "iiko-product-i-broth"],
    ])
    expect(await product(t, "i-meat")).toBeNull()
    expect(await product(t, "i-broth")).toMatchObject({ itemType: "preparation", writeOffMethod: "finished-product", enabled: false })
  })
})

describe("iiko recipes and prices (W2-IIKO-08/09)", () => {
  const chart = { externalId: "c-1", assembledProductExternalId: "i-dish", dateFrom: "2026-09-01", assembledAmount: 1, items: [{ productExternalId: "i-meat", amountIn: 0.4, amountMiddle: 0.3, amountOut: 0.24 }, { productExternalId: "i-broth", amountIn: 0.25, amountMiddle: 0.25, amountOut: 0.25 }, { productExternalId: "unknown", amountIn: 1, amountMiddle: 1, amountOut: 1 }], payloadHash: "c1" }

  it("a chart becomes an active version «из iiko» with losses; an unchanged chart adds nothing, a changed one supersedes it", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [dish, meat, broth] })
    const result = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, recipeCharts: [chart] })
    expect(result.skipped["v2/assemblyCharts/getAll"]?.[0]).toMatch(/пропущено ингредиентов — 1/)
    const versions = await t.run((ctx) => ctx.db.query("recipeVersions").take(10))
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ status: "active", sourceSystem: "iiko-server", createdBy: "iiko", batchYield: 1 })
    const lines = await t.run((ctx) => ctx.db.query("recipeLines").take(10))
    expect(lines.map((line) => [line.kind, line.unit, line.quantity, line.coldLossPercent, line.hotLossPercent])).toEqual([
      ["item", "кг", 0.4, 25, 20],
      ["preparation", "л", 0.25, 0, 0],
    ])

    const again = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, recipeCharts: [chart] })
    expect(again.changed["v2/assemblyCharts/getAll"]).toBe(0)
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, recipeCharts: [{ ...chart, items: chart.items.slice(0, 1), payloadHash: "c2" }] })
    const after = await t.run((ctx) => ctx.db.query("recipeVersions").take(10))
    expect(after.map((version) => [version.version, version.status])).toEqual([
      [1, "superseded"],
      [2, "active"],
    ])
    expect(after[1].effectiveFrom).toBeGreaterThan(after[0].effectiveFrom)
  })

  it("per-branch variants of a line are never summed: a restaurant gets its department's line, an unlinked one the reference department's", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [dish, meat, broth] })
    const variants = { ...chart, items: [{ productExternalId: "i-broth", amountIn: 0.25, amountMiddle: 0.25, amountOut: 0.25 }, { productExternalId: "i-meat", amountIn: 0.4, amountMiddle: 0.4, amountOut: 0.4, departmentExternalIds: ["dep-almaty"] }, { productExternalId: "i-meat", amountIn: 0.5, amountMiddle: 0.5, amountOut: 0.5, departmentExternalIds: ["dep-astana"] }], payloadHash: "cv" }
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, recipeCharts: [variants] })
    const quantities = (restaurant?: string) =>
      t.run(async (ctx) => {
        const version = (await ctx.db.query("recipeVersions").first())!
        return (await recipeLinesOf(ctx, version._id, restaurant)).map((line) => line.quantity)
      })
    expect(await quantities("almaty")).toEqual([0.25, 0.4])
    await t.run((ctx) => ctx.db.insert("restaurants", { externalId: "astana", organizationExternalId: "sandyq", name: "Астана", address: "—", timezone: "Asia/Almaty", active: true }))
    await t.run((ctx) => ctx.db.insert("restaurantSourceLinks", { restaurantExternalId: "astana", iikoDepartmentExternalId: "dep-astana", confirmedBy: "a", confirmedAt: 0 }))
    expect(await quantities("astana")).toEqual([0.25, 0.5])
    expect(await quantities(undefined)).toEqual([0.25, 0.4])
    expect(await quantities("seed-branch")).toEqual([0.25, 0.4])
  })

  it("an iiko price becomes the branch price; Sandyq's own branch price wins and the difference is reported; unlinked departments are skipped", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [dish, { ...dish, externalId: "i-dish-2", name: "Сорпа", payloadHash: "p9" }] })
    const own = (await product(t, "i-dish-2"))!
    await t.run((ctx) => ctx.db.insert("productPrices", { productId: own._id, restaurantExternalId: "almaty", priceKzt: 2000 }))
    const result = await t.mutation(internal.domains.iiko.mutations.importBatch, {
      ...empty,
      prices: [
        { departmentExternalId: "dep-almaty", productExternalId: "i-dish", price: 7990, payloadHash: "x1" },
        { departmentExternalId: "dep-almaty", productExternalId: "i-dish-2", price: 2150, payloadHash: "x2" },
        { departmentExternalId: "dep-other", productExternalId: "i-dish", price: 5000, payloadHash: "x3" },
      ],
    })
    expect(result.skipped["v2/price"]).toEqual([expect.stringMatching(/цена Sandyq 2000 ₸, в iiko 2150 ₸/), expect.stringMatching(/не сопоставлено/)])
    const prices = await t.run((ctx) => ctx.db.query("productPrices").take(10))
    expect(prices.map((row) => [row.priceKzt, row.sourceSystem ?? null])).toEqual([
      [2000, null],
      [7990, "iiko-server"],
    ])
  })
})

describe("iiko import run totals", () => {
  it("the endpoint shows the run's total, not the size of its last chunk", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.beginRun, { runExternalId: "run-1" })
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [dish, meat] })
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, products: [broth] })
    await t.mutation(internal.domains.iiko.mutations.completeRun, { runExternalId: "run-1", counts: { departments: 0, employees: 0 }, countsByEndpoint: { "v2/entities/products/list": 3 } })
    const state = await t.run((ctx) => ctx.db.query("iikoEndpointStates").withIndex("by_endpoint_key", (q) => q.eq("endpointKey", "v2/entities/products/list")).unique())
    expect(state?.recordCount).toBe(3)
  })
})

describe("iiko opening balances (W1-IIKO-05)", () => {
  it("the first import posts an opening movement and a journal entry; a repeat does nothing; Sandyq's own movements are only compared", async () => {
    const { t } = await linked()
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, warehouses: [{ externalId: "st-1", parentExternalId: "dep-almaty", name: "Склад Алматы", deleted: false, payloadHash: "w" }], products: [meat] })
    const balance = { storeExternalId: "st-1", productExternalId: "i-meat", amount: 12.5, sum: 50_000, occurredAt: Date.parse("2026-09-26T09:00:00+05:00") }
    await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, openingBalances: [balance] })
    const movements = await t.run((ctx) => ctx.db.query("stockMovements").take(10))
    expect(movements).toMatchObject([{ quantityDelta: 12.5, unitCost: 4000, sourceModuleId: "iiko-opening-balance" }])
    const entries = await t.run((ctx) => ctx.db.query("journalEntries").take(10))
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(50_000)

    const again = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, openingBalances: [balance] })
    expect(again.changed["v2/reports/balance/stores"]).toBe(0)
    const differs = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, openingBalances: [{ ...balance, amount: 10 }] })
    expect(differs.skipped["v2/reports/balance/stores"]?.[0]).toMatch(/в Sandyq 12\.5, в iiko 10/)
    expect(await t.run((ctx) => ctx.db.query("stockMovements").take(10))).toHaveLength(1)
  })
})

describe("iiko orders and cash shifts in the office (W2-RTL-01, D7)", () => {
  const shift = { externalId: "sh-1", departmentExternalId: "dep-almaty", sessionNumber: 42, cashRegisterNumber: 3, status: "UNACCEPTED", openedAt: Date.parse("2026-09-25T09:00:00+05:00"), closedAt: Date.parse("2026-09-25T23:00:00+05:00"), managerEmployeeExternalId: "e-1", startCash: 0, salesCash: 100_000, salesCard: 250_000, salesCredit: 0, payIn: 0, payOut: 5_000, cashDiff: -200, ordersTotal: 350_000, payloadHash: "s1" }
  const order = { externalId: "o-1", departmentExternalId: "dep-almaty", orderNumber: 5, openedAt: Date.parse("2026-09-25T14:02:02+05:00"), orderTypeName: "Обычный заказ", cashShiftExternalId: "sh-1", grossAmount: 28_160, total: 32_384, guestCount: 2, payloadHash: "o1" }

  it("are read-only lists of linked restaurants, with the shift number and the manager's code, and need the right", async () => {
    const { t, admin, stranger } = await linked()
    await t.run((ctx) => ctx.db.insert("iikoEmployees", { externalId: "e-1", code: "77", displayName: "Менеджер iiko", departmentCodes: [], active: true, sourceHash: "h", importedAt: 0 }))
    const result = await t.mutation(internal.domains.iiko.mutations.importBatch, { ...empty, cashShifts: [shift, { ...shift, externalId: "sh-x", departmentExternalId: "dep-other" }], orders: [order] })
    expect(result.skipped["v2/cashshifts/list"]).toHaveLength(1)
    const orders = await admin.query(api.domains.retail.office.listIikoOrders, { paginationOpts: { numItems: 10, cursor: null } })
    expect(orders.page).toMatchObject([{ number: 5, source: "iiko", shiftNumber: 42, total: 32_384, grossAmount: 28_160, restaurantName: "Алматы", businessDate: "2026-09-25" }])
    const shifts = await admin.query(api.domains.retail.office.listIikoShifts, { restaurantExternalId: "almaty", paginationOpts: { numItems: 10, cursor: null } })
    expect(shifts.page).toMatchObject([{ number: 42, managerCode: "77", ordersTotal: 350_000, cashDiff: -200 }])
    expect(JSON.stringify(shifts.page)).not.toContain("Менеджер iiko")
    await expect(stranger.query(api.domains.retail.office.listIikoOrders, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow()
  })
})
