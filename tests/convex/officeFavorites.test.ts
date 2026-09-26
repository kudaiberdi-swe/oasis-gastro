import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")
const favorites = api.domains.office.favorites
const config = { dateFrom: "2026-09-01", dateTo: "2026-09-07", restaurantExternalIds: [] }

// W3-ADM-13 «Избранное»: any office user, only their own rows; favorite report views in the same list.
async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    // The warehouse role has no «Избранное» right of its own: the section is personal.
    await ctx.db.insert("officeRoles", { externalId: "warehouse", name: "Склад", capabilities: ["office.stock.view", "office.receipts.view"], system: false })
    await ctx.db.insert("officeRoles", { externalId: "analyst", name: "Аналитик", capabilities: ["office.reports.view", "office.report-favorites.view", "office.report-favorites.edit"], system: false })
    await ctx.db.insert("officeUsers", { externalId: "a", email: "a@sandyq.test", name: "А", roleExternalId: "warehouse", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "b", email: "b@sandyq.test", name: "Б", roleExternalId: "warehouse", restaurantScopes: ["*"], active: true })
    await ctx.db.insert("officeUsers", { externalId: "c", email: "c@sandyq.test", name: "В", roleExternalId: "analyst", restaurantScopes: ["*"], active: true })
  })
  return { t, a: t.withIdentity({ email: "a@sandyq.test" }), b: t.withIdentity({ email: "b@sandyq.test" }), c: t.withIdentity({ email: "c@sandyq.test" }) }
}

describe("office favorites (W3-ADM-13)", () => {
  it("pins sections for their owner only; another user's favorites are not visible", async () => {
    const { t, a, b } = await setup()
    expect(await a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "stock", label: "Остатки" })).toEqual({ favorite: true })
    await a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "receipts", label: "Приходные накладные" })
    expect((await a.query(favorites.listFavorites, {})).map((item) => [item.id, item.label])).toEqual([
      ["section:stock", "Остатки"],
      ["section:receipts", "Приходные накладные"],
    ])
    expect(await b.query(favorites.listFavorites, {})).toEqual([])
    // b cannot reorder or remove a's rows: its own list is simply empty.
    await b.mutation(favorites.reorderFavorites, { ids: ["section:receipts", "section:stock"] })
    expect((await a.query(favorites.listFavorites, {})).map((item) => item.targetId)).toEqual(["stock", "receipts"])
    await expect(t.query(favorites.listFavorites, {})).rejects.toThrow(/Требуется вход/)

    expect(await a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "stock", label: "Остатки" })).toEqual({ favorite: false })
    expect((await a.query(favorites.listFavorites, {})).map((item) => item.targetId)).toEqual(["receipts"])
  })

  it("rejects unknown sections and ones the role cannot open; hides a section after the right is gone", async () => {
    const { t, a } = await setup()
    await expect(a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "no-such", label: "?" })).rejects.toThrow(/не найден/)
    await expect(a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "payroll", label: "Зарплата" })).rejects.toThrow(/Нет доступа/)
    await expect(a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "favorites", label: "Избранное" })).rejects.toThrow(/не найден/)
    await a.mutation(favorites.toggleFavorite, { kind: "document", targetId: "receipts/receipt-1", label: "Приход №1" })
    await a.mutation(favorites.toggleFavorite, { kind: "section", targetId: "stock", label: "Остатки" })
    await t.run(async (ctx) => {
      const role = (await ctx.db.query("officeRoles").withIndex("by_external_id", (q) => q.eq("externalId", "warehouse")).unique())!
      await ctx.db.patch(role._id, { capabilities: ["office.stock.view"] })
    })
    expect((await a.query(favorites.listFavorites, {})).map((item) => item.id)).toEqual(["section:stock"])
  })

  it("shows favorite report views in the same list and reorders across kinds", async () => {
    const { c } = await setup()
    const viewId = await c.mutation(api.domains.reports.mutations.saveView, { reportId: "sales-01", name: "Неделя", favorite: true, config })
    await c.mutation(favorites.toggleFavorite, { kind: "section", targetId: "reports", label: "Отчёты" })
    const listed = await c.query(favorites.listFavorites, {})
    expect(listed.map((item) => [item.id, item.label, item.reportTitle ?? null])).toEqual([
      ["section:reports", "Отчёты", null],
      [`report:${viewId}`, "Неделя", "Выручка по дням"],
    ])

    await c.mutation(favorites.reorderFavorites, { ids: [`report:${viewId}`, "section:reports"] })
    expect((await c.query(favorites.listFavorites, {})).map((item) => item.id)).toEqual([`report:${viewId}`, "section:reports"])
    await expect(c.mutation(favorites.reorderFavorites, { ids: ["section:reports", "section:reports"] })).rejects.toThrow(/повторы/)

    // Unpinning a report here keeps the saved view, just not as a favorite.
    expect(await c.mutation(favorites.toggleFavorite, { kind: "report", targetId: viewId, label: "Неделя" })).toEqual({ favorite: false })
    expect((await c.query(favorites.listFavorites, {})).map((item) => item.id)).toEqual(["section:reports"])
    expect((await c.query(api.domains.reports.mutations.listViews, {})).map((view) => [view.externalId, view.favorite])).toEqual([[viewId, false]])
    await expect(c.mutation(favorites.toggleFavorite, { kind: "report", targetId: viewId, label: "Неделя" })).rejects.toThrow(/из самого отчёта/)
  })
})
